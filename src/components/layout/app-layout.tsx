'use client';

import React from 'react';
import { useAuth } from '@/lib/auth-context';
import { AppSidebar } from '@/components/layout/sidebar';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { FullPageLoader, ErrorState } from '@/components/loading-states';

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, profile, authError, retryAuth } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAuthenticated && !authError) {
      router.push('/login');
    }
  }, [isLoading, isAuthenticated, authError, router]);

  useEffect(() => {
    if (!isLoading && isAuthenticated && profile?.status === 'disabled') {
      router.push('/login');
    }
  }, [isLoading, isAuthenticated, profile, router]);

  if (isLoading) {
    return <FullPageLoader />;
  }

  // 认证初始化失败（超时或错误），显示重试界面
  if (authError && !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-background)]">
        <ErrorState message={authError} onRetry={retryAuth} />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  if (profile?.status === 'disabled') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-background)]">
        <div className="text-center">
          <h2 className="text-lg font-medium text-[var(--color-text)]">账号已被禁用</h2>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">请联系管理员</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--color-background)]">
      <AppSidebar />
      {/* Desktop: left margin for sidebar; Mobile: top padding for top bar */}
      <main className="md:ml-[var(--sidebar-width)] pt-[var(--topbar-height)] md:pt-0">
        {children}
      </main>
    </div>
  );
}
