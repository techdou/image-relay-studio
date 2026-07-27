#!/usr/bin/env bash
# Cleanup Script
# Cleans up soft-deleted records, orphaned files, expired API keys, and expired task locks
# Safe to run repeatedly (idempotent)

set -euo pipefail

echo "=== Image Relay Studio Cleanup ==="

RETENTION_DAYS="${DEFAULT_RETENTION_DAYS:-90}"
CUTOFF_DATE=$(date -d "-${RETENTION_DAYS} days" -Iseconds 2>/dev/null || date -v-${RETENTION_DAYS}d -Iseconds 2>/dev/null || echo "")

if [ -z "$CUTOFF_DATE" ]; then
  echo "ERROR: Unable to calculate cutoff date"
  exit 1
fi

echo "Retention period: ${RETENTION_DAYS} days"
echo "Cutoff date: ${CUTOFF_DATE}"
echo ""

pnpm exec tsx -e "
const { getSupabaseServerClient } = require('./src/storage/database/supabase-client');

async function cleanup() {
  const supabase = getSupabaseServerClient();
  
  // 1. Clean soft-deleted assets older than retention
  const { count: deletedAssets, error: e1 } = await supabase
    .from('generation_assets')
    .delete({ count: 'exact' })
    .not('deleted_at', 'is', null)
    .lt('deleted_at', '${CUTOFF_DATE}');
  console.log('Soft-deleted assets cleaned:', deletedAssets || 0, e1 ? 'Error: ' + e1.message : '');
  
  // 2. Clean revoked API keys older than 90 days
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const { count: revokedKeys, error: e2 } = await supabase
    .from('api_keys')
    .delete({ count: 'exact' })
    .not('revoked_at', 'is', null)
    .lt('revoked_at', ninetyDaysAgo);
  console.log('Revoked API keys cleaned:', revokedKeys || 0, e2 ? 'Error: ' + e2.message : '');
  
  // 3. Clean expired API keys
  const { count: expiredKeys, error: e3 } = await supabase
    .from('api_keys')
    .delete({ count: 'exact' })
    .not('expires_at', 'is', null)
    .lt('expires_at', new Date().toISOString());
  console.log('Expired API keys cleaned:', expiredKeys || 0, e3 ? 'Error: ' + e3.message : '');
  
  // 4. Reset stuck running tasks (lock timeout - 30 minutes)
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { count: stuckTasks, error: e4 } = await supabase
    .from('generation_tasks')
    .update({ status: 'failed', error_code: 'TIMEOUT', error_message: 'Task lock expired' })
    .eq('status', 'running')
    .lt('started_at', thirtyMinAgo);
  console.log('Stuck tasks reset:', stuckTasks || 0, e4 ? 'Error: ' + e4.message : '');
  
  // 5. Clean old audit logs (older than 1 year)
  const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
  const { count: oldLogs, error: e5 } = await supabase
    .from('audit_logs')
    .delete({ count: 'exact' })
    .lt('created_at', oneYearAgo);
  console.log('Old audit logs cleaned:', oldLogs || 0, e5 ? 'Error: ' + e5.message : '');
}

cleanup().catch(e => { console.error(e); process.exit(1); });
"

echo ""
echo "=== Cleanup Complete ==="
