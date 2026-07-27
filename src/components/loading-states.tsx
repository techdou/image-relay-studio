'use client';

import React from 'react';

/**
 * 页面级加载骨架屏
 * 模拟页面结构，比纯文字"加载中..."体验更好
 */
export function PageSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="p-4 md:p-6 animate-pulse">
      {/* Title */}
      <div className="h-5 w-28 bg-[var(--color-surface-hover)] rounded mb-4 md:mb-6" />
      {/* Content rows */}
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-10 bg-[var(--color-surface-hover)] rounded" />
        ))}
      </div>
    </div>
  );
}

/**
 * 表格骨架屏
 */
export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="p-4 md:p-6 animate-pulse">
      <div className="h-5 w-28 bg-[var(--color-surface-hover)] rounded mb-4" />
      <div className="space-y-2">
        {/* Header */}
        <div className="flex gap-3">
          {Array.from({ length: cols }).map((_, i) => (
            <div key={i} className="h-4 flex-1 bg-[var(--color-surface-hover)] rounded" />
          ))}
        </div>
        {/* Rows */}
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex gap-3">
            {Array.from({ length: cols }).map((_, c) => (
              <div key={c} className="h-8 flex-1 bg-[var(--color-surface-hover)] rounded" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 网格骨架屏（图库等）
 */
export function GridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="p-4 md:p-6 animate-pulse">
      <div className="h-5 w-16 bg-[var(--color-surface-hover)] rounded mb-4" />
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="aspect-square bg-[var(--color-surface-hover)] rounded" />
        ))}
      </div>
    </div>
  );
}

/**
 * 全屏居中加载状态（带骨架点动画）
 */
export function FullPageLoader({ message = '加载中' }: { message?: string }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--color-background)] gap-3">
      <div className="flex gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-text-subtle)] animate-bounce [animation-delay:0ms]" />
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-text-subtle)] animate-bounce [animation-delay:150ms]" />
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-text-subtle)] animate-bounce [animation-delay:300ms]" />
      </div>
      <div className="text-sm text-[var(--color-text-muted)]">{message}...</div>
    </div>
  );
}

/**
 * 错误状态，带重试按钮
 */
export function ErrorState({
  message = '加载失败',
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[var(--color-text-subtle)]">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v4M12 16h.01" />
      </svg>
      <p className="text-sm text-[var(--color-text-muted)]">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-3 py-1.5 text-xs font-medium text-[var(--color-accent)] border border-[var(--color-accent)] rounded-[var(--radius-sm)] hover:bg-[var(--color-accent-subtle)] transition-colors"
        >
          重试
        </button>
      )}
    </div>
  );
}

/**
 * 空状态
 */
export function EmptyState({
  message = '暂无数据',
  icon,
}: {
  message?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-2">
      {icon || (
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[var(--color-text-subtle)]">
          <path d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
        </svg>
      )}
      <p className="text-sm text-[var(--color-text-subtle)]">{message}</p>
    </div>
  );
}
