import { NextRequest } from 'next/server';
import { authenticateRequest, successResponse, errorResponse } from '@/server/api-helpers';
import { AppError, ErrorCodes } from '@/server/errors';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ task_id: string }> }
) {
  try {
    const { task_id } = await params;
    const auth = await authenticateRequest(request);
    const { getSupabaseServerClient } = await import('@/storage/database/supabase-client');
    const supabase = getSupabaseServerClient();

    const { data, error } = await supabase
      .from('generation_tasks')
      .select('*')
      .eq('id', task_id)
      .single();

    if (error || !data) {
      throw new AppError(ErrorCodes.TASK_NOT_FOUND, '任务不存在');
    }

    // Check ownership (unless admin)
    if (auth.role !== 'admin' && data.user_id !== auth.userId) {
      throw new AppError(ErrorCodes.FORBIDDEN, '无权访问此任务');
    }

    return successResponse(data, auth.requestId);
  } catch (err) {
    return errorResponse(err, '');
  }
}
