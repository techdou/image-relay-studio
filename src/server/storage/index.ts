import { S3Storage } from 'coze-coding-dev-sdk';

let storageInstance: S3Storage | null = null;

function ensureEnvLoaded(): void {
  if (process.env.COZE_BUCKET_ENDPOINT_URL && process.env.COZE_BUCKET_NAME) {
    return;
  }
  // Trigger dynamic env loading via supabase-client's loadEnv
  try {
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
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download from URL: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') || 'image/png';
  const key = await storage.uploadFile({
    fileContent: buffer,
    fileName: targetKey,
    contentType,
  });
  return key;
}
