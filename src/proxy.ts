import { NextRequest, NextResponse } from 'next/server';

/**
 * Global proxy (Next.js 16.1+):
 * - Enforces security headers (CSP, HSTS, X-Content-Type-Options, etc.)
 * - Sets CORS headers for OpenAI-compatible API endpoints
 * - Handles CORS preflight (OPTIONS)
 *
 * 安全决策记录（reviewer 关注点）：
 * - `unsafe-eval` 已移除：Next.js 16 生产模式不需要，是最大的 XSS 防护缺口。
 * - `script-src 'unsafe-inline'`：保留。Next.js 16 当前未在此项目启用 nonce-based
 *   CSP（见 next.config.ts，未配置 nonce）。Next.js 在 SSR/Hydration/RSC 时会注入
 *   少量内联脚本（错误堆栈、路由 prefetch 提示等），如要彻底移除 'unsafe-inline'
 *   必须开启 nonce 方案并改写入口，超出本次改动范围。
 *   TODO(future): 切换到 nonce-based CSP，移除 'unsafe-inline'。
 * - `connect-src`/`img-src`：从通配 `https:`/`wss:` 收紧为明确的 Supabase URL
 *   和可选的 Storage Host，从构建期 env 读取，未配置时 fallback 到 'self'。
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

  // HSTS: 仅生产环境启用，避免本地开发 http://localhost 被 preload 永久锁死
  if (process.env.COZE_PROJECT_ENV === 'PROD') {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload'
    );
  }

  // ── Content Security Policy ────────────────────────────────────────
  // 从构建期 env 读取受信外部源（NEXT_PUBLIC_* 会被内联到运行时代码，proxy 在
  // Node 运行时也可以读到）。未配置时 fallback 到 'self'。
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const storageHost = process.env.NEXT_PUBLIC_STORAGE_HOST?.trim();

  const connectSources = [
    "'self'",
    ...(supabaseUrl ? [supabaseUrl] : []),
    // Supabase Realtime / auth websocket 与 http 同源，需要显式允许 wss:
    ...(supabaseUrl ? [supabaseUrl.replace(/^http/, 'ws')] : []),
    ...(storageHost ? [storageHost] : []),
  ];

  const imgSources = [
    "'self'",
    'data:',
    'blob:',
    ...(supabaseUrl ? [supabaseUrl] : []),
    ...(storageHost ? [storageHost] : []),
  ];

  response.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      // 保留 'unsafe-inline'：见文件头注释，需配合 nonce 方案才能移除
      "script-src 'self' 'unsafe-inline'",
      // Tailwind 运行时注入内联 style，Next.js 也注入内联样式 -> 需要 'unsafe-inline'
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      `img-src ${imgSources.join(' ')}`,
      // Google Fonts 实际字体文件
      "font-src 'self' data: https://fonts.gstatic.com",
      `connect-src ${connectSources.join(' ')}`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; ')
  );

  // ── CORS for /api/v1/* (OpenAI-compatible endpoints) ────────────────
  // SECURITY: 此处使用通配 `*` 是安全的，因为 /api/v1/* 全部走 Bearer Token 鉴权
  // (x-session / Authorization)，不依赖 cookie / session。
  // 如果未来为这些端点引入 cookie 鉴权，必须改为显式 origin 白名单，
  // 否则跨站请求会自动携带 cookie，引发 CSRF。
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
