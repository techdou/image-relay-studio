import { NextRequest } from 'next/server';
import { authenticateRequest, successResponse, errorResponse, requireAdmin } from '@/server/api-helpers';
import { AppError, ErrorCodes } from '@/server/errors';

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    requireAdmin(auth);

    const { getSupabaseServerClient } = await import('@/storage/database/supabase-client');
    const supabase = getSupabaseServerClient();

    const { data, error } = await supabase
      .from('model_configs')
      .select('*')
      .order('sort_order', { ascending: true });

    if (error) throw new AppError(ErrorCodes.INTERNAL_ERROR, '查询模型失败');

    return successResponse({ models: data || [] }, auth.requestId);
  } catch (err) {
    return errorResponse(err, '');
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    requireAdmin(auth);

    const body = await request.json();

    const { getSupabaseServerClient } = await import('@/storage/database/supabase-client');
    const supabase = getSupabaseServerClient();

    const { data, error } = await supabase
      .from('model_configs')
      .insert({
        code: body.code,
        display_name: body.display_name,
        provider_type: body.provider_type,
        external_model_id: body.external_model_id || null,
        workflow_id: body.workflow_id || null,
        enabled: body.enabled ?? true,
        sort_order: body.sort_order ?? 0,
        supports_text_to_image: body.supports_text_to_image ?? true,
        supports_image_to_image: body.supports_image_to_image ?? false,
        supports_multiple_references: body.supports_multiple_references ?? false,
        supports_sequential_generation: body.supports_sequential_generation ?? false,
        supports_visible_watermark_control: body.supports_visible_watermark_control ?? false,
        supported_sizes: body.supported_sizes || ['1024x1024'],
        max_images_per_request: body.max_images_per_request ?? 4,
        max_provider_concurrency: body.max_provider_concurrency ?? 5,
        timeout_seconds: body.timeout_seconds ?? 120,
        default_parameters: body.default_parameters || {},
        capability_metadata: body.capability_metadata || {},
      })
      .select()
      .single();

    if (error) throw new AppError(ErrorCodes.INTERNAL_ERROR, '创建模型失败');

    const { createAuditLogger } = await import('@/server/audit');
    const audit = createAuditLogger(auth.userId, auth.role, auth.requestId);
    await audit.logAction('create_model', 'model_config', data.id, null, body);

    return successResponse(data, auth.requestId, 201);
  } catch (err) {
    return errorResponse(err, '');
  }
}
