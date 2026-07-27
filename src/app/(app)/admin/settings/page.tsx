'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { fetchWithTimeout } from '@/lib/fetch-utils';
import { PageSkeleton, ErrorState } from '@/components/loading-states';

interface SystemSettings {
  [key: string]: { value: string; description: string | null };
}

const SETTING_LABELS: Record<string, string> = {
  generation_enabled: '全局生成开关',
  api_enabled: 'API 总开关',
  public_registration_enabled: '公开注册',
  default_daily_limit: '默认每日额度',
  default_monthly_limit: '默认每月额度',
  default_max_concurrency: '默认最大并发',
  prompt_logging_mode: 'Prompt 日志模式',
  default_retention_days: '默认数据保留天数',
  maintenance_message: '维护公告',
};

const SETTING_DESCRIPTIONS: Record<string, string> = {
  generation_enabled: '关闭后不再接受新生成任务',
  api_enabled: '关闭后所有 API 请求将被拒绝',
  public_registration_enabled: '开启后允许用户自行注册账号',
  default_daily_limit: '新用户默认每日可生成图片数',
  default_monthly_limit: '新用户默认每月可生成图片数',
  default_max_concurrency: '单个用户同时执行的最大任务数',
  prompt_logging_mode: 'full=完整记录 / redacted=脱敏 / disabled=不记录',
  default_retention_days: '生成记录和图片的保留天数',
  maintenance_message: '维护时显示给用户的公告信息，留空则不显示',
};

const SETTING_GROUPS = [
  {
    title: '生成与 API',
    keys: ['generation_enabled', 'api_enabled'],
  },
  {
    title: '用户与额度',
    keys: ['public_registration_enabled', 'default_daily_limit', 'default_monthly_limit', 'default_max_concurrency', 'default_retention_days'],
  },
  {
    title: '日志与公告',
    keys: ['prompt_logging_mode', 'maintenance_message'],
  },
];

