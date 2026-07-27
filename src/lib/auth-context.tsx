'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { getSupabaseBrowserClientAsync } from '@/lib/supabase-browser';
import { fetchWithTimeout } from '@/lib/fetch-utils';

type UserRole = 'admin' | 'user';
type UserStatus = 'active' | 'disabled' | 'pending';

interface UserProfile {
  id: string;
  user_id: string;
  email: string;
  display_name: string | null;
  avatar_key: string | null;
  role: UserRole;
  status: UserStatus;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  session: Session | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  authError: string | null;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  retryAuth: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  session: null,
  isLoading: true,
  isAuthenticated: false,
  isAdmin: false,
  authError: null,
  signIn: async () => ({ error: null }),
  signOut: async () => {},
  refreshProfile: async () => {},
  retryAuth: () => {},
});

/** Auth 初始化安全超时：10 秒后强制结束 loading */
const AUTH_INIT_TIMEOUT_MS = 10_000;
/** Profile 请求超时 */
const PROFILE_FETCH_TIMEOUT_MS = 8_000;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  // 用递增 key 触发重新初始化
  const [initKey, setInitKey] = useState(0);

  const fetchProfile = useCallback(async (userId: string) => {
    try {
      const supabase = await getSupabaseBrowserClientAsync();
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      const token = currentSession?.access_token;
      if (!token) return;

      const res = await fetchWithTimeout('/api/auth/profile', {
        headers: { 'x-session': token },
        timeout: PROFILE_FETCH_TIMEOUT_MS,
      });
      if (res.ok) {
        const data = await res.json();
        setProfile(data.profile);
      }
    } catch {
      // Profile might not exist yet — non-fatal
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    let timedOut = false;

    async function initAuth() {
      try {
        const supabase = await getSupabaseBrowserClientAsync();
        if (!mounted) return;

        try {
          const { data: { session: currentSession } } = await supabase.auth.getSession();
          if (!mounted) return;

          if (currentSession?.user) {
            setSession(currentSession);
            setUser(currentSession.user);
            await fetchProfile(currentSession.user.id);
          }
          if (mounted) setAuthError(null);
        } catch (sessionErr: any) {
          // Refresh token expired / invalid / revoked — clear stored session silently
          // and proceed as unauthenticated (don't show error to user)
          if (
            sessionErr?.message?.includes('Refresh Token') ||
            sessionErr?.name === 'AuthSessionMissingError' ||
            sessionErr?.__isAuthError
          ) {
            console.warn('[Auth] Session refresh failed, clearing local session:', sessionErr.message);
            try {
              // signOut with scope 'local' only clears localStorage, no server call
              await supabase.auth.signOut({ scope: 'local' });
            } catch {
              // ignore
            }
            // Proceed as unauthenticated — no error shown
            if (mounted) setAuthError(null);
          } else {
            throw sessionErr;
          }
        }
      } catch (err) {
        if (mounted) {
          setAuthError(err instanceof Error ? err.message : '认证初始化失败');
        }
      } finally {
        if (mounted && !timedOut) {
          setIsLoading(false);
        }
      }
    }

    initAuth();

    // 安全超时：无论 initAuth 是否完成，最多 AUTH_INIT_TIMEOUT_MS 后解除 loading
    const timeoutId = setTimeout(() => {
      if (mounted && isLoading) {
        timedOut = true;
        setIsLoading(false);
        setAuthError((prev) => prev || '认证初始化超时，请检查网络连接');
      }
    }, AUTH_INIT_TIMEOUT_MS);

    // Listen for auth changes
    let subscription: { unsubscribe: () => void } | null = null;

    (async () => {
      try {
        const supabase = await getSupabaseBrowserClientAsync();
        const { data } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
          if (!mounted) return;
          setSession(newSession);
          setUser(newSession?.user ?? null);
          if (newSession?.user) {
            await fetchProfile(newSession.user.id);
          } else {
            setProfile(null);
          }
        });
        subscription = data.subscription;
      } catch {
        // Failed to set up listener
      }
    })();

    return () => {
      mounted = false;
      clearTimeout(timeoutId);
      subscription?.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchProfile, initKey]);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const supabase = await getSupabaseBrowserClientAsync();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { error: error.message };
      return { error: null };
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Sign in failed' };
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      const supabase = await getSupabaseBrowserClientAsync();
      await supabase.auth.signOut();
    } catch {
      // Ignore
    }
    setUser(null);
    setProfile(null);
    setSession(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user) await fetchProfile(user.id);
  }, [user, fetchProfile]);

  const retryAuth = useCallback(() => {
    setIsLoading(true);
    setAuthError(null);
    setInitKey((k) => k + 1);
  }, []);

  const isAuthenticated = !!user && !!profile;
  const isAdmin = profile?.role === 'admin';

  return (
    <AuthContext.Provider value={{ user, profile, session, isLoading, isAuthenticated, isAdmin, authError, signIn, signOut, refreshProfile, retryAuth }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
