'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { fetchWithTimeout } from '@/lib/fetch-utils';

interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  role: string;
  created_at: string;
}

export default function SettingsPage() {
  const { profile, session } = useAuth();
  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleSave = async () => {
    setIsSaving(true);
    setMessage(null);
    try {
      const res = await fetchWithTimeout('/api/v1/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-session': session?.access_token || '',
        },
        body: JSON.stringify({ display_name: displayName.trim() || null }),
        timeout: 10_000,
      });
      if (res.ok) {
        setMessage({ type: 'success', text: '保存成功' });
      } else {
        const data = await res.json();
        setMessage({ type: 'error', text: data.error?.message || '保存失败' });
      }
    } catch {
      setMessage({ type: 'error', text: '请求失败' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <h1 className="text-lg font-semibold text-[var(--color-text)] mb-4 md:mb-6">个人设置</h1>

      <div className="space-y-5">
        {/* Display Name */}
        <div>
          <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5">显示名称</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="输入显示名称"
            className="w-full px-3 py-2 text-sm bg-[var(--color-surface-subtle)] border border-[var(--color-border)] rounded-[var(--radius-md)] text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
          />
        </div>

        {/* Email (read-only) */}
        <div>
          <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5">邮箱</label>
          <input
            type="email"
            value={profile?.email || ''}
            readOnly
            className="w-full px-3 py-2 text-sm bg-[var(--color-surface-subtle)] border border-[var(--color-border)] rounded-[var(--radius-md)] text-[var(--color-text-muted)] cursor-not-allowed"
          />
        </div>

        {/* Role (read-only) */}
        <div>
          <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5">角色</label>
          <input
            type="text"
            value={profile?.role === 'admin' ? '管理员' : '用户'}
            readOnly
            className="w-full px-3 py-2 text-sm bg-[var(--color-surface-subtle)] border border-[var(--color-border)] rounded-[var(--radius-md)] text-[var(--color-text-muted)] cursor-not-allowed"
          />
        </div>

        {message && (
          <div className={`p-3 rounded-[var(--radius-md)] text-xs ${
            message.type === 'success'
              ? 'bg-[var(--color-success-subtle)] text-[var(--color-success)]'
              : 'bg-[var(--color-destructive-subtle)] text-[var(--color-destructive)]'
          }`}>
            {message.text}
          </div>
        )}

        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 md:py-1.5 text-xs font-medium text-white bg-[var(--color-accent)] rounded-[var(--radius-sm)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50 transition-colors tap-target"
          >
            {isSaving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
