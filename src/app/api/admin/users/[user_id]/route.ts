import { NextRequest } from 'next/server';
import { authenticateRequest, successResponse, errorResponse, requireAdmin } from '@/server/api-helpers';
import { AppError, ErrorCodes } from '@/server/errors';
import { adminUpdateUserSchema } from '@/server/validation/admin-schemas';
import { getQuotaUsage } from '@/server/quotas';

const QUOTA_FIELDS = [
  'daily_image_limit',
  'monthly_image_limit',
  'max_concurrent_tasks',
  'max_images_per_request',
  'api_access_enabled',
  'allowed_model_codes',
  'allowed_sizes',
  'retention_days',
] as const;

const PROFILE_FIELDS = ['display_name', 'role', 'status'] as const;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ user_id: string }> }
) {
  try {
    const { user_id } = await params;
    const auth = await authenticateRequest(request);
    requireAdmin(auth);

    const { getSupabaseServerClient } = await import('@/storage/database/supabase-client');
    const supabase = getSupabaseServerClient();

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user_id)
      .single();

    if (error || !profile) throw new AppError(ErrorCodes.TASK_NOT_FOUND, '用户不存在');

    const { data: quota } = await supabase
      .from('user_quotas')
      .select('*')
      .eq('user_id', profile.user_id)
      .single();

    // Recent tasks
    const { data: recentTasks } = await supabase
      .from('generation_tasks')
      .select('id, status, task_type, created_at, error_message')
      .eq('user_id', profile.user_id)
      .order('created_at', { ascending: false })
      .limit(10);

    const usage = await getQuotaUsage(profile.user_id);

    return successResponse({
      profile,
      quota: quota || null,
      recent_tasks: recentTasks || [],
      today_usage: usage.daily_used,
    }, auth.requestId);
  } catch (err) {
    return errorResponse(err, '');
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ user_id: string }> }
) {
  try {
    const { user_id: targetUserId } = await params;
    const auth = await authenticateRequest(request);
    requireAdmin(auth);

    const body = await request.json();
    const parsed = adminUpdateUserSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      });
    }
    const data = parsed.data;

    const { getSupabaseServerClient } = await import('@/storage/database/supabase-client');
    const supabase = getSupabaseServerClient();

    // Get current profile
    const { data: currentProfile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', targetUserId)
      .single();

    if (!currentProfile) throw new AppError(ErrorCodes.TASK_NOT_FOUND, '用户不存在');

    // ── Admin self-protection ────────────────────────────────────────
    // An admin cannot demote or disable themselves (would leave the system
    // without an active admin if they're the only one). They also cannot
    // demote the last remaining admin.
    const isSelf = currentProfile.user_id === auth.userId;
    const newRole = data.role;
    const newStatus = data.status;
    if (isSelf && newRole === 'user') {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Cannot demote yourself');
    }
    if (isSelf && newStatus === 'disabled') {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Cannot disable yourself');
    }

    if (newRole === 'user' && currentProfile.role === 'admin') {
      // Refuse to demote the last active admin. Count active admins; the
      // target itself still counts because the demotion hasn't happened yet.
      const { count } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'admin')
        .eq('status', 'active');
      if ((count ?? 0) <= 1) {
        throw new AppError(ErrorCodes.FORBIDDEN, 'Cannot demote the last admin');
      }
    }

    // Update profile fields (only those explicitly provided & validated)
    const profileUpdates: Record<string, unknown> = {};
    for (const field of PROFILE_FIELDS) {
      if (data[field] !== undefined) {
        profileUpdates[field] = data[field];
      }
    }

    if (Object.keys(profileUpdates).length > 0) {
      const { error } = await supabase
        .from('profiles')
        .update(profileUpdates)
        .eq('id', targetUserId);
      if (error) throw new AppError(ErrorCodes.INTERNAL_ERROR, '更新用户失败');
    }

    // Update quota fields
    const quotaUpdates: Record<string, unknown> = {};
    for (const field of QUOTA_FIELDS) {
      if (data[field] !== undefined) {
        quotaUpdates[field] = data[field];
      }
    }

    if (Object.keys(quotaUpdates).length > 0) {
      const { error } = await supabase
        .from('user_quotas')
        .update(quotaUpdates)
        .eq('user_id', currentProfile.user_id);
      if (error) throw new AppError(ErrorCodes.INTERNAL_ERROR, '更新额度失败');
    }

    // Audit log
    const { createAuditLogger } = await import('@/server/audit');
    const audit = createAuditLogger(auth.userId, auth.role, auth.requestId);
    await audit.logAction('update_user', 'user', targetUserId, currentProfile, { ...profileUpdates, ...quotaUpdates });

    return successResponse({ updated: true }, auth.requestId);
  } catch (err) {
    return errorResponse(err, '');
  }
}
