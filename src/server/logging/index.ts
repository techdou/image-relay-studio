import { randomUUID } from 'crypto';

/**
 * Keys whose values must be redacted from logs.
 *
 * Matching uses word-boundary semantics (see isSensitiveKey) so that
 * 'keyboard' is NOT redacted (substring 'key' followed by alphabetic
 * characters), while 'api_key', 'apikey', 'key_id', 'key' are redacted.
 */
const SENSITIVE_KEYS = [
  'authorization',
  'cookie',
  'x-session',
  'api_key',
  'access_token',
  'refresh_token',
  'service_role_key',
  'provider_token',
  'password',
  'secret',
  'token',
  'key_hash',
  // Newly added per spec: catch no-underscore variants and broader coverage.
  'prompt',
  'email',
  'apikey',
  'accesstoken',
  'refreshtoken',
  'pepper',
  'session',
  'key',
];

/**
 * Explicit whitelist of key names that must NEVER be redacted even if
 * they contain a sensitive substring (e.g. 'key_prefix' is safe to log
 * because it is a non-secret identifier prefix).
 */
const SAFE_KEYS = new Set<string>([
  'key_prefix',
  'key_id',
  'key_path',
  'keyboard', // belt-and-suspenders: even if word-boundary logic misses
]);

export function generateRequestId(): string {
  return `req_${randomUUID().replace(/-/g, '')}`;
}

function isAlphaNumeric(ch: string): boolean {
  return /^[a-z0-9]$/.test(ch);
}

/**
 * Determines if a key should be redacted using word-boundary semantics.
 *
 * Normalisation: the key is lowercased and all non-alphanumeric
 * characters are stripped ('api_key' -> 'apikey', 'key-id' -> 'keyid').
 * Each sensitive token is likewise normalised; we look for it in the
 * normalised key and require that it is bordered by non-alphanumeric
 * (or string boundary) characters on both sides.
 *
 * Examples:
 *   - 'api_key'      -> 'apikey', token 'key'   -> match at end    -> REDACT
 *   - 'key_id'       -> 'keyid',  token 'key'   -> match at start  -> REDACT
 *   - 'keyboard'     -> 'keyboard', token 'key' -> followed by 'b' -> KEEP
 *   - 'authorization'-> 'authorization', token 'authorization'    -> REDACT
 */
function isSensitiveKey(rawKey: string): boolean {
  const normalizedKey = rawKey.toLowerCase().replace(/[^a-z0-9]/g, '');

  // Whitelist takes precedence.
  if (SAFE_KEYS.has(rawKey.toLowerCase())) return false;

  for (const s of SENSITIVE_KEYS) {
    const normalized = s.replace(/[^a-z0-9]/g, '');
    if (!normalized) continue;
    const idx = normalizedKey.indexOf(normalized);
    if (idx < 0) continue;
    const before = idx > 0 ? normalizedKey[idx - 1] : '';
    const after =
      idx + normalized.length < normalizedKey.length
        ? normalizedKey[idx + normalized.length]
        : '';
    const beforeOk = !before || !isAlphaNumeric(before);
    const afterOk = !after || !isAlphaNumeric(after);
    if (beforeOk && afterOk) return true;
  }
  return false;
}

export function sanitizeForLog(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return obj;
  if (typeof obj === 'number' || typeof obj === 'boolean') return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeForLog(item));
  }

  if (typeof obj === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (isSensitiveKey(key)) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = sanitizeForLog(value);
      }
    }
    return sanitized;
  }

  return obj;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  request_id?: string;
  user_id?: string;
  route?: string;
  action?: string;
  task_id?: string;
  provider?: string;
  model_code?: string;
  duration_ms?: number;
  result?: string;
  message: string;
  [key: string]: unknown;
}

function formatLog(entry: LogEntry): string {
  return JSON.stringify(sanitizeForLog(entry));
}

function createLogger(level: LogLevel) {
  return (message: string, data?: Partial<LogEntry>) => {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...data,
    };

    const output = formatLog(entry);

    switch (level) {
      case 'error':
        console.error(output);
        break;
      case 'warn':
        console.warn(output);
        break;
      default:
        console.log(output);
    }
  };
}

export const logger = {
  debug: createLogger('debug'),
  info: createLogger('info'),
  warn: createLogger('warn'),
  error: createLogger('error'),
};
