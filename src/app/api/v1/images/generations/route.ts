import { NextRequest, NextResponse } from 'next/server';
import { HeaderUtils } from 'coze-coding-dev-sdk';
import { authenticateRequest, errorResponse } from '@/server/api-helpers';
import { AppError, ErrorCodes } from '@/server/errors';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { createTask, executeTaskSync } from '@/server/tasks/executor';
import type { TaskType } from '@/server/tasks/state-machine';
import { generateSignedUrl } from '@/server/storage';
import { logger } from '@/server/logging';
import { checkRateLimit } from '@/server/rate-limit';

// ---------------------------------------------------------------------------
// OpenAI-compatible size mapping
// OpenAI format: "1024x1024", "1024x1792", "1792x1024"
// Our format: "2K", "4K", "2560x1440", "2048x2048", etc.
// ---------------------------------------------------------------------------
const OPENAI_SIZE_MAP: Record<string, string> = {
  '1024x1024': '2K',
  '1024x1792': '2K',
  '1792x1024': '2K',
  '512x512': '512x512',
  '2048x2048': '2048x2048',
  '2560x1440': '2560x1440',
  '3840x2160': '3840x2160',
  '4096x4096': '4096x4096',
};

// OpenAI-compatible model name mapping
const OPENAI_MODEL_MAP: Record<string, string> = {
  'dall-e-2': 'image-standard',
  'dall-e-3': 'image-pro',
  'stable-diffusion': 'image-standard',
};

function resolveModel(model: string): string {
  return OPENAI_MODEL_MAP[model] || model;
}

function resolveSize(size: string | undefined, modelCode: string): string {
  if (!size) return '2K';
  return OPENAI_SIZE_MAP[size] || size;
}

// ---------------------------------------------------------------------------
// Basic prompt content moderation
// ---------------------------------------------------------------------------
const PROHIBITED_PATTERNS: Array<{ pattern: RegExp; flag: string }> = [
  { pattern: /\b(child\s*(sexual|abuse|pornography|exploitation)|CSAM)\b/i, flag: 'csam' },
  { pattern: /\b(non[- ]?consensual\s*(porn|nude|intimate)|revenge\s*porn)\b/i, flag: 'ncii' },
  { pattern: /\b(sexual\s*violence|rape|sexual\s*assault)\b/i, flag: 'sexual_violence' },
  { pattern: /\b(self[- ]?harm|suicide|cutting)\b/i, flag: 'self_harm' },
  { pattern: /\b(terroris[mt]|extremis[mt]|mass\s*shooting|bomb\s*making)\b/i, flag: 'violence_extremism' },
];

function checkPromptModeration(prompt: string): string[] {
  const flags: string[] = [];
  for (const { pattern, flag } of PROHIBITED_PATTERNS) {
    if (pattern.test(prompt)) {
      flags.push(flag);
    }
  }
  return flags;
}

