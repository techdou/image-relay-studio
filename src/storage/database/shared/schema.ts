import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  varchar,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  uuid,
  index,
  uniqueIndex,
  numeric,
} from "drizzle-orm/pg-core";

// ============================================================
// System health check table (DO NOT DELETE)
// ============================================================
export const healthCheck = pgTable("health_check", {
  id: serial().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

// ============================================================
// 1. profiles
// ============================================================
export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    user_id: uuid("user_id").notNull().unique(),
    email: varchar("email", { length: 255 }).notNull(),
    display_name: varchar("display_name", { length: 128 }),
    avatar_key: varchar("avatar_key", { length: 512 }),
    role: varchar("role", { length: 20 }).notNull().default("user"),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    last_login_at: timestamp("last_login_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("profiles_user_id_idx").on(table.user_id),
    index("profiles_email_idx").on(table.email),
    index("profiles_role_idx").on(table.role),
    index("profiles_status_idx").on(table.status),
  ]
);

// ============================================================
// 2. user_quotas
// ============================================================
export const userQuotas = pgTable(
  "user_quotas",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    user_id: uuid("user_id").notNull().unique().references(() => profiles.id, { onDelete: "cascade" }),
    daily_image_limit: integer("daily_image_limit").notNull().default(20),
    monthly_image_limit: integer("monthly_image_limit").notNull().default(200),
    max_concurrent_tasks: integer("max_concurrent_tasks").notNull().default(2),
    max_images_per_request: integer("max_images_per_request").notNull().default(4),
    api_access_enabled: boolean("api_access_enabled").notNull().default(false),
    allowed_model_codes: jsonb("allowed_model_codes").default(sql`'[]'::jsonb`),
    allowed_sizes: jsonb("allowed_sizes").default(sql`'[]'::jsonb`),
    retention_days: integer("retention_days").notNull().default(90),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("user_quotas_user_id_idx").on(table.user_id),
  ]
);

// ============================================================
// 3. model_configs
// ============================================================
export const modelConfigs = pgTable(
  "model_configs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    code: varchar("code", { length: 64 }).notNull().unique(),
    display_name: varchar("display_name", { length: 128 }).notNull(),
    provider_type: varchar("provider_type", { length: 32 }).notNull(),
    external_model_id: varchar("external_model_id", { length: 256 }),
    workflow_id: varchar("workflow_id", { length: 256 }),
    enabled: boolean("enabled").notNull().default(true),
    sort_order: integer("sort_order").notNull().default(0),
    supports_text_to_image: boolean("supports_text_to_image").notNull().default(true),
    supports_image_to_image: boolean("supports_image_to_image").notNull().default(false),
    supports_multiple_references: boolean("supports_multiple_references").notNull().default(false),
    supports_sequential_generation: boolean("supports_sequential_generation").notNull().default(false),
    supports_visible_watermark_control: boolean("supports_visible_watermark_control").notNull().default(false),
    supported_sizes: jsonb("supported_sizes").default(sql`'[]'::jsonb`),
    max_images_per_request: integer("max_images_per_request").notNull().default(4),
    max_provider_concurrency: integer("max_provider_concurrency").notNull().default(5),
    timeout_seconds: integer("timeout_seconds").notNull().default(120),
    default_parameters: jsonb("default_parameters").default(sql`'{}'::jsonb`),
    capability_metadata: jsonb("capability_metadata").default(sql`'{}'::jsonb`),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("model_configs_code_idx").on(table.code),
    index("model_configs_enabled_idx").on(table.enabled),
  ]
);

