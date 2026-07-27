import { getSupabaseClient } from '@/storage/database/supabase-client';
import { AppError, ErrorCodes, type ErrorCode } from '@/server/errors';
import { logger } from '@/server/logging';
import { canTransition, type TaskStatus, type TaskType } from './state-machine';
import { generateWithModel, getModelConfig } from '@/server/providers/images';
import { uploadFile, generateSignedUrl, deleteFile } from '@/server/storage';
import type { ProviderGenerationRequest } from '@/server/providers/images/types';

export interface CreateTaskParams {
  user_id: string;
  model_code: string;
  task_type: TaskType;
  prompt: string;
  request_parameters?: Record<string, unknown>;
  idempotency_key?: string;
  reference_asset_ids?: string[];
  custom_headers?: Record<string, string>;
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

  // Check idempotency
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

  const { data, error } = await client
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

  if (error || !data) {
    logger.error('Failed to create task', { error: error?.message, user_id: params.user_id });
    throw new AppError(ErrorCodes.INTERNAL_ERROR, 'Failed to create generation task');
  }

  // Create usage record
  await client.from('usage_records').insert({
    user_id: params.user_id,
    task_id: data.id,
    model_config_id: modelConfig.id,
    request_source: params.custom_headers ? 'api' : 'web',
    requested_image_count: (params.request_parameters?.n as number) || 1,
    status: 'queued',
  });

  // Link pre-uploaded reference assets to this task
  if (params.reference_asset_ids && params.reference_asset_ids.length > 0) {
    await client
      .from('generation_references')
      .update({ task_id: data.id })
      .in('id', params.reference_asset_ids)
      .eq('user_id', params.user_id)
      .is('task_id', null);
  }

  logger.info('Task created', {
    task_id: data.id,
    user_id: params.user_id,
    model_code: params.model_code,
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

  // Update to running
  const startTime = Date.now();
  await client
    .from('generation_tasks')
    .update({
      status: 'running',
      started_at: new Date().toISOString(),
      attempt_count: task.attempt_count + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId);

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
      // Otherwise fetch and convert to data URIs
      referenceUrls = await Promise.all(
        urls.map(async (url) => {
          if (url.startsWith('data:')) {
            return url; // Already a data URI, pass through
          }
          try {
            const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const buffer = Buffer.from(await resp.arrayBuffer());
            const contentType = resp.headers.get('content-type') || 'image/png';
            return `data:${contentType};base64,${buffer.toString('base64')}`;
          } catch {
            return url;
          }
        })
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
          refs.map(async (r) => {
            const url = await generateSignedUrl(r.object_key, 300);
            try {
              const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
              if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
              const buffer = Buffer.from(await resp.arrayBuffer());
              const contentType = resp.headers.get('content-type') || 'image/png';
              return `data:${contentType};base64,${buffer.toString('base64')}`;
            } catch {
              return url;
            }
          })
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
            refs2.map(async (r) => {
              const url = await generateSignedUrl(r.object_key, 300);
              try {
                const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const buffer = Buffer.from(await resp.arrayBuffer());
                const contentType = resp.headers.get('content-type') || 'image/png';
                return `data:${contentType};base64,${buffer.toString('base64')}`;
              } catch {
                return url;
              }
            })
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

          if (urlOrB64.startsWith('http')) {
            // Download from provider URL and persist
            const targetKey = `users/${task.user_id}/generated/${new Date().getFullYear()}/${(new Date().getMonth() + 1).toString().padStart(2, '0')}/${taskId}_${idx}.png`;
            objectKey = await uploadFile(
              Buffer.from(await (await fetch(urlOrB64)).arrayBuffer()),
              targetKey,
              'image/png'
            );
          } else {
            // Base64 - decode and upload
            const buffer = Buffer.from(urlOrB64, 'base64');
            const targetKey = `users/${task.user_id}/generated/${new Date().getFullYear()}/${(new Date().getMonth() + 1).toString().padStart(2, '0')}/${taskId}_${idx}.png`;
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

      // Update task to succeeded
      await client
        .from('generation_tasks')
        .update({
          status: 'succeeded',
          completed_at: new Date().toISOString(),
          latency_ms: latencyMs,
          provider_request_id: result.usage ? `gen_${Date.now()}` : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', taskId);

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
      // Provider returned errors
      const errorMsg = result.error_messages.join('; ');
      await markTaskFailed(taskId, ErrorCodes.PROVIDER_ERROR, errorMsg, latencyMs);
    }
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const errorCode = error instanceof AppError ? error.code : ErrorCodes.PROVIDER_ERROR;
    const errorMsg = error instanceof Error ? error.message : 'Unknown provider error';
    await markTaskFailed(taskId, errorCode, errorMsg, latencyMs);
  }
}

async function markTaskFailed(
  taskId: string,
  errorCode: string,
  errorMessage: string,
  latencyMs: number
): Promise<void> {
  const client = getSupabaseClient();

  await client
    .from('generation_tasks')
    .update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_code: errorCode,
      error_message: errorMessage,
      latency_ms: latencyMs,
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId);

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

  await client
    .from('generation_tasks')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId);
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

  await client
    .from('generation_tasks')
    .update({
      status: 'queued',
      error_code: null,
      error_message: null,
      error_details: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId);

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
