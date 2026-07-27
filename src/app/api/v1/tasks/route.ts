import { NextRequest } from 'next/server';
import { authenticateRequest, successResponse, errorResponse, paginatedResponse, requireScope } from '@/server/api-helpers';
import { AppError, ErrorCodes } from '@/server/errors';

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    requireScope(auth, 'tasks:read');
    const { getSupabaseServerClient } = await import('@/storage/database/supabase-client');
    const supabase = getSupabaseServerClient();

    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1');
    const pageSize = parseInt(url.searchParams.get('page_size') || '20');
    const status = url.searchParams.get('status');
    const modelCode = url.searchParams.get('model_code');

    let query = supabase
      .from('generation_tasks')
      .select('*', { count: 'exact' })
      .eq('user_id', auth.userId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);

    if (status) query = query.eq('status', status);
    if (modelCode) {
      const { data: modelConfig } = await supabase
        .from('model_configs')
        .select('id')
        .eq('code', modelCode)
        .single();
      if (modelConfig) query = query.eq('model_config_id', modelConfig.id);
    }

    const { data, error, count } = await query;
    if (error) return errorResponse(new Error('获取任务失败'), auth.requestId);

    return paginatedResponse(data || [], count || 0, page, pageSize, auth.requestId);
  } catch (err) {
    return errorResponse(err, '');
  }
}
