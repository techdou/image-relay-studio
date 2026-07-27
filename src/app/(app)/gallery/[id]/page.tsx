'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { GenerationAsset } from '@/types';
import { fetchWithTimeout } from '@/lib/fetch-utils';
import { PageSkeleton, ErrorState, EmptyState } from '@/components/loading-states';

export default function GalleryDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { session } = useAuth();
  const [asset, setAsset] = useState<GenerationAsset | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isZoomed, setIsZoomed] = useState(false);

  const fetchAsset = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetchWithTimeout(`/api/v1/images/${id}`, {
        headers: { 'x-session': session?.access_token || '' },
        timeout: 10_000,
      });
      if (res.ok) {
        const data = await res.json();
        setAsset(data.data);
      } else {
        throw new Error('获取图片详情失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setIsLoading(false);
    }
  }, [id, session]);

  useEffect(() => {
    if (session && id) fetchAsset();
  }, [session, id, fetchAsset]);

  const toggleFavorite = async () => {
    if (!asset) return;
    try {
      const res = await fetchWithTimeout(`/api/v1/images/${asset.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-session': session?.access_token || '',
        },
        body: JSON.stringify({ favorite: !asset.favorite }),
        timeout: 8_000,
      });
      if (res.ok) fetchAsset();
    } catch { /* ignore */ }
  };

  const deleteAsset = async () => {
    if (!asset || !confirm('确定要删除此图片吗？')) return;
    try {
      const res = await fetchWithTimeout(`/api/v1/images/${asset.id}`, {
        method: 'DELETE',
        headers: { 'x-session': session?.access_token || '' },
        timeout: 8_000,
      });
      if (res.ok) router.push('/gallery');
    } catch { /* ignore */ }
  };

  const downloadAsset = async () => {
    if (!asset?.url) return;
    try {
      const response = await fetch(asset.url);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `image-${asset.id.slice(0, 8)}.png`;
      link.click();
      window.URL.revokeObjectURL(blobUrl);
    } catch { /* ignore */ }
  };

  if (isLoading) {
    return <PageSkeleton rows={4} />;
  }

  if (error) {
    return <ErrorState message={error} onRetry={fetchAsset} />;
  }

  if (!asset) {
    return <EmptyState message="图片未找到" />;
  }

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center gap-3 mb-4 md:mb-6">
        <button
          onClick={() => router.push('/gallery')}
          className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] tap-target p-1"
          aria-label="返回图库"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M11 4L6 9l5 5" />
          </svg>
        </button>
        <h1 className="text-lg font-semibold text-[var(--color-text)]">图片详情</h1>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 md:gap-6">
        {/* Image Preview */}
        <div className="lg:flex-1">
          <div
            className={`relative rounded-[var(--radius-md)] overflow-hidden border border-[var(--color-border)] bg-[var(--color-surface-subtle)] cursor-pointer ${
              isZoomed ? 'fixed inset-0 z-50 rounded-none border-0' : 'aspect-square md:aspect-auto md:max-h-[70vh]'
            }`}
            onClick={() => setIsZoomed(!isZoomed)}
          >
            {asset.url || asset.thumbnail_url ? (
              <img
                src={isZoomed ? asset.url : (asset.thumbnail_url || asset.url)}
                alt="AI 生成图片"
                className={`w-full h-full object-contain ${isZoomed ? 'min-h-screen' : ''}`}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[var(--color-text-subtle)]">
                图片不可用
              </div>
            )}
            {isZoomed && (
              <div className="absolute top-3 right-3 md:top-4 md:right-4">
                <button
                  onClick={(e) => { e.stopPropagation(); setIsZoomed(false); }}
                  className="w-8 h-8 md:w-7 md:h-7 bg-black/60 text-white rounded-full flex items-center justify-center text-lg tap-target"
                >
                  ×
                </button>
              </div>
            )}
          </div>
          <p className="mt-1.5 text-[10px] text-[var(--color-text-subtle)] text-center">点击图片放大查看</p>
        </div>

        {/* Metadata */}
        <div className="lg:w-72 xl:w-80 space-y-4">
          <div className="flex gap-2">
            <button
              onClick={downloadAsset}
              className="flex-1 py-2 text-xs font-medium text-white bg-[var(--color-accent)] rounded-[var(--radius-sm)] hover:bg-[var(--color-accent-hover)] transition-colors tap-target"
            >
              下载
            </button>
            <button
              onClick={toggleFavorite}
              className={`px-4 py-2 text-xs font-medium rounded-[var(--radius-sm)] transition-colors tap-target ${
                asset.favorite
                  ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent)]'
                  : 'border border-[var(--color-border)] text-[var(--color-text-muted)]'
              }`}
            >
              {asset.favorite ? '★ 已收藏' : '☆ 收藏'}
            </button>
            <button
              onClick={deleteAsset}
              className="px-4 py-2 text-xs font-medium border border-[var(--color-destructive)] text-[var(--color-destructive)] rounded-[var(--radius-sm)] hover:bg-[var(--color-destructive-subtle)] transition-colors tap-target"
            >
              删除
            </button>
          </div>

          <div className="border border-[var(--color-border)] rounded-[var(--radius-md)] divide-y divide-[var(--color-border)]">
            <div className="px-3 py-2.5 flex justify-between items-start">
              <span className="text-xs text-[var(--color-text-muted)]">ID</span>
              <span className="text-xs font-mono text-[var(--color-text)] mobile-break-all">{asset.id}</span>
            </div>
            {asset.width && asset.height && (
              <div className="px-3 py-2.5 flex justify-between">
                <span className="text-xs text-[var(--color-text-muted)]">尺寸</span>
                <span className="text-xs text-[var(--color-text)]">{asset.width}×{asset.height}</span>
              </div>
            )}
            {asset.file_size != null && (
              <div className="px-3 py-2.5 flex justify-between">
                <span className="text-xs text-[var(--color-text-muted)]">文件大小</span>
                <span className="text-xs text-[var(--color-text)]">
                  {asset.file_size! > 1024 * 1024
                    ? `${(asset.file_size! / 1024 / 1024).toFixed(1)} MB`
                    : `${(asset.file_size! / 1024).toFixed(0)} KB`}
                </span>
              </div>
            )}
            {asset.mime_type && (
              <div className="px-3 py-2.5 flex justify-between">
                <span className="text-xs text-[var(--color-text-muted)]">格式</span>
                <span className="text-xs text-[var(--color-text)]">{asset.mime_type}</span>
              </div>
            )}
            <div className="px-3 py-2.5 flex justify-between">
              <span className="text-xs text-[var(--color-text-muted)]">创建时间</span>
              <span className="text-xs text-[var(--color-text)]">{new Date(asset.created_at).toLocaleString('zh-CN')}</span>
            </div>
          </div>

          {asset.task_id && (
            <button
              onClick={() => router.push(`/tasks?task_id=${asset.task_id}`)}
              className="w-full py-2 text-xs text-[var(--color-accent)] text-center hover:underline"
            >
              查看关联任务 →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
