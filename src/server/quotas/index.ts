import { getSupabaseClient } from '@/storage/database/supabase-client';
import { AppError, ErrorCodes } from '@/server/errors';
import { logger } from '@/server/logging';

export interface UserQuota {
  id: string;
  user_id: string;
  daily_image_limit: number;
  monthly_image_limit: number;
  max_concurrent_tasks: number;
  max_images_per_request: number;
  api_access_enabled: boolean;
  allowed_model_codes: string[];
  allowed_sizes: string[];
  retention_days: number;
}

export async function getUserQuota(userId: string): Promise<UserQuota> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('user_quotas')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    // Create default quota if not exists
    const { data: newQuota, error: createError } = await client
      .from('user_quotas')
      .insert({ user_id: userId })
      .select()
      .single();

    if (createError || !newQuota) {
      throw new AppError(ErrorCodes.INTERNAL_ERROR, 'Failed to create user quota');
    }
    return newQuota as unknown as UserQuota;
  }

  return data as unknown as UserQuota;
}

export async function updateUserQuota(
  userId: string,
  updates: Partial<UserQuota>,
  adminUserId: string
): Promise<UserQuota> {
  const client = getSupabaseClient();

  const { data, error } = await client
    .from('user_quotas')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .select()
    .single();

  if (error || !data) {
    throw new AppError(ErrorCodes.INTERNAL_ERROR, 'Failed to update user quota');
  }

  logger.info('User quota updated', {
    user_id: userId,
    admin_user_id: adminUserId,
    action: 'update_quota',
  });

  return data as unknown as UserQuota;
}

export async function checkQuota(userId: string, modelCode: string): Promise<void> {
  const client = getSupabaseClient();

  // Check generation enabled
  const { data: genSetting } = await client
    .from('system_settings')
    .select('value')
    .eq('key', 'generation_enabled')
    .single();

  if (genSetting?.value === 'false') {
    throw new AppError(ErrorCodes.GENERATION_DISABLED, 'Image generation is currently disabled');
  }

  const quota = await getUserQuota(userId);

  // Check model allowed
  if (quota.allowed_model_codes && quota.allowed_model_codes.length > 0) {
    if (!quota.allowed_model_codes.includes(modelCode)) {
      throw new AppError(ErrorCodes.MODEL_NOT_ALLOWED, `Model ${modelCode} is not allowed for this user`);
    }
  }

  // Check daily quota.
  // Counts usage_records in {queued, running, succeeded} — i.e. "active
  // quota slots". Failed records do NOT consume quota (the user should
  // be able to retry without being penalised for provider errors).
  // For this invariant to hold, retryTask in executor.ts MUST flip the
  // matching usage_records row back to 'queued' so the retry consumes
  // the existing slot rather than opening a new one.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const { count: dailyCount } = await client
    .from('usage_records')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', today.toISOString())
    .in('status', ['queued', 'running', 'succeeded']);

  if (dailyCount !== null && dailyCount >= quota.daily_image_limit) {
    throw new AppError(ErrorCodes.QUOTA_EXCEEDED, 'Daily image generation limit exceeded');
  }

  // Check monthly quota (same semantics as daily above).
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const { count: monthlyCount } = await client
    .from('usage_records')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', monthStart.toISOString())
    .in('status', ['queued', 'running', 'succeeded']);

  if (monthlyCount !== null && monthlyCount >= quota.monthly_image_limit) {
    throw new AppError(ErrorCodes.QUOTA_EXCEEDED, 'Monthly image generation limit exceeded');
  }

  // Check concurrent tasks
  const { count: activeCount } = await client
    .from('generation_tasks')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('status', ['queued', 'running'])
    .is('deleted_at', null);

  if (activeCount !== null && activeCount >= quota.max_concurrent_tasks) {
    throw new AppError(ErrorCodes.CONCURRENCY_LIMITED, 'Maximum concurrent tasks reached');
  }
}

export async function getQuotaUsage(userId: string): Promise<{
  daily_used: number;
  daily_limit: number;
  monthly_used: number;
  monthly_limit: number;
  active_tasks: number;
  max_concurrent: number;
}> {
  const client = getSupabaseClient();
  const quota = await getUserQuota(userId);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const { count: dailyUsed } = await client
    .from('usage_records')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', today.toISOString())
    .in('status', ['queued', 'running', 'succeeded']);

  const { count: monthlyUsed } = await client
    .from('usage_records')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', monthStart.toISOString())
    .in('status', ['queued', 'running', 'succeeded']);

  const { count: activeTasks } = await client
    .from('generation_tasks')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('status', ['queued', 'running'])
    .is('deleted_at', null);

  return {
    daily_used: dailyUsed || 0,
    daily_limit: quota.daily_image_limit,
    monthly_used: monthlyUsed || 0,
    monthly_limit: quota.monthly_image_limit,
    active_tasks: activeTasks || 0,
    max_concurrent: quota.max_concurrent_tasks,
  };
}