// Default values for settings not yet in DB
const SETTING_DEFAULTS: Record<string, string> = {
  generation_enabled: 'true',
  api_enabled: 'true',
  public_registration_enabled: 'false',
  default_daily_limit: '50',
  default_monthly_limit: '500',
  default_max_concurrency: '3',
  prompt_logging_mode: 'redacted',
  default_retention_days: '90',
  maintenance_message: '',
};

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 md:h-5 md:w-9 shrink-0 cursor-pointer rounded-full border-transparent transition-colors duration-150 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed tap-target ${
        checked ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border)]'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 md:h-4 md:w-4 transform rounded-full bg-white shadow-sm ring-0 transition-transform duration-150 ease-in-out ${
          checked ? 'translate-x-[22px] md:translate-x-[18px]' : 'translate-x-[2px]'
        } mt-[2px] md:mt-[1px]`}
      />
    </button>
  );
}

export default function AdminSettingsPage() {
  const { isAdmin, session } = useAuth();
  const [settings, setSettings] = useState<SystemSettings>({});
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await fetchWithTimeout('/api/admin/settings', {
        headers: { 'x-session': session?.access_token || '' },
        timeout: 10_000,
      });
      if (res.ok) {
        const json = await res.json();
        const rawSettings = json.data?.settings || [];
        const mapped: SystemSettings = {};
        const edits: Record<string, string> = {};
        for (const s of rawSettings) {
          if (s.key && s.key in SETTING_LABELS) {
            mapped[s.key] = { value: s.value ?? '', description: s.description };
            edits[s.key] = s.value ?? '';
          }
        }
        // Fill in defaults for settings not in DB
        for (const key of Object.keys(SETTING_LABELS)) {
          if (!(key in mapped)) {
            mapped[key] = { value: SETTING_DEFAULTS[key] ?? '', description: SETTING_DESCRIPTIONS[key] ?? null };
            edits[key] = SETTING_DEFAULTS[key] ?? '';
          }
        }
        setSettings(mapped);
        setEditValues(edits);
      } else {
        throw new Error('获取系统设置失败');
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setIsLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (!isAdmin) return;
    fetchSettings();
  }, [isAdmin, fetchSettings]);

  // Auto-dismiss save message
  useEffect(() => {
    if (!saveMessage) return;
    const timer = setTimeout(() => setSaveMessage(null), 3000);
    return () => clearTimeout(timer);
  }, [saveMessage]);

  const handleSave = async (key: string, value: string) => {
    setSaveMessage(null);
    setSavingKey(key);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-session': session?.access_token || '',
        },
        body: JSON.stringify({ key, value }),
      });
      if (res.ok) {
        setSaveMessage({ type: 'success', text: `${SETTING_LABELS[key] || key} 已保存` });
        await fetchSettings();
      } else {
        const json = await res.json().catch(() => ({}));
        setSaveMessage({ type: 'error', text: json.error?.message || '保存失败' });
      }
    } catch {
      setSaveMessage({ type: 'error', text: '网络错误，保存失败' });
    } finally {
      setSavingKey(null);
    }
  };

  const handleInputChange = (key: string, newValue: string) => {
    setEditValues((prev) => ({ ...prev, [key]: newValue }));
  };

  if (!isAdmin) return null;

  const isBoolean = (value: string) => value === 'true' || value === 'false';

  return (
    <div className="p-4 md:p-6 max-w-3xl">
      <h1 className="text-lg font-semibold text-[var(--color-text)] mb-4 md:mb-6">系统设置</h1>

      {saveMessage && (
        <div className={`mb-4 p-2.5 text-xs rounded-[var(--radius-sm)] ${
          saveMessage.type === 'success'
            ? 'text-[var(--color-success)] bg-[var(--color-success-subtle)]'
            : 'text-[var(--color-destructive)] bg-[var(--color-destructive-subtle)]'
        }`}>
          {saveMessage.text}
        </div>
      )}

      {isLoading ? (
        <PageSkeleton />
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={fetchSettings} />
      ) : (
        <div className="space-y-6">
          {SETTING_GROUPS.map((group) => {
            const groupSettings = group.keys
              .filter((key) => key in settings)
              .map((key) => ({ key, ...settings[key] }));

            if (groupSettings.length === 0) return null;

            return (
              <div key={group.title}>
                <h2 className="text-sm font-medium text-[var(--color-text)] mb-3">{group.title}</h2>
                <div className="space-y-2">
                  {groupSettings.map((setting) => {
                    const bool = isBoolean(setting.value);
                    const isOn = setting.value === 'true';
                    const editValue = editValues[setting.key] ?? setting.value;
                    const hasChanged = editValue !== setting.value;
                    const isSaving = savingKey === setting.key;

                    return (
                      <div key={setting.key} className="flex items-center justify-between p-3 border border-[var(--color-border)] rounded-[var(--radius-md)]">
                        <div className="min-w-0 flex-1 mr-4">
                          <div className="text-sm text-[var(--color-text)]">
                            {SETTING_LABELS[setting.key] || setting.key}
                          </div>
                          <div className="text-xs text-[var(--color-text-subtle)] mt-0.5 mobile-break-all">
                            {SETTING_DESCRIPTIONS[setting.key] || setting.description}
                          </div>
                        </div>
                        {bool ? (
                          <Toggle
                            checked={isOn}
                            onChange={() => handleSave(setting.key, isOn ? 'false' : 'true')}
                            disabled={isSaving}
                          />
                        ) : (
                          <div className="flex items-center gap-2 shrink-0">
                            <input
                              type="text"
                              value={editValue}
                              onChange={(e) => handleInputChange(setting.key, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && hasChanged) {
                                  handleSave(setting.key, editValue);
                                }
                              }}
                              className="px-2 py-1.5 md:py-1 text-xs bg-[var(--color-surface-subtle)] border border-[var(--color-border)] rounded-[var(--radius-sm)] w-28 sm:w-36"
                            />
                            <button
                              onClick={() => handleSave(setting.key, editValue)}
                              disabled={!hasChanged || isSaving}
                              className={`px-2.5 py-1.5 md:py-1 text-xs font-medium rounded-[var(--radius-sm)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                                hasChanged
                                  ? 'bg-[var(--color-accent)] text-white hover:opacity-90'
                                  : 'bg-[var(--color-surface-subtle)] text-[var(--color-text-muted)]'
                              }`}
                            >
                              {isSaving ? '...' : '保存'}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Emergency Stop */}
      <div className="mt-6 md:mt-8 p-4 border border-[var(--color-destructive)]/30 rounded-[var(--radius-md)]">
        <h2 className="text-sm font-medium text-[var(--color-destructive)] mb-2">紧急停止</h2>
        <p className="text-xs text-[var(--color-text-muted)] mb-3">
          关闭后不再接受新任务。已运行任务将继续执行。用户端将显示维护说明。
        </p>
        <button
          onClick={() => handleSave('generation_enabled', settings.generation_enabled?.value === 'true' ? 'false' : 'true')}
          disabled={savingKey === 'generation_enabled'}
          className={`px-3 py-2 md:py-1.5 text-xs font-medium rounded-[var(--radius-md)] transition-colors disabled:opacity-50 tap-target ${
            settings.generation_enabled?.value === 'true'
              ? 'bg-[var(--color-destructive)] text-white hover:opacity-90'
              : 'bg-[var(--color-success)] text-white hover:opacity-90'
          }`}
        >
          {savingKey === 'generation_enabled' ? '...' : settings.generation_enabled?.value === 'true' ? '紧急停止生成服务' : '恢复生成服务'}
        </button>
      </div>
    </div>
  );
}
