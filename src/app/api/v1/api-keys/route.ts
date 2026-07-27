import { NextRequest } from 'next/server';
import { authenticateRequest, successResponse, errorResponse, requireScope } from '@/server/api-helpers';
import { AppError, ErrorCodes } from '@/server/errors';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { createApiKey } from '@/server/api-keys';
import { createApiKeySchema, parseInput } from '@/server/validation/schemas';

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    requireScope(auth, 'api_keys:read');
    const supabase = getSupabaseClient();

    // Fetch ALL keys (including disabled ones) so user can toggle them
    const { data, error } = await supabase
      .from('api_keys')
      .select('id, user_id, name, key_prefix, scopes, last_used_at, expires_at, revoked_at, created_at')
      .eq('user_id', auth.userId)
      .order('created_at', { ascending: false });

    if (error) return errorResponse(new Error('获取 API 密钥失败'), auth.requestId);

    // Also return the user's api_access_enabled so the frontend can show appropriate prompts
    const { data: quota } = await supabase
      .from('user_quotas')
      .select('api_access_enabled')
      .eq('user_id', auth.userId)
      .single();

    // Map database fields to frontend-friendly format
    const keys = (data || []).map((k) => ({
      id: k.id,
      name: k.name,
      prefix: k.key_prefix,
      scopes: k.scopes,
      last_used_at: k.last_used_at,
      expires_at: k.expires_at,
      created_at: k.created_at,
      is_active: !k.revoked_at,
    }));

    return successResponse({
      keys,
      api_access_enabled: quota?.api_access_enabled ?? false,
    }, auth.requestId);
  } catch (err) {
    return errorResponse(err, '');
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    requireScope(auth, 'api_keys:write');
    const { name, expires_at, scopes } = parseInput(
      createApiKeySchema,
      await request.json()
    );

    const supabase = getSupabaseClient();

    // Check API access enabled
    const [{ data: quota }, { data: apiSetting }] = await Promise.all([
      supabase
        .from('user_quotas')
        .select('api_access_enabled')
        .eq('user_id', auth.userId)
        .single(),
      supabase
        .from('system_settings')
        .select('value')
        .eq('key', 'api_enabled')
        .maybeSingle(),
    ]);

    if (!quota?.api_access_enabled || apiSetting?.value !== 'true') {
      throw new AppError(ErrorCodes.API_DISABLED, 'API 访问未启用');
    }

    // Generate API key. Default scope names follow the canonical naming used
    // by the api_keys.scopes column default and the createApiKey helper:
    //   images:read / images:write (NOT the legacy "images:generate").
    const result = await createApiKey(
      auth.userId,
      name,
      scopes,
      expires_at || undefined
    );

    return successResponse({
      id: result.key_info.id,
      name: result.key_info.name,
      key_prefix: result.key_info.key_prefix,
      scopes: result.key_info.scopes,
      expires_at: result.key_info.expires_at,
      created_at: result.key_info.created_at,
      key: result.raw_key, // Only returned once!
    }, auth.requestId, 201);
  } catch (err) {
    return errorResponse(err, '');
  }
}
