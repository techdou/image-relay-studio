import { NextRequest } from 'next/server';
import { authenticateRequest, successResponse, errorResponse, requireAdmin } from '@/server/api-helpers';

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    requireAdmin(auth);

    const { getSupabaseServerClient } = await import('@/storage/database/supabase-client');
    const supabase = getSupabaseServerClient();

    const today = new Date().toISOString().split('T')[0];

    // Today tasks
    const { count: todayTasks } = await supabase
      .from('generation_tasks')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', today);

    // Today images
    const { count: todayImages } = await supabase
      .from('generation_assets')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', today);

    // Success rate
    const { data: todayRecords } = await supabase
      .from('usage_records')
      .select('status, latency_ms')
      .gte('created_at', today);

    const totalRecords = todayRecords?.length || 0;
    const succeededRecords = todayRecords?.filter((r: { status: string }) => r.status === 'succeeded').length || 0;
    const successRate = totalRecords > 0 ? succeededRecords / totalRecords : 0;
    const latencies = todayRecords?.filter((r: { latency_ms: number | null }) => r.latency_ms).map((r: { latency_ms: number }) => r.latency_ms) || [];
    const avgLatency = latencies.length > 0 ? latencies.reduce((a: number, b: number) => a + b, 0) / latencies.length : null;

    // Queue status
    const { count: queuedTasks } = await supabase
      .from('generation_tasks')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'queued');

    const { count: runningTasks } = await supabase
      .from('generation_tasks')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'running');

    // Active users today
    const { data: activeUsersData } = await supabase
      .from('usage_records')
      .select('user_id')
      .gte('created_at', today);
    const activeUsers = new Set(activeUsersData?.map((r: { user_id: string }) => r.user_id)).size;

    // Provider health
    let providerHealth: Array<{ provider: string; healthy: boolean }> = [];
    try {
      const { getProviderRouter } = await import('@/server/providers/images');
      const router = getProviderRouter();
      providerHealth = await router.healthCheckAll();
    } catch { /* ignore */ }

    // Recent errors
    const { data: recentErrors } = await supabase
      .from('generation_tasks')
      .select('id, error_message, created_at')
      .eq('status', 'failed')
      .order('created_at', { ascending: false })
      .limit(5);

    // Generation enabled
    const { data: genSetting } = await supabase
      .from('system_settings')
      .select('value')
      .eq('key', 'generation_enabled')
      .single();

    return successResponse({
      today_tasks: todayTasks || 0,
      today_images: todayImages || 0,
      success_rate: successRate,
      avg_latency_ms: avgLatency,
      queued_tasks: queuedTasks || 0,
      running_tasks: runningTasks || 0,
      active_users: activeUsers,
      provider_health: providerHealth,
      recent_errors: (recentErrors || []).map((e: { id: string; error_message: string; created_at: string }) => ({
        task_id: e.id,
        error_message: e.error_message,
        created_at: e.created_at,
      })),
      generation_enabled: genSetting?.value === 'true',
    }, auth.requestId);
  } catch (err) {
    return errorResponse(err, '');
  }
}
