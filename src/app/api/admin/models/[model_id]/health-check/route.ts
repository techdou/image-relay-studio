import { NextRequest } from 'next/server';
import { authenticateRequest, successResponse, errorResponse, requireAdmin } from '@/server/api-helpers';
import { AppError, ErrorCodes } from '@/server/errors';
import { logger } from '@/server/logging';
import { checkProviderHealth } from '@/server/providers/images';

/**
 * POST /api/admin/models/[model_id]/health-check
 *
 * Probes the provider that backs the given model. The provider layer
 * exposes `checkProviderHealth(providerType)` which calls the provider's
 * `healthCheck()` method and returns `{ healthy, provider, latency_ms?,
 * error? }`. We surface that result along with the model's `enabled`
 * flag so the admin UI can show both the provider probe and the
 * admin-controlled toggle.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ model_id: string }> }
) {
  let requestId = '';
  try {
    const auth = await authenticateRequest(request);
    requestId = auth.requestId;
    requireAdmin(auth);

    const { model_id } = await params;

    const { getSupabaseServerClient } = await import('@/storage/database/supabase-client');
    const supabase = getSupabaseServerClient();

    const { data: model, error } = await supabase
      .from('model_configs')
      .select('id, code, display_name, provider_type, enabled')
      .eq('id', model_id)
      .single();

    if (error || !model) {
      throw new AppError(ErrorCodes.MODEL_NOT_FOUND, '模型不存在');
    }

    // Probe the provider behind this model. If the provider type is
    // unknown or the probe throws, we surface an 'unhealthy' status
    // rather than a 500 so the dashboard keeps rendering.
    let healthy = false;
    let latencyMs: number | null = null;
    let probeError: string | null = null;

    try {
      const start = Date.now();
      const result = await checkProviderHealth(model.provider_type);
      latencyMs = result.latency_ms ?? Date.now() - start;
      healthy = result.healthy;
      probeError = result.error ?? null;
    } catch (err) {
      probeError = err instanceof Error ? err.message : 'Unknown error';
      logger.warn('admin model health-check failed', {
        model_id,
        provider_type: model.provider_type,
        error: probeError,
      });
    }

    return successResponse(
      {
        model_id,
        code: model.code,
        provider_type: model.provider_type,
        enabled: model.enabled,
        healthy,
        latency_ms: latencyMs,
        error: probeError,
        checked_at: new Date().toISOString(),
      },
      auth.requestId
    );
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
