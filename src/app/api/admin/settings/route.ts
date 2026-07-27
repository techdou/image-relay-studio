import { NextRequest } from 'next/server';
import { authenticateRequest, successResponse, errorResponse, requireAdmin } from '@/server/api-helpers';
import { AppError, ErrorCodes } from '@/server/errors';
import { logger } from '@/server/logging';

// Descriptions for each setting key
const SETTING_DESCRIPTIONS: Record<string, string> = {
  generation_enabled: '全局图像生成开关',
  api_enabled: 'API 访问总开关',
  public_registration_enabled: '公开注册开关',
  default_daily_limit: '默认每日生成限额',
  default_monthly_limit: '默认每月生成限额',
  default_max_concurrency: '默认最大并发数',
  prompt_logging_mode: 'Prompt 日志模式: full/redacted/disabled',
  default_retention_days: '默认数据保留天数',
  maintenance_message: '维护公告信息',
};

// Mapping from system_settings key → user_quotas column
// When a default quota setting is changed, users still using the old default
// get their quota updated to the new default.
const QUOTA_PROPAGATION_MAP: Record<string, { column: string; parser: (v: string) => number }> = {
  default_daily_limit: { column: 'daily_image_limit', parser: (v) => parseInt(v) || 50 },
  default_monthly_limit: { column: 'monthly_image_limit', parser: (v) => parseInt(v) || 500 },
  default_max_concurrency: { column: 'max_concurrent_tasks', parser: (v) => parseInt(v) || 3 },
  default_retention_days: { column: 'retention_days', parser: (v) => parseInt(v) || 90 },
};

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    requireAdmin(auth);

    const { getSupabaseServerClient } = await import('@/storage/database/supabase-client');
    const supabase = getSupabaseServerClient();

    const { data, error } = await supabase
      .from('system_settings')
      .select('*')
      .order('key');

    if (error) throw new AppError(ErrorCodes.INTERNAL_ERROR, '查询设置失败');

    return successResponse({ settings: data || [] }, auth.requestId);
  } catch (err) {
    return errorResponse(err, '');
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    requireAdmin(auth);

    const body = await request.json();
    const { key, value } = body;

    if (!key || value === undefined) {
      throw new AppError(ErrorCodes.INVALID_REQUEST, 'key 和 value 必填');
    }

    if (!(key in SETTING_DESCRIPTIONS)) {
      throw new AppError(ErrorCodes.INVALID_REQUEST, `未知的设置项: ${key}`);
    }

    const { getSupabaseServerClient } = await import('@/storage/database/supabase-client');
    const supabase = getSupabaseServerClient();

    // Get current value for audit
    const { data: current } = await supabase
      .from('system_settings')
      .select('value')
      .eq('key', key)
      .single();

    const oldValue = current?.value;

    // Upsert with description
    const { error } = await supabase
      .from('system_settings')
      .upsert({
        key,
        value: String(value),
        description: SETTING_DESCRIPTIONS[key],
        updated_by: auth.userId,
      }, { onConflict: 'key' });

    if (error) throw new AppError(ErrorCodes.INTERNAL_ERROR, '更新设置失败');

    // ── Propagate quota changes to existing users ──────────────────────
    // When a default quota setting changes, update all users whose current
    // quota still matches the old default — they should inherit the new default.
    // Users with custom quotas (different from old default) are left untouched.
    let propagatedCount = 0;
    const propagation = QUOTA_PROPAGATION_MAP[key];
    if (propagation && oldValue != null) {
      const newParsed = propagation.parser(String(value));
      const oldParsed = propagation.parser(oldValue);

      if (newParsed !== oldParsed) {
        const { error: updateError, data: updatedRows } = await supabase
          .from('user_quotas')
          .update({ [propagation.column]: newParsed })
          .eq(propagation.column, oldParsed)
          .select('user_id');

        if (updateError) {
          logger.error('Failed to propagate quota setting to users', {
            key,
            old_value: oldParsed,
            new_value: newParsed,
            error: updateError.message,
          });
        } else {
          propagatedCount = updatedRows?.length || 0;
          logger.info('Propagated quota setting to users', {
            key,
            old_value: oldParsed,
            new_value: newParsed,
            affected_users: propagatedCount,
          });
        }
      }
    }

    const { createAuditLogger } = await import('@/server/audit');
    const audit = createAuditLogger(auth.userId, auth.role, auth.requestId);
    await audit.logAction('update_setting', 'system_setting', key, { value: oldValue }, { value: String(value) });

    return successResponse({
      updated: true,
      key,
      value: String(value),
      propagated_users: propagatedCount > 0 ? propagatedCount : undefined,
    }, auth.requestId);
  } catch (err) {
    return errorResponse(err, '');
  }
}
