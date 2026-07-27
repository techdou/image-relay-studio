import { z } from 'zod';

/**
 * Admin-only validation schemas.
 *
 * Kept separate from `schemas.ts` (the shared file used by user-facing
 * routes) so admin write surfaces can validate extra fields such as
 * `role`/`status` (user PATCH), `code`/`provider_type` (model POST)
 * without altering shared schemas used elsewhere.
 */

// ── Admin user management ────────────────────────────────────────────
/**
 * Body schema for `PATCH /api/admin/users/[user_id]`.
 *
 * Combines profile fields (display_name/role/status) with quota fields
 * (daily_image_limit, etc.) into a single discriminated object so the
 * route can validate everything in one shot.
 */
export const adminUpdateUserSchema = z
  .object({
    // Profile fields
    display_name: z.string().min(1).max(128).optional(),
    role: z.enum(['admin', 'user']).optional(),
    status: z.enum(['active', 'disabled', 'pending']).optional(),
    // Quota fields (mirror updateUserQuotaSchema so admin can edit them inline)
    daily_image_limit: z.number().int().min(0).optional(),
    monthly_image_limit: z.number().int().min(0).optional(),
    max_concurrent_tasks: z.number().int().min(1).optional(),
    max_images_per_request: z.number().int().min(1).optional(),
    api_access_enabled: z.boolean().optional(),
    allowed_model_codes: z.array(z.string()).optional(),
    allowed_sizes: z.array(z.string()).optional(),
    retention_days: z.number().int().min(1).optional(),
  })
  .strict();

export type AdminUpdateUserInput = z.infer<typeof adminUpdateUserSchema>;

/**
 * Query-string schema for `GET /api/admin/users`.
 *
 * `search` is constrained to a safe character class so it cannot inject
 * Postgres filter syntax into the `.or()` builder.
 */
export const adminListUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['active', 'disabled', 'pending']).optional(),
  search: z
    .string()
    .max(128)
    .regex(/^[A-Za-z0-9@._\-\s]*$/, 'Invalid search characters')
    .optional(),
});

// ── Admin model management ───────────────────────────────────────────
/**
 * Body schema for `POST /api/admin/models`.
 *
 * `code` and `provider_type` are required on creation; everything else
 * is optional with sensible defaults.
 */
export const adminCreateModelSchema = z
  .object({
    code: z.string().min(1, 'Model code is required').max(64),
    display_name: z.string().min(1).max(128),
    provider_type: z.string().min(1).max(32),
    external_model_id: z.string().max(256).nullable().optional(),
    workflow_id: z.string().max(256).nullable().optional(),
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
  })
  .strict();

export type AdminCreateModelInput = z.infer<typeof adminCreateModelSchema>;

/**
 * Body schema for `PATCH /api/admin/models/[model_id]`.
 *
 * Mirrors `updateModelConfigSchema` from the shared file but enforces
 * `.strict()` to reject unknown fields.
 */
export const adminUpdateModelSchema = z
  .object({
    display_name: z.string().max(128).optional(),
    provider_type: z.string().max(32).optional(),
    external_model_id: z.string().max(256).nullable().optional(),
    workflow_id: z.string().max(256).nullable().optional(),
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
  })
  .strict();

export type AdminUpdateModelInput = z.infer<typeof adminUpdateModelSchema>;

// ── Admin settings ───────────────────────────────────────────────────
/**
 * Body schema for `PATCH /api/admin/settings`.
 *
 * `key` must be one of the known setting keys; value is a string.
 */
export const adminUpdateSettingSchema = z
  .object({
    key: z.string().min(1).max(64),
    value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  })
  .strict();

export type AdminUpdateSettingInput = z.infer<typeof adminUpdateSettingSchema>;
