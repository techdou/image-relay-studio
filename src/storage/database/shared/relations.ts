import { relations } from "drizzle-orm";
import {
  profiles,
  userQuotas,
  modelConfigs,
  generationTasks,
  generationReferences,
  generationAssets,
  apiKeys,
  usageRecords,
  auditLogs,
  systemSettings,
  moderationEvents,
} from "./schema";

// Drizzle relational query API mapping.
// Each relation mirrors the foreign keys declared in schema.ts so the
// relational query builder (e.g. `db.query.profiles.findMany({ with: ... })`)
// can resolve nested data without manual joins.

export const profilesRelations = relations(profiles, ({ many }) => ({
  quotas: many(userQuotas),
  tasks: many(generationTasks),
  apiKeys: many(apiKeys),
  usageRecords: many(usageRecords),
  auditLogs: many(auditLogs),
}));

export const generationTasksRelations = relations(generationTasks, ({ one, many }) => ({
  user: one(profiles, {
    fields: [generationTasks.user_id],
    references: [profiles.id],
  }),
  model: one(modelConfigs, {
    fields: [generationTasks.model_config_id],
    references: [modelConfigs.id],
  }),
  references: many(generationReferences),
  assets: many(generationAssets),
  usageRecords: many(usageRecords),
}));

export const generationReferencesRelations = relations(generationReferences, ({ one }) => ({
  task: one(generationTasks, {
    fields: [generationReferences.task_id],
    references: [generationTasks.id],
  }),
}));

export const generationAssetsRelations = relations(generationAssets, ({ one }) => ({
  task: one(generationTasks, {
    fields: [generationAssets.task_id],
    references: [generationTasks.id],
  }),
}));

export const apiKeysRelations = relations(apiKeys, ({ one, many }) => ({
  user: one(profiles, {
    fields: [apiKeys.user_id],
    references: [profiles.id],
  }),
  usageRecords: many(usageRecords),
}));

export const usageRecordsRelations = relations(usageRecords, ({ one }) => ({
  user: one(profiles, {
    fields: [usageRecords.user_id],
    references: [profiles.id],
  }),
  task: one(generationTasks, {
    fields: [usageRecords.task_id],
    references: [generationTasks.id],
  }),
  apiKey: one(apiKeys, {
    fields: [usageRecords.api_key_id],
    references: [apiKeys.id],
  }),
  modelConfig: one(modelConfigs, {
    fields: [usageRecords.model_config_id],
    references: [modelConfigs.id],
  }),
}));

export const userQuotasRelations = relations(userQuotas, ({ one }) => ({
  user: one(profiles, {
    fields: [userQuotas.user_id],
    references: [profiles.id],
  }),
}));

export const modelConfigsRelations = relations(modelConfigs, ({ many }) => ({
  tasks: many(generationTasks),
  usageRecords: many(usageRecords),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  actor: one(profiles, {
    fields: [auditLogs.actor_user_id],
    references: [profiles.id],
  }),
}));

export const systemSettingsRelations = relations(systemSettings, ({ one }) => ({
  updatedBy: one(profiles, {
    fields: [systemSettings.updated_by],
    references: [profiles.id],
  }),
}));

export const moderationEventsRelations = relations(moderationEvents, ({ one }) => ({
  task: one(generationTasks, {
    fields: [moderationEvents.task_id],
    references: [generationTasks.id],
  }),
  user: one(profiles, {
    fields: [moderationEvents.user_id],
    references: [profiles.id],
  }),
}));
