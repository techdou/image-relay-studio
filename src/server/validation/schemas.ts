import { z } from 'zod';
import { AppError, ErrorCodes } from '@/server/errors';

export function parseInput<TSchema extends z.ZodType>(
  schema: TSchema,
  input: unknown
): z.infer<TSchema> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      result.error.issues[0]?.message || 'Invalid request',
      { issues: result.error.issues }
    );
  }
  return result.data;
}

export const loginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

export const createGenerationTaskSchema = z.object({
  model: z.string().min(1, 'Model code is required'),
  prompt: z.string().min(1, 'Prompt is required').max(4000, 'Prompt too long'),
  size: z.string().optional().default('2K'),
  n: z.number().int().min(1).max(4).optional().default(1),
  reference_asset_ids: z.array(z.string().uuid()).optional().default([]),
  visible_watermark: z.boolean().optional().default(false),
  idempotency_key: z.string().max(128).optional(),
  task_type: z.enum(['text_to_image', 'image_to_image']).optional().default('text_to_image'),
});

export const openAiImageGenerationSchema = z.object({
  model: z.string().min(1).optional().default('image-pro'),
  prompt: z.string().trim().min(1, 'Prompt is required').max(4000, 'Prompt too long'),
  size: z.string().min(1).optional(),
  n: z.number().int().min(1).max(4).optional().default(1),
  response_format: z.enum(['url', 'b64_json']).optional().default('url'),
  reference_asset_ids: z.array(z.string().uuid()).max(4).optional().default([]),
  visible_watermark: z.boolean().optional().default(false),
  idempotency_key: z.string().min(1).max(128).optional(),
}).passthrough();

export const imageEditFieldsSchema = z.object({
  model: z.string().min(1).default('dall-e-2'),
  prompt: z.string().trim().min(1, 'Prompt is required').max(4000, 'Prompt too long'),
  size: z.string().min(1).default('1024x1024'),
  n: z.coerce.number().int().min(1).max(4).default(1),
  response_format: z.enum(['url', 'b64_json']).default('url'),
});

export const imageListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(24),
  favorite: z.enum(['true', 'false']).optional(),
  task_id: z.string().uuid().optional(),
});

export const updateImageSchema = z.object({
  favorite: z.boolean(),
}).strict();

export const API_KEY_SCOPES = [
  'images:read',
  'images:write',
  'tasks:read',
  'tasks:write',
  'models:read',
  'usage:read',
  'api_keys:read',
  'api_keys:write',
  'profile:read',
  'profile:write',
] as const;

export const retryTaskSchema = z.object({
  task_id: z.string().uuid('Invalid task ID'),
});

export const cancelTaskSchema = z.object({
  task_id: z.string().uuid('Invalid task ID'),
});

export const createApiKeySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(128),
  scopes: z.array(z.enum(API_KEY_SCOPES)).max(API_KEY_SCOPES.length)
    .optional()
    .default(['images:read', 'images:write']),
  expires_at: z.string().datetime().optional(),
}).strict();

export const revokeApiKeySchema = z.object({
  key_id: z.string().uuid('Invalid key ID'),
});

export const updateProfileSchema = z.object({
  display_name: z.string().min(1).max(128).optional(),
});

export const updateUserQuotaSchema = z.object({
  daily_image_limit: z.number().int().min(0).optional(),
  monthly_image_limit: z.number().int().min(0).optional(),
  max_concurrent_tasks: z.number().int().min(1).optional(),
  max_images_per_request: z.number().int().min(1).optional(),
  api_access_enabled: z.boolean().optional(),
  allowed_model_codes: z.array(z.string()).optional(),
  allowed_sizes: z.array(z.string()).optional(),
  retention_days: z.number().int().min(1).optional(),
});

export const updateModelConfigSchema = z.object({
  display_name: z.string().max(128).optional(),
  provider_type: z.string().max(32).optional(),
  external_model_id: z.string().max(256).optional(),
  workflow_id: z.string().max(256).optional(),
  enabled: z.boolean().optional(),
  sort_order: z.number().int().optional(),
  supports_text_to_image: z.boolean().optional(),
  supports_image_to_image: z.boolean().optional(),
  supports_multiple_references: z.boolean().optional(),
  supports_sequential_generation: z.boolean().optional(),
  supports_visible_watermark_control: z.boolean().optional(),
  supported_sizes: z.array(z.string()).optional(),
  max_images_per_request: z.number().int().min(1).optional(),
  max_provider_concurrency: z.number().int().min(1).optional(),
  timeout_seconds: z.number().int().min(10).optional(),
  default_parameters: z.record(z.string(), z.unknown()).optional(),
  capability_metadata: z.record(z.string(), z.unknown()).optional(),
});

export const updateSystemSettingSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
  description: z.string().optional(),
});

export const createUserSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  display_name: z.string().max(128).optional(),
  role: z.enum(['admin', 'user']).optional().default('user'),
});

export const updateUserStatusSchema = z.object({
  status: z.enum(['active', 'disabled', 'pending']),
});

export const uploadReferenceSchema = z.object({
  task_id: z.string().uuid().optional(),
});

export const imageUploadConstraints = {
  maxFileSize: 20 * 1024 * 1024, // 20MB
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp', '.gif'],
  maxFilesPerRequest: 5,
} as const;

export type LoginInput = z.infer<typeof loginSchema>;
export type CreateGenerationTaskInput = z.infer<typeof createGenerationTaskSchema>;
export type OpenAiImageGenerationInput = z.infer<typeof openAiImageGenerationSchema>;
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type UpdateUserQuotaInput = z.infer<typeof updateUserQuotaSchema>;
export type UpdateModelConfigInput = z.infer<typeof updateModelConfigSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
