-- =============================================================
-- Migration 0003: auth identity alignment, hardened RLS, atomic quotas
-- =============================================================
-- The application consistently stores Supabase Auth user IDs in user_id
-- columns. profiles.id remains an internal resource ID; profiles.user_id is
-- the canonical identity key used by auth.uid() and all user-owned rows.

BEGIN;

-- -----------------------------------------------------------------
-- 1. Re-point user-owned foreign keys to profiles.user_id.
--    Convert legacy rows that still contain profiles.id before adding
--    the corrected constraints.
-- -----------------------------------------------------------------
ALTER TABLE user_quotas DROP CONSTRAINT IF EXISTS user_quotas_user_id_profiles_id_fk;
ALTER TABLE user_quotas DROP CONSTRAINT IF EXISTS user_quotas_user_id_profiles_user_id_fk;
ALTER TABLE generation_tasks DROP CONSTRAINT IF EXISTS generation_tasks_user_id_profiles_id_fk;
ALTER TABLE generation_tasks DROP CONSTRAINT IF EXISTS generation_tasks_user_id_profiles_user_id_fk;
ALTER TABLE generation_references DROP CONSTRAINT IF EXISTS generation_references_user_id_profiles_user_id_fk;
ALTER TABLE generation_assets DROP CONSTRAINT IF EXISTS generation_assets_user_id_profiles_user_id_fk;
ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_user_id_profiles_id_fk;
ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_user_id_profiles_user_id_fk;
ALTER TABLE usage_records DROP CONSTRAINT IF EXISTS usage_records_user_id_profiles_id_fk;
ALTER TABLE usage_records DROP CONSTRAINT IF EXISTS usage_records_user_id_profiles_user_id_fk;
ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_actor_user_id_profiles_id_fk;
ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_actor_user_id_profiles_user_id_fk;
ALTER TABLE system_settings DROP CONSTRAINT IF EXISTS system_settings_updated_by_profiles_id_fk;
ALTER TABLE system_settings DROP CONSTRAINT IF EXISTS system_settings_updated_by_profiles_user_id_fk;
ALTER TABLE moderation_events DROP CONSTRAINT IF EXISTS moderation_events_user_id_profiles_id_fk;
ALTER TABLE moderation_events DROP CONSTRAINT IF EXISTS moderation_events_user_id_profiles_user_id_fk;

UPDATE user_quotas c SET user_id = p.user_id FROM profiles p WHERE c.user_id = p.id;
UPDATE generation_tasks c SET user_id = p.user_id FROM profiles p WHERE c.user_id = p.id;
UPDATE generation_references c SET user_id = p.user_id FROM profiles p WHERE c.user_id = p.id;
UPDATE generation_assets c SET user_id = p.user_id FROM profiles p WHERE c.user_id = p.id;
UPDATE api_keys c SET user_id = p.user_id FROM profiles p WHERE c.user_id = p.id;
UPDATE usage_records c SET user_id = p.user_id FROM profiles p WHERE c.user_id = p.id;
UPDATE audit_logs c SET actor_user_id = p.user_id FROM profiles p WHERE c.actor_user_id = p.id;
UPDATE system_settings c SET updated_by = p.user_id FROM profiles p WHERE c.updated_by = p.id;
UPDATE moderation_events c SET user_id = p.user_id FROM profiles p WHERE c.user_id = p.id;

ALTER TABLE user_quotas
  ADD CONSTRAINT user_quotas_user_id_profiles_user_id_fk
  FOREIGN KEY (user_id) REFERENCES profiles(user_id) ON DELETE CASCADE;
ALTER TABLE generation_tasks
  ADD CONSTRAINT generation_tasks_user_id_profiles_user_id_fk
  FOREIGN KEY (user_id) REFERENCES profiles(user_id) ON DELETE CASCADE;
ALTER TABLE generation_references
  ADD CONSTRAINT generation_references_user_id_profiles_user_id_fk
  FOREIGN KEY (user_id) REFERENCES profiles(user_id) ON DELETE CASCADE;
ALTER TABLE generation_assets
  ADD CONSTRAINT generation_assets_user_id_profiles_user_id_fk
  FOREIGN KEY (user_id) REFERENCES profiles(user_id) ON DELETE CASCADE;
ALTER TABLE api_keys
  ADD CONSTRAINT api_keys_user_id_profiles_user_id_fk
  FOREIGN KEY (user_id) REFERENCES profiles(user_id) ON DELETE CASCADE;
