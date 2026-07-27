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
    const action = searchParams.get('action');
    const resourceType = searchParams.get('resource_type');

    const { getSupabaseServerClient } = await import('@/storage/database/supabase-client');
    const supabase = getSupabaseServerClient();

    let query = supabase
      .from('audit_logs')
      .select('id, actor_user_id, actor_role, action, resource_type, resource_id, created_at, metadata', { count: 'exact' })
      .range((page - 1) * pageSize, page * pageSize - 1)
      .order('created_at', { ascending: false });

    if (action) query = query.eq('action', action);
    if (resourceType) query = query.eq('resource_type', resourceType);

    const { data, count, error } = await query;
    if (error) {
      logger.error('admin list audit logs failed', { error: error.message, request_id: auth.requestId });
      throw new AppError(ErrorCodes.INTERNAL_ERROR, '查询审计日志失败');
    }

    return successResponse({
      logs: data || [],
      total: count || 0,
      page,
      page_size: pageSize,
    }, auth.requestId);
  } catch (err) {
    return errorResponse(err, '');
  }
}
