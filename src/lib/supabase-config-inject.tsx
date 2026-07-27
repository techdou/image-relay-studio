'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

interface SupabaseConfig {
  url: string;
  anonKey: string;
}

interface SupabaseConfigContextType {
  config: SupabaseConfig | null;
  isLoading: boolean;
  error: string | null;
  retry: () => void;
}

const SupabaseConfigContext = createContext<SupabaseConfigContextType>({
  config: null,
  isLoading: true,
  error: null,
  retry: () => {},
});

const CONFIG_FETCH_TIMEOUT_MS = 8_000;

export function SupabaseConfigProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<SupabaseConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG_FETCH_TIMEOUT_MS);

    fetch('/api/supabase-config', { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error('配置加载失败');
        return res.json();
      })
      .then((data) => {
        if (mounted) {
          setConfig({ url: data.url, anonKey: data.anonKey });
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (mounted) {
          const msg = err instanceof Error && err.name === 'AbortError'
            ? '配置加载超时，请检查网络连接'
            : (err instanceof Error ? err.message : '配置加载失败');
          setError(msg);
          setIsLoading(false);
        }
      })
      .finally(() => {
        clearTimeout(timeoutId);
      });

    return () => {
      mounted = false;
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [retryKey]);

  const retry = useCallback(() => {
    setIsLoading(true);
    setError(null);
    setRetryKey((k) => k + 1);
  }, []);

  // 加载中：不渲染 children，避免 AuthProvider 重复请求
  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--color-background)] gap-3">
        <div className="flex gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-text-subtle)] animate-bounce [animation-delay:0ms]" />
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-text-subtle)] animate-bounce [animation-delay:150ms]" />
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-text-subtle)] animate-bounce [animation-delay:300ms]" />
        </div>
        <div className="text-sm text-[var(--color-text-muted)]">正在初始化...</div>
      </div>
    );
  }

  // 配置加载失败：显示错误 + 重试，不渲染 children
  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--color-background)] gap-3">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[var(--color-text-subtle)]">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4M12 16h.01" />
        </svg>
        <p className="text-sm text-[var(--color-text-muted)]">{error}</p>
        <button
          onClick={retry}
          className="px-3 py-1.5 text-xs font-medium text-[var(--color-accent)] border border-[var(--color-accent)] rounded-[var(--radius-sm)] hover:bg-[var(--color-accent-subtle)] transition-colors"
        >
          重试
        </button>
      </div>
    );
  }

  return (
    <SupabaseConfigContext.Provider value={{ config, isLoading, error, retry }}>
      {children}
    </SupabaseConfigContext.Provider>
  );
}

export function useSupabaseConfig() {
  return useContext(SupabaseConfigContext);
}
