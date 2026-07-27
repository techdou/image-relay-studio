import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/storage/database/supabase-client';
import { generateRequestId } from '@/server/logging';
import { AppError, ErrorCodes, errorStatusMap } from '@/server/errors';

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
}

export async function authenticateRequest(request: NextRequest): Promise<AuthResult> {
  const requestId = generateRequestId();

  const sessionToken = request.headers.get('x-session');
  const authHeader = request.headers.get('authorization');

  let userId: string | null = null;

  if (sessionToken) {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser(sessionToken);
    if (!error && data.user) {
      userId = data.user.id;
    }
  } else if (authHeader) {
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      if (token.startsWith('irs_live_')) {
        const { validateApiKey } = await import('@/server/api-keys');
        const result = await validateApiKey(token);
        if (result) {
          userId = result.user_id;
        }
      } else {
        const supabase = getSupabaseServerClient();
        const { data, error } = await supabase.auth.getUser(token);
        if (!error && data.user) {
          userId = data.user.id;
        }
      }
    }
  }

  if (!userId) {
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

  return {
    userId,
    role: profile.role,
    profile,
    requestId,
  };
}

export function requireAdmin(auth: AuthResult): void {
  if (auth.role !== 'admin') {
    throw new AppError(ErrorCodes.FORBIDDEN, '无权访问管理接口');
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

  console.error('Unhandled error:', error);
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