// ============================================================
// 4. generation_tasks
// ============================================================
export const generationTasks = pgTable(
  "generation_tasks",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    user_id: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    model_config_id: uuid("model_config_id").notNull().references(() => modelConfigs.id),
    task_type: varchar("task_type", { length: 32 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("queued"),
    prompt: text("prompt").notNull(),
    request_parameters: jsonb("request_parameters").default(sql`'{}'::jsonb`),
    idempotency_key: varchar("idempotency_key", { length: 128 }),
    provider_request_id: varchar("provider_request_id", { length: 256 }),
    provider_task_id: varchar("provider_task_id", { length: 256 }),
    attempt_count: integer("attempt_count").notNull().default(0),
    progress: integer("progress").default(0),
    queued_at: timestamp("queued_at", { withTimezone: true }).defaultNow(),
    started_at: timestamp("started_at", { withTimezone: true }),
    completed_at: timestamp("completed_at", { withTimezone: true }),
    error_code: varchar("error_code", { length: 64 }),
    error_message: text("error_message"),
    error_details: jsonb("error_details"),
    latency_ms: integer("latency_ms"),
    cancelled_at: timestamp("cancelled_at", { withTimezone: true }),
    deleted_at: timestamp("deleted_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("generation_tasks_user_id_idx").on(table.user_id),
    index("generation_tasks_model_config_id_idx").on(table.model_config_id),
    index("generation_tasks_status_idx").on(table.status),
    index("generation_tasks_task_type_idx").on(table.task_type),
    index("generation_tasks_idempotency_key_idx").on(table.idempotency_key),
    index("generation_tasks_created_at_idx").on(table.created_at),
    index("generation_tasks_user_status_idx").on(table.user_id, table.status),
    // Partial unique index: enforce (user_id, idempotency_key) uniqueness only when
    // idempotency_key IS NOT NULL. PostgreSQL treats multiple NULLs as distinct under
    // a UNIQUE constraint, so this is safe even for rows without an idempotency_key.
    // Fixes the select-then-insert TOCTOU race in the executor.
    uniqueIndex("generation_tasks_idempotency_unique")
      .on(table.user_id, table.idempotency_key)
      .where(sql`${table.idempotency_key} IS NOT NULL`),
  ]
);

// ============================================================
// 5. generation_references
// ============================================================
export const generationReferences = pgTable(
  "generation_references",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    task_id: uuid("task_id").references(() => generationTasks.id, { onDelete: "cascade" }),
    user_id: uuid("user_id").notNull(),
    object_key: varchar("object_key", { length: 512 }).notNull(),
    original_filename: varchar("original_filename", { length: 256 }),
    mime_type: varchar("mime_type", { length: 64 }),
    file_size: integer("file_size"),
    width: integer("width"),
    height: integer("height"),
    sha256: varchar("sha256", { length: 64 }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("generation_references_task_id_idx").on(table.task_id),
    index("generation_references_user_id_idx").on(table.user_id),
  ]
);

// ============================================================
// 6. generation_assets
// ============================================================
export const generationAssets = pgTable(
  "generation_assets",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    task_id: uuid("task_id").notNull().references(() => generationTasks.id, { onDelete: "cascade" }),
    user_id: uuid("user_id").notNull(),
    object_key: varchar("object_key", { length: 512 }).notNull(),
    thumbnail_key: varchar("thumbnail_key", { length: 512 }),
    original_filename: varchar("original_filename", { length: 256 }),
    mime_type: varchar("mime_type", { length: 64 }),
    file_size: integer("file_size"),
    width: integer("width"),
    height: integer("height"),
    sha256: varchar("sha256", { length: 64 }),
    provider_metadata: jsonb("provider_metadata"),
    ai_generated: boolean("ai_generated").notNull().default(true),
    visible_watermark_disabled: boolean("visible_watermark_disabled").notNull().default(false),
    favorite: boolean("favorite").notNull().default(false),
    deleted_at: timestamp("deleted_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("generation_assets_task_id_idx").on(table.task_id),
    index("generation_assets_user_id_idx").on(table.user_id),
    index("generation_assets_favorite_idx").on(table.user_id, table.favorite),
    index("generation_assets_deleted_at_idx").on(table.deleted_at),
    index("generation_assets_created_at_idx").on(table.created_at),
  ]
);

// ============================================================
// 7. api_keys
// ============================================================
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    user_id: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 128 }).notNull(),
    key_prefix: varchar("key_prefix", { length: 16 }).notNull(),
    key_hash: varchar("key_hash", { length: 128 }).notNull(),
    scopes: jsonb("scopes").default(sql`'["images:read","images:write"]'::jsonb`),
    last_used_at: timestamp("last_used_at", { withTimezone: true }),
    expires_at: timestamp("expires_at", { withTimezone: true }),
    revoked_at: timestamp("revoked_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("api_keys_user_id_idx").on(table.user_id),
    index("api_keys_key_prefix_idx").on(table.key_prefix),
    index("api_keys_revoked_at_idx").on(table.revoked_at),
  ]
);

