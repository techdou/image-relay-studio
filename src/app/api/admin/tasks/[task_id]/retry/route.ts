import { NextRequest } from 'next/server';
import { authenticateRequest, successResponse, errorResponse, requireAdmin } from '@/server/api-helpers';
import { logger } from '@/server/logging';
import { retryTask } from '@/server/tasks/executor';

/**
 * POST /api/admin/tasks/[task_id]/retry
 *
 * Admin variant of the user retry endpoint. Calls the shared `retryTask`
 * helper with `isAdmin = true`, which bypasses the per-user ownership
 * check inside `getTask` (it skips the `.eq('user_id', ...)` clause).
 * Admins may therefore retry any user's task.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ task_id: string }> }
) {
  let requestId = '';
  try {
    const auth = await authenticateRequest(request);
    requestId = auth.requestId;
    requireAdmin(auth);

    const { task_id } = await params;
    const task = await retryTask(task_id, auth.userId, /* isAdmin */ true);

    logger.info('admin retried task', {
      task_id,
      admin_id: auth.userId,
      request_id: auth.requestId,
    });

    return successResponse(task, auth.requestId);
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
