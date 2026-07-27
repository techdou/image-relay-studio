import { getSupabaseClient } from '@/storage/database/supabase-client';
import {
  AppError,
  ErrorCodes,
  type ErrorCode,
  isRetryableProviderError,
} from '@/server/errors';
import { logger } from '@/server/logging';
import { canTransition, type TaskStatus, type TaskType } from './state-machine';
import { generateWithModel, getModelConfig } from '@/server/providers/images';
import {
  uploadFile,
  deleteFile,
  generateSignedUrl,
  assertSafeUrl,
  fetchToBuffer,
  MAX_DOWNLOAD_BYTES,
} from '@/server/storage';
import type { ProviderGenerationRequest } from '@/server/providers/images/types';

/**
 * Narrows an unknown caught value to a PostgREST/Postgres-style error
 * with `code` and `message` fields. Supabase JS client surfaces these
 * as objects with those string fields (not instances of Error).
 */
function isPostgresLikeError(err: unknown): err is { code: string; message: string } {
  if (!err || typeof err !== 'object') return false;
  const obj = err as Record<string, unknown>;
  return (
    (typeof obj.code === 'string' || obj.code === undefined) &&
    (typeof obj.message === 'string' || obj.message === undefined)
  );
}

function errorMessageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (isPostgresLikeError(err) && typeof err.message === 'string') return err.message;
  return 'Unknown error';
}

export interface CreateTaskParams {
  user_id: string;
  model_code: string;
  task_type: TaskType;
  prompt: string;
  request_parameters?: Record<string, unknown>;
  idempotency_key?: string;
  reference_asset_ids?: string[];
  custom_headers?: Record<string, string>;
  api_key_id?: string;
  /**
   * Origin of the request. Stored on usage_records.request_source.
   * Defaults to 'web'. Do NOT infer from custom_headers (those can be
   * spoofed by the client).
   */
  requestSource?: 'api' | 'web';
}

