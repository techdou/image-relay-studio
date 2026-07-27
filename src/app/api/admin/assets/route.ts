import { NextRequest } from 'next/server';
import { authenticateRequest, successResponse, errorResponse, requireAdmin } from '@/server/api-helpers';
import { AppError, ErrorCodes } from '@/server/errors';
import { logger } from '@/server/logging';

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    requireAdmin(auth);

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('page_size') || '20');
    const userId = searchParams.get('user_id');

    const { getSupabaseServerClient } = await import('@/storage/database/supabase-client');
    const supabase = getSupabaseServerClient();

    let query = supabase
      .from('generation_assets')
      .select('id, task_id, user_id, object_key, mime_type, file_size, width, height, ai_generated, visible_watermark_disabled, favorite, deleted_at, created_at', { count: 'exact' })
      .range((page - 1) * pageSize, page * pageSize - 1)
      .order('created_at', { ascending: false });

    if (userId) query = query.eq('user_id', userId);

    const { data, count, error } = await query;
    if (error) {
      logger.error('admin list assets failed', { error: error.message, request_id: auth.requestId });
      throw new AppError(ErrorCodes.INTERNAL_ERROR, '查询资产失败');
    }

    return successResponse({
      assets: data || [],
      total: count || 0,
      page,
      page_size: pageSize,
    }, auth.requestId);
  } catch (err) {
    return errorResponse(err, '');
  }
}
