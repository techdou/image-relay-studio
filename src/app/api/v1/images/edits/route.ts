import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/server/api-helpers';
import { AppError, ErrorCodes } from '@/server/errors';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { createTask, executeTaskSync } from '@/server/tasks/executor';
import { uploadFile } from '@/server/storage';
import { logger } from '@/server/logging';
import { HeaderUtils } from 'coze-coding-dev-sdk';

// ---------------------------------------------------------------------------
// OpenAI-compatible size mapping
// ---------------------------------------------------------------------------
const OPENAI_SIZE_MAP: Record<string, string> = {
  '256x256': '512x512',
  '512x512': '512x512',
  '1024x1024': '2K',
  '1024x1792': '2K',
  '1792x1024': '2K',
  '2048x2048': '2048x2048',
};

// OpenAI-compatible model name mapping
const OPENAI_MODEL_MAP: Record<string, string> = {
  'dall-e-2': 'image-standard',
  'dall-e-3': 'image-pro',
};

function resolveModel(model: string): string {
  return OPENAI_MODEL_MAP[model] || model;
}

function resolveSize(size: string | undefined): string {
  if (!size) return '2K';
  return OPENAI_SIZE_MAP[size] || size;
}

// ---------------------------------------------------------------------------
// MIME type detection from magic bytes
// ---------------------------------------------------------------------------
function detectMimeType(buffer: Buffer): string | null {
  if (buffer.length < 4) return null;
  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png';
  }
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  // WebP: 52 49 46 46 ... 57 45 42 50
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Image dimension reader (supports PNG + JPEG)
// ---------------------------------------------------------------------------
function readPngDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 33) return null;
  if (
    buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4e || buffer[3] !== 0x47 ||
    buffer[4] !== 0x0d || buffer[5] !== 0x0a || buffer[6] !== 0x1a || buffer[7] !== 0x0a
  ) {
    return null;
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return { width, height };
}

function readJpegDimensions(buffer: Buffer): { width: number; height: number } | null {
  // JPEG: starts with FF D8 FF
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) return null;

  let offset = 2;
  while (offset < buffer.length - 1) {
    if (buffer[offset] !== 0xff) { offset++; continue; }
    const marker = buffer[offset + 1];

    // SOF0 (Baseline) or SOF2 (Progressive): contain dimensions
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      if (offset + 8 > buffer.length) return null;
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      return { width, height };
    }

    // Skip markers without payload (RST, SOI, EOI)
    if (marker >= 0xd0 && marker <= 0xd9) { offset += 2; continue; }

    // Read segment length and skip
    if (offset + 3 > buffer.length) return null;
    const segLen = buffer.readUInt16BE(offset + 2);
    offset += 2 + segLen;
  }
  return null;
}

function readImageDimensions(buffer: Buffer, mimeType: string): { width: number; height: number } | null {
  if (mimeType === 'image/png') return readPngDimensions(buffer);
  if (mimeType === 'image/jpeg') return readJpegDimensions(buffer);
  // Try PNG first, then JPEG
  return readPngDimensions(buffer) || readJpegDimensions(buffer);
}

// ---------------------------------------------------------------------------
// File validation constants
// ---------------------------------------------------------------------------
const MAX_IMAGE_SIZE = 4 * 1024 * 1024; // 4MB (OpenAI limit)
const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_REFERENCE_IMAGES = 4;

