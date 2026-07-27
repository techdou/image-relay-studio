'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { AuditLog } from '@/types';
import { fetchWithTimeout } from '@/lib/fetch-utils';
import { TableSkeleton, ErrorState, EmptyState } from '@/components/loading-states';

export default function AdminAuditLogsPage() {
  const { isAdmin, session } = useAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 30;

  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
      if (actionFilter) params.set('action', actionFilter);

      const res = await fetchWithTimeout(`/api/admin/audit-logs?${params}`, {
        headers: { 'x-session': session?.access_token || '' },
        timeout: 10_000,
      });
      if (res.ok) {
        const data = await res.json();
        setLogs(data.data?.logs || []);
        setTotal(data.data?.total || 0);
      } else {
        throw new Error('获取审计日志失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setIsLoading(false);
    }
  }, [session, page, actionFilter]);

  useEffect(() => {
    if (isAdmin) fetchLogs();
  }, [isAdmin, fetchLogs]);

  if (!isAdmin) return null;

  return (
    <div className="p-4 md:p-6">
      <h1 className="text-lg font-semibold text-[var(--color-text)] mb-4 md:mb-6">审计日志</h1>

      <div className="flex gap-2 mb-4">
        <select value={actionFilter} onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
          className="px-2.5 py-2 md:py-1.5 text-xs bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-sm)]">
          <option value="">全部操作</option>
          <option value="user.create">创建用户</option>
          <option value="user.update">更新用户</option>
          <option value="user.disable">禁用用户</option>
          <option value="model.create">创建模型</option>
          <option value="model.update">更新模型</option>
          <option value="task.create">创建任务</option>
          <option value="task.cancel">取消任务</option>
          <option value="task.retry">重试任务</option>
          <option value="settings.update">更新设置</option>
          <option value="apikey.create">创建 API Key</option>
          <option value="apikey.revoke">吊销 API Key</option>
        </select>
      </div>

      {isLoading ? (
        <TableSkeleton rows={5} cols={4} />
      ) : error ? (
        <ErrorState message={error} onRetry={fetchLogs} />
      ) : logs.length === 0 ? (
        <EmptyState message="暂无审计记录" />
      ) : (
        <>
          {/* Mobile: Card list */}
          <div className="md:hidden space-y-2">
            {logs.map((log) => (
              <div key={log.id} className="p-3 border border-[var(--color-border)] rounded-[var(--radius-md)] bg-[var(--color-surface)]">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-[var(--color-text)]">{log.action}</span>
                  <span className="text-[10px] text-[var(--color-text-subtle)]">
                    {new Date(log.created_at).toLocaleString('zh-CN')}
                  </span>
                </div>
                <div className="text-[10px] text-[var(--color-text-subtle)] space-y-0.5">
                  <div>操作者: <span className="font-mono">{log.actor_user_id?.slice(0, 8) || 'system'}</span></div>
                  <div className="mobile-break-all">资源: {log.resource_type}/{log.resource_id?.slice(0, 8)}</div>
                  {log.request_id && <div className="font-mono">请求: {log.request_id?.slice(0, 8)}</div>}
                </div>
              </div>
            ))}
          </div>

          {/* Desktop: Table */}
          <div className="hidden md:block border border-[var(--color-border)] rounded-[var(--radius-md)] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[var(--color-surface-subtle)] border-b border-[var(--color-border)]">
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)]">时间</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)]">操作者</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)]">操作</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)]">资源</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)]">请求 ID</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-hover)]">
                    <td className="px-4 py-2.5 text-xs text-[var(--color-text-subtle)]">
                      {new Date(log.created_at).toLocaleString('zh-CN')}
                    </td>
                    <td className="px-4 py-2.5 text-xs font-mono">{log.actor_user_id?.slice(0, 8) || 'system'}</td>
                    <td className="px-4 py-2.5 text-xs">{log.action}</td>
                    <td className="px-4 py-2.5 text-xs text-[var(--color-text-muted)]">
                      {log.resource_type}/{log.resource_id?.slice(0, 8)}
                    </td>
                    <td className="px-4 py-2.5 text-xs font-mono text-[var(--color-text-subtle)]">
                      {log.request_id?.slice(0, 8)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {total > pageSize && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-xs text-[var(--color-text-muted)]">共 {total} 条</span>
          <div className="flex gap-1">
            <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}
              className="px-2.5 py-1 text-xs border border-[var(--color-border)] rounded-[var(--radius-sm)] disabled:opacity-40 tap-target">上一页</button>
            <button onClick={() => setPage(page + 1)} disabled={page * pageSize >= total}
              className="px-2.5 py-1 text-xs border border-[var(--color-border)] rounded-[var(--radius-sm)] disabled:opacity-40 tap-target">下一页</button>
          </div>
        </div>
      )}
    </div>
  );
}
