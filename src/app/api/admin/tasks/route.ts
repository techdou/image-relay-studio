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
    const status = searchParams.get('status');
    const userId = searchParams.get('user_id');
    const modelConfigId = searchParams.get('model_config_id');

    const { getSupabaseServerClient } = await import('@/storage/database/supabase-client');
    const supabase = getSupabaseServerClient();

    let query = supabase
      .from('generation_tasks')
      .select('id, user_id, model_config_id, task_type, status, prompt, error_code, error_message, created_at, started_at, completed_at', { count: 'exact' })
      .range((page - 1) * pageSize, page * pageSize - 1)
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);
    if (userId) query = query.eq('user_id', userId);
    if (modelConfigId) query = query.eq('model_config_id', modelConfigId);

    const { data, count, error } = await query;
    if (error) {
      logger.error('admin list tasks failed', { error: error.message, request_id: auth.requestId });
      throw new AppError(ErrorCodes.INTERNAL_ERROR, '查询任务失败');
    }

    return successResponse({
      tasks: data || [],
      total: count || 0,
      page,
      page_size: pageSize,
    }, auth.requestId);
  } catch (err) {
    return errorResponse(err, '');
  }
}
