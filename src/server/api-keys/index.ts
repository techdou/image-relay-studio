import { randomBytes, createHash } from 'crypto';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { AppError, ErrorCodes } from '@/server/errors';
import { logger } from '@/server/logging';

const KEY_PREFIX = 'irs_live_';

export interface ApiKeyInfo {
  id: string;
  user_id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export async function createApiKey(
  userId: string,
  name: string,
  scopes: string[] = ['images:read', 'images:write'],
  expiresAt?: string
): Promise<{ key_info: ApiKeyInfo; raw_key: string }> {
  // Generate random key with pepper for brute-force resistance
  const rawKey = `${KEY_PREFIX}${randomBytes(32).toString('hex')}`;
  const keyPrefix = rawKey.substring(0, 12);
  const pepper = process.env.API_KEY_HASH_PEPPER || '';
  const keyHash = createHash('sha256').update(rawKey + pepper).digest('hex');

  const client = getSupabaseClient();

  const { data, error } = await client
    .from('api_keys')
    .insert({
      user_id: userId,
      name,
      key_prefix: keyPrefix,
      key_hash: keyHash,
      scopes,
      expires_at: expiresAt || null,
    })
    .select()
    .single();

  if (error || !data) {
    throw new AppError(ErrorCodes.INTERNAL_ERROR, 'Failed to create API key');
  }

  logger.info('API key created', { user_id: userId, key_prefix: keyPrefix, action: 'create_api_key' });

  return {
    key_info: data as unknown as ApiKeyInfo,
    raw_key: rawKey,
  };
}

export async function getUserApiKeys(userId: string): Promise<ApiKeyInfo[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('api_keys')
    .select('id, user_id, name, key_prefix, scopes, last_used_at, expires_at, revoked_at, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    logger.error('Failed to fetch API keys', { error: error.message, user_id: userId });
    return [];
  }

  return (data || []) as unknown as ApiKeyInfo[];
}

export async function revokeApiKey(keyId: string, userId: string): Promise<void> {
  const client = getSupabaseClient();

  const { data: key, error: fetchError } = await client
    .from('api_keys')
    .select('id, user_id')
    .eq('id', keyId)
    .is('revoked_at', null)
    .single();

  if (fetchError || !key) {
    throw new AppError(ErrorCodes.TASK_NOT_FOUND, 'API key not found');
  }

  if (key.user_id !== userId) {
    throw new AppError(ErrorCodes.FORBIDDEN, 'Cannot revoke another user\'s API key');
  }

  await client
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', keyId);

  logger.info('API key revoked', { key_id: keyId, user_id: userId, action: 'revoke_api_key' });
}

// Alias for route consumers
export const generateApiKey = createApiKey;

export async function validateApiKey(rawKey: string): Promise<ApiKeyInfo | null> {
  const pepper = process.env.API_KEY_HASH_PEPPER || '';
  const keyHash = createHash('sha256').update(rawKey + pepper).digest('hex');
  const keyPrefix = rawKey.substring(0, 12);

  const client = getSupabaseClient();
  const { data, error } = await client
    .from('api_keys')
    .select('id, user_id, name, key_prefix, scopes, last_used_at, expires_at, revoked_at, created_at')
    .eq('key_prefix', keyPrefix)
    .eq('key_hash', keyHash)
    .is('revoked_at', null)
    .single();

  if (error || !data) {
    return null;
  }

  // Check expiry
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return null;
  }

  // Update last_used_at
  await client
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id);

  return data as unknown as ApiKeyInfo;
}
