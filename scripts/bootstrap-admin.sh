#!/usr/bin/env bash
# Bootstrap Admin User
# This script creates or upgrades a user to admin role.
# It is idempotent - can be run multiple times safely.
#
# Usage:
#   ADMIN_EMAIL=your@email.com \
#   BOOTSTRAP_TOKEN=xxx \
#   bash scripts/bootstrap-admin.sh
#
# Required environment variables:
#   ADMIN_EMAIL        Email of the user to bootstrap as admin.
#   BOOTSTRAP_TOKEN    Bootstrap token (must match the server-side BOOTSTRAP_TOKEN env).
#
# Note: ADMIN_EMAIL is passed to the tsx child process verbatim via the
# process environment and read inside the script with `process.env.ADMIN_EMAIL`.
# It is NEVER interpolated into the JS source, so values containing quotes,
# backticks, dollar signs, or any other special characters are safe.

set -euo pipefail

# ── Validate required inputs ───────────────────────────────────────────
if [ -z "${ADMIN_EMAIL:-}" ]; then
  echo "ERROR: ADMIN_EMAIL environment variable is required" >&2
  echo "Usage: ADMIN_EMAIL=your@email.com BOOTSTRAP_TOKEN=xxx bash scripts/bootstrap-admin.sh" >&2
  exit 1
fi

if [ -z "${BOOTSTRAP_TOKEN:-}" ]; then
  echo "ERROR: BOOTSTRAP_TOKEN environment variable is required" >&2
  echo "Usage: ADMIN_EMAIL=your@email.com BOOTSTRAP_TOKEN=xxx bash scripts/bootstrap-admin.sh" >&2
  exit 1
fi

# Re-export so they are guaranteed to be present in the child process env,
# even if the parent shell only set them as shell variables (not exports).
export ADMIN_EMAIL
export BOOTSTRAP_TOKEN

# Avoid echoing the token. Only confirm we have it.
echo "Bootstrapping admin user: $ADMIN_EMAIL (token present: yes)"

# ── Run the bootstrap logic ────────────────────────────────────────────
# The JS source below reads `process.env.ADMIN_EMAIL` and never embeds the
# value as a string literal, so it is immune to shell/JS injection via the
# email value.
pnpm exec tsx -e '
const { getSupabaseServerClient } = require("./src/storage/database/supabase-client");

async function bootstrap() {
  const email = process.env.ADMIN_EMAIL;
  if (!email) {
    console.error("ADMIN_EMAIL is not set in the environment");
    process.exit(1);
  }

  const supabase = getSupabaseServerClient();

  // Check if profile exists
  const { data: existing, error: fetchError } = await supabase
    .from("profiles")
    .select("id, user_id, role")
    .eq("email", email)
    .single();

  if (fetchError && fetchError.code !== "PGRST116") {
    // PGRST116 = no rows found, which is an expected case (create path).
    console.error("Failed to query profiles:", fetchError.message);
    process.exit(1);
  }

  if (existing) {
    if (existing.role === "admin") {
      console.log("User already has admin role:", email);
      return;
    }
    // Upgrade to admin
    const { error } = await supabase
      .from("profiles")
      .update({ role: "admin", status: "active" })
      .eq("id", existing.id);
    if (error) {
      console.error("Failed to upgrade user:", error.message);
      process.exit(1);
    }
    console.log("User upgraded to admin:", email);
  } else {
    // Create admin profile
    const userId = crypto.randomUUID();
    const { error } = await supabase
      .from("profiles")
      .insert({
        id: crypto.randomUUID(),
        user_id: userId,
        email: email,
        display_name: "Admin",
        role: "admin",
        status: "active",
      })
      .select()
      .single();

    if (error) {
      console.error("Failed to create admin user:", error.message);
      process.exit(1);
    }

    // Create default quota for admin
    const { error: quotaError } = await supabase.from("user_quotas").insert({
      user_id: userId,
      daily_image_limit: 999,
      monthly_image_limit: 9999,
      max_concurrent_tasks: 10,
      max_images_per_request: 4,
      api_access_enabled: true,
      retention_days: 365,
    });

    if (quotaError) {
      console.error("Failed to create admin quota:", quotaError.message);
      process.exit(1);
    }

    console.log("Admin user created:", email);
  }
}

bootstrap().catch((e) => {
  console.error(e);
  process.exit(1);
});
'

echo "Done."
