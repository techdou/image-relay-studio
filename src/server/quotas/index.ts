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
    // Create the default row safely when two first requests race.
    const { data: newQuota, error: createError } = await client
      .from('user_quotas')
      .upsert(
        { user_id: userId },
        { onConflict: 'user_id', ignoreDuplicates: true }
      )
      .select()
      .maybeSingle();

    if (createError) {
      throw new AppError(ErrorCodes.INTERNAL_ERROR, 'Failed to create user quota');
    }
    if (newQuota) return newQuota as unknown as UserQuota;

    const { data: concurrentQuota, error: refetchError } = await client
      .from('user_quotas')
      .select('*')
      .eq('user_id', userId)
      .single();
    if (refetchError || !concurrentQuota) {
      throw new AppError(ErrorCodes.INTERNAL_ERROR, 'Failed to load user quota');
    }
    return concurrentQuota as unknown as UserQuota;
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

  const usage = await getQuotaUsage(userId);
  if (usage.daily_used >= quota.daily_image_limit) {
    throw new AppError(ErrorCodes.QUOTA_EXCEEDED, 'Daily image generation limit exceeded');
  }
  if (usage.monthly_used >= quota.monthly_image_limit) {
    throw new AppError(ErrorCodes.QUOTA_EXCEEDED, 'Monthly image generation limit exceeded');
  }
  if (usage.active_tasks >= quota.max_concurrent_tasks) {
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

  const { data, error } = await client.rpc('get_generation_quota_usage', {
    p_user_id: userId,
  });
  if (error || !data) {
    logger.error('Failed to fetch quota usage', {
      user_id: userId,
      error: error?.message,
    });
    throw new AppError(ErrorCodes.INTERNAL_ERROR, 'Failed to fetch quota usage');
  }
  const usage = data as unknown as {
    daily_used: number;
    monthly_used: number;
    active_tasks: number;
  };

  return {
    daily_used: Number(usage.daily_used) || 0,
    daily_limit: quota.daily_image_limit,
    monthly_used: Number(usage.monthly_used) || 0,
    monthly_limit: quota.monthly_image_limit,
    active_tasks: Number(usage.active_tasks) || 0,
    max_concurrent: quota.max_concurrent_tasks,
  };
}
