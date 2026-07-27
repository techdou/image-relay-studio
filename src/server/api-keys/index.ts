import { randomBytes, createHash, timingSafeEqual } from 'crypto';
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

/**
 * Coerce a DB-stored `scopes` value (jsonb) into a `string[]`.
 *
 * The column default is `'["images:read","images:write"]'::jsonb`, but historic
 * rows or direct DB edits may store non-array values. We defensively normalise
 * to an empty array instead of throwing so that a malformed row never crashes
 * the auth path.
 */
function coerceScopes(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((s): s is string => typeof s === 'string');
  }
  return [];
}

/**
 * Timing-safe equality check for two hex digest strings.
 *
 * We always compare fixed-length SHA-256 hex digests (64 chars), so the input
 * lengths are constant. A defensive fallback hashes both inputs first to avoid
 * leaking length information in the (theoretically impossible) case where the
 * stored hash has been tampered with to a different length.
 */
function safeEqualHex(expected: string, actual: string): boolean {
  const expectedBuf = Buffer.from(expected, 'utf8');
  const actualBuf = Buffer.from(actual, 'utf8');
  if (expectedBuf.length === actualBuf.length) {
    return timingSafeEqual(expectedBuf, actualBuf);
  }
  // Length mismatch: don't return false immediately. Instead hash both inputs
  // to equal fixed-length digests and compare those, so the timing depends on
  // the (constant) hash length rather than the differing input lengths.
  const a = createHash('sha256').update(expectedBuf).digest();
  const b = createHash('sha256').update(actualBuf).digest();
  return timingSafeEqual(a, b);
}

export async function validateApiKey(rawKey: string): Promise<ApiKeyInfo | null> {
  if (typeof rawKey !== 'string' || !rawKey.startsWith(KEY_PREFIX)) {
    return null;
  }

  const pepper = process.env.API_KEY_HASH_PEPPER || '';
  const keyHash = createHash('sha256').update(rawKey + pepper).digest('hex');
  const keyPrefix = rawKey.substring(0, 12);

  const client = getSupabaseClient();

  // Pull candidate rows by prefix only (≤10), then compare hashes in the
  // application layer with timingSafeEqual. Filtering on `key_hash` in SQL
  // would leak whether a candidate matched via row-presence / query timing
  // and is not constant-time.
  const { data: candidates, error } = await client
    .from('api_keys')
    .select('id, user_id, name, key_prefix, key_hash, scopes, last_used_at, expires_at, revoked_at, created_at')
    .eq('key_prefix', keyPrefix)
    .is('revoked_at', null)
    .limit(10);

  if (error || !candidates || candidates.length === 0) {
    return null;
  }

  // Iterate ALL candidates and compare each stored hash in constant time so
  // that timing does not reveal which prefix row (if any) matched. We do not
  // break early on the first match to keep the loop length uniform.
  let matchedRow: (typeof candidates)[number] | null = null;
  for (const row of candidates) {
    const storedHash = row.key_hash as unknown;
    if (typeof storedHash !== 'string') {
      // Skip rows with a malformed hash but keep iterating to preserve timing.
      continue;
    }
    if (safeEqualHex(storedHash, keyHash)) {
      matchedRow = row;
      // Do NOT break: continue iterating over remaining candidates to keep
      // the work factor independent of which row matched.
    }
  }

  if (!matchedRow) {
    return null;
  }

  // Check expiry
  if (matchedRow.expires_at && new Date(matchedRow.expires_at) < new Date()) {
    return null;
  }

  // Update last_used_at (fire-and-forget, errors here are non-fatal)
  client
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', matchedRow.id)
    .then(
      () => { /* last_used_at update succeeded — nothing to log */ },
      (err: unknown) => {
        logger.warn('Failed to update api_keys.last_used_at', {
          key_id: matchedRow?.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    );

  return {
    id: matchedRow.id,
    user_id: matchedRow.user_id,
    name: matchedRow.name,
    key_prefix: matchedRow.key_prefix,
    scopes: coerceScopes(matchedRow.scopes),
    last_used_at: matchedRow.last_used_at,
    expires_at: matchedRow.expires_at,
    revoked_at: matchedRow.revoked_at,
    created_at: matchedRow.created_at,
  };
}
