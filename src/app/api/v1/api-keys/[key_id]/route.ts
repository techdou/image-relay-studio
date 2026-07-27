import { NextRequest } from 'next/server';
import { authenticateRequest, successResponse, errorResponse, requireScope } from '@/server/api-helpers';
import { AppError, ErrorCodes } from '@/server/errors';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ key_id: string }> }
) {
  try {
    const { key_id } = await params;
    const auth = await authenticateRequest(request);
    requireScope(auth, 'api_keys:write');
    const body = await request.json();
    const { is_active } = body as { is_active?: boolean };

    if (typeof is_active !== 'boolean') {
      throw new AppError(ErrorCodes.INVALID_REQUEST, 'is_active 必须为布尔值');
    }

    const { getSupabaseServerClient } = await import('@/storage/database/supabase-client');
    const supabase = getSupabaseServerClient();

    // Verify ownership
    const { data: existing } = await supabase
      .from('api_keys')
      .select('user_id')
      .eq('id', key_id)
      .single();

    if (!existing) throw new AppError(ErrorCodes.TASK_NOT_FOUND, '密钥不存在');
    if (auth.role !== 'admin' && existing.user_id !== auth.userId) {
      throw new AppError(ErrorCodes.FORBIDDEN, '无权操作此密钥');
    }

    const updateData = is_active
      ? { revoked_at: null }
      : { revoked_at: new Date().toISOString() };

    const { error } = await supabase
      .from('api_keys')
      .update(updateData)
      .eq('id', key_id);

    if (error) throw new AppError(ErrorCodes.INTERNAL_ERROR, '更新失败');

    return successResponse({ updated: true, is_active }, auth.requestId);
  } catch (err) {
    return errorResponse(err, '');
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ key_id: string }> }
) {
  try {
    const { key_id } = await params;
    const auth = await authenticateRequest(request);
    requireScope(auth, 'api_keys:write');

    const { getSupabaseServerClient } = await import('@/storage/database/supabase-client');
    const supabase = getSupabaseServerClient();

    // Verify ownership
    const { data: existing } = await supabase
      .from('api_keys')
      .select('user_id')
      .eq('id', key_id)
      .single();

    if (!existing) throw new AppError(ErrorCodes.TASK_NOT_FOUND, '密钥不存在');
    if (auth.role !== 'admin' && existing.user_id !== auth.userId) {
      throw new AppError(ErrorCodes.FORBIDDEN, '无权操作此密钥');
    }

    const { error } = await supabase
      .from('api_keys')
      .delete()
      .eq('id', key_id);

    if (error) throw new AppError(ErrorCodes.INTERNAL_ERROR, '删除失败');

    return successResponse({ deleted: true }, auth.requestId);
  } catch (err) {
    return errorResponse(err, '');
  }
}
