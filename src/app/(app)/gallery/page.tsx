'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { GenerationAsset, ModelConfig } from '@/types';
import { fetchWithTimeout } from '@/lib/fetch-utils';
import { GridSkeleton, TableSkeleton, ErrorState, EmptyState } from '@/components/loading-states';

export default function GalleryPage() {
  const { session } = useAuth();
  const router = useRouter();
  const [assets, setAssets] = useState<GenerationAsset[]>([]);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [modelFilter, setModelFilter] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 24;

  const fetchAssets = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
      if (favoriteOnly) params.set('favorite', 'true');
      if (modelFilter) params.set('model_code', modelFilter);

      const res = await fetchWithTimeout(`/api/v1/images?${params}`, {
        headers: { 'x-session': session?.access_token || '' },
        timeout: 10_000,
      });
      if (res.ok) {
        const data = await res.json();
        setAssets(data.data || []);
        setTotal(data.pagination?.total || 0);
      } else {
        throw new Error('获取图片列表失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setIsLoading(false);
    }
  }, [session, page, favoriteOnly, modelFilter]);

  useEffect(() => {
    if (session) fetchAssets();
  }, [session, fetchAssets]);

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
      } catch { /* non-critical */ }
    }
    if (session) fetchModels();
  }, [session]);

  const toggleFavorite = async (assetId: string, currentFavorite: boolean) => {
    try {
      const res = await fetchWithTimeout(`/api/v1/images/${assetId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-session': session?.access_token || '',
        },
        body: JSON.stringify({ favorite: !currentFavorite }),
        timeout: 8_000,
      });
      if (!res.ok) throw new Error('操作失败');
      fetchAssets();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    }
  };

  const deleteAsset = async (assetId: string) => {
    if (!confirm('确定要删除此图片吗？')) return;
    try {
      const res = await fetchWithTimeout(`/api/v1/images/${assetId}`, {
        method: 'DELETE',
        headers: { 'x-session': session?.access_token || '' },
        timeout: 8_000,
      });
      if (!res.ok) throw new Error('删除失败');
      fetchAssets();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  };

  return (
    <div className="p-4 md:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 md:mb-6 gap-3">
        <h1 className="text-lg font-semibold text-[var(--color-text)]">图库</h1>
        <div className="flex gap-2 items-center flex-wrap">
          <button
            onClick={() => setFavoriteOnly(!favoriteOnly)}
            className={`px-2.5 py-1.5 text-xs rounded-[var(--radius-sm)] transition-colors tap-target ${
              favoriteOnly
                ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent)]'
                : 'text-[var(--color-text-muted)] border border-[var(--color-border)]'
            }`}
          >
            {favoriteOnly ? '已收藏' : '收藏'}
          </button>
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
          <div className="flex border border-[var(--color-border)] rounded-[var(--radius-sm)] overflow-hidden">
            <button
              onClick={() => setViewMode('grid')}
              className={`px-2 py-1.5 text-xs tap-target ${viewMode === 'grid' ? 'bg-[var(--color-surface-hover)]' : ''}`}
            >
              ▦
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`px-2 py-1.5 text-xs tap-target ${viewMode === 'list' ? 'bg-[var(--color-surface-hover)]' : ''}`}
            >
              ☰
            </button>
          </div>
        </div>
      </div>

      {isLoading ? (
        viewMode === 'grid' ? <GridSkeleton count={8} /> : <TableSkeleton rows={6} cols={5} />
      ) : error ? (
        <ErrorState message={error} onRetry={fetchAssets} />
      ) : assets.length === 0 ? (
        <EmptyState message="暂无图片" />
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 md:gap-3">
          {assets.map((asset) => (
            <div
              key={asset.id}
              className="group relative aspect-square rounded-[var(--radius-md)] overflow-hidden border border-[var(--color-border)] bg-[var(--color-surface-subtle)] cursor-pointer"
              onClick={() => router.push(`/gallery/${asset.id}`)}
            >
              {asset.url || asset.thumbnail_url ? (
                <img
                  src={asset.thumbnail_url || asset.url}
                  alt={asset.ai_generated ? 'AI 生成图片' : '图片'}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[var(--color-text-subtle)]">
                  <span className="text-xs">图片 {asset.id.slice(0, 6)}</span>
                </div>
              )}
              {/* Mobile: always visible actions, Desktop: hover */}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors opacity-100 md:opacity-0 md:group-hover:opacity-100">
                <div className="absolute bottom-0 left-0 right-0 p-2 flex justify-between items-end">
                  <span className="text-[10px] text-white/70">AI 生成</span>
                  <div className="flex gap-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleFavorite(asset.id, asset.favorite); }}
                      className="text-xs text-white/80 hover:text-white tap-target p-1"
                    >
                      {asset.favorite ? '★' : '☆'}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteAsset(asset.id); }}
                      className="text-xs text-white/80 hover:text-[var(--color-destructive)] tap-target p-1"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* Mobile: Card list */}
          <div className="md:hidden space-y-2">
            {assets.map((asset) => (
              <div key={asset.id} className="flex items-center gap-3 p-3 border border-[var(--color-border)] rounded-[var(--radius-md)] bg-[var(--color-surface)]">
                {(asset.url || asset.thumbnail_url) ? (
                  <img
                    src={asset.thumbnail_url || asset.url}
                    alt=""
                    className="w-12 h-12 rounded-[var(--radius-sm)] object-cover flex-shrink-0"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-[var(--radius-sm)] bg-[var(--color-surface-subtle)] flex items-center justify-center text-[10px] text-[var(--color-text-subtle)] flex-shrink-0">
                    {asset.id.slice(0, 6)}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-[var(--color-text)]">
                    {asset.width && asset.height ? `${asset.width}×${asset.height}` : '-'}
                  </div>
                  <div className="text-[10px] text-[var(--color-text-subtle)] mt-0.5">
                    {new Date(asset.created_at).toLocaleString('zh-CN')}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => toggleFavorite(asset.id, asset.favorite)}
                    className="text-sm tap-target p-1"
                  >
                    {asset.favorite ? '★' : '☆'}
                  </button>
                  <button
                    onClick={() => deleteAsset(asset.id)}
                    className="text-xs text-[var(--color-destructive)] tap-target p-1"
                  >
                    ✕
                  </button>
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
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)]">尺寸</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)]">收藏</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)]">创建时间</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)]">操作</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((asset) => (
                  <tr key={asset.id} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-hover)]">
                    <td className="px-4 py-2.5 text-xs font-mono">{asset.id.slice(0, 8)}</td>
                    <td className="px-4 py-2.5 text-xs text-[var(--color-text-muted)]">
                      {asset.width && asset.height ? `${asset.width}×${asset.height}` : '-'}
                    </td>
                    <td className="px-4 py-2.5 text-xs">{asset.favorite ? '★' : '☆'}</td>
                    <td className="px-4 py-2.5 text-xs text-[var(--color-text-muted)]">
                      {new Date(asset.created_at).toLocaleString('zh-CN')}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => toggleFavorite(asset.id, asset.favorite)}
                          className="text-xs text-[var(--color-accent)] hover:underline"
                        >
                          {asset.favorite ? '取消收藏' : '收藏'}
                        </button>
                        <button
                          onClick={() => deleteAsset(asset.id)}
                          className="text-xs text-[var(--color-destructive)] hover:underline"
                        >
                          删除
                        </button>
                      </div>
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
          <span className="text-xs text-[var(--color-text-muted)]">共 {total} 张</span>
          <div className="flex gap-1">
            <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="px-2.5 py-1 text-xs border border-[var(--color-border)] rounded-[var(--radius-sm)] disabled:opacity-40 tap-target">上一页</button>
            <button onClick={() => setPage(page + 1)} disabled={page * pageSize >= total} className="px-2.5 py-1 text-xs border border-[var(--color-border)] rounded-[var(--radius-sm)] disabled:opacity-40 tap-target">下一页</button>
          </div>
        </div>
      )}
    </div>
  );
}
