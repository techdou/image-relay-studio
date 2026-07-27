'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { ModelConfig, ProviderType } from '@/types';
import { fetchWithTimeout } from '@/lib/fetch-utils';
import { TableSkeleton, ErrorState, EmptyState } from '@/components/loading-states';

export default function AdminModelsPage() {
  const { isAdmin, session } = useAuth();
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingModel, setEditingModel] = useState<ModelConfig | null>(null);
  const [form, setForm] = useState({
    code: '',
    display_name: '',
    provider_type: 'mock' as ProviderType,
    external_model_id: '',
    workflow_id: '',
    enabled: true,
    supports_text_to_image: true,
    supports_image_to_image: false,
    supports_multiple_references: false,
    supports_sequential_generation: false,
    supports_visible_watermark_control: false,
    supported_sizes: '1024x1024,2048x2048',
    max_images_per_request: 1,
    max_provider_concurrency: 2,
    timeout_seconds: 60,
  });

  const fetchModels = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetchWithTimeout('/api/admin/models', {
        headers: { 'x-session': session?.access_token || '' },
        timeout: 10_000,
      });
      if (res.ok) {
        const data = await res.json();
        setModels(data.data?.models || []);
      } else {
        throw new Error('获取模型列表失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setIsLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (isAdmin) fetchModels();
  }, [isAdmin, fetchModels]);

  const handleSave = async () => {
    try {
      const body = {
        ...form,
        supported_sizes: form.supported_sizes.split(',').map(s => s.trim()).filter(Boolean),
      };

      const url = editingModel ? `/api/admin/models/${editingModel.id}` : '/api/admin/models';
      const method = editingModel ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'x-session': session?.access_token || '',
        },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        setShowCreate(false);
        setEditingModel(null);
        fetchModels();
      }
    } catch { /* ignore */ }
  };

  const handleHealthCheck = async (modelId: string) => {
    try {
      await fetch(`/api/admin/models/${modelId}/health-check`, {
        method: 'POST',
        headers: { 'x-session': session?.access_token || '' },
      });
      fetchModels();
    } catch { /* ignore */ }
  };

  if (!isAdmin) return null;

  return (
    <div className="p-4 md:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 md:mb-6 gap-3">
        <h1 className="text-lg font-semibold text-[var(--color-text)]">模型配置</h1>
        <button
          onClick={() => {
            setEditingModel(null);
            setForm({
              code: '', display_name: '', provider_type: 'mock', external_model_id: '',
              workflow_id: '', enabled: true, supports_text_to_image: true,
              supports_image_to_image: false, supports_multiple_references: false,
              supports_sequential_generation: false, supports_visible_watermark_control: false,
              supported_sizes: '1024x1024,2048x2048', max_images_per_request: 1,
              max_provider_concurrency: 2, timeout_seconds: 60,
            });
            setShowCreate(true);
          }}
          className="px-3 py-2 md:py-1.5 text-xs font-medium text-white bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] rounded-[var(--radius-md)] tap-target self-start"
        >
          添加模型
        </button>
      </div>

      {/* Create/Edit Form - mobile: single column, desktop: 2 columns */}
      {(showCreate || editingModel) && (
        <div className="mb-4 md:mb-6 p-4 border border-[var(--color-border)] rounded-[var(--radius-md)] bg-[var(--color-surface)]">
          <h3 className="text-sm font-medium text-[var(--color-text)] mb-3">
            {editingModel ? '编辑模型' : '添加模型'}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">内部代码</label>
              <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })}
                disabled={!!editingModel}
                className="w-full px-3 py-2 md:py-1.5 text-sm bg-[var(--color-surface-subtle)] border border-[var(--color-border)] rounded-[var(--radius-md)] disabled:opacity-50" />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">显示名称</label>
              <input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                className="w-full px-3 py-2 md:py-1.5 text-sm bg-[var(--color-surface-subtle)] border border-[var(--color-border)] rounded-[var(--radius-md)]" />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Provider 类型</label>
              <select value={form.provider_type} onChange={(e) => setForm({ ...form, provider_type: e.target.value as ProviderType })}
                className="w-full px-3 py-2 md:py-1.5 text-sm bg-[var(--color-surface-subtle)] border border-[var(--color-border)] rounded-[var(--radius-md)]">
                <option value="mock">Mock</option>
                <option value="coze_coding">Coze Coding SDK</option>
                <option value="coze_workflow">Coze Workflow</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">外部模型 ID</label>
              <input value={form.external_model_id} onChange={(e) => setForm({ ...form, external_model_id: e.target.value })}
                className="w-full px-3 py-2 md:py-1.5 text-sm bg-[var(--color-surface-subtle)] border border-[var(--color-border)] rounded-[var(--radius-md)]" />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Workflow ID</label>
              <input value={form.workflow_id} onChange={(e) => setForm({ ...form, workflow_id: e.target.value })}
                className="w-full px-3 py-2 md:py-1.5 text-sm bg-[var(--color-surface-subtle)] border border-[var(--color-border)] rounded-[var(--radius-md)]" />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">支持尺寸（逗号分隔）</label>
              <input value={form.supported_sizes} onChange={(e) => setForm({ ...form, supported_sizes: e.target.value })}
                className="w-full px-3 py-2 md:py-1.5 text-sm bg-[var(--color-surface-subtle)] border border-[var(--color-border)] rounded-[var(--radius-md)]" />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">最大生成数</label>
              <input type="number" value={form.max_images_per_request} onChange={(e) => setForm({ ...form, max_images_per_request: Number(e.target.value) })}
                className="w-full px-3 py-2 md:py-1.5 text-sm bg-[var(--color-surface-subtle)] border border-[var(--color-border)] rounded-[var(--radius-md)]" />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">超时(秒)</label>
              <input type="number" value={form.timeout_seconds} onChange={(e) => setForm({ ...form, timeout_seconds: Number(e.target.value) })}
                className="w-full px-3 py-2 md:py-1.5 text-sm bg-[var(--color-surface-subtle)] border border-[var(--color-border)] rounded-[var(--radius-md)]" />
            </div>
          </div>
          <div className="flex flex-wrap gap-3 mt-3">
            {[
              { key: 'enabled', label: '启用' },
              { key: 'supports_text_to_image', label: '文生图' },
              { key: 'supports_image_to_image', label: '图生图' },
              { key: 'supports_multiple_references', label: '多参考图' },
              { key: 'supports_visible_watermark_control', label: '水印控制' },
            ].map(({ key, label }) => (
              <label key={key} className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] tap-target py-1">
                <input type="checkbox" checked={form[key as keyof typeof form] as boolean}
                  onChange={(e) => setForm({ ...form, [key]: e.target.checked })} />
                {label}
              </label>
            ))}
          </div>
          <div className="flex flex-col-reverse sm:flex-row gap-2 mt-4 sm:justify-end">
            <button onClick={() => { setShowCreate(false); setEditingModel(null); }}
              className="px-3 py-2 md:py-1.5 text-xs border border-[var(--color-border)] rounded-[var(--radius-sm)] tap-target">取消</button>
            <button onClick={handleSave}
              className="px-3 py-2 md:py-1.5 text-xs text-white bg-[var(--color-accent)] rounded-[var(--radius-sm)] tap-target">保存</button>
          </div>
        </div>
      )}

      {/* Models List */}
      {isLoading ? (
        <TableSkeleton rows={4} cols={5} />
      ) : error ? (
        <ErrorState message={error} onRetry={fetchModels} />
      ) : models.length === 0 ? (
        <div className="text-sm text-[var(--color-text-subtle)] py-8 text-center">暂无模型配置</div>
      ) : (
        <div className="space-y-2">
          {models.map((model) => (
            <div key={model.id} className="p-3 border border-[var(--color-border)] rounded-[var(--radius-md)]">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${model.enabled ? 'bg-[var(--color-success)]' : 'bg-[var(--color-text-subtle)]'}`} />
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-[var(--color-text)]">{model.display_name}</span>
                    <span className="ml-2 text-xs text-[var(--color-text-subtle)] mobile-break-all">{model.code}</span>
                  </div>
                  <span className="text-[10px] text-[var(--color-text-subtle)] bg-[var(--color-surface-subtle)] px-1.5 py-0.5 rounded flex-shrink-0">
                    {model.provider_type}
                  </span>
                </div>
                <div className="flex gap-2 flex-shrink-0 ml-4 sm:ml-0">
                  <button onClick={() => handleHealthCheck(model.id)}
                    className="text-xs text-[var(--color-accent)] hover:underline tap-target">健康检查</button>
                  <button onClick={() => {
                    setEditingModel(model);
                    setForm({
                      code: model.code, display_name: model.display_name,
                      provider_type: model.provider_type,
                      external_model_id: model.external_model_id || '',
                      workflow_id: model.workflow_id || '',
                      enabled: model.enabled,
                      supports_text_to_image: model.supports_text_to_image,
                      supports_image_to_image: model.supports_image_to_image,
                      supports_multiple_references: model.supports_multiple_references,
                      supports_sequential_generation: model.supports_sequential_generation,
                      supports_visible_watermark_control: model.supports_visible_watermark_control,
                      supported_sizes: model.supported_sizes?.join(',') || '',
                      max_images_per_request: model.max_images_per_request,
                      max_provider_concurrency: model.max_provider_concurrency,
                      timeout_seconds: model.timeout_seconds,
                    });
                  }} className="text-xs text-[var(--color-accent)] hover:underline tap-target">编辑</button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[var(--color-text-subtle)]">
                {model.supports_text_to_image && <span>文生图</span>}
                {model.supports_image_to_image && <span>图生图</span>}
                {model.supports_multiple_references && <span>多参考图</span>}
                {model.supports_visible_watermark_control && <span>水印控制</span>}
                <span>尺寸: {model.supported_sizes?.join(', ')}</span>
                <span>最大: {model.max_images_per_request}张</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
