import { NextRequest } from 'next/server';
import { authenticateRequest, successResponse, errorResponse, requireAdmin } from '@/server/api-helpers';
import { AppError, ErrorCodes } from '@/server/errors';
import { logger } from '@/server/logging';
import { createUserSchema } from '@/server/validation/schemas';
import { adminListUsersQuerySchema } from '@/server/validation/admin-schemas';

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    requireAdmin(auth);

    const { searchParams } = new URL(request.url);
    const rawQuery: Record<string, string | undefined> = {
      page: searchParams.get('page') ?? undefined,
      page_size: searchParams.get('page_size') ?? undefined,
      status: searchParams.get('status') ?? undefined,
      search: searchParams.get('search') ?? undefined,
    };
    const parsed = adminListUsersQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Invalid query parameters', {
        issues: parsed.error.issues,
      });
    }
    const { page, page_size: pageSize, status, search } = parsed.data;

    const { getSupabaseServerClient } = await import('@/storage/database/supabase-client');
    const supabase = getSupabaseServerClient();

    let query = supabase
      .from('profiles')
      .select('id, user_id, email, display_name, role, status, last_login_at, created_at', { count: 'exact' })
      .range((page - 1) * pageSize, page * pageSize - 1)
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);
    if (search) {
      // `search` is already constrained by adminListUsersQuerySchema to a
      // safe character class, so it cannot inject Postgres filter syntax.
      // We additionally URL-encode it to neutralise any reserved chars
      // (.or() expects a raw filter string; encoding makes the value inert).
      const safe = encodeURIComponent(search);
      query = query.or(`email.ilike.%${safe}%,display_name.ilike.%${safe}%`);
    }

    const { data, count, error } = await query;
    if (error) throw new AppError(ErrorCodes.INTERNAL_ERROR, '查询用户失败');

    // Get quotas for each user
    const userIds = (data || []).map((u: { user_id: string }) => u.user_id);
    const { data: quotas } = await supabase
      .from('user_quotas')
      .select('*')
      .in('user_id', userIds.length > 0 ? userIds : ['__none__']);

    const quotaMap = new Map((quotas || []).map((q: { user_id: string }) => [q.user_id, q]));

    return successResponse({
      users: (data || []).map((u: { user_id: string }) => ({
        ...u,
        quota: quotaMap.get(u.user_id) || null,
      })),
      total: count || 0,
      page,
      page_size: pageSize,
    }, auth.requestId);
  } catch (err) {
    return errorResponse(err, '');
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    requireAdmin(auth);

    const body = await request.json();
    const parsed = createUserSchema.safeParse(body);

    if (!parsed.success) {
      const firstError = parsed.error.issues[0];
      throw new AppError(ErrorCodes.INVALID_REQUEST, firstError?.message || '参数校验失败');
    }

    const { email, password, display_name, role } = parsed.data;

    const { getSupabaseServerClient } = await import('@/storage/database/supabase-client');
    const supabase = getSupabaseServerClient();

    // Check if user already exists in profiles
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', email)
      .single();

    if (existingProfile) throw new AppError(ErrorCodes.INVALID_REQUEST, '用户已存在');

    // Step 1: Create Supabase Auth user via admin API
    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirm email
      user_metadata: {
        display_name: display_name || email.split('@')[0],
        role,
      },
    });

    if (authError) {
      if (authError.message.includes('already registered') || authError.message.includes('already been registered')) {
        throw new AppError(ErrorCodes.INVALID_REQUEST, '该邮箱已在认证系统中注册');
      }
      logger.error('Admin create user: auth creation failed', { error: authError.message, email });
      // Don't leak Supabase auth internals back to the caller.
      throw new AppError(ErrorCodes.INTERNAL_ERROR, '创建认证账号失败，请稍后重试');
    }

    if (!authUser.user) {
      throw new AppError(ErrorCodes.INTERNAL_ERROR, '创建认证账号失败：未返回用户数据');
    }

    const userId = authUser.user.id;

    // Step 2: Create profile (upsert to handle potential race with trigger)
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .upsert({
        user_id: userId,
        email,
        display_name: display_name || email.split('@')[0],
        role,
        status: 'active',
      }, { onConflict: 'user_id' })
      .select()
      .single();

    if (profileError) {
      logger.error('Admin create user: profile creation failed', { error: profileError.message, user_id: userId });
      // Attempt to clean up the auth user since profile creation failed
      await supabase.auth.admin.deleteUser(userId);
      throw new AppError(ErrorCodes.INTERNAL_ERROR, '创建用户资料失败');
    }

    // Step 3: Create default quota
    const { data: defaultSettings } = await supabase
      .from('system_settings')
      .select('key, value')
      .in('key', ['default_daily_limit', 'default_monthly_limit', 'default_max_concurrency', 'default_retention_days', 'api_enabled']);

    const settingMap = new Map((defaultSettings || []).map((s: { key: string; value: string }) => [s.key, s.value]));

    // If API is globally enabled, grant new users API access by default
    const apiAccessEnabled = settingMap.get('api_enabled') === 'true';

    const { error: quotaError } = await supabase.from('user_quotas').insert({
      user_id: userId,
      daily_image_limit: parseInt(settingMap.get('default_daily_limit') || '50'),
      monthly_image_limit: parseInt(settingMap.get('default_monthly_limit') || '500'),
      max_concurrent_tasks: parseInt(settingMap.get('default_max_concurrency') || '3'),
      max_images_per_request: 4,
      api_access_enabled: apiAccessEnabled,
      retention_days: parseInt(settingMap.get('default_retention_days') || '90'),
    });

    if (quotaError) {
      logger.error('Admin create user: quota creation failed', { error: quotaError.message, user_id: userId });
      // Non-fatal: user is created, quota can be fixed later
    }

    // Step 4: Audit log
    const { createAuditLogger } = await import('@/server/audit');
    const audit = createAuditLogger(auth.userId, auth.role, auth.requestId);
    await audit.logAction('create_user', 'user', profile.id, null, { email, role });

    logger.info('Admin create user: success', { email, role, created_by: auth.userId });

    return successResponse({
      id: profile.id,
      user_id: userId,
      email,
      display_name: profile.display_name,
      role,
      status: 'active',
      message: '用户创建成功，已可使用邮箱和密码登录',
    }, auth.requestId, 201);
  } catch (err) {
    return errorResponse(err, '');
  }
}
