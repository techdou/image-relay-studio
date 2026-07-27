-- =============================================================
-- Migration 0001: idempotency unique constraint + ON DELETE behavior
-- =============================================================
-- Source of truth: src/storage/database/shared/schema.ts
--
-- This migration is idempotent: every DDL statement uses IF NOT EXISTS
-- or DROP IF EXISTS + CREATE so it can be re-run safely.
--
-- Background:
--   * generation_tasks.idempotency_key had only a plain btree index, so two
--     concurrent identical requests could both pass the select-then-insert
--     check in src/server/tasks/executor.ts. We add a partial UNIQUE index on
--     (user_id, idempotency_key) restricted to rows where idempotency_key is
--     NOT NULL. PostgreSQL treats NULLs as distinct under UNIQUE, so the
--     constraint is safe for rows that omit the key.
--
--   * Foreign keys were declared without ON DELETE behavior. Deleting a user
--     left orphaned tasks / quotas / api_keys / etc. We add explicit cascade
--     or set-null semantics. See schema.ts comments for the rationale per
--     table. ALTER CONSTRAINT is not supported in PostgreSQL, so each FK is
--     dropped and recreated.

BEGIN;

-- -------------------------------------------------------------
-- 1. Partial UNIQUE index for idempotency deduplication
-- -------------------------------------------------------------
DROP INDEX IF EXISTS generation_tasks_idempotency_unique;
CREATE UNIQUE INDEX generation_tasks_idempotency_unique
  ON generation_tasks (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- -------------------------------------------------------------
-- 2. generation_tasks.user_id -> profiles.id ON DELETE CASCADE
-- -------------------------------------------------------------
ALTER TABLE generation_tasks
  DROP CONSTRAINT IF EXISTS generation_tasks_user_id_profiles_id_fk;
ALTER TABLE generation_tasks
  ADD CONSTRAINT generation_tasks_user_id_profiles_id_fk
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- -------------------------------------------------------------
-- 3. user_quotas.user_id -> profiles.id ON DELETE CASCADE
-- -------------------------------------------------------------
ALTER TABLE user_quotas
  DROP CONSTRAINT IF EXISTS user_quotas_user_id_profiles_id_fk;
ALTER TABLE user_quotas
  ADD CONSTRAINT user_quotas_user_id_profiles_id_fk
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- -------------------------------------------------------------
-- 4. api_keys.user_id -> profiles.id ON DELETE CASCADE
-- -------------------------------------------------------------
ALTER TABLE api_keys
  DROP CONSTRAINT IF EXISTS api_keys_user_id_profiles_id_fk;
ALTER TABLE api_keys
  ADD CONSTRAINT api_keys_user_id_profiles_id_fk
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- -------------------------------------------------------------
-- 5. audit_logs.actor_user_id -> profiles.id ON DELETE SET NULL
--    Audit history must survive user deletion; just blank the actor.
-- -------------------------------------------------------------
ALTER TABLE audit_logs
  DROP CONSTRAINT IF EXISTS audit_logs_actor_user_id_profiles_id_fk;
ALTER TABLE audit_logs
  ADD CONSTRAINT audit_logs_actor_user_id_profiles_id_fk
  FOREIGN KEY (actor_user_id) REFERENCES profiles(id) ON DELETE SET NULL;

-- -------------------------------------------------------------
-- 6. usage_records FKs
--    task_id          -> generation_tasks.id  ON DELETE CASCADE
--    api_key_id       -> api_keys.id          ON DELETE SET NULL
--    model_config_id  -> model_configs.id     ON DELETE SET NULL
--    user_id          -> profiles.id          ON DELETE CASCADE
-- -------------------------------------------------------------
ALTER TABLE usage_records
  DROP CONSTRAINT IF EXISTS usage_records_task_id_generation_tasks_id_fk;
ALTER TABLE usage_records
  ADD CONSTRAINT usage_records_task_id_generation_tasks_id_fk
  FOREIGN KEY (task_id) REFERENCES generation_tasks(id) ON DELETE CASCADE;

ALTER TABLE usage_records
  DROP CONSTRAINT IF EXISTS usage_records_api_key_id_api_keys_id_fk;
ALTER TABLE usage_records
  ADD CONSTRAINT usage_records_api_key_id_api_keys_id_fk
  FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE SET NULL;

ALTER TABLE usage_records
  DROP CONSTRAINT IF EXISTS usage_records_model_config_id_model_configs_id_fk;
ALTER TABLE usage_records
  ADD CONSTRAINT usage_records_model_config_id_model_configs_id_fk
  FOREIGN KEY (model_config_id) REFERENCES model_configs(id) ON DELETE SET NULL;

ALTER TABLE usage_records
  DROP CONSTRAINT IF EXISTS usage_records_user_id_profiles_id_fk;
ALTER TABLE usage_records
  ADD CONSTRAINT usage_records_user_id_profiles_id_fk
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- -------------------------------------------------------------
-- 7. system_settings.updated_by -> profiles.id ON DELETE SET NULL
-- -------------------------------------------------------------
ALTER TABLE system_settings
  DROP CONSTRAINT IF EXISTS system_settings_updated_by_profiles_id_fk;
ALTER TABLE system_settings
  ADD CONSTRAINT system_settings_updated_by_profiles_id_fk
  FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL;

-- -------------------------------------------------------------
-- 8. moderation_events
--    task_id -> generation_tasks.id ON DELETE CASCADE
--    user_id -> profiles.id         ON DELETE CASCADE
-- -------------------------------------------------------------
ALTER TABLE moderation_events
  DROP CONSTRAINT IF EXISTS moderation_events_task_id_generation_tasks_id_fk;
ALTER TABLE moderation_events
  ADD CONSTRAINT moderation_events_task_id_generation_tasks_id_fk
  FOREIGN KEY (task_id) REFERENCES generation_tasks(id) ON DELETE CASCADE;

ALTER TABLE moderation_events
  DROP CONSTRAINT IF EXISTS moderation_events_user_id_profiles_id_fk;
ALTER TABLE moderation_events
  ADD CONSTRAINT moderation_events_user_id_profiles_id_fk
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

COMMIT;
