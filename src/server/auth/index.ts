import { getSupabaseClient } from '@/storage/database/supabase-client';
import { AppError, ErrorCodes } from '@/server/errors';
import { logger } from '@/server/logging';

export interface AuthUser {
  id: string;
  email: string;
  role: 'admin' | 'user';
  status: 'active' | 'disabled' | 'pending';
  display_name: string | null;
}

export async function verifySession(sessionToken: string): Promise<AuthUser> {
  if (!sessionToken) {
    throw new AppError(ErrorCodes.UNAUTHORIZED, 'No session token provided');
  }

  const client = getSupabaseClient(sessionToken);

  const { data: userData, error: userError } = await client.auth.getUser(sessionToken);

  if (userError || !userData.user) {
    throw new AppError(ErrorCodes.UNAUTHORIZED, 'Invalid or expired session');
  }

  // Fetch profile from our profiles table
  const adminClient = getSupabaseClient();
  const { data: profile, error: profileError } = await adminClient
    .from('profiles')
    .select('id, user_id, email, role, status, display_name')
    .eq('user_id', userData.user.id)
    .single();

  if (profileError || !profile) {
    logger.warn('User has auth account but no profile', { user_id: userData.user.id });
    throw new AppError(ErrorCodes.UNAUTHORIZED, 'User profile not found');
  }

  if (profile.status === 'disabled') {
    throw new AppError(ErrorCodes.USER_DISABLED, 'User account is disabled');
  }

  return {
    id: profile.user_id,
    email: profile.email,
    role: profile.role,
    status: profile.status,
    display_name: profile.display_name,
  };
}

export function requireRole(user: AuthUser, ...roles: ('admin' | 'user')[]): void {
  if (!roles.includes(user.role)) {
    throw new AppError(ErrorCodes.FORBIDDEN, 'Insufficient permissions');
  }
}

export function requireAdmin(user: AuthUser): void {
  requireRole(user, 'admin');
}

export function getSessionFromHeaders(headers: Headers): string | null {
  const session = headers.get('x-session');
  if (session) return session;

  const authHeader = headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  return null;
}

export async function verifyApiKey(keyString: string): Promise<AuthUser> {
  if (!keyString || !keyString.startsWith('irs_live_')) {
    throw new AppError(ErrorCodes.API_KEY_INVALID, 'Invalid API key format');
  }

  const prefix = keyString.substring(0, 12);
  const adminClient = getSupabaseClient();

  const { data: keys, error } = await adminClient
    .from('api_keys')
    .select('id, user_id, key_hash, scopes, revoked_at, expires_at')
    .eq('key_prefix', prefix)
    .is('revoked_at', null)
    .limit(10);

  if (error || !keys || keys.length === 0) {
    throw new AppError(ErrorCodes.API_KEY_INVALID, 'API key not found');
  }

  // Use timing-safe comparison
  const encoder = new TextEncoder();
  const keyData = encoder.encode(keyString);

  const { createHash } = await import('crypto');
  const keyHash = createHash('sha256').update(keyData).digest('hex');

  let matchedKey: (typeof keys)[0] | null = null;
  for (const k of keys) {
    const hashData = encoder.encode(k.key_hash);
    const inputHashData = encoder.encode(keyHash);
    if (hashData.length === inputHashData.length) {
      // Simple constant-time comparison
      let match = true;
      for (let i = 0; i < hashData.length; i++) {
        if (hashData[i] !== inputHashData[i]) match = false;
      }
      if (match) {
        matchedKey = k;
        break;
      }
    }
  }

  if (!matchedKey) {
    throw new AppError(ErrorCodes.API_KEY_INVALID, 'API key verification failed');
  }

  if (matchedKey.expires_at && new Date(matchedKey.expires_at) < new Date()) {
    throw new AppError(ErrorCodes.API_KEY_EXPIRED, 'API key has expired');
  }

  // Update last_used_at
  await adminClient
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', matchedKey.id);

  // Get user profile
  const { data: profile, error: profileError } = await adminClient
    .from('profiles')
    .select('id, user_id, email, role, status, display_name')
    .eq('user_id', matchedKey.user_id)
    .single();

  if (profileError || !profile) {
    throw new AppError(ErrorCodes.UNAUTHORIZED, 'User profile not found for API key');
  }

  if (profile.status === 'disabled') {
    throw new AppError(ErrorCodes.USER_DISABLED, 'User account is disabled');
  }

  // Check if user has API access
  const { data: quota } = await adminClient
    .from('user_quotas')
    .select('api_access_enabled')
    .eq('user_id', matchedKey.user_id)
    .single();

  if (!quota?.api_access_enabled) {
    throw new AppError(ErrorCodes.API_DISABLED, 'API access is not enabled for this user');
  }

  return {
    id: profile.user_id,
    email: profile.email,
    role: profile.role,
    status: profile.status,
    display_name: profile.display_name,
  };
}
