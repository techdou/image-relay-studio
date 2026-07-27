'use client';

import React, { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;

    setIsLoading(true);
    setError(null);

    try {
      const { error: authError } = await signIn(email.trim(), password);
      if (authError) {
        setError(authError || '登录失败');
      } else {
        router.push('/studio');
      }
    } catch {
      setError('登录请求失败');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-surface-subtle)] px-4 safe-area-all">
      <div className="w-full max-w-sm">
        <div className="p-6 md:p-8 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)]">
          <div className="text-center mb-6">
            <h1 className="text-lg font-semibold text-[var(--color-text)]">Image Relay Studio</h1>
            <p className="mt-1.5 text-xs text-[var(--color-text-muted)]">AI 图像生成工作台</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5">邮箱</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                autoComplete="email"
                required
                className="w-full px-3 py-2.5 text-base bg-[var(--color-surface-subtle)] border border-[var(--color-border)] rounded-[var(--radius-md)] text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5">密码</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="输入密码"
                autoComplete="current-password"
                required
                className="w-full px-3 py-2.5 text-base bg-[var(--color-surface-subtle)] border border-[var(--color-border)] rounded-[var(--radius-md)] text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              />
            </div>

            {error && (
              <div className="p-2.5 bg-[var(--color-destructive-subtle)] border border-[var(--color-destructive)]/20 rounded-[var(--radius-sm)] text-xs text-[var(--color-destructive)]">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading || !email.trim() || !password}
              className="w-full py-2.5 text-sm font-medium text-white bg-[var(--color-accent)] rounded-[var(--radius-md)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors tap-target"
            >
              {isLoading ? '登录中...' : '登录'}
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-[10px] text-[var(--color-text-subtle)]">
          仅限白名单用户使用
        </p>
      </div>
    </div>
  );
}
