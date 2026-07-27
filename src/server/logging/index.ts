import { randomUUID } from 'crypto';

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
];

export function generateRequestId(): string {
  return `req_${randomUUID().replace(/-/g, '')}`;
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
      const lowerKey = key.toLowerCase();
      if (SENSITIVE_KEYS.some((s) => lowerKey.includes(s))) {
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
