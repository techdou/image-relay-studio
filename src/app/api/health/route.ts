import { NextResponse } from 'next/server';

export async function GET() {
  const checks: Record<string, { status: string; latency_ms?: number }> = {};
  let overallStatus = 'healthy';

  // Database check
  const dbStart = Date.now();
  try {
    const { getSupabaseClient } = await import('@/storage/database/supabase-client');
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('system_settings').select('id').limit(1);
    checks.database = {
      status: error ? 'unhealthy' : 'healthy',
      latency_ms: Date.now() - dbStart,
    };
    if (error) overallStatus = 'degraded';
  } catch {
    checks.database = { status: 'unhealthy' };
    overallStatus = 'degraded';
  }

  // Storage check
  const storageStart = Date.now();
  try {
    const { createStorageClient } = await import('@/server/storage');
    const storage = createStorageClient();
    await storage.exists('__health_check__');
    checks.storage = {
      status: 'healthy',
      latency_ms: Date.now() - storageStart,
    };
  } catch {
    checks.storage = { status: 'unhealthy' };
    overallStatus = 'degraded';
  }

  // Provider check - lightweight, just check if providers are registered
  try {
    const { getProviderRouter } = await import('@/server/providers/images');
    const router = getProviderRouter();
    checks.providers = { status: 'healthy' };
    // Don't run actual health check as it may be slow
    void router; // ensure router is used
  } catch {
    checks.providers = { status: 'unknown' };
  }

  // Generation enabled check
  try {
    const { getSupabaseClient } = await import('@/storage/database/supabase-client');
    const supabase = getSupabaseClient();
    const { data } = await supabase.from('system_settings').select('value').eq('key', 'generation_enabled').single();
    checks.generation = {
      status: data?.value === 'true' ? 'enabled' : 'disabled',
    };
  } catch {
    checks.generation = { status: 'unknown' };
  }

  return NextResponse.json({
    status: overallStatus,
    checks,
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
}
