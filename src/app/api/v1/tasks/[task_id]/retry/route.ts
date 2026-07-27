import { NextRequest } from 'next/server';
import { authenticateRequest, successResponse, errorResponse, requireScope } from '@/server/api-helpers';
import { retryTask } from '@/server/tasks/executor';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ task_id: string }> }
) {
  try {
    const { task_id } = await params;
    const auth = await authenticateRequest(request);
    requireScope(auth, 'tasks:write');
    await retryTask(task_id, auth.userId, auth.role === 'admin');

    return successResponse({ task_id, status: 'queued' }, auth.requestId);
  } catch (err) {
    return errorResponse(err, '');
  }
}
