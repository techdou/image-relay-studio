'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Profile } from '@/types';
import { fetchWithTimeout } from '@/lib/fetch-utils';
import { TableSkeleton, ErrorState, EmptyState } from '@/components/loading-states';

export default function AdminUsersPage() {
  const { isAdmin, session } = useAuth();
  const [users, setUsers] = useState<Profile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);

      const res = await fetchWithTimeout(`/api/admin/users?${params}`, {
        headers: { 'x-session': session?.access_token || '' },
        timeout: 10_000,
      });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.data?.users || []);
      } else {
        throw new Error('获取用户列表失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setIsLoading(false);
    }
  }, [session, search, statusFilter]);

  useEffect(() => {
    if (isAdmin) fetchUsers();
  }, [isAdmin, fetchUsers]);

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviteMessage(null);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session': session?.access_token || '',
        },
        body: JSON.stringify({ email: inviteEmail.trim() }),
      });
      if (res.ok) {
        setInviteMessage('用户已创建');
        setInviteEmail('');
        setShowInvite(false);
        fetchUsers();
      } else {
        const data = await res.json();
        setInviteMessage(data.error?.message || '创建失败');
      }
    } catch {
      setInviteMessage('创建请求失败');
    }
  };

  const toggleUserStatus = async (userId: string, currentStatus: string) => {
    const newStatus = currentStatus === 'active' ? 'disabled' : 'active';
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-session': session?.access_token || '',
        },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) fetchUsers();
    } catch { /* ignore */ }
  };

  if (!isAdmin) return null;

  return (
    <div className="p-4 md:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 md:mb-6 gap-3">
        <h1 className="text-lg font-semibold text-[var(--color-text)]">用户管理</h1>
        <button
          onClick={() => setShowInvite(true)}
          className="px-3 py-2 md:py-1.5 text-xs font-medium text-white bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] rounded-[var(--radius-md)] tap-target self-start"
        >
          创建用户
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索邮箱或昵称..."
          className="px-3 py-2 md:py-1.5 text-sm bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] w-full sm:w-64"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-2.5 py-2 md:py-1.5 text-xs bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-sm)]"
        >
          <option value="">全部状态</option>
          <option value="active">活跃</option>
          <option value="disabled">禁用</option>
          <option value="pending">待激活</option>
        </select>
      </div>

      {/* Invite Form */}
      {showInvite && (
        <div className="mb-4 p-4 border border-[var(--color-border)] rounded-[var(--radius-md)] bg-[var(--color-surface)]">
          <h3 className="text-sm font-medium text-[var(--color-text)] mb-3">创建用户</h3>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="用户邮箱"
              className="flex-1 px-3 py-2 md:py-1.5 text-sm bg-[var(--color-surface-subtle)] border border-[var(--color-border)] rounded-[var(--radius-md)]"
            />
            <div className="flex gap-2">
              <button onClick={handleInvite} className="flex-1 sm:flex-none px-3 py-2 md:py-1.5 text-xs text-white bg-[var(--color-accent)] rounded-[var(--radius-sm)] tap-target">创建</button>
              <button onClick={() => setShowInvite(false)} className="flex-1 sm:flex-none px-3 py-2 md:py-1.5 text-xs border border-[var(--color-border)] rounded-[var(--radius-sm)] tap-target">取消</button>
            </div>
          </div>
          {inviteMessage && <p className="mt-2 text-xs text-[var(--color-text-muted)]">{inviteMessage}</p>}
        </div>
      )}

      {isLoading ? (
        <TableSkeleton rows={5} cols={5} />
      ) : error ? (
        <ErrorState message={error} onRetry={fetchUsers} />
      ) : users.length === 0 ? (
        <div className="text-sm text-[var(--color-text-subtle)] py-8 text-center">暂无用户</div>
      ) : (
        <>
          {/* Mobile: Card list */}
          <div className="md:hidden space-y-2">
            {users.map((user) => (
              <div key={user.id} className="p-3 border border-[var(--color-border)] rounded-[var(--radius-md)] bg-[var(--color-surface)]">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm text-[var(--color-text)] mobile-break-all">{user.email}</span>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                    user.status === 'active' ? 'bg-[var(--color-success-subtle)] text-[var(--color-success)]' :
                    user.status === 'disabled' ? 'bg-[var(--color-destructive-subtle)] text-[var(--color-destructive)]' :
                    'bg-[var(--color-warning-subtle)] text-[var(--color-warning)]'
                  }`}>
                    {user.status === 'active' ? '活跃' : user.status === 'disabled' ? '禁用' : '待激活'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="text-xs text-[var(--color-text-muted)]">
                    {user.display_name || '-'} · {user.role === 'admin' ? '管理员' : '用户'}
                  </div>
                  <button
                    onClick={() => toggleUserStatus(user.id, user.status)}
                    className="text-xs text-[var(--color-accent)] hover:underline tap-target"
                  >
                    {user.status === 'active' ? '禁用' : '启用'}
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
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)]">邮箱</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)]">昵称</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)]">角色</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)]">状态</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-[var(--color-text-muted)]">操作</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-hover)]">
                    <td className="px-4 py-2.5 text-[var(--color-text)]">{user.email}</td>
                    <td className="px-4 py-2.5 text-[var(--color-text-muted)]">{user.display_name || '-'}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs ${user.role === 'admin' ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]'}`}>
                        {user.role === 'admin' ? '管理员' : '用户'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs ${
                        user.status === 'active' ? 'text-[var(--color-success)]' :
                        user.status === 'disabled' ? 'text-[var(--color-destructive)]' :
                        'text-[var(--color-warning)]'
                      }`}>
                        {user.status === 'active' ? '活跃' : user.status === 'disabled' ? '禁用' : '待激活'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <button
                        onClick={() => toggleUserStatus(user.id, user.status)}
                        className="text-xs text-[var(--color-accent)] hover:underline"
                      >
                        {user.status === 'active' ? '禁用' : '启用'}
                      </button>
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
