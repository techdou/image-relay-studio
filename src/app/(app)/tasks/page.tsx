'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { GenerationTask, ModelConfig, TaskStatus } from '@/types';
import { fetchWithTimeout } from '@/lib/fetch-utils';
import { TableSkeleton, ErrorState, EmptyState } from '@/components/loading-states';

export default function TasksPage() {
  const { session } = useAuth();
  const [tasks, setTasks] = useState<GenerationTask[]>([]);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [modelFilter, setModelFilter] = useState<string>('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 20;

  const fetchTasks = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
      if (statusFilter) params.set('status', statusFilter);
      if (modelFilter) params.set('model_code', modelFilter);

      const res = await fetchWithTimeout(`/api/v1/tasks?${params}`, {
        headers: { 'x-session': session?.access_token || '' },
        timeout: 10_000,
      });
      if (res.ok) {
        const data = await res.json();
        setTasks(data.data || []);
        setTotal(data.pagination?.total || 0);
      } else {
        throw new Error('获取任务列表失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setIsLoading(false);
    }
  }, [session, page, statusFilter, modelFilter]);

  useEffect(() => {
    if (session) fetchTasks();
  }, [session, fetchTasks]);

  useEffect(() => {
    async function fetchModels() {
      try {
        const res = await fetchWithTimeout('/api/v1/models', {
          headers: { 'x-session': session?.access_token || '' },
          timeout: 8_000,
        });
        if (res.ok) {
          const data = await res.json();
          setModels(data.data || []);
        }
      } catch { /* non-critical - models are supplementary */ }
    }
    if (session) fetchModels();
  }, [session]);

  const handleRetryTask = async (taskId: string) => {
    try {
      const res = await fetchWithTimeout(`/api/v1/tasks/${taskId}/retry`, {
        method: 'POST',
        headers: { 'x-session': session?.access_token || '' },
        timeout: 8_000,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message || '重试失败');
      }
      fetchTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : '重试失败');
    }
  };

  const handleCancel = async (taskId: string) => {
    try {
      const res = await fetchWithTimeout(`/api/v1/tasks/${taskId}/cancel`, {
        method: 'POST',
        headers: { 'x-session': session?.access_token || '' },
        timeout: 8_000,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message || '取消失败');
      }
      fetchTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : '取消失败');
    }
  };

  const statusColors: Record<TaskStatus, string> = {
    queued: 'text-[var(--color-warning)]',
    running: 'text-[var(--color-accent)]',
    succeeded: 'text-[var(--color-success)]',
    failed: 'text-[var(--color-destructive)]',
    cancelled: 'text-[var(--color-text-subtle)]',
  };

  const statusLabels: Record<TaskStatus, string> = {
    queued: '排队中',
    running: '生成中',
    succeeded: '已完成',
    failed: '失败',
    cancelled: '已取消',
  };

  return (
    <div className="p-4 md:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 md:mb-6 gap-3">
        <h1 className="text-lg font-semibold text-[var(--color-text)]">任务列表</h1>
        <div className="flex gap-2">
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="px-2.5 py-1.5 text-xs bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-sm)] text-[var(--color-text)]"
          >
            <option value="">全部状态</option>
            <option value="queued">排队中</option>
            <option value="running">生成中</option>
            <option value="succeeded">已完成</option>
            <option value="failed">失败</option>
            <option value="cancelled">已取消</option>
          </select>
          <select
            value={modelFilter}
            onChange={(e) => { setModelFilter(e.target.value); setPage(1); }}
            className="px-2.5 py-1.5 text-xs bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-sm)] text-[var(--color-text)]"
          >
            <option value="">全部模型</option>
            {models.map(m => (
              <option key={m.code} value={m.code}>{m.display_name}</option>
            ))}
          </select>
        </div>
      </div>

      {isLoading ? (
        <TableSkeleton rows={5} cols={6} />
      ) : error ? (
        <ErrorState message={error} onRetry={fetchTasks} />
      ) : tasks.length === 0 ? (
        <EmptyState message="暂无任务" />
      ) : (
        <>
          {/* Mobile: Card list */}
          <div className="md:hidden space-y-2">
            {tasks.map((task) => (
              <div key={task.id} className="p-3 border border-[var(--color-border)] rounded-[var(--radius-md)] bg-[var(--color-surface)]">
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-xs font-medium ${statusColors[task.status]}`}>
                    {statusLabels[task.status]}
                  </span>
                  <span className="text-[10px] text-[var(--color-text-subtle)]">
                    {task.task_type === 'text_to_image' ? '文生图' : '图生图'}
                  </span>
                </div>
                <p className="text-sm text-[var(--color-text)] mb-2 line-clamp-2 mobile-break-all">
                  {task.prompt}
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-[var(--color-text-subtle)]">
                    {new Date(task.created_at).toLocaleString('zh-CN')}
                  </span>
                  <div className="flex gap-2">
                    {task.status === 'failed' && (
                      <button
                        onClick={() => handleRetryTask(task.id)}
                        className="text-xs text-[var(--color-accent)] hover:underline tap-target"
                      >
                        重试
                      </button>
                    )}
                    {task.status === 'queued' && (
                      <button
                        onClick={() => handleCancel(task.id)}
                        className="text-xs text-[var(--color-destructive)] hover:underline tap-target"
                      >
                        取消
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop: Table */}
          <div className="hidden md:block border border-[var(--color-border)] rounded-[var(--radius-md)] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[var(--color-surface-subtle)] border-b border-[var(--color-border)]">
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)]">ID</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)]">Prompt</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)]">状态</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)]">类型</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)]">创建时间</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)]">操作</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-hover)]">
                    <td className="px-4 py-2.5 text-xs font-mono text-[var(--color-text-muted)]">
                      {task.id.slice(0, 8)}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--color-text)] max-w-xs truncate">
                      {task.prompt}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs font-medium ${statusColors[task.status]}`}>
                        {statusLabels[task.status]}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[var(--color-text-muted)]">
                      {task.task_type === 'text_to_image' ? '文生图' : '图生图'}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[var(--color-text-muted)]">
                      {new Date(task.created_at).toLocaleString('zh-CN')}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex gap-1.5">
                        {task.status === 'failed' && (
                          <button
                            onClick={() => handleRetryTask(task.id)}
                            className="text-xs text-[var(--color-accent)] hover:underline"
                          >
                            重试
                          </button>
                        )}
                        {(task.status === 'queued') && (
                          <button
                            onClick={() => handleCancel(task.id)}
                            className="text-xs text-[var(--color-destructive)] hover:underline"
                          >
                            取消
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Pagination */}
      {total > pageSize && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-xs text-[var(--color-text-muted)]">
            共 {total} 条
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page === 1}
              className="px-2.5 py-1 text-xs border border-[var(--color-border)] rounded-[var(--radius-sm)] disabled:opacity-40 tap-target"
            >
              上一页
            </button>
            <button
              onClick={() => setPage(page + 1)}
              disabled={page * pageSize >= total}
              className="px-2.5 py-1 text-xs border border-[var(--color-border)] rounded-[var(--radius-sm)] disabled:opacity-40 tap-target"
            >
              下一页
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
