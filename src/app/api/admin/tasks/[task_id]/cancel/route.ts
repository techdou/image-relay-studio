import { NextRequest } from 'next/server';
import { authenticateRequest, successResponse, errorResponse, requireAdmin } from '@/server/api-helpers';
import { logger } from '@/server/logging';
import { cancelTask } from '@/server/tasks/executor';

/**
 * POST /api/admin/tasks/[task_id]/cancel
 *
 * Admin variant of the user cancel endpoint. Calls the shared
 * `cancelTask` helper with `isAdmin = true`, which bypasses the
 * per-user ownership check inside `getTask`. Admins may therefore
 * cancel any user's task.
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
    await cancelTask(task_id, auth.userId, /* isAdmin */ true);

    logger.info('admin cancelled task', {
      task_id,
      admin_id: auth.userId,
      request_id: auth.requestId,
    });

    return successResponse({ task_id, status: 'cancelled' }, auth.requestId);
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
