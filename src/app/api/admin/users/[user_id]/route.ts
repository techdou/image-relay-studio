import { NextRequest } from 'next/server';
import { authenticateRequest, successResponse, errorResponse, requireAdmin } from '@/server/api-helpers';
import { AppError, ErrorCodes } from '@/server/errors';

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

    // Usage today
    const today = new Date().toISOString().split('T')[0];
    const { count: todayCount } = await supabase
      .from('usage_records')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', profile.user_id)
      .gte('created_at', today);

    return successResponse({
      profile,
      quota: quota || null,
      recent_tasks: recentTasks || [],
      today_usage: todayCount || 0,
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
    const { user_id } = await params;
    const auth = await authenticateRequest(request);
    requireAdmin(auth);

    const body = await request.json();

    const { getSupabaseServerClient } = await import('@/storage/database/supabase-client');
    const supabase = getSupabaseServerClient();

    // Get current profile
    const { data: currentProfile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user_id)
      .single();

    if (!currentProfile) throw new AppError(ErrorCodes.TASK_NOT_FOUND, '用户不存在');

    // Update profile fields
    const profileUpdates: Record<string, unknown> = {};
    if (body.display_name !== undefined) profileUpdates.display_name = body.display_name;
    if (body.status !== undefined) profileUpdates.status = body.status;
    if (body.role !== undefined) profileUpdates.role = body.role;

    if (Object.keys(profileUpdates).length > 0) {
      const { error } = await supabase
        .from('profiles')
        .update(profileUpdates)
        .eq('id', user_id);
      if (error) throw new AppError(ErrorCodes.INTERNAL_ERROR, '更新用户失败');
    }

    // Update quota fields
    const quotaUpdates: Record<string, unknown> = {};
    const quotaFields = [
      'daily_image_limit', 'monthly_image_limit', 'max_concurrent_tasks',
      'max_images_per_request', 'api_access_enabled', 'allowed_model_codes',
      'allowed_sizes', 'retention_days'
    ];
    for (const field of quotaFields) {
      if (body[field] !== undefined) quotaUpdates[field] = body[field];
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
    await audit.logAction('update_user', 'user', user_id, currentProfile, { ...profileUpdates, ...quotaUpdates });

    return successResponse({ updated: true }, auth.requestId);
  } catch (err) {
    return errorResponse(err, '');
  }
}
