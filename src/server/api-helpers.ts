import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/storage/database/supabase-client';
import { generateRequestId, logger } from '@/server/logging';
import { AppError, ErrorCodes, errorStatusMap } from '@/server/errors';
import { checkRateLimit } from '@/server/rate-limit';

export type AuthMethod = 'apikey' | 'session';

export interface AuthResult {
  userId: string;
  role: 'admin' | 'user';
  profile: {
    id: string;
    user_id: string;
    email: string;
    role: 'admin' | 'user';
    status: 'active' | 'disabled' | 'pending';
    [key: string]: unknown;
  };
  requestId: string;
  /**
   * How the caller authenticated for this request.
   * - `'apikey'`: validated via the `irs_live_*` API key flow.
   * - `'session'`: validated via a Supabase session/JWT token.
   */
  authMethod: AuthMethod;
  /**
   * Scopes attached to the API key, if `authMethod === 'apikey'`.
   * Always `undefined` for session-authenticated requests; session callers are
   * currently treated as having full access.
   */
  scopes?: string[];
  apiKeyId?: string;
}

export async function authenticateRequest(request: NextRequest): Promise<AuthResult> {
  const requestId = generateRequestId();

  const sessionToken = request.headers.get('x-session');
  const authHeader = request.headers.get('authorization');

  let userId: string | null = null;
  let authMethod: AuthMethod | null = null;
  let scopes: string[] | undefined = undefined;
  let apiKeyId: string | undefined;

  if (sessionToken) {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser(sessionToken);
    if (!error && data.user) {
      userId = data.user.id;
      authMethod = 'session';
    }
  } else if (authHeader) {
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      if (token.startsWith('irs_live_')) {
        const { validateApiKey } = await import('@/server/api-keys');
        const result = await validateApiKey(token);
        if (result) {
          userId = result.user_id;
          authMethod = 'apikey';
          scopes = result.scopes;
          apiKeyId = result.id;
        }
      } else {
        const supabase = getSupabaseServerClient();
        const { data, error } = await supabase.auth.getUser(token);
        if (!error && data.user) {
          userId = data.user.id;
          authMethod = 'session';
        }
      }
    }
  }

  if (!userId || !authMethod) {
    // If the request had an Authorization header, it's an API key issue
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      if (token.startsWith('irs_live_')) {
        throw new AppError(ErrorCodes.API_KEY_INVALID, 'Invalid API key');
      }
      // Any other Bearer token that failed validation
      throw new AppError(ErrorCodes.API_KEY_INVALID, 'Invalid API key');
    }
    throw new AppError(ErrorCodes.UNAUTHORIZED, '未登录或会话已过期');
  }

  const supabase = getSupabaseServerClient();
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (profileError || !profile) {
    throw new AppError(ErrorCodes.UNAUTHORIZED, '用户资料不存在');
  }

  if (profile.status === 'disabled') {
    throw new AppError(ErrorCodes.USER_DISABLED, '账号已被禁用');
  }

  if (authMethod === 'apikey') {
    const [apiSettingResult, quotaResult] = await Promise.all([
      supabase
        .from('system_settings')
        .select('value')
        .eq('key', 'api_enabled')
        .maybeSingle(),
      supabase
        .from('user_quotas')
        .select('api_access_enabled')
        .eq('user_id', userId)
        .maybeSingle(),
    ]);

    // Previously issued keys must stop working immediately when either the
    // global or per-user switch is disabled. Missing rows/errors fail closed.
    if (
      apiSettingResult.error ||
      apiSettingResult.data?.value !== 'true' ||
      quotaResult.error ||
      quotaResult.data?.api_access_enabled !== true
    ) {
      throw new AppError(ErrorCodes.API_DISABLED, 'API access is disabled');
    }
  }

  return {
    userId,
    role: profile.role,
    profile,
    requestId,
    authMethod,
    // Only attach `scopes` for API-key auth; leave undefined for sessions.
    scopes: authMethod === 'apikey' ? scopes : undefined,
    apiKeyId: authMethod === 'apikey' ? apiKeyId : undefined,
  };
}

