'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import { fetchWithTimeout } from '@/lib/fetch-utils';
import { PageSkeleton, ErrorState } from '@/components/loading-states';

interface DashboardData {
  today_tasks: number;
  today_images: number;
  success_rate: number;
  avg_latency_ms: number | null;
  queued_tasks: number;
  running_tasks: number;
  active_users: number;
  provider_health: Array<{ provider: string; healthy: boolean }>;
  recent_errors: Array<{ task_id: string; error_message: string; created_at: string }>;
  generation_enabled: boolean;
}

export default function AdminDashboardPage() {
  const { isAdmin, session } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetchWithTimeout('/api/admin/dashboard', {
        headers: { 'x-session': session?.access_token || '' },
        timeout: 10_000,
      });
      if (res.ok) {
        const result = await res.json();
        setData(result.data);
      } else {
        throw new Error('获取管理面板数据失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setIsLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (!isAdmin) {
      router.push('/studio');
      return;
    }
    fetchDashboard();
  }, [isAdmin, router, fetchDashboard]);

  if (!isAdmin) return null;

  if (isLoading) {
    return <PageSkeleton rows={6} />;
  }

  if (error) {
    return <ErrorState message={error} onRetry={fetchDashboard} />;
  }

  return (
    <div className="p-4 md:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 md:mb-6 gap-2">
        <h1 className="text-lg font-semibold text-[var(--color-text)]">管理总览</h1>
        {!data?.generation_enabled && (
          <span className="self-start px-2 py-1 text-xs bg-[var(--color-warning-subtle)] text-[var(--color-warning)] rounded-[var(--radius-sm)]">
            生成服务已关闭
          </span>
        )}
      </div>

      {/* Stats Grid - 2 columns on mobile, 4 on desktop */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 mb-4 md:mb-6">
        <div className="p-3 border border-[var(--color-border)] rounded-[var(--radius-md)]">
          <div className="text-[10px] md:text-xs text-[var(--color-text-muted)]">今日任务</div>
          <div className="mt-1 text-lg md:text-xl font-semibold text-[var(--color-text)]">{data?.today_tasks ?? '-'}</div>
        </div>
        <div className="p-3 border border-[var(--color-border)] rounded-[var(--radius-md)]">
          <div className="text-[10px] md:text-xs text-[var(--color-text-muted)]">今日图片</div>
          <div className="mt-1 text-lg md:text-xl font-semibold text-[var(--color-text)]">{data?.today_images ?? '-'}</div>
        </div>
        <div className="p-3 border border-[var(--color-border)] rounded-[var(--radius-md)]">
          <div className="text-[10px] md:text-xs text-[var(--color-text-muted)]">成功率</div>
          <div className="mt-1 text-lg md:text-xl font-semibold text-[var(--color-text)]">
            {data?.success_rate != null ? `${Math.round(data.success_rate * 100)}%` : '-'}
          </div>
        </div>
        <div className="p-3 border border-[var(--color-border)] rounded-[var(--radius-md)]">
          <div className="text-[10px] md:text-xs text-[var(--color-text-muted)]">平均耗时</div>
          <div className="mt-1 text-lg md:text-xl font-semibold text-[var(--color-text)]">
            {data?.avg_latency_ms ? `${Math.round(data.avg_latency_ms / 1000)}s` : '-'}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 mb-4 md:mb-6">
        <div className="p-3 border border-[var(--color-border)] rounded-[var(--radius-md)]">
          <div className="text-[10px] md:text-xs text-[var(--color-text-muted)]">排队任务</div>
          <div className="mt-1 text-lg md:text-xl font-semibold text-[var(--color-warning)]">{data?.queued_tasks ?? 0}</div>
        </div>
        <div className="p-3 border border-[var(--color-border)] rounded-[var(--radius-md)]">
          <div className="text-[10px] md:text-xs text-[var(--color-text-muted)]">运行中</div>
          <div className="mt-1 text-lg md:text-xl font-semibold text-[var(--color-accent)]">{data?.running_tasks ?? 0}</div>
        </div>
        <div className="p-3 border border-[var(--color-border)] rounded-[var(--radius-md)]">
          <div className="text-[10px] md:text-xs text-[var(--color-text-muted)]">活跃用户</div>
          <div className="mt-1 text-lg md:text-xl font-semibold text-[var(--color-text)]">{data?.active_users ?? '-'}</div>
        </div>
        <div className="p-3 border border-[var(--color-border)] rounded-[var(--radius-md)]">
          <div className="text-[10px] md:text-xs text-[var(--color-text-muted)]">Provider 健康</div>
          <div className="mt-1 flex gap-1">
            {data?.provider_health?.map((p) => (
              <span key={p.provider} className={`w-2 h-2 rounded-full ${p.healthy ? 'bg-[var(--color-success)]' : 'bg-[var(--color-destructive)]'}`} />
            )) || <span className="text-[var(--color-text-subtle)]">-</span>}
          </div>
        </div>
      </div>

      {/* Recent Errors */}
      {data?.recent_errors && data.recent_errors.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-[var(--color-text)] mb-3">最近错误</h2>
          {/* Mobile: Card list */}
          <div className="md:hidden space-y-2">
            {data.recent_errors.map((err, i) => (
              <div key={i} className="p-3 border border-[var(--color-border)] rounded-[var(--radius-md)]">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-mono text-[var(--color-text-muted)]">{err.task_id?.slice(0, 8)}</span>
                  <span className="text-[10px] text-[var(--color-text-subtle)]">{new Date(err.created_at).toLocaleString('zh-CN')}</span>
                </div>
                <p className="text-xs text-[var(--color-destructive)] mobile-break-all">{err.error_message}</p>
              </div>
            ))}
          </div>
          {/* Desktop: Table */}
          <div className="hidden md:block border border-[var(--color-border)] rounded-[var(--radius-md)] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[var(--color-surface-subtle)] border-b border-[var(--color-border)]">
                  <th className="text-left px-4 py-2 text-xs font-medium text-[var(--color-text-muted)]">任务 ID</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-[var(--color-text-muted)]">错误</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-[var(--color-text-muted)]">时间</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_errors.map((err, i) => (
                  <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-4 py-2 text-xs font-mono">{err.task_id?.slice(0, 8)}</td>
                    <td className="px-4 py-2 text-xs text-[var(--color-destructive)] max-w-xs truncate">{err.error_message}</td>
                    <td className="px-4 py-2 text-xs text-[var(--color-text-subtle)]">{new Date(err.created_at).toLocaleString('zh-CN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
