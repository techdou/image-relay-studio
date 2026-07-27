import { NextRequest } from 'next/server';
import { authenticateRequest, successResponse, errorResponse } from '@/server/api-helpers';
import { AppError, ErrorCodes } from '@/server/errors';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ task_id: string }> }
) {
  try {
    const { task_id } = await params;
    const auth = await authenticateRequest(request);
    const { getSupabaseServerClient } = await import('@/storage/database/supabase-client');
    const supabase = getSupabaseServerClient();

    const { data: task } = await supabase
      .from('generation_tasks')
      .select('*')
      .eq('id', task_id)
      .single();

    if (!task) throw new AppError(ErrorCodes.TASK_NOT_FOUND, '任务不存在');
    if (auth.role !== 'admin' && task.user_id !== auth.userId) {
      throw new AppError(ErrorCodes.FORBIDDEN, '无权操作此任务');
    }

    if (task.status !== 'queued' && task.status !== 'running') {
      throw new AppError(ErrorCodes.INVALID_TASK_STATE, '当前状态不可取消');
    }

    const { error } = await supabase
      .from('generation_tasks')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', task_id);

    if (error) throw new AppError(ErrorCodes.INTERNAL_ERROR, '取消失败');

    return successResponse({ task_id, status: 'cancelled' }, auth.requestId);
  } catch (err) {
    return errorResponse(err, '');
  }
}
