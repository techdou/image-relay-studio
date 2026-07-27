'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { fetchWithTimeout } from '@/lib/fetch-utils';
import { PageSkeleton, ErrorState, EmptyState } from '@/components/loading-states';

interface UsageData {
  quota: {
    daily_limit: number;
    daily_used: number;
    monthly_limit: number;
    monthly_used: number;
    max_concurrent: number;
    current_concurrent: number;
  };
  generation_enabled: boolean;
  recent_usage: Array<{
    date: string;
    count: number;
  }>;
}

export default function UsagePage() {
  const { session } = useAuth();
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsage = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetchWithTimeout('/api/v1/usage', {
        headers: { 'x-session': session?.access_token || '' },
        timeout: 10_000,
      });
      if (res.ok) {
        const data = await res.json();
        setUsage(data.data);
      } else {
        throw new Error('获取使用量失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setIsLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (session) fetchUsage();
  }, [session, fetchUsage]);

  if (isLoading) {
    return <PageSkeleton rows={5} />;
  }

  if (error) {
    return <ErrorState message={error} onRetry={fetchUsage} />;
  }

  if (!usage) {
    return <EmptyState message="数据不可用" />;
  }

  const { quota } = usage;
  const dailyPercent = quota.daily_limit > 0 ? Math.round((quota.daily_used / quota.daily_limit) * 100) : 0;
  const monthlyPercent = quota.monthly_limit > 0 ? Math.round((quota.monthly_used / quota.monthly_limit) * 100) : 0;

  const maxRecentCount = Math.max(...(usage.recent_usage?.map(r => r.count) || [1]), 1);

  return (
    <div className="p-4 md:p-6 max-w-3xl">
      <h1 className="text-lg font-semibold text-[var(--color-text)] mb-4 md:mb-6">使用量</h1>

      {!usage.generation_enabled && (
        <div className="mb-4 p-3 bg-[var(--color-warning-subtle)] border border-[var(--color-warning)]/20 rounded-[var(--radius-md)] text-xs text-[var(--color-warning)]">
          生成服务暂时关闭
        </div>
      )}

      {/* Quota Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4 mb-6">
        {/* Daily Quota */}
        <div className="p-4 border border-[var(--color-border)] rounded-[var(--radius-md)] bg-[var(--color-surface)]">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-[var(--color-text-muted)]">今日额度</span>
            <span className="text-xs text-[var(--color-text)]">
              {quota.daily_used} / {quota.daily_limit}
            </span>
          </div>
          <div className="w-full h-2 bg-[var(--color-surface-subtle)] rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--color-accent)] rounded-full transition-all duration-300"
              style={{ width: `${Math.min(dailyPercent, 100)}%` }}
            />
          </div>
          <div className="mt-1.5 text-[10px] text-[var(--color-text-subtle)]">{dailyPercent}% 已使用</div>
        </div>

        {/* Monthly Quota */}
        <div className="p-4 border border-[var(--color-border)] rounded-[var(--radius-md)] bg-[var(--color-surface)]">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-[var(--color-text-muted)]">本月额度</span>
            <span className="text-xs text-[var(--color-text)]">
              {quota.monthly_used} / {quota.monthly_limit}
            </span>
          </div>
          <div className="w-full h-2 bg-[var(--color-surface-subtle)] rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--color-accent)] rounded-full transition-all duration-300"
              style={{ width: `${Math.min(monthlyPercent, 100)}%` }}
            />
          </div>
          <div className="mt-1.5 text-[10px] text-[var(--color-text-subtle)]">{monthlyPercent}% 已使用</div>
        </div>
      </div>

      {/* Concurrent */}
      <div className="p-4 border border-[var(--color-border)] rounded-[var(--radius-md)] bg-[var(--color-surface)] mb-6">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-[var(--color-text-muted)]">当前并发</span>
          <span className="text-sm text-[var(--color-text)]">
            {quota.current_concurrent} / {quota.max_concurrent}
          </span>
        </div>
      </div>

      {/* Recent Usage Chart - simple bar chart */}
      {usage.recent_usage && usage.recent_usage.length > 0 && (
        <div className="p-4 border border-[var(--color-border)] rounded-[var(--radius-md)] bg-[var(--color-surface)]">
          <h2 className="text-xs font-medium text-[var(--color-text-muted)] mb-3">近 7 天使用趋势</h2>
          <div className="flex items-end gap-1.5 md:gap-2 h-28 md:h-32">
            {usage.recent_usage.map((item) => (
              <div key={item.date} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-[10px] text-[var(--color-text-subtle)]">{item.count}</span>
                <div
                  className="w-full bg-[var(--color-accent)]/70 rounded-t-sm min-h-[4px] transition-all duration-300"
                  style={{ height: `${Math.max((item.count / maxRecentCount) * 80, 4)}px` }}
                />
                <span className="text-[9px] md:text-[10px] text-[var(--color-text-subtle)]">
                  {new Date(item.date).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
