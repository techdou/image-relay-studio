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
  generateSignedUrl,
  assertSafeUrl,
  fetchToBuffer,
  MAX_DOWNLOAD_BYTES,
} from '@/server/storage';
import type { ProviderGenerationRequest } from '@/server/providers/images/types';

/**
 * PostgreSQL error code for unique_violation. Returned by Supabase when
 * a UNIQUE constraint (e.g. on (user_id, idempotency_key)) is violated.
 */
const PG_UNIQUE_VIOLATION = '23505';

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

/**
 * Inspects an unknown caught error and decides whether it represents a
 * Postgres unique_violation (23505) — either via the structured `code`
 * field or via substring matches on `message` (Supabase wraps 23505 in
 * both shapes depending on whether it came through .single() or not).
 */
function isUniqueViolationError(err: unknown): boolean {
  if (!isPostgresLikeError(err)) return false;
  const code = err.code ?? '';
  const message = (err.message ?? '').toLowerCase();
  return (
    code === PG_UNIQUE_VIOLATION ||
    message.includes(PG_UNIQUE_VIOLATION) ||
    message.includes('duplicate') ||
    message.includes('unique')
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

  // Fast path: most idempotent requests are first-time, so we still try
  // a select-then-insert. The race window is closed by the unique
  // constraint at the DB layer; we additionally catch the 23505
  // violation below to recover gracefully on collision.
  if (params.idempotency_key) {
    const { data: existing } = await client
      .from('generation_tasks')
      .select('*')
      .eq('user_id', params.user_id)
      .eq('idempotency_key', params.idempotency_key)
      .is('deleted_at', null)
      .limit(1);

    if (existing && existing.length > 0) {
      return existing[0] as unknown as GenerationTask;
    }
  }

  const modelConfig = await getModelConfig(params.model_code);

  let data: unknown = null;
  try {
    const insertResult = await client
      .from('generation_tasks')
      .insert({
        user_id: params.user_id,
        model_config_id: modelConfig.id,
        task_type: params.task_type,
        status: 'queued',
        prompt: params.prompt,
        request_parameters: params.request_parameters || {},
        idempotency_key: params.idempotency_key || null,
        attempt_count: 0,
      })
      .select()
      .single();
    if (insertResult.error || !insertResult.data) {
      throw insertResult.error ?? new Error('insert returned no data');
    }
    data = insertResult.data;
  } catch (err: unknown) {
    // 23505 = unique_violation. If the (user_id, idempotency_key) row
    // was inserted by a concurrent request between our SELECT and
    // INSERT, fall back to returning that existing row.
    const isUniqueViolation = isUniqueViolationError(err);

    if (params.idempotency_key && isUniqueViolation) {
      logger.warn('Idempotency conflict on insert, returning existing task', {
        user_id: params.user_id,
        idempotency_key: params.idempotency_key,
        action: 'create_task_idempotency_conflict',
      });
      const { data: existing } = await client
        .from('generation_tasks')
        .select('*')
        .eq('user_id', params.user_id)
        .eq('idempotency_key', params.idempotency_key)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (existing) {
        return existing as unknown as GenerationTask;
      }
    }

    logger.error('Failed to create task', {
      error: errorMessageOf(err),
      user_id: params.user_id,
    });
    throw new AppError(
      isUniqueViolation ? ErrorCodes.IDEMPOTENCY_CONFLICT : ErrorCodes.INTERNAL_ERROR,
      'Failed to create generation task'
    );
  }

  const task = data as { id: string };

  // Create usage record. request_source is taken from the explicit
  // params field — never inferred from custom_headers (which can be
  // spoofed by clients).
  const requestSource: 'api' | 'web' = params.requestSource ?? 'web';
  try {
    await client.from('usage_records').insert({
      user_id: params.user_id,
      task_id: task.id,
      model_config_id: modelConfig.id,
      request_source: requestSource,
      requested_image_count: (params.request_parameters?.n as number) || 1,
      status: 'queued',
    });
  } catch (usageErr: unknown) {
    // If the usage record insert fails (e.g. unique violation from a
    // concurrent duplicate), do not fail the whole create. The task row
    // already exists; downstream code will still see status='queued'.
    logger.error('Failed to create usage record', {
      task_id: task.id,
      error: errorMessageOf(usageErr),
    });
  }

  // Link pre-uploaded reference assets to this task
  if (params.reference_asset_ids && params.reference_asset_ids.length > 0) {
    await client
      .from('generation_references')
      .update({ task_id: task.id })
      .in('id', params.reference_asset_ids)
      .eq('user_id', params.user_id)
      .is('task_id', null);
  }

  logger.info('Task created', {
    task_id: task.id,
    user_id: params.user_id,
    model_code: params.model_code,
    request_source: requestSource,
    action: 'create_task',
  });

  return data as unknown as GenerationTask;
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

  // Optimistic lock: only this worker can flip queued -> running.
  // If another worker already claimed the task (or it was cancelled),
  // the conditional update matches 0 rows and we bail out to avoid
  // duplicate execution / double-billing.
  const startTime = Date.now();
  const { data: claimed, count } = await client
    .from('generation_tasks')
    .update({
      status: 'running',
      started_at: new Date().toISOString(),
      attempt_count: task.attempt_count + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId)
    .eq('status', 'queued')
    .select();

  if (!claimed || claimed.length === 0) {
    logger.warn('Task already claimed or no longer queued', {
      task_id: taskId,
      status: task.status,
      count: count ?? 0,
      action: 'execute_task_skipped',
    });
    return;
  }

  try {
    // Get model config
    const modelConfig = await getModelConfig(
      await getTaskModelCode(task.model_config_id)
    );

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

    // Build provider request
    const providerRequest: ProviderGenerationRequest = {
      prompt: task.prompt,
      model_id: (modelConfig.external_model_id as string) || '',
      size: (task.request_parameters?.size as string) || '2K',
      watermark: task.request_parameters?.visible_watermark as boolean ?? false,
      reference_image_urls: referenceUrls.length > 0 ? referenceUrls : undefined,
      custom_headers: customHeaders,
    };

    // Call provider
    const result = await generateWithModel(
      await getTaskModelCode(task.model_config_id),
      providerRequest
    );

    const latencyMs = Date.now() - startTime;

    if (result.success) {
      // Persist generated images to object storage
      let generatedCount = 0;
      for (const [idx, urlOrB64] of (result.image_urls.length > 0
        ? result.image_urls.map((url, i) => [i, url] as [number, string])
        : result.image_b64_list.map((b64, i) => [i, b64] as [number, string]))) {

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
          await client.from('generation_assets').insert({
            task_id: taskId,
            user_id: task.user_id,
            object_key: objectKey,
            mime_type: 'image/png',
            ai_generated: true,
            visible_watermark_disabled: !(task.request_parameters?.visible_watermark as boolean ?? false),
            favorite: false,
          });

          generatedCount++;
        } catch (assetError) {
          logger.error('Failed to persist generated asset', {
            task_id: taskId,
            asset_index: idx,
            error: assetError instanceof Error ? assetError.message : 'Unknown',
          });
        }
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
        await client
          .from('usage_records')
          .update({
            generated_image_count: generatedCount,
            status: 'succeeded',
            latency_ms: latencyMs,
          })
          .eq('task_id', taskId);

        logger.info('Task completed successfully', {
          task_id: taskId,
          latency_ms: latencyMs,
          generated_count: generatedCount,
          action: 'task_succeeded',
        });
      } else {
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

  const { data: updated } = await client
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

  if (!updated || updated.length === 0) {
    logger.warn('Task failed update skipped (status changed concurrently)', {
      task_id: taskId,
      error_code: errorCode,
      action: 'task_failed_skipped',
    });
    return;
  }

  await client
    .from('usage_records')
    .update({
      status: 'failed',
      latency_ms: latencyMs,
    })
    .eq('task_id', taskId);

  logger.error('Task failed', {
    task_id: taskId,
    error_code: errorCode,
    error_message: errorMessage,
    is_retryable: retryable,
    action: 'task_failed',
  });
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
  const task = await getTask(taskId, userId, isAdmin);
  if (!task) throw new AppError(ErrorCodes.TASK_NOT_FOUND, 'Task not found');

  if (!canTransition(task.status, 'cancelled')) {
    throw new AppError(ErrorCodes.INVALID_TASK_STATE, `Cannot cancel task in ${task.status} state`);
  }

  // Optimistic lock: cancel only succeeds if the task is still in the
  // status we read. A worker that just flipped it to 'running' or a
  // parallel cancel request will cause this update to affect 0 rows,
  // in which case we report the current state to the caller.
  const { data: cancelled } = await client
    .from('generation_tasks')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId)
    .eq('status', task.status)
    .select();

  if (!cancelled || cancelled.length === 0) {
    throw new AppError(
      ErrorCodes.INVALID_TASK_STATE,
      `Task was no longer in ${task.status} state (likely changed concurrently); cancellation aborted.`
    );
  }
}

export async function retryTask(taskId: string, userId: string, isAdmin: boolean): Promise<GenerationTask> {
  const client = getSupabaseClient();
  const task = await getTask(taskId, userId, isAdmin);
  if (!task) throw new AppError(ErrorCodes.TASK_NOT_FOUND, 'Task not found');

  if (task.status !== 'failed') {
    throw new AppError(ErrorCodes.INVALID_TASK_STATE, 'Only failed tasks can be retried');
  }

  if (!canTransition('failed', 'queued')) {
    throw new AppError(ErrorCodes.INVALID_TASK_STATE, 'Task cannot be retried');
  }

  // Optimistic lock: only retry if still failed (prevents double-retry
  // when the user double-clicks).
  const { data: queued } = await client
    .from('generation_tasks')
    .update({
      status: 'queued',
      error_code: null,
      error_message: null,
      error_details: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId)
    .eq('status', 'failed')
    .select();

  if (!queued || queued.length === 0) {
    throw new AppError(
      ErrorCodes.INVALID_TASK_STATE,
      'Task was no longer in failed state (likely retried concurrently); retry aborted.'
    );
  }

  // Sync the usage_records row back to 'queued' so that quota counters
  // (which count queued/running/succeeded) treat this slot as active
  // again. Without this, a failed-then-retried task would be counted
  // twice in the daily/monthly totals (once as failed-but-ignored, once
  // for the new run), or zero times if the failed row had been excluded.
  await client
    .from('usage_records')
    .update({
      status: 'queued',
      updated_at: new Date().toISOString(),
    })
    .eq('task_id', taskId);

  // Execute immediately (inline executor)
  executeTask(taskId).catch((err) => {
    logger.error('Retry task execution failed', {
      task_id: taskId,
      error: err instanceof Error ? err.message : 'Unknown',
    });
  });

  const { data } = await client
    .from('generation_tasks')
    .select('*')
    .eq('id', taskId)
    .single();

  return data as unknown as GenerationTask;
}