ALTER TABLE usage_records
  ADD CONSTRAINT usage_records_user_id_profiles_user_id_fk
  FOREIGN KEY (user_id) REFERENCES profiles(user_id) ON DELETE CASCADE;
ALTER TABLE audit_logs
  ADD CONSTRAINT audit_logs_actor_user_id_profiles_user_id_fk
  FOREIGN KEY (actor_user_id) REFERENCES profiles(user_id) ON DELETE SET NULL;
ALTER TABLE system_settings
  ADD CONSTRAINT system_settings_updated_by_profiles_user_id_fk
  FOREIGN KEY (updated_by) REFERENCES profiles(user_id) ON DELETE SET NULL;
ALTER TABLE moderation_events
  ADD CONSTRAINT moderation_events_user_id_profiles_user_id_fk
  FOREIGN KEY (user_id) REFERENCES profiles(user_id) ON DELETE CASCADE;

DROP INDEX IF EXISTS generation_tasks_idempotency_unique;
CREATE UNIQUE INDEX generation_tasks_idempotency_unique
  ON generation_tasks (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS usage_records_task_id_unique
  ON usage_records (task_id)
  WHERE task_id IS NOT NULL;

-- -----------------------------------------------------------------
-- 2. Harden direct Data API access. Business writes are server-owned.
-- -----------------------------------------------------------------
ALTER TABLE health_check ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE generation_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE generation_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE generation_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE moderation_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_self_read ON profiles;
DROP POLICY IF EXISTS profiles_self_update ON profiles;
DROP POLICY IF EXISTS user_quotas_owner_read ON user_quotas;
DROP POLICY IF EXISTS generation_tasks_owner_all ON generation_tasks;
DROP POLICY IF EXISTS generation_references_owner_all ON generation_references;
DROP POLICY IF EXISTS generation_assets_owner_all ON generation_assets;
DROP POLICY IF EXISTS api_keys_owner_all ON api_keys;
DROP POLICY IF EXISTS usage_records_owner_read ON usage_records;
DROP POLICY IF EXISTS audit_logs_authenticated_read ON audit_logs;
DROP POLICY IF EXISTS system_settings_authenticated_read ON system_settings;
DROP POLICY IF EXISTS moderation_events_owner_read ON moderation_events;

CREATE POLICY profiles_self_read ON profiles
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL AND (SELECT auth.uid()) = user_id);
CREATE POLICY user_quotas_owner_read ON user_quotas
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL AND (SELECT auth.uid()) = user_id);
CREATE POLICY generation_tasks_owner_read ON generation_tasks
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL AND (SELECT auth.uid()) = user_id);
CREATE POLICY generation_references_owner_read ON generation_references
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL AND (SELECT auth.uid()) = user_id);
CREATE POLICY generation_assets_owner_read ON generation_assets
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL AND (SELECT auth.uid()) = user_id);
CREATE POLICY usage_records_owner_read ON usage_records
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL AND (SELECT auth.uid()) = user_id);
CREATE POLICY moderation_events_owner_read ON moderation_events
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL AND (SELECT auth.uid()) = user_id);

REVOKE ALL ON TABLE health_check, model_configs, api_keys, audit_logs, system_settings
  FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE profiles, user_quotas, generation_tasks,
  generation_references, generation_assets, usage_records, moderation_events
  FROM anon, authenticated;
GRANT SELECT ON TABLE profiles, user_quotas, generation_tasks,
  generation_references, generation_assets, usage_records, moderation_events
  TO authenticated;

