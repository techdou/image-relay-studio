import { NextRequest } from 'next/server';
import { authenticateRequest, successResponse, errorResponse } from '@/server/api-helpers';
import { AppError, ErrorCodes } from '@/server/errors';
import { executeTask } from '@/server/tasks/executor';

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

    if (task.status !== 'failed') {
      throw new AppError(ErrorCodes.INVALID_TASK_STATE, '只有失败任务可以重试');
    }

    // Check retry eligibility - only retry for temporary errors
    const nonRetryableCodes = ['INVALID_REQUEST', 'MODEL_NOT_FOUND', 'MODEL_NOT_ALLOWED',
      'SIZE_NOT_ALLOWED', 'QUOTA_EXCEEDED', 'CONTENT_REJECTED', 'INVALID_FILE'];
    if (task.error_code && nonRetryableCodes.includes(task.error_code)) {
      throw new AppError(ErrorCodes.INVALID_TASK_STATE, '此错误类型不可自动重试');
    }

    const { error } = await supabase
      .from('generation_tasks')
      .update({
        status: 'queued',
        attempt_count: task.attempt_count + 1,
        error_code: null,
        error_message: null,
        error_details: null,
        queued_at: new Date().toISOString(),
        started_at: null,
        completed_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', task_id);

    if (error) throw new AppError(ErrorCodes.INTERNAL_ERROR, '重试失败');

    // Fire-and-forget: execute the retried task
    executeTask(task_id).catch(() => {
      // Error is already handled inside executeTask
    });

    return successResponse({ task_id, status: 'queued' }, auth.requestId);
  } catch (err) {
    return errorResponse(err, '');
  }
}
