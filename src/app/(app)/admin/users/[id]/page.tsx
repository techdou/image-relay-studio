'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { fetchWithTimeout } from '@/lib/fetch-utils';
import { PageSkeleton, ErrorState } from '@/components/loading-states';
import Link from 'next/link';

interface UserProfile {
  id: string;
  user_id: string;
  email: string;
  display_name: string;
  role: string;
  status: string;
  last_login_at: string | null;
  created_at: string;
}

interface UserQuota {
  daily_image_limit: number;
  monthly_image_limit: number;
  max_concurrent_tasks: number;
  max_images_per_request: number;
  api_access_enabled: boolean;
  allowed_model_codes: string[] | null;
  allowed_sizes: string[] | null;
  retention_days: number;
}

export default function AdminUserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, profile, session, isLoading: authLoading } = useAuth();
  const [detail, setDetail] = useState<UserProfile | null>(null);
  const [quota, setQuota] = useState<UserQuota | null>(null);
  const [recentTasks, setRecentTasks] = useState<Array<Record<string, unknown>>>([]);
  const [todayUsage, setTodayUsage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [quotaForm, setQuotaForm] = useState<Partial<UserQuota>>({});

  const fetchUser = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetchWithTimeout(`/api/admin/users/${id}`, {
        headers: { 'x-session': session?.access_token || '' },
        timeout: 10_000,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || '加载失败');
      setDetail(json.data.profile);
      setQuota(json.data.quota);
      setRecentTasks(json.data.recent_tasks || []);
      setTodayUsage(json.data.today_usage || 0);
      if (json.data.quota) setQuotaForm(json.data.quota);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '加载用户详情失败');
    } finally {
      setLoading(false);
    }
  }, [id, session]);

  useEffect(() => {
    if (!user || profile?.role !== 'admin') return;
    fetchUser();
  }, [user, profile, fetchUser]);

  async function updateUser(updates: Record<string, unknown>) {
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-session': session?.access_token || '',
        },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        await fetchUser();
        setEditing(false);
      }
    } catch { /* ignore */ }
  }

  async function saveQuota() {
    if (!quotaForm) return;
    await updateUser(quotaForm);
  }

  if (authLoading || loading) {
    return <PageSkeleton />;
  }

  if (loadError) {
    return <ErrorState message={loadError} onRetry={fetchUser} />;
  }

  if (!detail) {
    return <div className="p-4 text-sm text-[var(--color-text-muted)]">用户不存在</div>;
  }

  const statusLabels: Record<string, string> = { active: '活跃', disabled: '禁用', pending: '待激活' };
  const statusColors: Record<string, string> = {
    active: 'bg-[var(--color-success-subtle)] text-[var(--color-success)]',
    disabled: 'bg-[var(--color-destructive-subtle)] text-[var(--color-destructive)]',
    pending: 'bg-[var(--color-warning-subtle)] text-[var(--color-warning)]',
  };

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4 md:space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push('/admin/users')}
          className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] tap-target p-1"
          aria-label="返回用户列表"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M11 4L6 9l5 5" />
          </svg>
        </button>
        <h1 className="text-lg font-medium text-[var(--color-text)]">用户详情</h1>
      </div>

      {/* Profile Card */}
      <div className="p-4 border border-[var(--color-border)] rounded-[var(--radius-md)]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-3 gap-2">
          <h2 className="text-sm font-medium text-[var(--color-text)]">基本信息</h2>
          <div className="flex gap-2">
            {detail.status === 'active' && (
              <button onClick={() => updateUser({ status: 'disabled' })} className="px-3 py-1.5 text-xs border border-[var(--color-destructive)] text-[var(--color-destructive)] rounded-[var(--radius-sm)] hover:bg-[var(--color-destructive-subtle)] tap-target">禁用</button>
            )}
            {detail.status === 'disabled' && (
              <button onClick={() => updateUser({ status: 'active' })} className="px-3 py-1.5 text-xs border border-[var(--color-accent)] text-[var(--color-accent)] rounded-[var(--radius-sm)] hover:bg-[var(--color-accent-subtle)] tap-target">启用</button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div><span className="text-[var(--color-text-muted)]">邮箱：</span><span className="text-[var(--color-text)] mobile-break-all">{detail.email}</span></div>
          <div><span className="text-[var(--color-text-muted)]">昵称：</span><span className="text-[var(--color-text)]">{detail.display_name}</span></div>
          <div><span className="text-[var(--color-text-muted)]">角色：</span><span className="text-xs font-medium px-1.5 py-0.5 border border-[var(--color-border)] rounded">{detail.role}</span></div>
          <div><span className="text-[var(--color-text-muted)]">状态：</span><span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${statusColors[detail.status] || ''}`}>{statusLabels[detail.status] || detail.status}</span></div>
          <div><span className="text-[var(--color-text-muted)]">今日用量：</span><span className="text-[var(--color-text)]">{todayUsage}</span></div>
          <div><span className="text-[var(--color-text-muted)]">注册时间：</span><span className="text-[var(--color-text)]">{new Date(detail.created_at).toLocaleString('zh-CN')}</span></div>
        </div>
      </div>

      {/* Quota Card */}
      <div className="p-4 border border-[var(--color-border)] rounded-[var(--radius-md)]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-3 gap-2">
          <h2 className="text-sm font-medium text-[var(--color-text)]">额度配置</h2>
          <button
            onClick={() => editing ? saveQuota() : setEditing(true)}
            className="px-3 py-1.5 text-xs border border-[var(--color-border)] rounded-[var(--radius-sm)] hover:bg-[var(--color-surface-hover)] tap-target self-start"
          >
            {editing ? '保存' : '编辑'}
          </button>
        </div>
        {editing ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--color-text-muted)]">每日限额</label>
              <input type="number" value={quotaForm.daily_image_limit || ''} onChange={e => setQuotaForm(p => ({ ...p, daily_image_limit: parseInt(e.target.value) || 0 }))}
                className="w-full mt-1 px-3 py-2 md:py-1.5 text-sm bg-[var(--color-surface-subtle)] border border-[var(--color-border)] rounded-[var(--radius-md)]" />
            </div>
            <div>
              <label className="text-xs text-[var(--color-text-muted)]">每月限额</label>
              <input type="number" value={quotaForm.monthly_image_limit || ''} onChange={e => setQuotaForm(p => ({ ...p, monthly_image_limit: parseInt(e.target.value) || 0 }))}
                className="w-full mt-1 px-3 py-2 md:py-1.5 text-sm bg-[var(--color-surface-subtle)] border border-[var(--color-border)] rounded-[var(--radius-md)]" />
            </div>
            <div>
              <label className="text-xs text-[var(--color-text-muted)]">最大并发</label>
              <input type="number" value={quotaForm.max_concurrent_tasks || ''} onChange={e => setQuotaForm(p => ({ ...p, max_concurrent_tasks: parseInt(e.target.value) || 1 }))}
                className="w-full mt-1 px-3 py-2 md:py-1.5 text-sm bg-[var(--color-surface-subtle)] border border-[var(--color-border)] rounded-[var(--radius-md)]" />
            </div>
            <div>
              <label className="text-xs text-[var(--color-text-muted)]">单次最大数</label>
              <input type="number" value={quotaForm.max_images_per_request || ''} onChange={e => setQuotaForm(p => ({ ...p, max_images_per_request: parseInt(e.target.value) || 1 }))}
                className="w-full mt-1 px-3 py-2 md:py-1.5 text-sm bg-[var(--color-surface-subtle)] border border-[var(--color-border)] rounded-[var(--radius-md)]" />
            </div>
            <div>
              <label className="text-xs text-[var(--color-text-muted)]">保留天数</label>
              <input type="number" value={quotaForm.retention_days || ''} onChange={e => setQuotaForm(p => ({ ...p, retention_days: parseInt(e.target.value) || 30 }))}
                className="w-full mt-1 px-3 py-2 md:py-1.5 text-sm bg-[var(--color-surface-subtle)] border border-[var(--color-border)] rounded-[var(--radius-md)]" />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-[var(--color-text-muted)]">API 访问</label>
              <button
                onClick={() => setQuotaForm(p => ({ ...p, api_access_enabled: !p.api_access_enabled }))}
                className={`px-3 py-1.5 text-xs rounded-[var(--radius-sm)] tap-target ${
                  quotaForm.api_access_enabled
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'border border-[var(--color-border)] text-[var(--color-text-muted)]'
                }`}
              >
                {quotaForm.api_access_enabled ? '已开启' : '已关闭'}
              </button>
            </div>
          </div>
        ) : quota ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div><span className="text-[var(--color-text-muted)]">每日限额：</span>{quota.daily_image_limit}</div>
            <div><span className="text-[var(--color-text-muted)]">每月限额：</span>{quota.monthly_image_limit}</div>
            <div><span className="text-[var(--color-text-muted)]">最大并发：</span>{quota.max_concurrent_tasks}</div>
            <div><span className="text-[var(--color-text-muted)]">单次最大数：</span>{quota.max_images_per_request}</div>
            <div><span className="text-[var(--color-text-muted)]">保留天数：</span>{quota.retention_days}</div>
            <div><span className="text-[var(--color-text-muted)]">API 访问：</span>{quota.api_access_enabled ? '已开启' : '已关闭'}</div>
          </div>
        ) : (
          <p className="text-sm text-[var(--color-text-muted)]">暂无额度配置</p>
        )}
      </div>

      {/* Recent Tasks */}
      <div className="p-4 border border-[var(--color-border)] rounded-[var(--radius-md)]">
        <h2 className="text-sm font-medium text-[var(--color-text)] mb-3">最近任务</h2>
        {recentTasks.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">暂无任务</p>
        ) : (
          <div className="space-y-2">
            {recentTasks.map((task) => (
              <div key={task.id as string} className="flex flex-col sm:flex-row sm:items-center justify-between py-2 border-b border-[var(--color-border)] last:border-0 gap-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[10px] font-medium px-1.5 py-0.5 border border-[var(--color-border)] rounded text-[var(--color-text-muted)] flex-shrink-0">{task.status as string}</span>
                  <span className="text-sm text-[var(--color-text)] truncate mobile-break-all">{task.prompt as string}</span>
                </div>
                <span className="text-xs text-[var(--color-text-subtle)] flex-shrink-0">{new Date(task.created_at as string).toLocaleString('zh-CN')}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