-- -----------------------------------------------------------------
-- 3. Atomically reserve quota and create task + usage record.
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reserve_generation_task(
  p_user_id uuid,
  p_model_config_id uuid,
  p_task_type text,
  p_prompt text,
  p_request_parameters jsonb,
  p_idempotency_key text,
  p_request_source text,
  p_requested_count integer,
  p_api_key_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_existing public.generation_tasks%ROWTYPE;
  v_task public.generation_tasks%ROWTYPE;
  v_quota public.user_quotas%ROWTYPE;
  v_daily_used bigint;
  v_monthly_used bigint;
  v_active_tasks bigint;
BEGIN
  IF p_requested_count < 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IRS_INVALID_IMAGE_COUNT';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 918273)
  );

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.generation_tasks
    WHERE user_id = p_user_id
      AND idempotency_key = p_idempotency_key
      AND deleted_at IS NULL
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('created', false, 'task', to_jsonb(v_existing));
    END IF;
  END IF;

  SELECT * INTO v_quota
  FROM public.user_quotas
  WHERE user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IRS_QUOTA_NOT_CONFIGURED';
  END IF;

  SELECT COALESCE(SUM(
    CASE WHEN status = 'succeeded'
      THEN generated_image_count
      ELSE requested_image_count
    END
  ), 0)
  INTO v_daily_used
  FROM public.usage_records
  WHERE user_id = p_user_id
    AND created_at >= date_trunc('day', now())
    AND status IN ('queued', 'running', 'succeeded');

  SELECT COALESCE(SUM(
    CASE WHEN status = 'succeeded'
      THEN generated_image_count
      ELSE requested_image_count
    END
  ), 0)
  INTO v_monthly_used
  FROM public.usage_records
  WHERE user_id = p_user_id
    AND created_at >= date_trunc('month', now())
    AND status IN ('queued', 'running', 'succeeded');

  SELECT COUNT(*) INTO v_active_tasks
  FROM public.generation_tasks
  WHERE user_id = p_user_id
    AND status IN ('queued', 'running')
    AND deleted_at IS NULL;

  IF v_daily_used + p_requested_count > v_quota.daily_image_limit THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IRS_DAILY_QUOTA_EXCEEDED';
  END IF;
  IF v_monthly_used + p_requested_count > v_quota.monthly_image_limit THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IRS_MONTHLY_QUOTA_EXCEEDED';
  END IF;
  IF v_active_tasks >= v_quota.max_concurrent_tasks THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IRS_CONCURRENCY_LIMITED';
  END IF;

  INSERT INTO public.generation_tasks (
    user_id, model_config_id, task_type, status, prompt,
    request_parameters, idempotency_key, attempt_count
  )
  VALUES (
    p_user_id, p_model_config_id, p_task_type, 'queued', p_prompt,
    COALESCE(p_request_parameters, '{}'::jsonb), p_idempotency_key, 0
  )
  RETURNING * INTO v_task;

  INSERT INTO public.usage_records (
    user_id, task_id, api_key_id, model_config_id, request_source,
    requested_image_count, generated_image_count, status
  )
  VALUES (
    p_user_id, v_task.id, p_api_key_id, p_model_config_id, p_request_source,
    p_requested_count, 0, 'queued'
  );

  RETURN jsonb_build_object('created', true, 'task', to_jsonb(v_task));
END;
$$;

-- Atomically claim a provider slot across all application instances.
CREATE OR REPLACE FUNCTION public.claim_generation_task(p_task_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_model_config_id uuid;
  v_attempt_count integer;
  v_max_concurrency integer;
  v_running_count bigint;
  v_claimed_id uuid;
BEGIN
  SELECT model_config_id, attempt_count
  INTO v_model_config_id, v_attempt_count
  FROM public.generation_tasks
  WHERE id = p_task_id AND status = 'queued'
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_model_config_id::text, 192837)
  );

  SELECT max_provider_concurrency INTO v_max_concurrency
  FROM public.model_configs
  WHERE id = v_model_config_id AND enabled = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IRS_MODEL_DISABLED';
  END IF;

  SELECT COUNT(*) INTO v_running_count
  FROM public.generation_tasks
  WHERE model_config_id = v_model_config_id
    AND status = 'running'
    AND deleted_at IS NULL;
  IF v_running_count >= v_max_concurrency THEN
    RETURN false;
  END IF;

  UPDATE public.generation_tasks
  SET status = 'running',
      started_at = now(),
      attempt_count = v_attempt_count + 1,
      updated_at = now()
  WHERE id = p_task_id AND status = 'queued'
  RETURNING id INTO v_claimed_id;

  IF v_claimed_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.usage_records
  SET status = 'running'
  WHERE task_id = p_task_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_generation_quota_usage(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'daily_used', COALESCE((
      SELECT SUM(CASE WHEN status = 'succeeded'
        THEN generated_image_count ELSE requested_image_count END)
      FROM public.usage_records
      WHERE user_id = p_user_id
        AND created_at >= date_trunc('day', now())
        AND status IN ('queued', 'running', 'succeeded')
    ), 0),
    'monthly_used', COALESCE((
      SELECT SUM(CASE WHEN status = 'succeeded'
        THEN generated_image_count ELSE requested_image_count END)
      FROM public.usage_records
      WHERE user_id = p_user_id
        AND created_at >= date_trunc('month', now())
        AND status IN ('queued', 'running', 'succeeded')
    ), 0),
    'active_tasks', COALESCE((
      SELECT COUNT(*)
      FROM public.generation_tasks
      WHERE user_id = p_user_id
        AND status IN ('queued', 'running')
        AND deleted_at IS NULL
    ), 0)
  );
