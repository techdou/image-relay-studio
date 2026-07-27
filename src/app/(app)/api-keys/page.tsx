'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { fetchWithTimeout } from '@/lib/fetch-utils';
import { TableSkeleton, ErrorState, EmptyState } from '@/components/loading-states';

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  is_active: boolean;
}

export default function ApiKeysPage() {
  const { session } = useAuth();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [apiAccessEnabled, setApiAccessEnabled] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchKeys = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await fetchWithTimeout('/api/v1/api-keys', {
        headers: { 'x-session': session?.access_token || '' },
        timeout: 10_000,
      });
      if (res.ok) {
        const data = await res.json();
        setKeys(data.data?.keys || []);
        setApiAccessEnabled(data.data?.api_access_enabled ?? false);
      } else {
        throw new Error('获取 API Key 列表失败');
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setIsLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (session) fetchKeys();
  }, [session, fetchKeys]);

  const createKey = async () => {
    if (!newKeyName.trim()) return;
    setError(null);
    try {
      const res = await fetchWithTimeout('/api/v1/api-keys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session': session?.access_token || '',
        },
        body: JSON.stringify({ name: newKeyName.trim() }),
        timeout: 8_000,
      });
      if (res.ok) {
        const data = await res.json();
        setCreatedKey(data.data?.key || null);
        setNewKeyName('');
        fetchKeys();
      } else {
        const data = await res.json();
        setError(data.error?.message || '创建失败');
      }
    } catch {
      setError('创建请求失败');
    }
  };

  const deleteKey = async (keyId: string) => {
    if (!confirm('确定要删除此 API Key 吗？')) return;
    try {
      const res = await fetchWithTimeout(`/api/v1/api-keys/${keyId}`, {
        method: 'DELETE',
        headers: { 'x-session': session?.access_token || '' },
        timeout: 8_000,
      });
      if (res.ok) fetchKeys();
    } catch { /* ignore */ }
  };

  const toggleKey = async (keyId: string, currentActive: boolean) => {
    try {
      const res = await fetchWithTimeout(`/api/v1/api-keys/${keyId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-session': session?.access_token || '',
        },
        body: JSON.stringify({ is_active: !currentActive }),
        timeout: 8_000,
      });
      if (res.ok) fetchKeys();
    } catch { /* ignore */ }
  };

  return (
    <div className="p-4 md:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 md:mb-6 gap-3">
        <h1 className="text-lg font-semibold text-[var(--color-text)]">API Keys</h1>
        <button
          onClick={() => {
            if (!apiAccessEnabled) return;
            setShowCreateDialog(true);
          }}
          disabled={!apiAccessEnabled}
          className="px-3 py-2 md:py-1.5 text-xs font-medium text-white bg-[var(--color-accent)] rounded-[var(--radius-sm)] hover:bg-[var(--color-accent-hover)] transition-colors tap-target disabled:opacity-50 disabled:cursor-not-allowed"
        >
          + 新建 Key
        </button>
      </div>

      {/* API Access Disabled Banner */}
      {!isLoading && !loadError && !apiAccessEnabled && (
        <div className="mb-4 p-3 border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/5 rounded-[var(--radius-md)]">
          <div className="flex items-start gap-2">
            <svg className="w-4 h-4 text-[var(--color-warning)] flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <div>
              <p className="text-sm font-medium text-[var(--color-warning)]">API 访问未启用</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                当前账号未开启 API 访问权限，无法创建 API Key。请联系管理员在后台用户管理中开启 API 访问。
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Create Dialog */}
      {showCreateDialog && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40" onClick={() => setShowCreateDialog(false)}>
          <div
            className="w-full md:max-w-md bg-[var(--color-surface)] rounded-t-xl md:rounded-[var(--radius-lg)] p-5 md:p-6 safe-area-bottom"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-sm font-semibold text-[var(--color-text)] mb-4">新建 API Key</h2>

            {createdKey ? (
              <div>
                <p className="text-xs text-[var(--color-text-muted)] mb-2">请立即复制此 Key，它只会显示一次：</p>
                <div className="flex items-center gap-2 p-3 bg-[var(--color-surface-subtle)] border border-[var(--color-border)] rounded-[var(--radius-md)]">
                  <code className="flex-1 text-xs font-mono text-[var(--color-text)] mobile-break-all break-all">{createdKey}</code>
                  <button
                    onClick={() => navigator.clipboard.writeText(createdKey)}
                    className="px-2.5 py-1 text-xs text-[var(--color-accent)] hover:underline flex-shrink-0 tap-target"
                  >
                    复制
                  </button>
                </div>
                <button
                  onClick={() => { setShowCreateDialog(false); setCreatedKey(null); }}
                  className="w-full mt-4 py-2 text-xs font-medium text-[var(--color-text-muted)] border border-[var(--color-border)] rounded-[var(--radius-sm)] hover:bg-[var(--color-surface-hover)] tap-target"
                >
                  完成
                </button>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5">Key 名称</label>
                <input
                  type="text"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="例如: 生产环境"
                  className="w-full px-3 py-2 text-sm bg-[var(--color-surface-subtle)] border border-[var(--color-border)] rounded-[var(--radius-md)] text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                />
                {error && <p className="mt-1.5 text-xs text-[var(--color-destructive)]">{error}</p>}
                <div className="flex gap-2 mt-4">
                  <button
                    onClick={() => setShowCreateDialog(false)}
                    className="flex-1 py-2 text-xs font-medium text-[var(--color-text-muted)] border border-[var(--color-border)] rounded-[var(--radius-sm)] hover:bg-[var(--color-surface-hover)] tap-target"
                  >
                    取消
                  </button>
                  <button
                    onClick={createKey}
                    disabled={!newKeyName.trim()}
                    className="flex-1 py-2 text-xs font-medium text-white bg-[var(--color-accent)] rounded-[var(--radius-sm)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50 tap-target"
                  >
                    创建
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {isLoading ? (
        <TableSkeleton rows={3} cols={6} />
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={fetchKeys} />
      ) : keys.length === 0 ? (
        <EmptyState message="暂无 API Key" />
      ) : (
        <>
          {/* Mobile: Card list */}
          <div className="md:hidden space-y-2">
            {keys.map((key) => (
              <div key={key.id} className="p-3 border border-[var(--color-border)] rounded-[var(--radius-md)] bg-[var(--color-surface)]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-[var(--color-text)]">{key.name}</span>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                    key.is_active
                      ? 'bg-[var(--color-success-subtle)] text-[var(--color-success)]'
                      : 'bg-[var(--color-surface-subtle)] text-[var(--color-text-subtle)]'
                  }`}>
                    {key.is_active ? '活跃' : '已禁用'}
                  </span>
                </div>
                <p className="text-xs font-mono text-[var(--color-text-muted)] mb-2 mobile-break-all">{key.prefix}••••••••</p>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-[var(--color-text-subtle)]">
                    创建于 {new Date(key.created_at).toLocaleDateString('zh-CN')}
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => toggleKey(key.id, key.is_active)}
                      className="text-xs text-[var(--color-accent)] hover:underline tap-target"
                    >
                      {key.is_active ? '禁用' : '启用'}
                    </button>
                    <button
                      onClick={() => deleteKey(key.id)}
                      className="text-xs text-[var(--color-destructive)] hover:underline tap-target"
                    >
                      删除
                    </button>
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
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)]">名称</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)]">前缀</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)]">状态</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)]">创建时间</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)]">最后使用</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)]">操作</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((key) => (
                  <tr key={key.id} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-hover)]">
                    <td className="px-4 py-2.5 text-[var(--color-text)]">{key.name}</td>
                    <td className="px-4 py-2.5 text-xs font-mono text-[var(--color-text-muted)]">{key.prefix}••••••••</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                        key.is_active
                          ? 'bg-[var(--color-success-subtle)] text-[var(--color-success)]'
                          : 'bg-[var(--color-surface-subtle)] text-[var(--color-text-subtle)]'
                      }`}>
                        {key.is_active ? '活跃' : '已禁用'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[var(--color-text-muted)]">
                      {new Date(key.created_at).toLocaleDateString('zh-CN')}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[var(--color-text-muted)]">
                      {key.last_used_at ? new Date(key.last_used_at).toLocaleDateString('zh-CN') : '-'}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex gap-1.5">
                        <button onClick={() => toggleKey(key.id, key.is_active)} className="text-xs text-[var(--color-accent)] hover:underline">
                          {key.is_active ? '禁用' : '启用'}
                        </button>
                        <button onClick={() => deleteKey(key.id)} className="text-xs text-[var(--color-destructive)] hover:underline">
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
    </div>
  );
}
