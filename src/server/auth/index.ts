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
