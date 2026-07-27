'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth-context';
import { fetchWithTimeout } from '@/lib/fetch-utils';
import { ModelConfig, TaskStatus } from '@/types';

interface QuotaInfo {
  daily_limit: number;
  daily_used: number;
  monthly_limit: number;
  monthly_used: number;
  max_concurrent: number;
  current_concurrent: number;
}

interface GeneratedImage {
  id: string;
  url: string;
  thumbnail_url?: string;
  favorite: boolean;
}

export default function StudioPage() {
  const { profile, session } = useAuth();
  const [prompt, setPrompt] = useState('');
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [selectedModelCode, setSelectedModelCode] = useState<string>('');
  const [taskType, setTaskType] = useState<'text_to_image' | 'image_to_image'>('text_to_image');
  const [size, setSize] = useState('2K');
  const [imageCount, setImageCount] = useState(1);
  const [visibleWatermark, setVisibleWatermark] = useState(false);
  const [referenceFiles, setReferenceFiles] = useState<File[]>([]);
  const [referencePreviews, setReferencePreviews] = useState<string[]>([]);
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState<TaskStatus | null>(null);
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [generationEnabled, setGenerationEnabled] = useState(true);
  const [modelsLoading, setModelsLoading] = useState(true);
  // Mobile: control whether to show control panel or results
  const [mobileView, setMobileView] = useState<'control' | 'results'>('control');

  const selectedModel = models.find(m => m.code === selectedModelCode);

  // Fetch models
  useEffect(() => {
    let cancelled = false;
    async function fetchModels() {
      try {
        const res = await fetchWithTimeout('/api/v1/models', {
          headers: { 'x-session': session?.access_token || '' },
          timeout: 10_000,
        });
        if (res.ok && !cancelled) {
          const data = await res.json();
          const enabledModels = (data.data || []).filter((m: ModelConfig) => m.enabled);
          setModels(enabledModels);
          if (enabledModels.length > 0) {
            setSelectedModelCode((prev) => {
              // Only auto-select if no model is currently selected or the selected one is gone
              if (!prev || !enabledModels.find((m: ModelConfig) => m.code === prev)) {
                const defaultSize = enabledModels[0].supported_sizes?.[0] || '2K';
                setSize(defaultSize);
                return enabledModels[0].code;
              }
              return prev;
            });
          }
        }
      } catch {
        // Ignore
      } finally {
        if (!cancelled) setModelsLoading(false);
      }
    }
    fetchModels();
    return () => { cancelled = true; };
  }, [session]);

  // Fetch quota
  useEffect(() => {
    async function fetchQuota() {
      try {
        const res = await fetchWithTimeout('/api/v1/usage', {
          headers: { 'x-session': session?.access_token || '' },
          timeout: 10_000,
        });
        if (res.ok) {
          const data = await res.json();
          setQuota(data.data?.quota || null);
          setGenerationEnabled(data.data?.generation_enabled ?? true);
        }
      } catch {
        // Ignore
      }
    }
    if (session) fetchQuota();
  }, [session]);

  // ── Poll task status with adaptive backoff ────────────────────────
  // 替换原 setInterval(2000)：长任务下避免请求堆积，后台 tab 自动暂停。
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollDelayRef = useRef(2000);

  const clearPollTimer = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const checkTaskStatus = useCallback(async () => {
    if (!currentTaskId || !session) return false;
    try {
      const res = await fetchWithTimeout(`/api/v1/tasks/${currentTaskId}`, {
        headers: { 'x-session': session?.access_token || '' },
        timeout: 8_000,
      });
      if (res.ok) {
        const data = await res.json();
        setTaskStatus(data.data?.status);

        if (data.data?.status === 'succeeded') {
          const imagesRes = await fetchWithTimeout(`/api/v1/images?task_id=${currentTaskId}`, {
            headers: { 'x-session': session?.access_token || '' },
            timeout: 8_000,
          });
          if (imagesRes.ok) {
            const imagesData = await imagesRes.json();
            setGeneratedImages((imagesData.data || []).map((img: GeneratedImage) => ({
              id: img.id,
              url: img.url,
              thumbnail_url: img.thumbnail_url,
              favorite: img.favorite ?? false,
            })));
          }
          setIsGenerating(false);
          // Switch to results view on mobile when generation completes
          setMobileView('results');
          return true; // 任务完成
        }

        if (data.data?.status === 'failed' || data.data?.status === 'cancelled') {
          setError(data.data?.error_message || '生成失败');
          setIsGenerating(false);
          return true; // 任务结束
        }
      }
    } catch {
      // 单次轮询失败：忽略，下一轮重试
    }
    return false; // 任务未完成，继续轮询
  }, [currentTaskId, session]);

  const scheduleNextPoll = useCallback(() => {
    clearPollTimer();
    // 后台 tab 不轮询，等 visibilitychange resume
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;

    pollTimerRef.current = setTimeout(async () => {
      const done = await checkTaskStatus();
      if (done) return;
      // 递增间隔，上限 10s
      pollDelayRef.current = Math.min(pollDelayRef.current * 1.5, 10_000);
      scheduleNextPoll();
    }, pollDelayRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkTaskStatus, clearPollTimer]);

  // 任务激活时启动轮询，结束/卸载时清理
  useEffect(() => {
    if (!currentTaskId || !session) return;
    if (taskStatus === 'succeeded' || taskStatus === 'failed' || taskStatus === 'cancelled') {
      clearPollTimer();
      return;
    }
    // 新一轮任务：重置 delay
    pollDelayRef.current = 2000;
    scheduleNextPoll();

    return () => clearPollTimer();
  }, [currentTaskId, taskStatus, session, scheduleNextPoll, clearPollTimer]);

  // 标签页恢复可见时立即恢复轮询
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === 'visible' && currentTaskId && taskStatus !== 'succeeded' && taskStatus !== 'failed' && taskStatus !== 'cancelled') {
        // 把 delay 收回到初始值，立刻 poll 一次
        pollDelayRef.current = 2000;
        scheduleNextPoll();
      }
    }
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [currentTaskId, taskStatus, scheduleNextPoll]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const maxRefs = selectedModel?.supports_multiple_references ? 5 : 1;
    const limited = files.slice(0, maxRefs);
    setReferenceFiles(limited);

    const previews: string[] = [];
    limited.forEach((file) => {
      const url = URL.createObjectURL(file);
      previews.push(url);
    });
    setReferencePreviews(previews);
  }, [selectedModel]);

  const handleGenerate = async () => {
    if (!prompt.trim() || !selectedModelCode) return;
    if (!generationEnabled) {
      setError('生成服务暂时关闭');
      return;
    }

    setIsGenerating(true);
    setError(null);
    setTaskStatus('queued');
    setGeneratedImages([]);

    try {
      const body: Record<string, unknown> = {
        model: selectedModelCode,
        prompt: prompt.trim(),
        size,
        n: imageCount,
        visible_watermark: visibleWatermark,
      };

      if (taskType === 'image_to_image' && referenceFiles.length > 0) {
        const uploadForms = await Promise.all(
          referenceFiles.map(async (file) => {
            const formData = new FormData();
            formData.append('file', file);
            const res = await fetchWithTimeout('/api/upload/reference', {
              method: 'POST',
              headers: { 'x-session': session?.access_token || '' },
              body: formData,
              timeout: 30_000,
            });
            if (!res.ok) throw new Error('参考图上传失败');
            const data = await res.json();
            return data.data?.asset_id;
          })
        );
        body.reference_asset_ids = uploadForms.filter(Boolean);
      }

      const res = await fetchWithTimeout('/api/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session': session?.access_token || '',
        },
        body: JSON.stringify(body),
        timeout: 15_000,
      });

      const data = await res.json();

      if (!res.ok) {
        const msg = data.error?.message || '生成请求失败';
        setError(msg);
        toast.error('生成失败：' + msg);
        setIsGenerating(false);
        setTaskStatus(null);
        return;
      }

      setCurrentTaskId(data.data?.task_id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '生成请求失败';
      setError(msg);
      toast.error('生成失败：' + msg);
      setIsGenerating(false);
      setTaskStatus(null);
    }
  };

  const handleRetry = async () => {
    if (!currentTaskId) return;
    setIsGenerating(true);
    setError(null);
    setTaskStatus('queued');

    try {
      const res = await fetchWithTimeout(`/api/v1/tasks/${currentTaskId}/retry`, {
        method: 'POST',
        headers: { 'x-session': session?.access_token || '' },
        timeout: 10_000,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = data.error?.message || '重试失败';
        setError(msg);
        toast.error('重试失败：' + msg);
        setIsGenerating(false);
        setTaskStatus(null);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '重试请求失败';
      setError(msg);
      toast.error('重试失败：' + msg);
      setIsGenerating(false);
      setTaskStatus(null);
    }
  };

  // 收藏/取消收藏：复用 gallery 页面的 PATCH /api/v1/images/:id 接口
  const toggleFavorite = async (imageId: string, currentFavorite: boolean) => {
    try {
      const res = await fetchWithTimeout(`/api/v1/images/${imageId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-session': session?.access_token || '',
        },
        body: JSON.stringify({ favorite: !currentFavorite }),
        timeout: 8_000,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message || '操作失败');
      }
      setGeneratedImages((prev) =>
        prev.map((img) => (img.id === imageId ? { ...img, favorite: !currentFavorite } : img))
      );
      toast.success(currentFavorite ? '已取消收藏' : '已加入收藏');
    } catch (err) {
      toast.error('收藏失败：' + (err instanceof Error ? err.message : '未知错误'));
    }
  };

  const availableSizes = selectedModel?.supported_sizes || ['2K'];
  const maxN = selectedModel?.max_images_per_request || 4;

  return (
    <div className="flex flex-col md:flex-row h-[calc(100vh-var(--topbar-height))] md:h-screen">
      {/* Left: Control Panel - on mobile, conditionally shown */}
      <div className={`md:w-[var(--studio-control-width)] md:border-r md:border-[var(--color-border)] md:flex md:flex-col md:overflow-hidden ${
        mobileView === 'control' ? 'flex flex-col flex-1 overflow-hidden' : 'hidden md:flex md:flex-col md:overflow-hidden'
      }`}>
        <div className="px-4 md:px-5 py-3 md:py-4 border-b border-[var(--color-border)]">
          <h1 className="text-base font-semibold text-[var(--color-text)]">工作台</h1>
        </div>

        <div className="flex-1 overflow-y-auto px-4 md:px-5 py-4 space-y-5">
          {/* Generation Mode */}
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5">生成模式</label>
            <div className="flex gap-1.5">
              <button
                onClick={() => setTaskType('text_to_image')}
                className={`flex-1 py-2 md:py-1.5 text-xs font-medium rounded-[var(--radius-sm)] transition-colors tap-target ${
                  taskType === 'text_to_image'
                    ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent)]'
                    : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]'
                }`}
              >
                文生图
              </button>
              <button
                onClick={() => setTaskType('image_to_image')}
                disabled={!selectedModel?.supports_image_to_image}
                className={`flex-1 py-2 md:py-1.5 text-xs font-medium rounded-[var(--radius-sm)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed tap-target ${
                  taskType === 'image_to_image'
                    ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent)]'
                    : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]'
                }`}
              >
                图生图
              </button>
            </div>
          </div>

          {/* Prompt */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-[var(--color-text-muted)]">Prompt</label>
              <span className="text-[10px] text-[var(--color-text-subtle)]">{prompt.length} 字</span>
            </div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="描述你想生成的图片..."
              rows={4}
              className="w-full px-3 py-2 text-sm bg-[var(--color-surface-subtle)] border border-[var(--color-border)] rounded-[var(--radius-md)] text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] resize-none"
            />
            <p className="mt-1 text-[10px] text-[var(--color-text-subtle)]">
              生成内容应遵守相关法律法规
            </p>
          </div>

          {/* Reference Images (for image-to-image) */}
          {taskType === 'image_to_image' && (
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5">
                参考图 {selectedModel?.supports_multiple_references && '(可上传多张)'}
              </label>
              <div className="flex gap-2 flex-wrap">
                {referencePreviews.map((preview, i) => (
                  <div key={i} className="relative w-16 h-16 rounded-[var(--radius-sm)] overflow-hidden border border-[var(--color-border)]">
                    <img src={preview} alt="" className="w-full h-full object-cover" />
                    <button
                      onClick={() => {
                        const newFiles = referenceFiles.filter((_, idx) => idx !== i);
                        const newPreviews = referencePreviews.filter((_, idx) => idx !== i);
                        setReferenceFiles(newFiles);
                        setReferencePreviews(newPreviews);
                      }}
                      className="absolute top-0.5 right-0.5 w-5 h-5 bg-[var(--color-destructive)] text-white rounded-full text-xs flex items-center justify-center tap-target"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <label className="w-16 h-16 rounded-[var(--radius-sm)] border border-dashed border-[var(--color-border-strong)] flex items-center justify-center cursor-pointer hover:bg-[var(--color-surface-hover)] transition-colors tap-target">
                  <span className="text-[var(--color-text-subtle)] text-lg">+</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    multiple={selectedModel?.supports_multiple_references}
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          )}

          {/* Model Selection */}
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5">模型</label>
            {modelsLoading ? (
              <div className="h-9 w-full rounded-md bg-[var(--color-bg-subtle)] animate-pulse" />
            ) : (
              <select
                value={selectedModelCode}
                onChange={(e) => {
                  setSelectedModelCode(e.target.value);
                  const model = models.find(m => m.code === e.target.value);
                  if (model?.supported_sizes?.[0]) {
                    setSize(model.supported_sizes[0]);
                  }
                }}
                className="w-full px-3 py-1.5 text-sm bg-[var(--color-surface-subtle)] border border-[var(--color-border)] rounded-[var(--radius-md)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              >
                {models.map((model) => (
                  <option key={model.code} value={model.code}>{model.display_name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Size */}
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5">尺寸</label>
            <div className="flex flex-wrap gap-1.5">
              {availableSizes.map((s) => (
                <button
                  key={s}
                  onClick={() => setSize(s)}
                  className={`px-3 py-1.5 md:py-1 text-xs rounded-[var(--radius-sm)] transition-colors tap-target ${
                    size === s
                      ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent)] font-medium'
                      : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)]'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Image Count */}
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5">
              生成数量
            </label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={1}
                max={maxN}
                value={imageCount}
                onChange={(e) => setImageCount(Number(e.target.value))}
                className="flex-1"
              />
              <span className="text-xs text-[var(--color-text)] w-6 text-center">{imageCount}</span>
            </div>
          </div>

          {/* Watermark */}
          {selectedModel?.supports_visible_watermark_control && (
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-[var(--color-text-muted)]">关闭可见水印</label>
              <button
                onClick={() => setVisibleWatermark(!visibleWatermark)}
                className={`w-10 h-6 md:w-8 md:h-4.5 rounded-full transition-colors relative tap-target ${
                  visibleWatermark ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border-strong)]'
                }`}
              >
                <span
                  className={`absolute top-0.5 w-5 h-5 md:w-3.5 md:h-3.5 rounded-full bg-white transition-transform ${
                    visibleWatermark ? 'left-[18px] md:left-4' : 'left-0.5'
                  }`}
                />
              </button>
            </div>
          )}
        </div>

        {/* Bottom: Quota & Generate */}
        <div className="border-t border-[var(--color-border)] px-4 md:px-5 py-3 space-y-3 safe-area-bottom">
          {/* Quota info */}
          {quota && (
            <div className="flex items-center justify-between text-[10px] text-[var(--color-text-subtle)]">
              <span>今日 {quota.daily_used}/{quota.daily_limit}</span>
              <span>本月 {quota.monthly_used}/{quota.monthly_limit}</span>
            </div>
          )}

          {!generationEnabled && (
            <div className="text-xs text-[var(--color-warning)] bg-[var(--color-warning-subtle)] px-3 py-1.5 rounded-[var(--radius-sm)]">
              生成服务暂时关闭
            </div>
          )}

          <button
            onClick={handleGenerate}
            disabled={isGenerating || !prompt.trim() || !selectedModelCode || !generationEnabled}
            className="w-full py-2.5 md:py-2 px-4 text-sm font-medium text-white bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] rounded-[var(--radius-md)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150"
          >
            {isGenerating ? (
              <span className="flex items-center justify-center gap-2">
                <span className="animate-spin w-3.5 h-3.5 border-1.5 border-white/30 border-t-white rounded-full" />
                {taskStatus === 'queued' ? '排队中...' : '生成中...'}
              </span>
            ) : (
              '生成'
            )}
          </button>

          {/* Mobile: View results button */}
          {generatedImages.length > 0 && (
            <button
              onClick={() => setMobileView('results')}
              className="md:hidden w-full py-2 text-xs text-[var(--color-accent)] text-center"
            >
              查看生成结果 ({generatedImages.length}) →
            </button>
          )}
        </div>
      </div>

      {/* Right: Results Area - on mobile, conditionally shown */}
      <div className={`flex-1 flex flex-col overflow-hidden ${
        mobileView === 'results' ? 'flex' : 'hidden md:flex'
      }`}>
        <div className="px-4 md:px-6 py-3 md:py-4 border-b border-[var(--color-border)] flex items-center gap-3">
          {/* Mobile: Back to control button */}
          <button
            onClick={() => setMobileView('control')}
            className="md:hidden tap-target text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            aria-label="返回控制面板"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M11 4L6 9l5 5" />
            </svg>
          </button>
          <h2 className="text-sm font-medium text-[var(--color-text)]">生成结果</h2>
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          {error && (
            <div className="mb-4 p-3 bg-[var(--color-destructive-subtle)] border border-[var(--color-destructive)]/20 rounded-[var(--radius-md)]">
              <p className="text-sm text-[var(--color-destructive)]">{error}</p>
              <button
                onClick={handleRetry}
                className="mt-2 text-xs text-[var(--color-accent)] hover:underline"
              >
                重试
              </button>
            </div>
          )}

          {isGenerating && !generatedImages.length && (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="w-10 h-10 border-2 border-[var(--color-accent)]/30 border-t-[var(--color-accent)] rounded-full animate-spin mb-4" />
              <p className="text-sm text-[var(--color-text-muted)]">
                {taskStatus === 'queued' ? '任务排队中...' : '正在生成图片...'}
              </p>
            </div>
          )}

          {!isGenerating && !error && !generatedImages.length && (
            <div className="flex flex-col items-center justify-center py-20">
              <p className="text-sm text-[var(--color-text-subtle)]">输入 Prompt 并点击生成</p>
            </div>
          )}

          {generatedImages.length > 0 && (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
              {generatedImages.map((img) => (
                <div key={img.id} className="group relative aspect-square rounded-[var(--radius-md)] overflow-hidden border border-[var(--color-border)] bg-[var(--color-surface-subtle)]">
                  <img
                    src={img.thumbnail_url || img.url}
                    alt="AI 生成图片"
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                  {/* Mobile: always show actions, Desktop: hover only */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center opacity-100 md:opacity-0 md:group-hover:opacity-100">
                    <div className="flex gap-2">
                      <a
                        href={img.url}
                        download
                        className="px-3 py-1.5 md:px-2.5 md:py-1 text-xs bg-white text-[var(--color-text)] rounded-[var(--radius-sm)] hover:bg-gray-100 tap-target"
                      >
                        下载
                      </a>
                      <button
                        onClick={() => toggleFavorite(img.id, img.favorite)}
                        className={`px-3 py-1.5 md:px-2.5 md:py-1 text-xs rounded-[var(--radius-sm)] tap-target ${
                          img.favorite
                            ? 'bg-[var(--color-accent)] text-white'
                            : 'bg-white text-[var(--color-text)] hover:bg-gray-100'
                        }`}
                      >
                        {img.favorite ? '★ 已收藏' : '☆ 收藏'}
                      </button>
                    </div>
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-gradient-to-t from-black/60 to-transparent">
                    <span className="text-[10px] text-white/80">AI 生成内容</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