export function requireAdmin(auth: AuthResult): void {
  if (auth.role !== 'admin') {
    throw new AppError(ErrorCodes.FORBIDDEN, '无权访问管理接口');
  }
}

/**
 * Enforce that an API-key-authenticated request carries a specific scope.
 *
 * Session-authenticated requests (`authMethod === 'session'`) bypass scope
 * checks; scopes are an API-key-only concept. Admins are NOT auto-granted any
 * scope here — admins using an API key must still possess the required scope
 * explicitly, matching the principle of least privilege.
 *
 * @throws {AppError} FORBIDDEN when the scope is missing.
 */
export function requireScope(auth: AuthResult, requiredScope: string): void {
  if (auth.authMethod === 'session') {
    return;
  }
  const granted = auth.scopes;
  if (!Array.isArray(granted) || !granted.includes(requiredScope)) {
    throw new AppError(
      ErrorCodes.FORBIDDEN,
      `Required scope: ${requiredScope}`,
      { required_scope: requiredScope, granted_scopes: granted ?? [] }
    );
  }
}

/**
 * Extract the client IP from common proxy headers. Falls back to 'unknown'
 * if no proxy header is present (e.g. direct invocation in tests).
 */
export function getClientIp(request: NextRequest): string {
  const xForwardedFor = request.headers.get('x-forwarded-for');
  if (xForwardedFor) {
    // x-forwarded-for may be a comma-separated list; the first entry is the
    // original client.
    const first = xForwardedFor.split(',')[0];
    if (first) {
      return first.trim();
    }
  }
  const xRealIp = request.headers.get('x-real-ip');
  if (xRealIp) {
    return xRealIp.trim();
  }
  return 'unknown';
}

/**
 * Per-user generation rate limit: 60 requests / minute.
 * Apply this on image-generation and image-edit endpoints.
 *
 * @throws {AppError} RATE_LIMITED when the limit is exceeded.
 */
export function enforceGenerationRateLimit(userId: string): void {
  const ok = checkRateLimit({
    key: `gen:${userId}`,
    maxRequests: 60,
    windowMs: 60_000,
  }).allowed;
  if (!ok) {
    throw new AppError(
      ErrorCodes.RATE_LIMITED,
      'Generation rate limit exceeded (60/min)'
    );
  }
}

/**
 * Per-user upload rate limit: 30 requests / minute.
 * Apply this on image upload endpoints (POST /api/v1/images etc.).
 *
 * @throws {AppError} RATE_LIMITED when the limit is exceeded.
 */
export function enforceUploadRateLimit(userId: string): void {
  const ok = checkRateLimit({
    key: `upload:${userId}`,
    maxRequests: 30,
    windowMs: 60_000,
  }).allowed;
  if (!ok) {
    throw new AppError(
      ErrorCodes.RATE_LIMITED,
      'Upload rate limit exceeded (30/min)'
    );
  }
}

export function successResponse<T>(data: T, requestId: string, status: number = 200): NextResponse {
  return NextResponse.json({ data, request_id: requestId }, { status });
}

export function errorResponse(error: unknown, requestId: string): NextResponse {
  if (error instanceof AppError) {
    const status = errorStatusMap[error.code] || 500;
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
        request_id: requestId,
      },
      { status }
    );
  }

  // Avoid dumping the raw error object (which may carry request payload,
  // tokens, PII, etc.) straight to stderr. Reduce to its identity + message +
  // stack. `logger` runs the entry through `sanitizeForLog`, masking any
  // sensitive keys that slipped into a structured field.
  const safeError = error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : String(error);

  logger.error('Unhandled error', { error: safeError, request_id: requestId });

  return NextResponse.json(
    {
      error: {
        code: ErrorCodes.INTERNAL_ERROR,
        message: '内部错误',
      },
      request_id: requestId,
    },
    { status: 500 }
  );
}

export function paginatedResponse<T>(
  data: T[],
  total: number,
  page: number,
  pageSize: number,
  requestId: string
): NextResponse {
  return NextResponse.json({
    data,
    pagination: {
      total,
      page,
      page_size: pageSize,
      total_pages: Math.ceil(total / pageSize),
    },
    request_id: requestId,
  });
}
