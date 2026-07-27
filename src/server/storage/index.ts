import { S3Storage } from 'coze-coding-dev-sdk';
import { AppError, ErrorCodes } from '@/server/errors';

let storageInstance: S3Storage | null = null;

/**
 * Maximum allowed size when downloading a remote asset (20 MB).
 */
export const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

/**
 * Default timeout for remote fetches (15s).
 */
const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

/**
 * Hostname patterns that must never be reachable from a server-side fetch.
 * Blocks loopback / private ranges / link-local / cloud metadata endpoints
 * to mitigate SSRF attacks.
 */
const BLOCKED_HOST_PATTERNS: RegExp[] = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^169\.254\./,
  /^0\./,
  /^::1$/,
  /^fc/,
  /^fd/,
  /^fe80:/,
  /^localtest\.me$/,
  /^localhost$/,
  /^metadata\.google\.internal$/,
  /^metadata\.azure\.com$/,
  /^169\.254\.169\.254$/, // AWS / OpenStack metadata IP (also covered by link-local but kept explicit)
];

/**
 * Throws an AppError if the URL is not safe for the server to fetch.
 * Validates scheme (http/https only) and rejects private / loopback /
 * link-local / cloud-metadata hostnames.
 *
 * NOTE: hostname-only check is a first line of defense. It does NOT
 * protect against DNS rebinding or hosts that resolve to private IPs
 * after the check. For full protection, an egress allowlist at the
 * network layer is recommended. This helper focuses on the obvious
 * cases that don't require a socket connection.
 */
export function assertSafeUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Invalid URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AppError(
      ErrorCodes.SSRF_BLOCKED,
      `Protocol not allowed: ${parsed.protocol}`
    );
  }

  const host = parsed.hostname.toLowerCase();

  for (const pattern of BLOCKED_HOST_PATTERNS) {
    if (pattern.test(host)) {
      throw new AppError(ErrorCodes.SSRF_BLOCKED, `Blocked host: ${host}`);
    }
  }
}

/**
 * Fetches a URL with SSRF guard, timeout, and streaming size limit.
 * Returns the buffered body and content-type. Throws AppError on any
 * protocol / network / size violation.
 */
export async function fetchToBuffer(
  url: string,
  options: { maxBytes?: number; timeoutMs?: number } = {}
): Promise<{ buffer: Buffer; contentType: string }> {
  const maxBytes = options.maxBytes ?? MAX_DOWNLOAD_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;

  assertSafeUrl(url);

  let resp: Response;
  try {
    resp = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new AppError(
      ErrorCodes.PROVIDER_ERROR_NETWORK,
      `Fetch failed: ${err instanceof Error ? err.message : 'network error'}`
    );
  }

  if (!resp.ok) {
    throw new AppError(
      ErrorCodes.PROVIDER_ERROR,
      `Fetch failed: ${resp.status}`
    );
  }

  const contentLengthHeader = resp.headers.get('content-length');
  if (contentLengthHeader) {
    const contentLength = parseInt(contentLengthHeader, 10);
    if (!Number.isNaN(contentLength) && contentLength > maxBytes) {
      throw new AppError(ErrorCodes.FILE_TOO_LARGE, 'Response too large');
    }
  }

  const reader = resp.body?.getReader();
  if (!reader) {
    // No streaming body available; fall back to arrayBuffer (still bounded
    // by the content-length check above if present).
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.byteLength > maxBytes) {
      throw new AppError(ErrorCodes.FILE_TOO_LARGE, 'Response exceeds size limit');
    }
    const contentType = resp.headers.get('content-type') || 'image/png';
    return { buffer: buf, contentType };
  }

  const chunks: Buffer[] = [];
  let total = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // ignore
        }
        throw new AppError(ErrorCodes.FILE_TOO_LARGE, 'Response exceeds size limit');
      }
      chunks.push(Buffer.from(value));
    }
  }

  const buffer = Buffer.concat(chunks);
  const contentType = resp.headers.get('content-type') || 'image/png';
  return { buffer, contentType };
}

function ensureEnvLoaded(): void {
  if (process.env.COZE_BUCKET_ENDPOINT_URL && process.env.COZE_BUCKET_NAME) {
    return;
  }
  // Trigger dynamic env loading via supabase-client's loadEnv
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@/storage/database/supabase-client').getSupabaseCredentials();
  } catch {
    // If supabase loading fails, continue with current env
  }
}

export function getStorage(): S3Storage {
  if (!storageInstance) {
    ensureEnvLoaded();
    storageInstance = new S3Storage({
      endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
      accessKey: '',
      secretKey: '',
      bucketName: process.env.COZE_BUCKET_NAME,
      region: 'cn-beijing',
    });
  }
  return storageInstance;
}

export function generateObjectKey(
  userId: string,
  category: 'references' | 'generated' | 'thumbnails',
  fileName: string
): string {
  const now = new Date();
  const yyyy = now.getFullYear().toString();
  const mm = (now.getMonth() + 1).toString().padStart(2, '0');
  const sanitized = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `users/${userId}/${category}/${yyyy}/${mm}/${sanitized}`;
}

export async function generateSignedUrl(key: string, expireTime: number = 600): Promise<string> {
  const storage = getStorage();
  return storage.generatePresignedUrl({ key, expireTime });
}

export async function uploadFile(
  fileContent: Buffer,
  fileName: string,
  contentType: string
): Promise<string> {
  const storage = getStorage();
  const key = await storage.uploadFile({
    fileContent,
    fileName,
    contentType,
  });
  return key;
}

// Adapter class for provider/storage consumers
export class StorageClient {
  async upload(key: string, data: Buffer, contentType: string): Promise<void> {
    const storage = getStorage();
    await storage.uploadFile({
      fileContent: data,
      fileName: key,
      contentType,
    });
  }

  async getSignedUrl(key: string, expireTime: number = 600): Promise<string> {
    return generateSignedUrl(key, expireTime);
  }

  async delete(key: string): Promise<boolean> {
    return deleteFile(key);
  }

  async exists(key: string): Promise<boolean> {
    return fileExists(key);
  }
}

export function createStorageClient(): StorageClient {
  return new StorageClient();
}

export async function deleteFile(key: string): Promise<boolean> {
  const storage = getStorage();
  return storage.deleteFile({ fileKey: key });
}

export async function fileExists(key: string): Promise<boolean> {
  const storage = getStorage();
  return storage.fileExists({ fileKey: key });
}

export async function downloadAndPersist(url: string, targetKey: string): Promise<string> {
  const storage = getStorage();
  const { buffer, contentType } = await fetchToBuffer(url);
  const key = await storage.uploadFile({
    fileContent: buffer,
    fileName: targetKey,
    contentType,
  });
  return key;
}