// ---------------------------------------------------------------------------
// POST /api/v1/images/edits — OpenAI-compatible edit endpoint
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  let requestId = '';

  try {
    const auth = await authenticateRequest(request);
    requestId = auth.requestId;

    // ── Extract forward headers for SDK authentication ────────────────
    const forwardHeaders = HeaderUtils.extractForwardHeaders(request.headers);

    // ── Parse multipart/form-data ──────────────────────────────────────
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      throw new AppError(
        ErrorCodes.INVALID_REQUEST,
        'Content-Type must be multipart/form-data for image edits'
      );
    }

    const formData = await request.formData();

    // ── Collect all image files ────────────────────────────────────────
    // OpenAI edits: "image" is the primary source image.
    // OpenAI SDKs (Python openai, Node openai, etc.) send "image[]" not "image".
    // We also support "reference_image" (singular or multiple) for
    // additional reference images that provide style/subject guidance.
    let imageFile: File | null = formData.get('image') as File | null;
    const promptRaw = formData.get('prompt') as string | null;
    const maskFile = formData.get('mask') as File | null;
    const rawModel = (formData.get('model') as string) || 'dall-e-2';
    const rawSize = (formData.get('size') as string) || '1024x1024';
    const nRaw = formData.get('n') as string | null;
    const responseFormat = (formData.get('response_format') as string) || 'url';

    // Collect reference_image files (can be multiple via repeated field names)
    const referenceImageFiles: File[] = [];
    for (const [key, value] of formData.entries()) {
      if (key === 'reference_image' && value instanceof File) {
        referenceImageFiles.push(value);
      }
      // OpenAI SDKs send "image[]" as the field name for the primary image
      if ((key === 'image[]') && value instanceof File && !imageFile) {
        imageFile = value;
      }
    }

    const n = nRaw ? parseInt(nRaw, 10) : 1;

    // ── Validate required fields ───────────────────────────────────────
    if (!imageFile) {
      throw new AppError(ErrorCodes.INVALID_REQUEST, 'image is required');
    }
    if (!promptRaw || typeof promptRaw !== 'string' || promptRaw.trim().length === 0) {
      throw new AppError(ErrorCodes.INVALID_REQUEST, 'prompt is required and cannot be empty');
    }
    const prompt = promptRaw.trim();

    // ── Validate image file ────────────────────────────────────────────
    if (!ALLOWED_MIME.includes(imageFile.type) && !imageFile.type.startsWith('image/')) {
      throw new AppError(ErrorCodes.INVALID_FILE, `image must be a valid image file (PNG, JPEG, or WebP), got: ${imageFile.type}`);
    }
    if (imageFile.size > MAX_IMAGE_SIZE) {
      throw new AppError(ErrorCodes.INVALID_FILE, 'image must be less than 4MB');
    }

    const imageBuffer = Buffer.from(await imageFile.arrayBuffer());
    // Detect actual MIME from magic bytes (don't trust Content-Type from browser)
    const actualImageMime = detectMimeType(imageBuffer) || imageFile.type || 'image/png';
    const imageMime = actualImageMime;
    const imageDims = readImageDimensions(imageBuffer, imageMime);
    if (!imageDims) {
      throw new AppError(ErrorCodes.INVALID_FILE, 'image could not be read — must be a valid PNG, JPEG, or WebP');
    }

    // ── Validate reference images ──────────────────────────────────────
    if (referenceImageFiles.length > MAX_REFERENCE_IMAGES) {
      throw new AppError(ErrorCodes.INVALID_REQUEST, `Maximum ${MAX_REFERENCE_IMAGES} reference images allowed`);
    }

    const referenceBuffers: { buffer: Buffer; dims: { width: number; height: number }; name: string; mime: string; size: number }[] = [];
    for (const refFile of referenceImageFiles) {
      if (!ALLOWED_MIME.includes(refFile.type) && !refFile.type.startsWith('image/')) {
        throw new AppError(ErrorCodes.INVALID_FILE, `reference_image must be a valid image file, got: ${refFile.type}`);
      }
      if (refFile.size > MAX_IMAGE_SIZE) {
        throw new AppError(ErrorCodes.INVALID_FILE, 'reference_image must be less than 4MB');
      }
      const refBuf = Buffer.from(await refFile.arrayBuffer());
      const actualRefMime = detectMimeType(refBuf) || refFile.type || 'image/png';
      const refDims = readImageDimensions(refBuf, actualRefMime);
      if (!refDims) {
        throw new AppError(ErrorCodes.INVALID_FILE, 'reference_image could not be read — must be a valid image');
      }
      referenceBuffers.push({ buffer: refBuf, dims: refDims, name: refFile.name, mime: actualRefMime, size: refFile.size });
    }

    // ── Validate mask file (if provided) ───────────────────────────────
    let maskBuffer: Buffer | null = null;
    let maskDims: { width: number; height: number } | null = null;
    let maskMime = 'image/png';

    if (maskFile) {
      if (maskFile.size === 0) {
        // Empty mask file = no mask (OpenAI behavior)
      } else {
        if (!ALLOWED_MIME.includes(maskFile.type) && !maskFile.type.startsWith('image/')) {
          throw new AppError(ErrorCodes.INVALID_FILE, 'mask must be a valid image file');
        }
        if (maskFile.size > MAX_IMAGE_SIZE) {
          throw new AppError(ErrorCodes.INVALID_FILE, 'mask must be less than 4MB');
        }

        maskBuffer = Buffer.from(await maskFile.arrayBuffer());
        const actualMaskMime = detectMimeType(maskBuffer) || maskFile.type || 'image/png';
        maskMime = actualMaskMime;
        maskDims = readImageDimensions(maskBuffer, maskMime);
        if (!maskDims) {
          throw new AppError(ErrorCodes.INVALID_FILE, 'mask could not be read — must be a valid image');
        }
        if (maskDims.width !== imageDims.width || maskDims.height !== imageDims.height) {
          throw new AppError(
            ErrorCodes.INVALID_REQUEST,
            `mask dimensions (${maskDims.width}x${maskDims.height}) must match image dimensions (${imageDims.width}x${imageDims.height})`
          );
        }
      }
    }

    // ── Validate other params ──────────────────────────────────────────
    if (isNaN(n) || n < 1 || n > 10) {
      throw new AppError(ErrorCodes.INVALID_REQUEST, 'n must be between 1 and 10');
    }
    if (responseFormat !== 'url' && responseFormat !== 'b64_json') {
      throw new AppError(ErrorCodes.INVALID_REQUEST, 'response_format must be "url" or "b64_json"');
    }

    const modelCode = resolveModel(rawModel);
    const size = resolveSize(rawSize);

    // ── Server-side checks (reuse generations logic) ───────────────────
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
      throw new AppError(ErrorCodes.MODEL_NOT_FOUND, `Model "${rawModel}" not found or disabled`);
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

    // 6. Check image-to-image support
    if (!modelConfig.supports_image_to_image) {
      throw new AppError(ErrorCodes.INVALID_REQUEST, 'This model does not support image editing');
    }

    // 7. Reference image count is bounded by the hard limit (MAX_REFERENCE_IMAGES).
    //    Actual multi-reference capability is determined by the upstream Provider/SDK —
    //    we don't duplicate that check here to avoid database-vs-reality desync.

    // 8. Check size
    if (modelConfig.supported_sizes && !modelConfig.supported_sizes.includes(size)) {
      throw new AppError(ErrorCodes.SIZE_NOT_ALLOWED, `Model does not support size "${rawSize}"`);
    }

    // 9. Check image count
    const maxPerRequest = quota?.max_images_per_request || modelConfig.max_images_per_request || 4;
    if (n > maxPerRequest) {
      throw new AppError(ErrorCodes.INVALID_REQUEST, `Maximum ${maxPerRequest} images per request`);
    }

    // 10. Check daily quota
    const today = new Date().toISOString().split('T')[0];
    const { count: todayCount } = await supabase
      .from('usage_records')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', auth.userId)
      .gte('created_at', today);
    const dailyLimit = quota?.daily_image_limit || 50;
    if ((todayCount || 0) + n > dailyLimit) {
      throw new AppError(ErrorCodes.QUOTA_EXCEEDED, 'Daily image generation quota exceeded');
    }

    // 11. Check monthly quota
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const { count: monthCount } = await supabase
      .from('usage_records')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', auth.userId)
      .gte('created_at', monthStart);
    const monthlyLimit = quota?.monthly_image_limit || 500;
    if ((monthCount || 0) + n > monthlyLimit) {
      throw new AppError(ErrorCodes.QUOTA_EXCEEDED, 'Monthly image generation quota exceeded');
    }

    // 12. Check concurrency
    const maxConcurrent = quota?.max_concurrent_tasks || 3;
    const { count: activeCount } = await supabase
      .from('generation_tasks')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', auth.userId)
      .in('status', ['queued', 'running']);
    if ((activeCount || 0) >= maxConcurrent) {
      throw new AppError(ErrorCodes.CONCURRENCY_LIMITED, 'Too many concurrent generation tasks');
    }

    // ── Upload source image to object storage (for provenance) ─────────
    const datePath = `${new Date().getFullYear()}/${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    const imageExt = imageMime.split('/')[1] || 'png';
    const imageObjectKey = `users/${auth.userId}/edits/${datePath}/${crypto.randomUUID()}.${imageExt}`;
    await uploadFile(imageBuffer, imageObjectKey, imageMime);

    // ── Upload reference images to object storage ──────────────────────
    const referenceObjectKeys: string[] = [];
    for (const ref of referenceBuffers) {
      const refExt = ref.mime.split('/')[1] || 'png';
      const refKey = `users/${auth.userId}/edits/${datePath}/${crypto.randomUUID()}_ref.${refExt}`;
      await uploadFile(ref.buffer, refKey, ref.mime);
      referenceObjectKeys.push(refKey);
    }

    // ── Upload mask to object storage (if provided) ────────────────────
    let maskObjectKey: string | null = null;
    if (maskBuffer) {
      const maskExt = maskMime.split('/')[1] || 'png';
      maskObjectKey = `users/${auth.userId}/edits/${datePath}/${crypto.randomUUID()}_mask.${maskExt}`;
      await uploadFile(maskBuffer, maskObjectKey, maskMime);
    }

    // ── Build data URIs for provider (base64, not signed URLs) ─────────
    // Coze API servers cannot reach our internal S3 signed URLs,
    // so we pass base64 data URIs directly.
    const imageDataUri = `data:${imageMime};base64,${imageBuffer.toString('base64')}`;
    const referenceImageUris: string[] = [imageDataUri];

    // Add reference images
    for (const ref of referenceBuffers) {
      referenceImageUris.push(`data:${ref.mime};base64,${ref.buffer.toString('base64')}`);
    }

    // Add mask as a reference image (if provided)
    if (maskBuffer) {
      referenceImageUris.push(`data:${maskMime};base64,${maskBuffer.toString('base64')}`);
    }

    // ── Store provenance references ────────────────────────────────────
    const referenceAssetIds: string[] = [];

    const { data: sourceRef } = await supabase
      .from('generation_references')
      .insert({
        task_id: '00000000-0000-0000-0000-000000000000',
        user_id: auth.userId,
        object_key: imageObjectKey,
        original_filename: imageFile.name || 'source.png',
        mime_type: imageMime,
        file_size: imageFile.size,
        width: imageDims.width,
        height: imageDims.height,
      })
      .select('id')
      .single();
    if (sourceRef) referenceAssetIds.push(sourceRef.id);

    for (let i = 0; i < referenceBuffers.length; i++) {
      const ref = referenceBuffers[i];
      const { data: refData } = await supabase
        .from('generation_references')
        .insert({
          task_id: '00000000-0000-0000-0000-000000000000',
          user_id: auth.userId,
          object_key: referenceObjectKeys[i],
          original_filename: ref.name || `reference_${i}.png`,
          mime_type: ref.mime,
          file_size: ref.size,
          width: ref.dims.width,
          height: ref.dims.height,
        })
        .select('id')
        .single();
      if (refData) referenceAssetIds.push(refData.id);
    }

    if (maskObjectKey) {
      const { data: maskRef } = await supabase
        .from('generation_references')
        .insert({
          task_id: '00000000-0000-0000-0000-000000000000',
          user_id: auth.userId,
          object_key: maskObjectKey,
          original_filename: maskFile?.name || 'mask.png',
          mime_type: maskMime,
          file_size: maskFile?.size || 0,
          width: maskDims?.width || 0,
          height: maskDims?.height || 0,
        })
        .select('id')
        .single();
      if (maskRef) referenceAssetIds.push(maskRef.id);
    }

    // ── Create task ───────────────────────────────────────────────────
    // Note: reference_image_urls stored as URIs count only (not the full
    // base64 data) to avoid bloating the JSON column.
    const task = await createTask({
      user_id: auth.userId,
      model_code: modelCode,
      task_type: 'image_to_image',
      prompt,
      request_parameters: {
        size,
        n,
        mode: 'edit',
        source_image_key: imageObjectKey,
        mask_image_key: maskObjectKey,
        source_image_dims: imageDims,
        mask_image_dims: maskDims,
        reference_image_count: referenceBuffers.length,
        reference_image_keys: referenceObjectKeys,
        has_mask: !!maskBuffer,
        response_format: responseFormat,
      },
      reference_asset_ids: referenceAssetIds.length > 0 ? referenceAssetIds : undefined,
      custom_headers: forwardHeaders,
    });

    // Update the placeholder task_id on references
    for (const refId of referenceAssetIds) {
      await supabase
        .from('generation_references')
        .update({ task_id: task.id })
        .eq('id', refId);
    }

    // ── Execute synchronously (OpenAI-compatible) ─────────────────────
    const timeoutMs = (modelConfig.timeout_seconds || 120) * 1000;
    const result = await executeTaskSync(task.id, {
      timeoutMs,
      reference_image_urls: referenceImageUris,
      custom_headers: forwardHeaders,
    });

    // ── Build OpenAI-compatible response ──────────────────────────────
    const data = await Promise.all(
      (result.generated_urls || []).map(async (signedUrl: string) => {
        if (responseFormat === 'b64_json') {
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

    // ── Log provenance ────────────────────────────────────────────────
    logger.info('Image edit completed', {
      request_id: requestId,
      task_id: task.id,
      user_id: auth.userId,
      model_code: modelCode,
      size,
      n,
      has_mask: !!maskBuffer,
      reference_image_count: referenceBuffers.length,
      source_dims: `${imageDims.width}x${imageDims.height}`,
      generated_count: data.length,
      action: 'image_edit',
    });

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
        INVALID_FILE: 400,
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

    logger.error('Unhandled error in images/edits', {
      error: err instanceof Error ? err.message : 'Unknown',
      request_id: requestId,
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
