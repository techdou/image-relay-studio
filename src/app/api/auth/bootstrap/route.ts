import { NextRequest, NextResponse } from 'next/server';
import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import { successResponse, errorResponse } from '@/server/api-helpers';
import { AppError, ErrorCodes } from '@/server/errors';
import { logger } from '@/server/logging';
import { checkRateLimit } from '@/server/rate-limit';

/**
 * Timing-safe string comparison that does not leak length information.
 *
 * Both inputs are SHA-256 hashed first, so the comparison is always performed
 * against fixed-length 32-byte digests regardless of the input lengths. This
 * avoids the length-correlation timing leak that a naive `Buffer.from(a)`
 * comparison would introduce when `a` and `b` differ in length.
 */
function safeCompare(a: string, b: string): boolean {
  const aBuf = createHash('sha256').update(a).digest();
  const bBuf = createHash('sha256').update(b).digest();
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Extract the client IP from common proxy headers. Kept local because this
 * route is hit before any user context exists (it bootstraps the first user).
 */
function getBootstrapIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0];
    if (first) return first.trim();
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  return 'unknown';
}

/**
 * POST /api/auth/bootstrap
 *
 * Initialize the first admin user. This endpoint is idempotent:
 * - If an admin already exists in profiles, it returns early.
 * - If BOOTSTRAP_ADMIN_EMAIL is not set, returns 400.
 * - Otherwise, creates the Supabase Auth user + profile + quota.
 *
 * Security:
 *   1. Only works when no admin exists yet (idempotent guard).
 *   2. Requires BOOTSTRAP_ADMIN_EMAIL env var to be set.
 *   3. IP rate limited: 5 requests / minute per client IP (checked BEFORE
 *      token validation so failed attempts are also throttled).
 *   4. Token validation:
 *      - In production (COZE_PROJECT_ENV=PROD), a non-empty BOOTSTRAP_TOKEN
 *        is REQUIRED and the X-Bootstrap-Token header must match it using a
 *        timing-safe comparison. An empty env token is a hard 403.
 *      - In development, if BOOTSTRAP_TOKEN is set it must match; if it is
 *        empty the call is allowed without a token (backward compatibility).
 *   5. Optionally requires BOOTSTRAP_ADMIN_PASSWORD for the initial password.
 *      If not set, a random password is generated and returned ONCE.
 */
export async function POST(request: NextRequest) {
  try {
    // ── 1. IP rate limit (BEFORE token check so probing is throttled) ──
    const clientIp = getBootstrapIp(request);
    const rateLimit = checkRateLimit({
      key: `bootstrap:${clientIp}`,
      maxRequests: 5,
      windowMs: 60_000,
    });
    if (!rateLimit.allowed) {
      logger.warn('Bootstrap: rate limited', { ip: clientIp });
      return NextResponse.json(
        {
          error: {
            code: ErrorCodes.RATE_LIMITED,
            message: 'Too many bootstrap attempts. Please retry later.',
          },
          request_id: 'bootstrap',
        },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((rateLimit.resetAt - Date.now()) / 1000)) } }
      );
    }

    const bootstrapEmail = process.env.BOOTSTRAP_ADMIN_EMAIL;
    if (!bootstrapEmail) {
      throw new AppError(ErrorCodes.INVALID_REQUEST, 'BOOTSTRAP_ADMIN_EMAIL 环境变量未配置');
    }

    // ── 2. Timing-safe token validation ──────────────────────────────
    const bootstrapToken = process.env.BOOTSTRAP_TOKEN || '';
    const isProduction = process.env.COZE_PROJECT_ENV === 'PROD';

    // In PROD an empty configured token = not configured = hard reject.
    // In DEV an empty token preserves the historical "no token needed" path.
    if (isProduction && !bootstrapToken) {
      logger.error('Bootstrap: BOOTSTRAP_TOKEN not configured in production', {
        env: process.env.COZE_PROJECT_ENV,
      });
      throw new AppError(ErrorCodes.FORBIDDEN, 'Bootstrap token not configured');
    }

    if (bootstrapToken) {
      const providedToken = request.headers.get('X-Bootstrap-Token') || '';
      // Compare timing-safely. We deliberately run both an emptiness check
      // (so the 401 message differs from a wrong-value attempt) AND the
      // constant-time comparison (so wrong values don't leak via timing).
      const providedPresent = providedToken.length > 0;
      const valueMatches = providedPresent && safeCompare(providedToken, bootstrapToken);
      if (!providedPresent || !valueMatches) {
        logger.warn('Bootstrap: invalid or missing token', {
          has_env_token: true,
          provided: providedPresent,
          env: process.env.COZE_PROJECT_ENV,
        });
        throw new AppError(ErrorCodes.UNAUTHORIZED, 'Bootstrap token 无效或未提供');
      }
    }

    const { getSupabaseServerClient } = await import('@/storage/database/supabase-client');
    const supabase = getSupabaseServerClient();

    // Check if any admin already exists
    const { data: existingAdmin } = await supabase
      .from('profiles')
      .select('id, email, role')
      .eq('role', 'admin')
      .limit(1);

    if (existingAdmin && existingAdmin.length > 0) {
      return successResponse({
        message: '管理员已存在，跳过初始化',
        admin_email: existingAdmin[0].email,
      }, 'bootstrap');
    }

    // Check if this email already has a profile
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('id, user_id, email, role, status')
      .eq('email', bootstrapEmail)
      .single();

    if (existingProfile) {
      // Promote existing user to admin
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ role: 'admin', status: 'active' })
        .eq('id', existingProfile.id);

      if (updateError) {
        throw new AppError(ErrorCodes.INTERNAL_ERROR, '提升管理员权限失败');
      }

      logger.info('Bootstrap: promoted existing user to admin', { email: bootstrapEmail });

      return successResponse({
        message: '已将现有用户提升为管理员',
        admin_email: bootstrapEmail,
        promoted: true,
      }, 'bootstrap');
    }

    // Generate or read password
    const bootstrapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD || generateRandomPassword();

    // Use admin API to create user (works even when public signup is disabled)
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: bootstrapEmail,
      password: bootstrapPassword,
      email_confirm: true,
      user_metadata: {
        display_name: bootstrapEmail.split('@')[0],
        role: 'admin',
      },
    });

    if (authError) {
      if (authError.message.includes('already registered') || authError.message.includes('already been registered')) {
        // User exists in auth but not in profiles - find them and create profile
        const { data: listData, error: listError } = await supabase.auth.admin.listUsers();

        if (listError) {
          throw new AppError(ErrorCodes.INTERNAL_ERROR, '查询已有用户失败');
        }

        const existingUser = listData.users.find((u: { email?: string }) => u.email === bootstrapEmail);
        if (!existingUser) {
          throw new AppError(ErrorCodes.INTERNAL_ERROR, 'Auth 用户存在但无法找到');
        }

        // If password needs to be reset for existing user
        await supabase.auth.admin.updateUserById(existingUser.id, { password: bootstrapPassword });

        const result = await createProfileAndQuota(supabase, existingUser.id, bootstrapEmail, 'admin');

        if (!process.env.BOOTSTRAP_ADMIN_PASSWORD) {
          return successResponse({
            ...result,
            message: '已为现有 Auth 用户创建管理员资料，请妥善保存密码（仅展示一次）',
            admin_email: bootstrapEmail,
            admin_password: bootstrapPassword,
            warning: '此密码仅展示一次，请立即保存',
          }, 'bootstrap', 201);
        }

        return successResponse({
          ...result,
          message: '已为现有 Auth 用户创建管理员资料',
          admin_email: bootstrapEmail,
        }, 'bootstrap', 201);
      }

      throw new AppError(ErrorCodes.INTERNAL_ERROR, `创建 Auth 用户失败: ${authError.message}`);
    }

    if (!authData.user) {
      throw new AppError(ErrorCodes.INTERNAL_ERROR, '创建 Auth 用户失败：未返回用户数据');
    }

    const userId = authData.user.id;
    const result = await createProfileAndQuota(supabase, userId, bootstrapEmail, 'admin');

    // If password was auto-generated, include it in the response (shown only once)
    if (!process.env.BOOTSTRAP_ADMIN_PASSWORD) {
      return successResponse({
        ...result,
        message: '管理员账号已创建，请妥善保存密码（仅展示一次）',
        admin_email: bootstrapEmail,
        admin_password: bootstrapPassword,
        warning: '此密码仅展示一次，请立即保存',
      }, 'bootstrap', 201);
    }

    return successResponse({
      ...result,
      message: '管理员账号已创建',
      admin_email: bootstrapEmail,
    }, 'bootstrap', 201);
  } catch (err) {
    logger.error('Bootstrap failed', { error: err instanceof Error ? err.message : 'Unknown' });
    return errorResponse(err, 'bootstrap');
  }
}

