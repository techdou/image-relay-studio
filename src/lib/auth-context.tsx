'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { Session, User, AuthError } from '@supabase/supabase-js';
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

/**
 * 把 Supabase / 网络层的英文错误映射为面向终端用户的中文文案。
 * 默认返回安全的"登录失败，请稍后重试"，避免向用户暴露底层细节。
 */
function mapAuthError(err: unknown): string {
  // fetch 网络故障（DNS/连接失败等）会抛出 TypeError
  if (err instanceof TypeError) {
    return '网络连接失败，请检查网络';
  }
  if (err instanceof AuthError) {
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('invalid login credentials')) return '邮箱或密码错误';
    if (msg.includes('email not confirmed')) return '请先验证邮箱';
    if (msg.includes('too many requests') || msg.includes('rate limit')) {
      return '尝试过于频繁，请稍后再试';
    }
    if (msg.includes('user already registered')) return '该邮箱已注册';
  }
  // 兜底：避免泄露原始英文/堆栈
  return '登录失败，请稍后重试';
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  // 用递增 key 触发重新初始化
  const [initKey, setInitKey] = useState(0);

  // mountedRef：跨 effect 的"组件是否仍在挂载状态"标志。
  // fetchProfile / onAuthStateChange 的 async 回调可能在卸载后才完成，
  // 此时 setState 会触发 React 警告，需要先检查 mountedRef.current。
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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
        if (!mountedRef.current) return;
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
        } catch (sessionErr: unknown) {
          // Refresh token expired / invalid / revoked — clear stored session silently
          // and proceed as unauthenticated (don't show error to user)
          const err = sessionErr as { message?: string; name?: string; __isAuthError?: boolean };
          if (
            err?.message?.includes('Refresh Token') ||
            err?.name === 'AuthSessionMissingError' ||
            err?.__isAuthError
          ) {
            console.warn('[Auth] Session refresh failed, clearing local session:', err?.message);
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
          // 1) initAuth 的 mounted 闭包标志
          if (!mounted) return;
          setSession(newSession);
          setUser(newSession?.user ?? null);
          if (newSession?.user) {
            await fetchProfile(newSession.user.id);
            // 2) await 期间组件可能已卸载，setState 前再检查一次
            if (!mountedRef.current) return;
          } else {
            if (!mountedRef.current) return;
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
      if (error) return { error: mapAuthError(error) };
      return { error: null };
    } catch (err) {
      return { error: mapAuthError(err) };
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