export interface GenerationTask {
  id: string;
  user_id: string;
  model_config_id: string;
  task_type: TaskType;
  status: TaskStatus;
  prompt: string;
  request_parameters: Record<string, unknown> | null;
  idempotency_key: string | null;
  provider_request_id: string | null;
  provider_task_id: string | null;
  attempt_count: number;
  progress: number | null;
  queued_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  error_code: string | null;
  error_message: string | null;
  error_details: Record<string, unknown> | null;
  latency_ms: number | null;
  cancelled_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function createTask(params: CreateTaskParams): Promise<GenerationTask> {
  const client = getSupabaseClient();
  const modelConfig = await getModelConfig(params.model_code);
  const requestSource: 'api' | 'web' = params.requestSource ?? 'web';
  const requestedCount = Number(params.request_parameters?.n ?? 1);

  // Ensure a quota row exists before entering the reservation transaction.
  // ignoreDuplicates makes concurrent first requests safe.
  const { error: quotaInitError } = await client
    .from('user_quotas')
    .upsert(
      { user_id: params.user_id },
      { onConflict: 'user_id', ignoreDuplicates: true }
    );
  if (quotaInitError) {
    throw new AppError(ErrorCodes.INTERNAL_ERROR, 'Failed to initialize user quota');
  }

  const { data: reservation, error: reservationError } = await client.rpc(
    'reserve_generation_task',
    {
      p_user_id: params.user_id,
      p_model_config_id: modelConfig.id,
      p_task_type: params.task_type,
      p_prompt: params.prompt,
      p_request_parameters: params.request_parameters || {},
      p_idempotency_key: params.idempotency_key || null,
      p_request_source: requestSource,
      p_requested_count: requestedCount,
      p_api_key_id: params.api_key_id || null,
    }
  );

  if (reservationError || !reservation) {
    const message = reservationError?.message || 'Task reservation returned no data';
    if (message.includes('IRS_DAILY_QUOTA_EXCEEDED')) {
      throw new AppError(ErrorCodes.QUOTA_EXCEEDED, 'Daily image generation quota exceeded');
    }
    if (message.includes('IRS_MONTHLY_QUOTA_EXCEEDED')) {
      throw new AppError(ErrorCodes.QUOTA_EXCEEDED, 'Monthly image generation quota exceeded');
    }
    if (message.includes('IRS_CONCURRENCY_LIMITED')) {
      throw new AppError(ErrorCodes.CONCURRENCY_LIMITED, 'Maximum concurrent tasks reached');
    }
    if (message.includes('IRS_MODEL_DISABLED')) {
      throw new AppError(ErrorCodes.MODEL_DISABLED, 'Model is disabled');
    }
    logger.error('Failed to reserve generation task', {
      error: message,
      user_id: params.user_id,
    });
    throw new AppError(ErrorCodes.INTERNAL_ERROR, 'Failed to create generation task');
  }

  const result = reservation as unknown as {
    created: boolean;
    task: GenerationTask;
  };
  const task = result.task;

  // Link pre-uploaded reference assets to this task
  if (result.created && params.reference_asset_ids && params.reference_asset_ids.length > 0) {
    const { error: referenceLinkError } = await client
      .from('generation_references')
      .update({ task_id: task.id })
      .in('id', params.reference_asset_ids)
      .eq('user_id', params.user_id)
      .is('task_id', null);
    if (referenceLinkError) {
      throw new AppError(ErrorCodes.INTERNAL_ERROR, 'Failed to link generation references');
    }
  }

  logger.info('Task created', {
    task_id: task.id,
    user_id: params.user_id,
    model_code: params.model_code,
    request_source: requestSource,
    idempotent_replay: !result.created,
    action: 'create_task',
  });

  return task;
}

export async function executeTask(taskId: string, customHeaders?: Record<string, string>, directReferenceUrls?: string[]): Promise<void> {
  const client = getSupabaseClient();

  // Fetch task
  const { data: task, error: fetchError } = await client
    .from('generation_tasks')
    .select('*')
    .eq('id', taskId)
    .single();

  if (fetchError || !task) {
    logger.error('Task not found for execution', { task_id: taskId });
    return;
  }

  if (!canTransition(task.status as TaskStatus, 'running')) {
    logger.warn('Task cannot transition to running', { task_id: taskId, status: task.status });
    return;
  }

  const startTime = Date.now();
  let modelCode: string;
  let modelConfig: Awaited<ReturnType<typeof getModelConfig>>;
  try {
    modelCode = await getTaskModelCode(task.model_config_id);
    modelConfig = await getModelConfig(modelCode);
  } catch (error) {
    await markQueuedTaskFailed(
      taskId,
      error instanceof AppError ? error.code : ErrorCodes.MODEL_NOT_FOUND,
      errorMessageOf(error),
      Date.now() - startTime
    );
    return;
  }
  const queueDeadline = Date.now() + Math.max(30_000, modelConfig.timeout_seconds * 1000);
  let claimed = false;

  // The RPC serializes claims per model in Postgres, so
  // max_provider_concurrency is enforced across all application instances.
  while (Date.now() < queueDeadline) {
    const { data, error } = await client.rpc('claim_generation_task', {
      p_task_id: taskId,
    });
    if (error) {
      await markQueuedTaskFailed(
        taskId,
        ErrorCodes.INTERNAL_ERROR,
        'Failed to claim provider execution slot',
        Date.now() - startTime
      );
      return;
    }
    if (data === true) {
      claimed = true;
      break;
    }

    const { data: latest } = await client
      .from('generation_tasks')
      .select('status')
      .eq('id', taskId)
      .single();
    if (!latest || latest.status !== 'queued') {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (!claimed) {
    await markQueuedTaskFailed(
      taskId,
      ErrorCodes.PROVIDER_TIMEOUT,
      'Timed out waiting for provider concurrency slot',
      Date.now() - startTime
    );
    return;
  }

  try {
    // Get reference image URLs for provider
    // Priority: 1) directReferenceUrls (from edits endpoint), 2) stored in request_parameters,
    // 3) from generation_references via object storage
    let referenceUrls: string[] = [];

    if (directReferenceUrls && directReferenceUrls.length > 0) {
      // Direct reference URLs passed from the edits endpoint (base64 data URIs)
      referenceUrls = directReferenceUrls;
    } else if (task.request_parameters?.reference_image_urls) {
      const urls = task.request_parameters.reference_image_urls as string[];
      // If already data URIs, pass through directly
      // Otherwise fetch and convert to data URIs (with SSRF + size guards)
      referenceUrls = await Promise.all(
        urls.map(async (url) => fetchToDataUri(url))
      );
    } else if (task.request_parameters?.reference_asset_ids) {
      const assetIds = task.request_parameters.reference_asset_ids as string[];
      // Try generation_assets first, then generation_references
      const { data: refs } = await client
        .from('generation_assets')
        .select('object_key')
        .in('id', assetIds)
        .eq('user_id', task.user_id);

      if (refs && refs.length > 0) {
        referenceUrls = await Promise.all(
          refs.map(async (r) => fetchToDataUri(await generateSignedUrl(r.object_key, 300)))
        );
      } else {
        // Fall back to generation_references
        const { data: refs2 } = await client
          .from('generation_references')
          .select('object_key')
          .in('id', assetIds)
          .eq('user_id', task.user_id);

        if (refs2 && refs2.length > 0) {
          referenceUrls = await Promise.all(
            refs2.map(async (r) => fetchToDataUri(await generateSignedUrl(r.object_key, 300)))
          );
        }
      }
    }

    const requestedCount = Number(task.request_parameters?.n ?? 1);
    if (requestedCount > 1 && !modelConfig.supports_sequential_generation) {
      throw new AppError(
        ErrorCodes.INVALID_REQUEST,
        'Model no longer supports multiple images per request'
      );
    }

    // Build provider request
    const providerRequest: ProviderGenerationRequest = {
      prompt: task.prompt,
      model_id: (modelConfig.external_model_id as string) || '',
      size: (task.request_parameters?.size as string) || '2K',
      watermark: task.request_parameters?.visible_watermark as boolean ?? false,
      reference_image_urls: referenceUrls.length > 0 ? referenceUrls : undefined,
      sequential_generation: requestedCount > 1 ? 'auto' : 'disabled',
      sequential_max_images: requestedCount,
      custom_headers: customHeaders,
    };

    // Call provider
    const result = await generateWithModel(
      modelCode,
      providerRequest
    );

    const latencyMs = Date.now() - startTime;

    if (result.success) {
      const providerOutputs = [
        ...result.image_urls,
        ...result.image_b64_list,
      ].slice(0, requestedCount);

      if (providerOutputs.length < requestedCount) {
        throw new AppError(
          ErrorCodes.PROVIDER_ERROR,
          `Provider returned ${providerOutputs.length} of ${requestedCount} requested images`
        );
      }

      // Persist generated images to object storage
      let generatedCount = 0;
      const persistedObjectKeys: string[] = [];
      for (const [idx, urlOrB64] of providerOutputs.entries()) {

        try {
          let objectKey: string;
          const targetKey = `users/${task.user_id}/generated/${new Date().getFullYear()}/${(new Date().getMonth() + 1).toString().padStart(2, '0')}/${taskId}_${idx}.png`;

          if (urlOrB64.startsWith('http')) {
            // Download from provider URL and persist. fetchToBuffer
            // applies SSRF + 20MB size guard. Provider URLs are trusted
            // by convention, but the guard still catches redirect
            // chains to private hosts.
            const { buffer, contentType } = await fetchToBuffer(urlOrB64);
            objectKey = await uploadFile(buffer, targetKey, contentType);
          } else {
            // Base64 - decode and upload
            const buffer = Buffer.from(urlOrB64, 'base64');
            if (buffer.byteLength > MAX_DOWNLOAD_BYTES) {
              throw new AppError(ErrorCodes.FILE_TOO_LARGE, 'Decoded asset exceeds size limit');
            }
            objectKey = await uploadFile(buffer, targetKey, 'image/png');
          }

          // Create asset record
          const { error: assetInsertError } = await client.from('generation_assets').insert({
            task_id: taskId,
            user_id: task.user_id,
            object_key: objectKey,
            mime_type: 'image/png',
            ai_generated: true,
            visible_watermark_disabled: !(task.request_parameters?.visible_watermark as boolean ?? false),
            favorite: false,
          });
          if (assetInsertError) {
            await deleteFile(objectKey).catch(() => false);
            throw assetInsertError;
          }

          persistedObjectKeys.push(objectKey);
          generatedCount++;
        } catch (assetError) {
          logger.error('Failed to persist generated asset', {
            task_id: taskId,
            asset_index: idx,
            error: assetError instanceof Error ? assetError.message : 'Unknown',
          });
        }
      }

      if (generatedCount !== requestedCount) {
        await cleanupTaskAssets(taskId, persistedObjectKeys);
        throw new AppError(
          ErrorCodes.STORAGE_ERROR,
          `Persisted ${generatedCount} of ${requestedCount} generated images`
        );
      }

      // Optimistic lock on running -> succeeded. If a parallel worker
      // somehow flipped status, we don't overwrite it.
      const { data: succeeded } = await client
        .from('generation_tasks')
        .update({
          status: 'succeeded',
          completed_at: new Date().toISOString(),
          latency_ms: latencyMs,
          provider_request_id: result.usage ? `gen_${Date.now()}` : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', taskId)
        .eq('status', 'running')
        .select();

      if (succeeded && succeeded.length > 0) {
        // Update usage record
        const { error: usageUpdateError } = await client
          .from('usage_records')
          .update({
            generated_image_count: generatedCount,
            status: 'succeeded',
            latency_ms: latencyMs,
          })
          .eq('task_id', taskId);
        if (usageUpdateError) {
          logger.error('Failed to finalize usage record', {
            task_id: taskId,
            error: usageUpdateError.message,
          });
        }

        logger.info('Task completed successfully', {
          task_id: taskId,
          latency_ms: latencyMs,
          generated_count: generatedCount,
          action: 'task_succeeded',
        });
      } else {
        await cleanupTaskAssets(taskId, persistedObjectKeys);
        logger.warn('Task succeeded update skipped (status changed concurrently)', {
          task_id: taskId,
          action: 'task_succeeded_skipped',
        });
      }
    } else {
      // Provider returned errors
      const errorMsg = result.error_messages.join('; ');
      await markTaskFailed(taskId, ErrorCodes.PROVIDER_ERROR, errorMsg, latencyMs);
    }
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const errorCode: ErrorCode = error instanceof AppError ? error.code : ErrorCodes.PROVIDER_ERROR;
    const errorMsg = error instanceof Error ? error.message : 'Unknown provider error';
    await markTaskFailed(taskId, errorCode, errorMsg, latencyMs);
  }
}

async function cleanupTaskAssets(taskId: string, objectKeys: string[]): Promise<void> {
  const client = getSupabaseClient();
  const { error } = await client
    .from('generation_assets')
    .delete()
    .eq('task_id', taskId);
  if (error) {
    logger.error('Failed to remove partial asset records', {
      task_id: taskId,
      error: error.message,
    });
  }
  await Promise.allSettled(objectKeys.map((key) => deleteFile(key)));
}

/**
 * Fetch a URL and convert it to a data: URI suitable for embedding in
 * provider requests. Applies SSRF + size guards via fetchToBuffer.
 * Returns the original value only if it is already a data: URI (which
 * is by definition safe to embed).
 */
async function fetchToDataUri(url: string): Promise<string> {
  if (url.startsWith('data:')) {
    return url;
  }
  // assertSafeUrl runs inside fetchToBuffer; we call it here too so the
  // error is thrown before any network call and surfaces a clean
  // SSRF_BLOCKED code.
  assertSafeUrl(url);
  const { buffer, contentType } = await fetchToBuffer(url);
  return `data:${contentType};base64,${buffer.toString('base64')}`;
}

/**
 * Mark a task as failed. Uses an optimistic lock (status='running') so
 * that a concurrently-cancelled or already-terminal task is not
 * overwritten. Records the retryable flag in error_message as JSON so
 * retryTask consumers (and ops dashboards) can decide whether to retry.
 */
async function markTaskFailed(
  taskId: string,
  errorCode: ErrorCode | string,
  errorMessage: string,
  latencyMs: number
): Promise<void> {
  const client = getSupabaseClient();

  const retryable = isRetryableProviderError(errorCode);
  // Embed is_retryable in error_message as JSON. Schema migration to a
  // dedicated is_retryable column is owned by Agent 2; for now we
  // serialize {message, is_retryable, code} so consumers can parse it.
  const structuredError = JSON.stringify({
    message: errorMessage,
    code: errorCode,
    is_retryable: retryable,
  });

  const { data: updated, error: taskUpdateError } = await client
    .from('generation_tasks')
    .update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_code: errorCode,
      error_message: structuredError,
      latency_ms: latencyMs,
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId)
    .eq('status', 'running')
    .select();

  if (taskUpdateError) {
    logger.error('Failed to mark task as failed', {
      task_id: taskId,
      error: taskUpdateError.message,
    });
    return;
  }

  if (!updated || updated.length === 0) {
    logger.warn('Task failed update skipped (status changed concurrently)', {
      task_id: taskId,
      error_code: errorCode,
      action: 'task_failed_skipped',
    });
    return;
  }

  const { error: usageUpdateError } = await client
    .from('usage_records')
    .update({
      status: 'failed',
      latency_ms: latencyMs,
    })
    .eq('task_id', taskId);
  if (usageUpdateError) {
    logger.error('Failed to mark usage record as failed', {
      task_id: taskId,
      error: usageUpdateError.message,
    });
  }

  logger.error('Task failed', {
    task_id: taskId,
    error_code: errorCode,
    error_message: errorMessage,
    is_retryable: retryable,
    action: 'task_failed',
  });
}

async function markQueuedTaskFailed(
  taskId: string,
  errorCode: ErrorCode,
  errorMessage: string,
  latencyMs: number
): Promise<void> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('generation_tasks')
    .update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_code: errorCode,
      error_message: JSON.stringify({
        message: errorMessage,
        code: errorCode,
        is_retryable: isRetryableProviderError(errorCode),
      }),
      latency_ms: latencyMs,
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId)
    .eq('status', 'queued')
    .select('id');

  if (error || !data || data.length === 0) {
    logger.warn('Queued task failure update was skipped', {
      task_id: taskId,
      error: error?.message,
    });
    return;
  }

  const { error: usageError } = await client
    .from('usage_records')
    .update({ status: 'failed', latency_ms: latencyMs })
    .eq('task_id', taskId);
  if (usageError) {
    logger.error('Failed to release queued usage reservation', {
      task_id: taskId,
      error: usageError.message,
    });
  }
}

async function getTaskModelCode(modelConfigId: string): Promise<string> {
  const client = getSupabaseClient();
  const { data } = await client
    .from('model_configs')
    .select('code')
    .eq('id', modelConfigId)
    .single();

  return data?.code || 'unknown';
}

export async function getTask(taskId: string, userId: string, isAdmin: boolean): Promise<GenerationTask | null> {
  const client = getSupabaseClient();
  let query = client
    .from('generation_tasks')
    .select('*')
    .eq('id', taskId);

  if (!isAdmin) {
    query = query.eq('user_id', userId);
  }

  const { data, error } = await query.single();
  if (error || !data) return null;
  return data as unknown as GenerationTask;
}

export async function getUserTasks(
  userId: string,
  options: {
    status?: TaskStatus;
    task_type?: TaskType;
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ tasks: GenerationTask[]; total: number }> {
  const client = getSupabaseClient();
  let query = client
    .from('generation_tasks')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (options.status) query = query.eq('status', options.status);
  if (options.task_type) query = query.eq('task_type', options.task_type);
  if (options.limit) query = query.limit(options.limit);
  if (options.offset) query = query.range(options.offset, options.offset + (options.limit || 20) - 1);

  const { data, error, count } = await query;

  if (error) {
    logger.error('Failed to fetch user tasks', { error: error.message, user_id: userId });
    return { tasks: [], total: 0 };
  }

  return { tasks: (data || []) as unknown as GenerationTask[], total: count || 0 };
}

/**
 * Execute a task synchronously and wait for completion.
 * Returns the task with generated asset URLs upon success.
 * Throws on failure or timeout.
 */
export async function executeTaskSync(
  taskId: string,
  options: {
    timeoutMs?: number;
    pollIntervalMs?: number;
    /** Forwarded request headers from the incoming HTTP request (required by SDK).
     *  Extract via HeaderUtils.extractForwardHeaders(request.headers). */
    custom_headers?: Record<string, string>;
    /** Direct reference image URLs (e.g. base64 data URIs) to pass to the provider.
     *  Used by the edits endpoint to avoid storing large base64 data in the database. */
    reference_image_urls?: string[];
  } = {}
): Promise<GenerationTask & { generated_urls?: string[] }> {
  const timeoutMs = options.timeoutMs || 120_000;
  const pollIntervalMs = options.pollIntervalMs || 2000;
  const deadline = Date.now() + timeoutMs;

  // Kick off execution (non-blocking), passing custom headers and reference URLs
  executeTask(taskId, options.custom_headers, options.reference_image_urls).catch((err) => {
    logger.error('executeTaskSync: background execution failed', {
      task_id: taskId,
      error: err instanceof Error ? err.message : 'Unknown',
    });
  });

  const client = getSupabaseClient();

  // Poll until terminal state or timeout
  while (Date.now() < deadline) {
    const { data: task } = await client
      .from('generation_tasks')
      .select('status, error_code, error_message')
      .eq('id', taskId)
      .single();

    if (!task) {
      throw new AppError(ErrorCodes.TASK_NOT_FOUND, 'Task not found');
    }

    if (task.status === 'succeeded') {
      // Fetch generated assets
      const { data: assets } = await client
        .from('generation_assets')
        .select('object_key')
        .eq('task_id', taskId)
        .is('deleted_at', null);

      const generated_urls: string[] = [];
      if (assets) {
        for (const asset of assets) {
          try {
            const url = await generateSignedUrl(asset.object_key, 3600);
            generated_urls.push(url);
          } catch {
            // Skip assets we can't sign
          }
        }
      }

      const { data: fullTask } = await client
        .from('generation_tasks')
        .select('*')
        .eq('id', taskId)
        .single();

      return { ...(fullTask as unknown as GenerationTask), generated_urls };
    }

    if (task.status === 'failed') {
      throw new AppError(
        (task.error_code as ErrorCode) || ErrorCodes.PROVIDER_ERROR,
        task.error_message || 'Image generation failed'
      );
    }

    if (task.status === 'cancelled') {
      throw new AppError(ErrorCodes.INVALID_TASK_STATE, 'Task was cancelled');
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new AppError(ErrorCodes.PROVIDER_TIMEOUT, `Image generation timed out after ${timeoutMs}ms`);
}

export async function cancelTask(taskId: string, userId: string, isAdmin: boolean): Promise<void> {
  const client = getSupabaseClient();
  const { data, error } = await client.rpc('cancel_generation_task', {
    p_task_id: taskId,
    p_actor_user_id: userId,
    p_is_admin: isAdmin,
  });
  if (error || data !== true) {
    const message = error?.message || '';
    if (message.includes('IRS_TASK_NOT_FOUND')) {
      throw new AppError(ErrorCodes.TASK_NOT_FOUND, 'Task not found');
    }
    if (message.includes('IRS_FORBIDDEN')) {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Cannot cancel another user\'s task');
    }
    if (message.includes('IRS_INVALID_TASK_STATE')) {
      throw new AppError(ErrorCodes.INVALID_TASK_STATE, 'Task cannot be cancelled in its current state');
    }
    throw new AppError(ErrorCodes.INTERNAL_ERROR, 'Failed to cancel task');
  }
}

export async function retryTask(taskId: string, userId: string, isAdmin: boolean): Promise<GenerationTask> {
  const client = getSupabaseClient();
  const task = await getTask(taskId, userId, isAdmin);
  if (!task) throw new AppError(ErrorCodes.TASK_NOT_FOUND, 'Task not found');

  if (task.status !== 'failed') {
    throw new AppError(ErrorCodes.INVALID_TASK_STATE, 'Only failed tasks can be retried');
  }

  const nonRetryableCodes = new Set<ErrorCode>([
    ErrorCodes.INVALID_REQUEST,
    ErrorCodes.MODEL_NOT_FOUND,
    ErrorCodes.MODEL_NOT_ALLOWED,
    ErrorCodes.SIZE_NOT_ALLOWED,
    ErrorCodes.QUOTA_EXCEEDED,
    ErrorCodes.INVALID_FILE,
  ]);
  if (task.error_code && nonRetryableCodes.has(task.error_code as ErrorCode)) {
    throw new AppError(ErrorCodes.INVALID_TASK_STATE, 'This failure is not retryable');
  }

  const { data: queued, error } = await client.rpc('retry_generation_task', {
    p_task_id: taskId,
    p_actor_user_id: userId,
    p_is_admin: isAdmin,
  });
  if (error || !queued) {
    const message = error?.message || '';
    if (message.includes('IRS_DAILY_QUOTA_EXCEEDED') || message.includes('IRS_MONTHLY_QUOTA_EXCEEDED')) {
      throw new AppError(ErrorCodes.QUOTA_EXCEEDED, 'Image generation quota exceeded');
    }
    if (message.includes('IRS_CONCURRENCY_LIMITED')) {
      throw new AppError(ErrorCodes.CONCURRENCY_LIMITED, 'Maximum concurrent tasks reached');
    }
    if (message.includes('IRS_INVALID_TASK_STATE')) {
      throw new AppError(ErrorCodes.INVALID_TASK_STATE, 'Task is no longer retryable');
    }
    throw new AppError(ErrorCodes.INTERNAL_ERROR, 'Failed to retry task');
  }

  // Execute immediately (inline executor)
  executeTask(taskId).catch((err) => {
    logger.error('Retry task execution failed', {
      task_id: taskId,
      error: err instanceof Error ? err.message : 'Unknown',
    });
  });

  return queued as unknown as GenerationTask;
}
