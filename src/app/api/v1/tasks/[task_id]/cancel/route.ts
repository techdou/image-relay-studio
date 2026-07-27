import { NextRequest } from 'next/server';
import { authenticateRequest, successResponse, errorResponse, requireScope } from '@/server/api-helpers';
import { cancelTask } from '@/server/tasks/executor';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ task_id: string }> }
) {
  try {
    const { task_id } = await params;
    const auth = await authenticateRequest(request);
    requireScope(auth, 'tasks:write');
    await cancelTask(task_id, auth.userId, auth.role === 'admin');

    return successResponse({ task_id, status: 'cancelled' }, auth.requestId);
  } catch (err) {
    return errorResponse(err, '');
  }
}
