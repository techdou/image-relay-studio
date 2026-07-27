// Central error codes for the application
export const ErrorCodes = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  USER_DISABLED: 'USER_DISABLED',
  API_DISABLED: 'API_DISABLED',
  GENERATION_DISABLED: 'GENERATION_DISABLED',
  INVALID_REQUEST: 'INVALID_REQUEST',
  INVALID_FILE: 'INVALID_FILE',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  PROVIDER_ERROR_NETWORK: 'PROVIDER_ERROR_NETWORK',
  SSRF_BLOCKED: 'SSRF_BLOCKED',
  MODEL_NOT_FOUND: 'MODEL_NOT_FOUND',
  MODEL_DISABLED: 'MODEL_DISABLED',
  MODEL_NOT_ALLOWED: 'MODEL_NOT_ALLOWED',
  SIZE_NOT_ALLOWED: 'SIZE_NOT_ALLOWED',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  CONCURRENCY_LIMITED: 'CONCURRENCY_LIMITED',
  RATE_LIMITED: 'RATE_LIMITED',
  TASK_NOT_FOUND: 'TASK_NOT_FOUND',
  INVALID_TASK_STATE: 'INVALID_TASK_STATE',
  PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
  PROVIDER_RATE_LIMITED: 'PROVIDER_RATE_LIMITED',
  PROVIDER_REJECTED: 'PROVIDER_REJECTED',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  STORAGE_ERROR: 'STORAGE_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  API_KEY_INVALID: 'API_KEY_INVALID',
  API_KEY_REVOKED: 'API_KEY_REVOKED',
  API_KEY_EXPIRED: 'API_KEY_EXPIRED',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  INVALID_MIME_TYPE: 'INVALID_MIME_TYPE',
  PROMPT_TOO_LONG: 'PROMPT_TOO_LONG',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

const RETRYABLE_ERRORS: ErrorCode[] = [
  ErrorCodes.PROVIDER_TIMEOUT,
  ErrorCodes.PROVIDER_RATE_LIMITED,
  ErrorCodes.STORAGE_ERROR,
  ErrorCodes.INTERNAL_ERROR,
  ErrorCodes.PROVIDER_ERROR_NETWORK,
];

/**
 * Provider error codes that should be considered retryable.
 * Used by executor to flag failures that can safely be retried.
 */
export const RETRYABLE_PROVIDER_ERRORS: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  ErrorCodes.PROVIDER_TIMEOUT,
  ErrorCodes.PROVIDER_RATE_LIMITED,
  ErrorCodes.PROVIDER_ERROR_NETWORK,
]);

export function isRetryableProviderError(code: ErrorCode | string | null | undefined): boolean {
  if (!code) return false;
  return RETRYABLE_PROVIDER_ERRORS.has(code as ErrorCode);
}

export function isRetryableError(code: ErrorCode): boolean {
  return RETRYABLE_ERRORS.includes(code);
}

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

export function createApiErrorResponse(error: AppError | unknown, requestId: string) {
  if (error instanceof AppError) {
    const status = errorStatusMap[error.code] || 500;
    return {
      status,
      body: {
        error: error.toJSON(),
        request_id: requestId,
      },
    };
  }
  return {
    status: 500,
    body: {
      error: {
        code: ErrorCodes.INTERNAL_ERROR,
        message: 'An unexpected error occurred',
      },
      request_id: requestId,
    },
  };
}

export const errorStatusMap: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  USER_DISABLED: 403,
  API_DISABLED: 403,
  GENERATION_DISABLED: 503,
  INVALID_REQUEST: 400,
  INVALID_FILE: 400,
  VALIDATION_ERROR: 400,
  SSRF_BLOCKED: 400,
  MODEL_NOT_FOUND: 404,
  MODEL_DISABLED: 400,
  MODEL_NOT_ALLOWED: 403,
  SIZE_NOT_ALLOWED: 400,
  QUOTA_EXCEEDED: 429,
  CONCURRENCY_LIMITED: 429,
  RATE_LIMITED: 429,
  TASK_NOT_FOUND: 404,
  INVALID_TASK_STATE: 409,
  PROVIDER_TIMEOUT: 504,
  PROVIDER_RATE_LIMITED: 502,
  PROVIDER_REJECTED: 400,
  PROVIDER_ERROR: 502,
  PROVIDER_ERROR_NETWORK: 502,
  STORAGE_ERROR: 500,
  INTERNAL_ERROR: 500,
  API_KEY_INVALID: 401,
  API_KEY_REVOKED: 401,
  API_KEY_EXPIRED: 401,
  IDEMPOTENCY_CONFLICT: 409,
  FILE_TOO_LARGE: 413,
  INVALID_MIME_TYPE: 400,
  PROMPT_TOO_LONG: 400,
};
