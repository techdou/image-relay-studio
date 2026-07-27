import { NextRequest } from 'next/server';
import { authenticateRequest, successResponse, errorResponse } from '@/server/api-helpers';

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    const { getSupabaseServerClient } = await import('@/storage/database/supabase-client');
    const supabase = getSupabaseServerClient();

    const { data: quota } = await supabase
      .from('user_quotas')
      .select('api_access_enabled, daily_image_limit, monthly_image_limit, max_concurrent_tasks')
      .eq('user_id', auth.userId)
      .single();

    return successResponse({
      user: { id: auth.userId, email: auth.profile.email },
      profile: auth.profile,
      quota: quota || null,
    }, auth.requestId);
  } catch (err) {
    return errorResponse(err, '');
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    const body = await request.json();
    const { display_name } = body;

    const { getSupabaseServerClient } = await import('@/storage/database/supabase-client');
    const supabase = getSupabaseServerClient();

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (display_name !== undefined) updates.display_name = display_name;

    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('user_id', auth.userId)
      .select()
      .single();

    if (error) {
      return errorResponse(new Error('更新失败'), auth.requestId);
    }

    return successResponse({ profile: data }, auth.requestId);
  } catch (err) {
    return errorResponse(err, '');
  }
}
