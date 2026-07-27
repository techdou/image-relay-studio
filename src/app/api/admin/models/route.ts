import { NextRequest } from 'next/server';
import { authenticateRequest, successResponse, errorResponse, requireAdmin } from '@/server/api-helpers';
import { AppError, ErrorCodes } from '@/server/errors';
import { adminCreateModelSchema } from '@/server/validation/admin-schemas';

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
    const parsed = adminCreateModelSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      });
    }
    const m = parsed.data;

    const { getSupabaseServerClient } = await import('@/storage/database/supabase-client');
    const supabase = getSupabaseServerClient();

    const { data, error } = await supabase
      .from('model_configs')
      .insert({
        code: m.code,
        display_name: m.display_name,
        provider_type: m.provider_type,
        external_model_id: m.external_model_id ?? null,
        workflow_id: m.workflow_id ?? null,
        enabled: m.enabled ?? true,
        sort_order: m.sort_order ?? 0,
        supports_text_to_image: m.supports_text_to_image ?? true,
        supports_image_to_image: m.supports_image_to_image ?? false,
        supports_multiple_references: m.supports_multiple_references ?? false,
        supports_sequential_generation: m.supports_sequential_generation ?? false,
        supports_visible_watermark_control: m.supports_visible_watermark_control ?? false,
        supported_sizes: m.supported_sizes ?? ['1024x1024'],
        max_images_per_request: m.max_images_per_request ?? 4,
        max_provider_concurrency: m.max_provider_concurrency ?? 5,
        timeout_seconds: m.timeout_seconds ?? 120,
        default_parameters: m.default_parameters ?? {},
        capability_metadata: m.capability_metadata ?? {},
      })
      .select()
      .single();

    if (error) throw new AppError(ErrorCodes.INTERNAL_ERROR, '创建模型失败');

    const { createAuditLogger } = await import('@/server/audit');
    const audit = createAuditLogger(auth.userId, auth.role, auth.requestId);
    await audit.logAction('create_model', 'model_config', data.id, null, m);

    return successResponse(data, auth.requestId, 201);
  } catch (err) {
    return errorResponse(err, '');
  }
}
