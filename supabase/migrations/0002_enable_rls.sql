-- =============================================================
-- Migration 0002: enable Row Level Security + baseline policies
-- =============================================================
-- Background: the application authorizes in code (API key hashing, role
-- checks in route handlers) and almost all server writes use the service
-- role, which bypasses RLS. RLS is enabled here as defense-in-depth so that
-- if a client ever obtains the anon key and tries to read/write directly,
-- it can only touch its own rows. This is not the primary authorization
-- boundary; do not weaken application-side checks based on the existence of
-- these policies.
--
-- Idempotency: PostgreSQL (>= 14) supports `CREATE POLICY IF NOT EXISTS`.
-- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` is idempotent on its own.
-- We still DROP IF EXISTS before CREATE for older toolchains; both forms
-- are guarded.

BEGIN;

-- -------------------------------------------------------------
-- 1. Enable RLS on every application table
-- -------------------------------------------------------------
ALTER TABLE profiles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_quotas          ENABLE ROW LEVEL SECURITY;
ALTER TABLE generation_tasks     ENABLE ROW LEVEL SECURITY;
ALTER TABLE generation_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE generation_assets    ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys             ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_records        ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE moderation_events    ENABLE ROW LEVEL SECURITY;

-- Note: we do NOT set `FORCE ROW LEVEL SECURITY`. The service_role bypasses
-- RLS by design, which is what server-side admin code relies on.

-- -------------------------------------------------------------
-- 2. profiles — owner can read/update their own row
-- -------------------------------------------------------------
DROP POLICY IF EXISTS profiles_self_read ON profiles;
CREATE POLICY profiles_self_read ON profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

DROP POLICY IF EXISTS profiles_self_update ON profiles;
CREATE POLICY profiles_self_update ON profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- -------------------------------------------------------------
-- 3. user_quotas — owner read only (mutated server-side)
-- -------------------------------------------------------------
DROP POLICY IF EXISTS user_quotas_owner_read ON user_quotas;
CREATE POLICY user_quotas_owner_read ON user_quotas
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- -------------------------------------------------------------
-- 4. generation_tasks — owner full access
-- -------------------------------------------------------------
DROP POLICY IF EXISTS generation_tasks_owner_all ON generation_tasks;
CREATE POLICY generation_tasks_owner_all ON generation_tasks
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- -------------------------------------------------------------
-- 5. generation_references — owner full access
--    Rows carry their own user_id even though the FK is task_id.
-- -------------------------------------------------------------
DROP POLICY IF EXISTS generation_references_owner_all ON generation_references;
CREATE POLICY generation_references_owner_all ON generation_references
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- -------------------------------------------------------------
-- 6. generation_assets — owner full access
-- -------------------------------------------------------------
DROP POLICY IF EXISTS generation_assets_owner_all ON generation_assets;
CREATE POLICY generation_assets_owner_all ON generation_assets
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- -------------------------------------------------------------
-- 7. api_keys — owner full access
--    (Key material itself is hashed server-side; the row is still
--    owner-scoped here for defense in depth.)
-- -------------------------------------------------------------
DROP POLICY IF EXISTS api_keys_owner_all ON api_keys;
CREATE POLICY api_keys_owner_all ON api_keys
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- -------------------------------------------------------------
-- 8. usage_records — owner read only (mutated server-side)
-- -------------------------------------------------------------
DROP POLICY IF EXISTS usage_records_owner_read ON usage_records;
CREATE POLICY usage_records_owner_read ON usage_records
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- -------------------------------------------------------------
-- 9. audit_logs — read-visible to any authenticated user
--    (Auditing is server-owned; writes happen via service role.)
-- -------------------------------------------------------------
DROP POLICY IF EXISTS audit_logs_authenticated_read ON audit_logs;
CREATE POLICY audit_logs_authenticated_read ON audit_logs
  FOR SELECT TO authenticated
  USING (true);

-- -------------------------------------------------------------
-- 10. system_settings — read-visible to any authenticated user
--     Writes are admin-only and go through the service role, so no
--     INSERT/UPDATE/DELETE policy is granted to authenticated here.
-- -------------------------------------------------------------
DROP POLICY IF EXISTS system_settings_authenticated_read ON system_settings;
CREATE POLICY system_settings_authenticated_read ON system_settings
  FOR SELECT TO authenticated
  USING (true);

-- -------------------------------------------------------------
-- 11. moderation_events — owner read only
-- -------------------------------------------------------------
DROP POLICY IF EXISTS moderation_events_owner_read ON moderation_events;
CREATE POLICY moderation_events_owner_read ON moderation_events
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

COMMIT;
