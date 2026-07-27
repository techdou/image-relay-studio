'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { GenerationAsset } from '@/types';
import { fetchWithTimeout } from '@/lib/fetch-utils';
import { TableSkeleton, ErrorState, EmptyState } from '@/components/loading-states';

export default function AdminAssetsPage() {
  const { isAdmin, session } = useAuth();
  const [assets, setAssets] = useState<GenerationAsset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 20;

  const fetchAssets = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
      const res = await fetchWithTimeout(`/api/admin/assets?${params}`, {
        headers: { 'x-session': session?.access_token || '' },
        timeout: 10_000,
      });
      if (res.ok) {
        const data = await res.json();
        setAssets(data.data?.assets || []);
        setTotal(data.data?.total || 0);
      } else {
        throw new Error('获取资产列表失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setIsLoading(false);
    }
  }, [session, page]);

  useEffect(() => {
    if (isAdmin) fetchAssets();
  }, [isAdmin, fetchAssets]);

  if (!isAdmin) return null;

  return (
    <div className="p-4 md:p-6">
      <h1 className="text-lg font-semibold text-[var(--color-text)] mb-4 md:mb-6">资产管理</h1>
      {isLoading ? (
        <TableSkeleton rows={5} cols={4} />
      ) : error ? (
        <ErrorState message={error} onRetry={fetchAssets} />
      ) : assets.length === 0 ? (
        <EmptyState message="暂无资产" />
      ) : (
        <>
          {/* Mobile: Card list */}
          <div className="md:hidden space-y-2">
            {assets.map((asset) => (
              <div key={asset.id} className="p-3 border border-[var(--color-border)] rounded-[var(--radius-md)] bg-[var(--color-surface)]">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-mono text-[var(--color-text-muted)]">{asset.id.slice(0, 8)}</span>
                  <span className={`text-[10px] font-medium ${asset.ai_generated ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-subtle)]'}`}>
                    {asset.ai_generated ? 'AI 生成' : '上传'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="text-[10px] text-[var(--color-text-subtle)]">
                    任务 {asset.task_id?.slice(0, 8)} · 用户 {asset.user_id?.slice(0, 8)}
                    {asset.width && asset.height && ` · ${asset.width}×${asset.height}`}
                  </div>
                </div>
                <div className="mt-1 text-[10px] text-[var(--color-text-subtle)]">
                  {new Date(asset.created_at).toLocaleString('zh-CN')}
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
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)]">任务</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)]">用户</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)]">尺寸</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)]">AI 生成</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)]">创建时间</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((asset) => (
                  <tr key={asset.id} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-hover)]">
                    <td className="px-4 py-2.5 text-xs font-mono">{asset.id.slice(0, 8)}</td>
                    <td className="px-4 py-2.5 text-xs font-mono">{asset.task_id?.slice(0, 8)}</td>
                    <td className="px-4 py-2.5 text-xs font-mono">{asset.user_id?.slice(0, 8)}</td>
                    <td className="px-4 py-2.5 text-xs text-[var(--color-text-muted)]">
                      {asset.width && asset.height ? `${asset.width}×${asset.height}` : '-'}
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      {asset.ai_generated ? <span className="text-[var(--color-accent)]">是</span> : <span className="text-[var(--color-text-subtle)]">否</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[var(--color-text-subtle)]">{new Date(asset.created_at).toLocaleString('zh-CN')}</td>
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
            <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="px-2.5 py-1 text-xs border border-[var(--color-border)] rounded-[var(--radius-sm)] disabled:opacity-40 tap-target">上一页</button>
            <button onClick={() => setPage(page + 1)} disabled={page * pageSize >= total} className="px-2.5 py-1 text-xs border border-[var(--color-border)] rounded-[var(--radius-sm)] disabled:opacity-40 tap-target">下一页</button>
          </div>
        </div>
      )}
    </div>
  );
}
