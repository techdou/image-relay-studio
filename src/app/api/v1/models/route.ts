import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, successResponse, errorResponse, requireScope } from '@/server/api-helpers';
import { AppError } from '@/server/errors';

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    requireScope(auth, 'models:read');
    const { getSupabaseServerClient } = await import('@/storage/database/supabase-client');
    const supabase = getSupabaseServerClient();

    const { data, error } = await supabase
      .from('model_configs')
      .select('*')
      .eq('enabled', true)
      .order('sort_order');

    if (error) {
      return errorResponse(new Error('获取模型失败'), auth.requestId);
    }

    // Filter models based on user permissions
    const { data: quota } = await supabase
      .from('user_quotas')
      .select('allowed_model_codes')
      .eq('user_id', auth.userId)
      .single();

    let models = data || [];
    if (quota?.allowed_model_codes && quota.allowed_model_codes.length > 0) {
      models = models.filter((m: { code: string }) => quota.allowed_model_codes.includes(m.code));
    }

    // Check if request is from API Key (OpenAI-compatible mode)
    const authHeader = request.headers.get('authorization');
    const isApiKeyAuth = authHeader?.startsWith('Bearer irs_live_');

    if (isApiKeyAuth) {
      // Return OpenAI-compatible format
      const openaiModels = models.map((m: Record<string, unknown>) => ({
        id: m.code,
        object: 'model' as const,
        created: Math.floor(new Date(m.created_at as string).getTime() / 1000),
        owned_by: 'image-relay-studio',
        // Extended fields for our platform
        display_name: m.display_name,
        provider_type: m.provider_type,
        supports_text_to_image: m.supports_text_to_image,
        supports_image_to_image: m.supports_image_to_image,
        supported_sizes: m.supported_sizes,
        max_images_per_request: m.max_images_per_request,
      }));
      return NextResponse.json({
        object: 'list',
        data: openaiModels,
      });
    }

    return successResponse(models, auth.requestId);
  } catch (err) {
    // OpenAI-compatible error for API key auth
    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer irs_live_') && err instanceof AppError) {
      return NextResponse.json(
        {
          error: {
            code: err.code,
            message: err.message,
            type: 'invalid_request_error',
          },
        },
        { status: 401 }
      );
    }
    return errorResponse(err, '');
  }
}
