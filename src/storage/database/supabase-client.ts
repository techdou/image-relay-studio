import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getReportBuffer, createWrappedFetch } from 'coze-coding-dev-sdk';

let envLoaded = false;

interface SupabaseCredentials {
  url: string;
  anonKey: string;
}

function loadEnv(): void {
  if (envLoaded || (process.env.COZE_SUPABASE_URL && process.env.COZE_SUPABASE_ANON_KEY)) {
    return;
  }

  try {
    try {
      require('dotenv').config();
      if (process.env.COZE_SUPABASE_URL && process.env.COZE_SUPABASE_ANON_KEY) {
        envLoaded = true;
        return;
      }
    } catch {
      // dotenv not available
    }

    const { execSync } = require('child_process');
    const pythonCode = `
import os
import sys
try:
    from coze_workload_identity import Client
    client = Client()
    env_vars = client.get_project_env_vars()
    client.close()
    for env_var in env_vars:
        print(f"{env_var.key}={env_var.value}")
except Exception as e:
    print(f"# Error: {e}", file=sys.stderr)
`;

    const output = execSync(`python3 -c '${pythonCode.replace(/'/g, "'\"'\"'")}'`, {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const lines = output.trim().split('\n');
    for (const line of lines) {
      if (line.startsWith('#')) continue;
      const eqIndex = line.indexOf('=');
      if (eqIndex > 0) {
        const key = line.substring(0, eqIndex);
        let value = line.substring(eqIndex + 1);
        if ((value.startsWith("'") && value.endsWith("'")) ||
            (value.startsWith('"') && value.endsWith('"'))) {
          value = value.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }

    envLoaded = true;
  } catch (err) {
    // Module-load-time failure to discover env vars (e.g. dotenv missing,
    // python helper unavailable). Surface it loudly via stderr so it is not
    // confused with a successful lookup, but do NOT rethrow — the caller
    // (getSupabaseCredentials / getSupabaseServiceRoleKey) is responsible
    // for deciding whether to hard-fail based on which key it needs.
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error('[supabase-client] loadEnv failed to populate env vars.', msg);
  }
}

export function getSupabaseCredentials(): SupabaseCredentials {
  loadEnv();

  const url = process.env.COZE_SUPABASE_URL;
  const anonKey = process.env.COZE_SUPABASE_ANON_KEY;

  if (!url) {
    throw new Error('COZE_SUPABASE_URL is not set');
  }
  if (!anonKey) {
    throw new Error('COZE_SUPABASE_ANON_KEY is not set');
  }

  return { url, anonKey };
}

function getSupabaseServiceRoleKey(): string | undefined {
  loadEnv();

  const key = process.env.COZE_SUPABASE_SERVICE_ROLE_KEY
    // Backward-compatible alias for deployments not using the COZE_ prefix.
    || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (key) {
    return key;
  }

  // Missing service role key. Behavior depends on environment:
  //  - In PROD we MUST NOT silently fall back to the anon key: callers like the
  //    task executor or audit logger assume they are running with admin
  //    privileges. Returning anon here would cause service-side writes to be
  //    rejected by RLS with a misleading "permission denied" instead of an
  //    obvious config error. Throw so the misconfiguration is caught early.
  //  - In DEV we tolerate the fallback (e.g. local supabase where anon also
  //    bypasses RLS) but warn so developers notice the missing key.
  const isProduction = process.env.COZE_PROJECT_ENV === 'PROD';
  const source = process.env.COZE_SUPABASE_SERVICE_ROLE_KEY
    ? 'COZE_SUPABASE_SERVICE_ROLE_KEY'
    : 'SUPABASE_SERVICE_ROLE_KEY';

  if (isProduction) {
    throw new Error(
      `[supabase-client] ${source} is not set in production. ` +
      'Server-side admin operations cannot safely fall back to the anon key. ' +
      'Set the service role key before deploying.',
    );
  }

  console.warn(
    `[supabase-client] ${source} is not set; falling back to anon key. ` +
    'Service-side operations will be subject to RLS. This is acceptable in DEV only.',
  );
  return undefined;
}

/**
 * Server-side Supabase client (alias for getSupabaseClient).
 *
 * Same callable as `getSupabaseClient` — kept as a named alias because many
 * route handlers import this name. Pass an optional `token` to scope RLS to
 * the requesting user; omit it for service/admin operations.
 */
export const getSupabaseServerClient = getSupabaseClient;

/**
 * Get a Supabase client for server-side use.
 *
 * **Authentication model:**
 * - `getSupabaseClient()` (no token) → uses the service role key
 *   (`COZE_SUPABASE_SERVICE_ROLE_KEY`, falling back to `SUPABASE_SERVICE_ROLE_KEY`)
 *   which bypasses RLS. Use for admin operations or when RLS bypass is
 *   intentional. In PROD a missing service role key throws rather than
 *   silently downgrading to anon — see getSupabaseServiceRoleKey(). In DEV it
 *   falls back to anon with a console warning.
 * - `getSupabaseClient(sessionToken)` → uses anon key + sets `Authorization:
 *   Bearer <token>` header. Use when you need RLS to enforce per-user access
 *   (e.g. user-facing API routes).
 *
 * @param token - Optional Supabase access token for user-scoped RLS queries.
 */
export function getSupabaseClient(token?: string): SupabaseClient {
  const { url, anonKey } = getSupabaseCredentials();

  let key: string;
  if (token) {
    key = anonKey;
  } else {
    const serviceRoleKey = getSupabaseServiceRoleKey();
    key = serviceRoleKey ?? anonKey;
  }

  const globalOptions: Record<string, unknown> = {};
  if (token) {
    globalOptions.headers = { Authorization: `Bearer ${token}` };
  }
  try {
    const buffer = getReportBuffer();
    if (buffer) {
      globalOptions.fetch = createWrappedFetch(buffer, 'supabase');
    }
  } catch {
    // Silent
  }

  return createClient(url, key, {
    global: globalOptions,
    db: {
      timeout: 60000,
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
