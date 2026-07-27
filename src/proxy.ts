import { NextRequest, NextResponse } from 'next/server';

/**
 * Global proxy (Next.js 16.1+):
 * - Enforces security headers (CSP, X-Content-Type-Options, etc.)
 * - Sets CORS headers for OpenAI-compatible API endpoints
 * - Handles CORS preflight (OPTIONS)
 */
export function proxy(request: NextRequest) {
  const response = NextResponse.next();
  const { pathname } = request.nextUrl;

  // ── Security headers for all routes ─────────────────────────────────
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=()'
  );
  // CSP: connect-src 使用通配符以兼容 Supabase 等外部服务的动态域名
  // （Supabase 实例域名不固定，无法在编译期枚举）
  response.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self'",
      "connect-src 'self' https: wss:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ')
  );

  // ── CORS for /api/v1/* (OpenAI-compatible endpoints) ────────────────
  if (pathname.startsWith('/api/v1/')) {
    response.headers.set('Access-Control-Allow-Origin', '*');
    response.headers.set(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, PATCH, DELETE, OPTIONS'
    );
    response.headers.set(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, x-session, x-idempotency-key'
    );
    response.headers.set('Access-Control-Max-Age', '86400');
  }

  // ── Handle CORS preflight ───────────────────────────────────────────
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: response.headers,
    });
  }

  return response;
}

export const config = {
  matcher: [
    // Match all routes except static files and Next.js internals
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