// ============================================================
// 8. usage_records
// ============================================================
export const usageRecords = pgTable(
  "usage_records",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    user_id: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    task_id: uuid("task_id").references(() => generationTasks.id, { onDelete: "cascade" }),
    api_key_id: uuid("api_key_id").references(() => apiKeys.id, { onDelete: "set null" }),
    model_config_id: uuid("model_config_id").references(() => modelConfigs.id, { onDelete: "set null" }),
    request_source: varchar("request_source", { length: 20 }).notNull().default("web"),
    requested_image_count: integer("requested_image_count").notNull().default(1),
    generated_image_count: integer("generated_image_count").notNull().default(0),
    status: varchar("status", { length: 20 }).notNull().default("queued"),
    latency_ms: integer("latency_ms"),
    provider_request_id: varchar("provider_request_id", { length: 256 }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("usage_records_user_id_idx").on(table.user_id),
    index("usage_records_task_id_idx").on(table.task_id),
    index("usage_records_model_config_id_idx").on(table.model_config_id),
    index("usage_records_created_at_idx").on(table.created_at),
    index("usage_records_user_created_idx").on(table.user_id, table.created_at),
  ]
);

// ============================================================
// 9. audit_logs
// ============================================================
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    actor_user_id: uuid("actor_user_id").references(() => profiles.id, { onDelete: "set null" }),
    actor_role: varchar("actor_role", { length: 20 }),
    action: varchar("action", { length: 128 }).notNull(),
    resource_type: varchar("resource_type", { length: 64 }),
    resource_id: varchar("resource_id", { length: 256 }),
    request_id: varchar("request_id", { length: 64 }),
    ip_hash: varchar("ip_hash", { length: 64 }),
    user_agent: text("user_agent"),
    before_data: jsonb("before_data"),
    after_data: jsonb("after_data"),
    metadata: jsonb("metadata"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("audit_logs_actor_user_id_idx").on(table.actor_user_id),
    index("audit_logs_action_idx").on(table.action),
    index("audit_logs_resource_type_idx").on(table.resource_type),
    index("audit_logs_created_at_idx").on(table.created_at),
  ]
);

// ============================================================
// 10. system_settings
// ============================================================
export const systemSettings = pgTable(
  "system_settings",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    key: varchar("key", { length: 128 }).notNull().unique(),
    value: text("value").notNull(),
    description: text("description"),
    updated_by: uuid("updated_by").references(() => profiles.id, { onDelete: "set null" }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("system_settings_key_idx").on(table.key),
  ]
);

// ============================================================
// 11. moderation_events
// ============================================================
export const moderationEvents = pgTable(
  "moderation_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    task_id: uuid("task_id").references(() => generationTasks.id, { onDelete: "cascade" }),
    user_id: uuid("user_id").references(() => profiles.id, { onDelete: "cascade" }),
    stage: varchar("stage", { length: 32 }).notNull(),
    decision: varchar("decision", { length: 32 }).notNull(),
    reason: text("reason"),
    rule_codes: jsonb("rule_codes").default(sql`'[]'::jsonb`),
    metadata: jsonb("metadata"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("moderation_events_task_id_idx").on(table.task_id),
    index("moderation_events_user_id_idx").on(table.user_id),
  ]
);