async function createProfileAndQuota(
  supabase: ReturnType<typeof import('@/storage/database/supabase-client')['getSupabaseServerClient']>,
  userId: string,
  email: string,
  role: string
) {
  // Create profile (upsert to handle potential race with Supabase Auth trigger)
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .upsert({
      user_id: userId,
      email,
      display_name: email.split('@')[0],
      role,
      status: 'active',
    }, { onConflict: 'user_id' })
    .select()
    .single();

  if (profileError) {
    logger.error('Bootstrap: failed to create profile', { error: profileError.message });
    throw new AppError(ErrorCodes.INTERNAL_ERROR, '创建用户资料失败');
  }

  // Create default quota - admin users always get API access
  const { data: defaultSettings } = await supabase
    .from('system_settings')
    .select('key, value')
    .in('key', ['default_daily_limit', 'default_monthly_limit', 'default_max_concurrency', 'default_retention_days', 'api_enabled']);

  const settingMap = new Map((defaultSettings || []).map((s: { key: string; value: string }) => [s.key, s.value]));

  // Admin users always get API access enabled
  const { error: quotaError } = await supabase.from('user_quotas').insert({
    user_id: userId,
    daily_image_limit: parseInt(settingMap.get('default_daily_limit') || '50'),
    monthly_image_limit: parseInt(settingMap.get('default_monthly_limit') || '500'),
    max_concurrent_tasks: parseInt(settingMap.get('default_max_concurrency') || '3'),
    max_images_per_request: 4,
    api_access_enabled: true,
    retention_days: parseInt(settingMap.get('default_retention_days') || '90'),
  });

  if (quotaError) {
    logger.error('Bootstrap: failed to create quota', { error: quotaError.message });
    // Non-fatal: profile is created, quota can be fixed later
  }

  // Audit log
  const { createAuditLog } = await import('@/server/audit');
  await createAuditLog({
    actor_user_id: userId,
    actor_role: role,
    action: 'bootstrap_admin',
    resource_type: 'user',
    resource_id: profile.id,
    metadata: { email, role, source: 'bootstrap' },
  });

  logger.info('Bootstrap: admin user created', { email, user_id: userId });

  return { profile_id: profile.id };
}

function generateRandomPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
  const length = 16;
  const bytes = randomBytes(length);
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars[bytes[i] % chars.length];
  }
  return password;
}