// ---------------------------------------------------------------------------
// POST /api/v1/images/generations — OpenAI-compatible endpoint
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  try {
    // Extract forwarded headers required by the SDK for authentication/routing
    const forwardHeaders = HeaderUtils.extractForwardHeaders(request.headers);

    const auth = await authenticateRequest(request);
    const body = await request.json();

    // ── Rate limiting (per user, 60 req/min) ──────────────────────────
    const rateLimitResult = checkRateLimit({
      key: `gen:${auth.userId}`,
      maxRequests: 60,
      windowMs: 60_000,
    });
    if (!rateLimitResult.allowed) {
      throw new AppError(ErrorCodes.RATE_LIMITED, 'Too many requests. Please slow down.');
    }

    const {
      model: rawModel,
      prompt,
      size: rawSize,
      n = 1,
      response_format: responseFormat = 'url',
      // Our extended fields (still supported)
      reference_asset_ids = [],
      visible_watermark = false,
      idempotency_key,
    } = body;

    const modelCode = resolveModel(rawModel || 'image-pro');
    const size = resolveSize(rawSize, modelCode);

    // ── Validate ──────────────────────────────────────────────────────
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      throw new AppError(ErrorCodes.INVALID_REQUEST, 'prompt is required and cannot be empty');
    }
    if (n < 1 || n > 4) {
      throw new AppError(ErrorCodes.INVALID_REQUEST, 'n must be between 1 and 4');
    }
    if (responseFormat !== 'url' && responseFormat !== 'b64_json') {
      throw new AppError(ErrorCodes.INVALID_REQUEST, 'response_format must be "url" or "b64_json"');
    }

    // ── Content moderation (basic prompt check) ────────────────────────
    const trimmedPrompt = prompt.trim();
    const moderationFlags = checkPromptModeration(trimmedPrompt);
    if (moderationFlags.length > 0) {
      // Log moderation event for audit (best-effort, don't block on failure)
      const supabase = getSupabaseClient();
      try {
        await supabase.from('moderation_events').insert({
          user_id: auth.userId,
          prompt: trimmedPrompt,
          flags: moderationFlags,
          action: 'blocked',
        });
      } catch { /* best-effort logging */ }
      throw new AppError(ErrorCodes.INVALID_REQUEST, 'Prompt contains prohibited content');
    }

    const supabase = getSupabaseClient();

    // 1. Check generation enabled
    const { data: genSetting } = await supabase
      .from('system_settings')
      .select('value')
      .eq('key', 'generation_enabled')
      .single();
    if (genSetting?.value === 'false') {
      throw new AppError(ErrorCodes.GENERATION_DISABLED, 'Image generation service is currently disabled');
    }

    // 2. Check user status
    const { data: profile } = await supabase
      .from('profiles')
      .select('status, role')
      .eq('user_id', auth.userId)
      .single();
    if (!profile || profile.status === 'disabled') {
      throw new AppError(ErrorCodes.USER_DISABLED, 'User account is disabled');
    }

    // 3. Get model config
    const { data: modelConfig } = await supabase
      .from('model_configs')
      .select('*')
      .eq('code', modelCode)
      .eq('enabled', true)
      .single();
    if (!modelConfig) {
      throw new AppError(ErrorCodes.MODEL_NOT_FOUND, `Model "${rawModel || modelCode}" not found or disabled`);
    }

    // 4. Get user quota
    const { data: quota } = await supabase
      .from('user_quotas')
      .select('*')
      .eq('user_id', auth.userId)
      .single();

    // 5. Check model access
    if (quota?.allowed_model_codes && Array.isArray(quota.allowed_model_codes) && quota.allowed_model_codes.length > 0) {
      if (!quota.allowed_model_codes.includes(modelCode)) {
        throw new AppError(ErrorCodes.MODEL_NOT_ALLOWED, 'This model is not available for your account');
      }
    }

    // 6. Check size access
    if (quota?.allowed_sizes && Array.isArray(quota.allowed_sizes) && quota.allowed_sizes.length > 0) {
      if (!quota.allowed_sizes.includes(size)) {
        throw new AppError(ErrorCodes.SIZE_NOT_ALLOWED, 'This size is not available for your account');
      }
    }
    if (modelConfig.supported_sizes && !modelConfig.supported_sizes.includes(size)) {
      throw new AppError(ErrorCodes.SIZE_NOT_ALLOWED, `Model does not support size "${rawSize || size}"`);
    }

    // 7. Check image count
    const maxPerRequest = quota?.max_images_per_request || modelConfig.max_images_per_request || 4;
    if (n > maxPerRequest) {
      throw new AppError(ErrorCodes.INVALID_REQUEST, `Maximum ${maxPerRequest} images per request`);
    }

    // 8. Check daily quota (only count succeeded generations)
    const today = new Date().toISOString().split('T')[0];
    const { count: todayCount } = await supabase
      .from('usage_records')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', auth.userId)
      .eq('status', 'succeeded')
      .gte('created_at', today);
    const dailyLimit = quota?.daily_image_limit || 50;
    if ((todayCount || 0) + n > dailyLimit) {
      throw new AppError(ErrorCodes.QUOTA_EXCEEDED, 'Daily image generation quota exceeded');
    }

    // 9. Check monthly quota (only count succeeded generations)
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const { count: monthCount } = await supabase
      .from('usage_records')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', auth.userId)
      .eq('status', 'succeeded')
      .gte('created_at', monthStart);
    const monthlyLimit = quota?.monthly_image_limit || 500;
    if ((monthCount || 0) + n > monthlyLimit) {
      throw new AppError(ErrorCodes.QUOTA_EXCEEDED, 'Monthly image generation quota exceeded');
    }

    // 10. Check concurrency
    const maxConcurrent = quota?.max_concurrent_tasks || 3;
    const { count: activeCount } = await supabase
      .from('generation_tasks')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', auth.userId)
      .in('status', ['queued', 'running']);
    if ((activeCount || 0) >= maxConcurrent) {
      throw new AppError(ErrorCodes.CONCURRENCY_LIMITED, 'Too many concurrent generation tasks');
    }

    // 11. Check watermark support
    if (visible_watermark && !modelConfig.supports_visible_watermark_control) {
      throw new AppError(ErrorCodes.INVALID_REQUEST, 'This model does not support watermark control');
    }

    // 12. Determine task type
    const taskType: TaskType = reference_asset_ids.length > 0 ? 'image_to_image' : 'text_to_image';
    if (taskType === 'image_to_image' && !modelConfig.supports_image_to_image) {
      throw new AppError(ErrorCodes.INVALID_REQUEST, 'This model does not support image-to-image');
    }

    // ── Create task ───────────────────────────────────────────────────
    const task = await createTask({
      user_id: auth.userId,
      model_code: modelCode,
      task_type: taskType,
      prompt: prompt.trim(),
      request_parameters: { size, n, visible_watermark, reference_asset_ids },
      idempotency_key: idempotency_key || undefined,
      reference_asset_ids: reference_asset_ids.length > 0 ? reference_asset_ids : undefined,
      custom_headers: forwardHeaders,
    });

    // ── Execute synchronously (OpenAI-compatible) ─────────────────────
    const timeoutMs = (modelConfig.timeout_seconds || 120) * 1000;
    const result = await executeTaskSync(task.id, { timeoutMs, custom_headers: forwardHeaders });

    // ── Build OpenAI-compatible response ──────────────────────────────
    const data = await Promise.all(
      (result.generated_urls || []).map(async (signedUrl: string, index: number) => {
        if (responseFormat === 'b64_json') {
          // Download image and convert to base64
          const imageResp = await fetch(signedUrl);
          const buffer = Buffer.from(await imageResp.arrayBuffer());
          return {
            b64_json: buffer.toString('base64'),
            revised_prompt: prompt,
          };
        }
        return {
          url: signedUrl,
          revised_prompt: prompt,
        };
      })
    );

    return NextResponse.json({
      created: Math.floor(Date.now() / 1000),
      data,
    });

  } catch (err) {
    // OpenAI-compatible error format
    if (err instanceof AppError) {
      const statusMap: Record<string, number> = {
        UNAUTHORIZED: 401,
        FORBIDDEN: 403,
        USER_DISABLED: 403,
        API_DISABLED: 403,
        GENERATION_DISABLED: 503,
        INVALID_REQUEST: 400,
        MODEL_NOT_FOUND: 404,
        MODEL_NOT_ALLOWED: 403,
        SIZE_NOT_ALLOWED: 400,
        QUOTA_EXCEEDED: 429,
        CONCURRENCY_LIMITED: 429,
        PROVIDER_TIMEOUT: 504,
        PROVIDER_ERROR: 502,
        RATE_LIMITED: 429,
        API_KEY_INVALID: 401,
        API_KEY_EXPIRED: 401,
      };
      const status = statusMap[err.code] || 500;
      return NextResponse.json(
        {
          error: {
            code: err.code,
            message: err.message,
            type: status >= 500 ? 'server_error' : 'invalid_request_error',
          },
        },
        { status }
      );
    }

    logger.error('Unhandled error in images/generations', {
      error: err instanceof Error ? err.message : 'Unknown',
    });
    return NextResponse.json(
      {
        error: {
          code: 'internal_error',
          message: 'An unexpected error occurred',
          type: 'server_error',
        },
      },
      { status: 500 }
    );
  }
}
