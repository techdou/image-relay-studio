'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { fetchWithTimeout } from '@/lib/fetch-utils';
import { PageSkeleton, ErrorState } from '@/components/loading-states';

interface HealthData {
  status: string;
  timestamp: string;
  checks: Record<string, {
    status: string;
    latency_ms?: number;
    error?: string;
    details?: Array<{ provider: string; healthy: boolean }>;
  }>;
}

export default function AdminHealthPage() {
  const { isAdmin, session } = useAuth();
  const [health, setHealth] = useState<HealthData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetchWithTimeout('/api/health', {
        headers: { 'x-session': session?.access_token || '' },
        timeout: 10_000,
      });
      if (res.ok) {
        const data = await res.json();
        setHealth(data);
      } else {
        throw new Error('获取健康状态失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setIsLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (!isAdmin) return;
    fetchHealth();
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, [isAdmin, fetchHealth]);

  if (!isAdmin) return null;

  return (
    <div className="p-4 md:p-6 max-w-3xl">
      <h1 className="text-lg font-semibold text-[var(--color-text)] mb-4 md:mb-6">服务健康状态</h1>

      {isLoading ? (
        <PageSkeleton rows={4} />
      ) : error ? (
        <ErrorState message={error} onRetry={fetchHealth} />
      ) : !health ? (
        <div className="text-sm text-[var(--color-text-subtle)] py-8 text-center">无法获取健康状态</div>
      ) : (
        <div className="space-y-3">
          <div className="p-3 border border-[var(--color-border)] rounded-[var(--radius-md)]">
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--color-text)]">整体状态</span>
              <span className={`text-xs font-medium ${
                health.status === 'healthy' ? 'text-[var(--color-success)]' :
                health.status === 'degraded' ? 'text-[var(--color-warning)]' :
                'text-[var(--color-destructive)]'
              }`}>
                {health.status === 'healthy' ? '正常' : health.status === 'degraded' ? '降级' : '异常'}
              </span>
            </div>
            <div className="text-[10px] text-[var(--color-text-subtle)] mt-1">
              更新于 {new Date(health.timestamp).toLocaleString('zh-CN')}
            </div>
          </div>

          {Object.entries(health.checks).map(([name, check]) => (
            <div key={name} className="p-3 border border-[var(--color-border)] rounded-[var(--radius-md)]">
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--color-text)] mobile-break-all">{name}</span>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {check.latency_ms != null && (
                    <span className="text-[10px] text-[var(--color-text-subtle)]">{check.latency_ms}ms</span>
                  )}
                  <span className={`text-xs font-medium ${
                    check.status === 'healthy' || check.status === 'enabled' ? 'text-[var(--color-success)]' :
                    check.status === 'degraded' || check.status === 'disabled' ? 'text-[var(--color-warning)]' :
                    'text-[var(--color-destructive)]'
                  }`}>
                    {check.status}
                  </span>
                </div>
              </div>
              {check.error && (
                <div className="text-xs text-[var(--color-destructive)] mt-1 mobile-break-all">{check.error}</div>
              )}
              {check.details && (
                <div className="mt-1 flex flex-wrap gap-2">
                  {check.details.map((d) => (
                    <span key={d.provider} className="flex items-center gap-1 text-[10px] text-[var(--color-text-muted)]">
                      <span className={`w-1.5 h-1.5 rounded-full ${d.healthy ? 'bg-[var(--color-success)]' : 'bg-[var(--color-destructive)]'}`} />
                      {d.provider}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
