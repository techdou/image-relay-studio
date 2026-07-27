import { NextRequest, NextResponse } from 'next/server';
import {
  authenticateRequest,
  enforceGenerationRateLimit,
  requireScope,
} from '@/server/api-helpers';
import { AppError, ErrorCodes, errorStatusMap } from '@/server/errors';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { createTask, executeTaskSync } from '@/server/tasks/executor';
import { uploadFile } from '@/server/storage';
import { logger } from '@/server/logging';
import { HeaderUtils } from 'coze-coding-dev-sdk';
import {
  detectImageMimeType,
  readImageDimensions,
} from '@/server/images/image-utils';
import {
  imageEditFieldsSchema,
  parseInput,
} from '@/server/validation/schemas';

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
    requireScope(auth, 'images:write');
    enforceGenerationRateLimit(auth.userId);

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
    const initialImage = formData.get('image');
    let imageFile: File | null = initialImage instanceof File ? initialImage : null;
    const maskValue = formData.get('mask');
    const maskFile = maskValue instanceof File ? maskValue : null;
    const fields = parseInput(imageEditFieldsSchema, {
      model: formData.get('model') || undefined,
      prompt: formData.get('prompt'),
      size: formData.get('size') || undefined,
      n: formData.get('n') || undefined,
      response_format: formData.get('response_format') || undefined,
    });
    const {
      model: rawModel,
      prompt,
      size: rawSize,
      n,
      response_format: responseFormat,
    } = fields;

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

    // ── Validate required fields ───────────────────────────────────────
    if (!imageFile) {
      throw new AppError(ErrorCodes.INVALID_REQUEST, 'image is required');
    }
    // ── Validate image file ────────────────────────────────────────────
    if (!ALLOWED_MIME.includes(imageFile.type) && !imageFile.type.startsWith('image/')) {
      throw new AppError(ErrorCodes.INVALID_FILE, `image must be a valid image file (PNG, JPEG, or WebP), got: ${imageFile.type}`);
    }
    if (imageFile.size > MAX_IMAGE_SIZE) {
      throw new AppError(ErrorCodes.INVALID_FILE, 'image must be less than 4MB');
    }

    const imageBuffer = Buffer.from(await imageFile.arrayBuffer());
    // Detect actual MIME from magic bytes (don't trust Content-Type from browser)
    const actualImageMime = detectImageMimeType(imageBuffer);
    if (!actualImageMime) {
      throw new AppError(ErrorCodes.INVALID_FILE, 'image content is not a supported PNG, JPEG, or WebP file');
    }
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
      const actualRefMime = detectImageMimeType(refBuf);
      if (!actualRefMime) {
        throw new AppError(ErrorCodes.INVALID_FILE, 'reference_image content is not a supported image');
      }
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
        const actualMaskMime = detectImageMimeType(maskBuffer);
        if (!actualMaskMime) {
          throw new AppError(ErrorCodes.INVALID_FILE, 'mask content is not a supported image');
        }
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

    const modelCode = resolveModel(rawModel);
    const size = resolveSize(rawSize);

    // ── Server-side checks (reuse generations logic) ───────────────────
    const supabase = getSupabaseClient();

    // 1. Check generation enabled (fail-closed: missing = disabled)
    const { data: genSetting } = await supabase
      .from('system_settings')
      .select('value')
      .eq('key', 'generation_enabled')
      .single();
    if (genSetting?.value !== 'true') {
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
    if (n > 1 && !modelConfig.supports_sequential_generation) {
      throw new AppError(ErrorCodes.INVALID_REQUEST, 'This model does not support multiple images per request');
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

    const { data: sourceRef, error: sourceRefError } = await supabase
      .from('generation_references')
      .insert({
        task_id: null,
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
    if (sourceRefError || !sourceRef) {
      throw new AppError(ErrorCodes.INTERNAL_ERROR, 'Failed to store source image provenance');
    }
    if (sourceRef) referenceAssetIds.push(sourceRef.id);

    for (let i = 0; i < referenceBuffers.length; i++) {
      const ref = referenceBuffers[i];
      const { data: refData, error: refInsertError } = await supabase
        .from('generation_references')
        .insert({
          task_id: null,
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
      if (refInsertError || !refData) {
        throw new AppError(ErrorCodes.INTERNAL_ERROR, 'Failed to store reference image provenance');
      }
      if (refData) referenceAssetIds.push(refData.id);
    }

    if (maskObjectKey) {
      const { data: maskRef, error: maskRefError } = await supabase
        .from('generation_references')
        .insert({
          task_id: null,
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
      if (maskRefError || !maskRef) {
        throw new AppError(ErrorCodes.INTERNAL_ERROR, 'Failed to store mask provenance');
      }
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
        reference_asset_ids: referenceAssetIds,
        has_mask: !!maskBuffer,
        response_format: responseFormat,
      },
      reference_asset_ids: referenceAssetIds.length > 0 ? referenceAssetIds : undefined,
      custom_headers: forwardHeaders,
      requestSource: auth.authMethod === 'apikey' ? 'api' : 'web',
      api_key_id: auth.apiKeyId,
    });

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
      const status = errorStatusMap[err.code] || 500;
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
