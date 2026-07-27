import { NextRequest } from 'next/server';
import { authenticateRequest, successResponse, errorResponse, requireScope } from '@/server/api-helpers';
import { getQuotaUsage } from '@/server/quotas';

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    requireScope(auth, 'usage:read');
    const { getSupabaseServerClient } = await import('@/storage/database/supabase-client');
    const supabase = getSupabaseServerClient();

    const today = new Date().toISOString().split('T')[0];
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

    // Get quota
    const { data: quota } = await supabase
      .from('user_quotas')
      .select('*')
      .eq('user_id', auth.userId)
      .single();

    const quotaUsage = await getQuotaUsage(auth.userId);

    // Today stats
    const { data: todayRecords } = await supabase
      .from('usage_records')
      .select('status, latency_ms')
      .eq('user_id', auth.userId)
      .gte('created_at', today);

    const todayTotal = todayRecords?.length || 0;
    const todaySucceeded = todayRecords?.filter((r: { status: string }) => r.status === 'succeeded').length || 0;
    const todayFailed = todayRecords?.filter((r: { status: string }) => r.status === 'failed').length || 0;
    const todayLatencies = todayRecords?.filter((r: { latency_ms: number | null }) => r.latency_ms).map((r: { latency_ms: number }) => r.latency_ms) || [];
    const avgLatency = todayLatencies.length > 0
      ? todayLatencies.reduce((a: number, b: number) => a + b, 0) / todayLatencies.length
      : null;

    // Monthly stats
    const { data: monthlyRecords } = await supabase
      .from('usage_records')
      .select('status')
      .eq('user_id', auth.userId)
      .gte('created_at', monthStart);

    const monthlyTotal = monthlyRecords?.length || 0;
    const monthlySucceeded = monthlyRecords?.filter((r: { status: string }) => r.status === 'succeeded').length || 0;
    const monthlyFailed = monthlyRecords?.filter((r: { status: string }) => r.status === 'failed').length || 0;

    // By model
    const { data: modelRecords } = await supabase
      .from('usage_records')
      .select('model_config_id, status')
      .eq('user_id', auth.userId)
      .gte('created_at', monthStart);

    const modelStats = new Map<string, { count: number; success: number; display_name: string }>();
    for (const r of (modelRecords || [])) {
      const existing = modelStats.get(r.model_config_id) || { count: 0, success: 0, display_name: '' };
      existing.count++;
      if (r.status === 'succeeded') existing.success++;
      modelStats.set(r.model_config_id, existing);
    }

    // Get model names
    const modelIds = Array.from(modelStats.keys());
    const { data: modelConfigs } = await supabase
      .from('model_configs')
      .select('id, display_name')
      .in('id', modelIds);

    const byModel = Array.from(modelStats.entries()).map(([id, stats]) => {
      const config = modelConfigs?.find((m: { id: string }) => m.id === id);
      return {
        model_code: id,
        display_name: config?.display_name || id,
        count: stats.count,
        success_rate: stats.count > 0 ? stats.success / stats.count : 0,
      };
    });

    // Check generation enabled
    const { data: genSetting } = await supabase
      .from('system_settings')
      .select('value')
      .eq('key', 'generation_enabled')
      .single();

    return successResponse({
      quota: {
        daily_limit: quota?.daily_image_limit || 10,
        daily_used: quotaUsage.daily_used,
        monthly_limit: quota?.monthly_image_limit || 100,
        monthly_used: quotaUsage.monthly_used,
        max_concurrent: quota?.max_concurrent_tasks || 2,
        current_concurrent: quotaUsage.active_tasks,
      },
      today: {
        total_tasks: todayTotal,
        succeeded: todaySucceeded,
        failed: todayFailed,
        avg_latency_ms: avgLatency,
      },
      monthly: {
        total_tasks: monthlyTotal,
        succeeded: monthlySucceeded,
        failed: monthlyFailed,
        avg_latency_ms: null,
      },
      by_model: byModel,
      generation_enabled: genSetting?.value === 'true',
    }, auth.requestId);
  } catch (err) {
    return errorResponse(err, '');
  }
}