$$;

CREATE OR REPLACE FUNCTION public.retry_generation_task(
  p_task_id uuid,
  p_actor_user_id uuid,
  p_is_admin boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_task public.generation_tasks%ROWTYPE;
  v_quota public.user_quotas%ROWTYPE;
  v_requested_count integer;
  v_daily_used bigint;
  v_monthly_used bigint;
  v_active_tasks bigint;
BEGIN
  SELECT * INTO v_task
  FROM public.generation_tasks
  WHERE id = p_task_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IRS_TASK_NOT_FOUND';
  END IF;
  IF NOT p_is_admin AND v_task.user_id <> p_actor_user_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IRS_FORBIDDEN';
  END IF;
  IF v_task.status <> 'failed' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IRS_INVALID_TASK_STATE';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_task.user_id::text, 918273)
  );

  SELECT * INTO v_quota
  FROM public.user_quotas
  WHERE user_id = v_task.user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IRS_QUOTA_NOT_CONFIGURED';
  END IF;

  SELECT requested_image_count INTO v_requested_count
  FROM public.usage_records
  WHERE task_id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IRS_USAGE_NOT_FOUND';
  END IF;

  SELECT COALESCE(SUM(CASE WHEN status = 'succeeded'
    THEN generated_image_count ELSE requested_image_count END), 0)
  INTO v_daily_used
  FROM public.usage_records
  WHERE user_id = v_task.user_id
    AND created_at >= date_trunc('day', now())
    AND status IN ('queued', 'running', 'succeeded');

  SELECT COALESCE(SUM(CASE WHEN status = 'succeeded'
    THEN generated_image_count ELSE requested_image_count END), 0)
  INTO v_monthly_used
  FROM public.usage_records
  WHERE user_id = v_task.user_id
    AND created_at >= date_trunc('month', now())
    AND status IN ('queued', 'running', 'succeeded');

  SELECT COUNT(*) INTO v_active_tasks
  FROM public.generation_tasks
  WHERE user_id = v_task.user_id
    AND status IN ('queued', 'running')
    AND deleted_at IS NULL;

  IF v_daily_used + v_requested_count > v_quota.daily_image_limit THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IRS_DAILY_QUOTA_EXCEEDED';
  END IF;
  IF v_monthly_used + v_requested_count > v_quota.monthly_image_limit THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IRS_MONTHLY_QUOTA_EXCEEDED';
  END IF;
  IF v_active_tasks >= v_quota.max_concurrent_tasks THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IRS_CONCURRENCY_LIMITED';
  END IF;

  UPDATE public.generation_tasks
  SET status = 'queued',
      error_code = NULL,
      error_message = NULL,
      error_details = NULL,
      queued_at = now(),
      started_at = NULL,
      completed_at = NULL,
      cancelled_at = NULL,
      updated_at = now()
  WHERE id = p_task_id
  RETURNING * INTO v_task;

  UPDATE public.usage_records
  SET status = 'queued',
      generated_image_count = 0,
      latency_ms = NULL,
      created_at = now()
  WHERE task_id = p_task_id;

  RETURN to_jsonb(v_task);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_generation_task(
  p_task_id uuid,
  p_actor_user_id uuid,
  p_is_admin boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_task public.generation_tasks%ROWTYPE;
BEGIN
  SELECT * INTO v_task
  FROM public.generation_tasks
  WHERE id = p_task_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IRS_TASK_NOT_FOUND';
  END IF;
  IF NOT p_is_admin AND v_task.user_id <> p_actor_user_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IRS_FORBIDDEN';
  END IF;
  IF v_task.status NOT IN ('queued', 'running') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'IRS_INVALID_TASK_STATE';
  END IF;

  UPDATE public.generation_tasks
  SET status = 'cancelled',
      cancelled_at = now(),
      updated_at = now()
  WHERE id = p_task_id;
  UPDATE public.usage_records
  SET status = 'cancelled'
  WHERE task_id = p_task_id;
  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reserve_generation_task(
  uuid, uuid, text, text, jsonb, text, text, integer, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_generation_task(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_generation_quota_usage(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.retry_generation_task(uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_generation_task(uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_generation_task(
  uuid, uuid, text, text, jsonb, text, text, integer, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_generation_task(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_generation_quota_usage(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_generation_task(uuid, uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_generation_task(uuid, uuid, boolean) TO service_role;

COMMIT;
