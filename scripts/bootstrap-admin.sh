#!/usr/bin/env bash
# Bootstrap Admin User
# This script creates or upgrades a user to admin role.
# It is idempotent - can be run multiple times safely.
#
# Usage: BOOTSTRAP_ADMIN_EMAIL=your@email.com pnpm run bootstrap-admin

set -euo pipefail

ADMIN_EMAIL="${BOOTSTRAP_ADMIN_EMAIL:-}"

if [ -z "$ADMIN_EMAIL" ]; then
  echo "ERROR: BOOTSTRAP_ADMIN_EMAIL environment variable is required"
  echo "Usage: BOOTSTRAP_ADMIN_EMAIL=your@email.com pnpm run bootstrap-admin"
  exit 1
fi

echo "Bootstrapping admin user: $ADMIN_EMAIL"

# Use tsx to run the bootstrap script
npx tsx -e "
const { getSupabaseServerClient } = require('./src/storage/database/supabase-client');

async function bootstrap() {
  const supabase = getSupabaseServerClient();
  
  // Check if profile exists
  const { data: existing } = await supabase
    .from('profiles')
    .select('id, user_id, role')
    .eq('email', '${ADMIN_EMAIL}')
    .single();
  
  if (existing) {
    if (existing.role === 'admin') {
      console.log('User already has admin role:', '${ADMIN_EMAIL}');
      return;
    }
    // Upgrade to admin
    const { error } = await supabase
      .from('profiles')
      .update({ role: 'admin', status: 'active' })
      .eq('id', existing.id);
    if (error) {
      console.error('Failed to upgrade user:', error);
      process.exit(1);
    }
    console.log('User upgraded to admin:', '${ADMIN_EMAIL}');
  } else {
    // Create admin profile
    const userId = crypto.randomUUID();
    const { data, error } = await supabase
      .from('profiles')
      .insert({
        id: crypto.randomUUID(),
        user_id: userId,
        email: '${ADMIN_EMAIL}',
        display_name: 'Admin',
        role: 'admin',
        status: 'active',
      })
      .select()
      .single();
    
    if (error) {
      console.error('Failed to create admin user:', error);
      process.exit(1);
    }
    
    // Create default quota for admin
    await supabase.from('user_quotas').insert({
      user_id: userId,
      daily_image_limit: 999,
      monthly_image_limit: 9999,
      max_concurrent_tasks: 10,
      max_images_per_request: 4,
      api_access_enabled: true,
      retention_days: 365,
    });
    
    console.log('Admin user created:', '${ADMIN_EMAIL}');
  }
}

bootstrap().catch(e => { console.error(e); process.exit(1); });
"

echo "Done."
