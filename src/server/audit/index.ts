import { getSupabaseClient } from '@/storage/database/supabase-client';
import { logger } from '@/server/logging';
import { sanitizeForLog } from '@/server/logging';

export interface AuditLogEntry {
  actor_user_id?: string;
  actor_role?: string;
  action: string;
  resource_type?: string;
  resource_id?: string;
  request_id?: string;
  ip_hash?: string;
  user_agent?: string;
  before_data?: Record<string, unknown>;
  after_data?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export async function createAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    const client = getSupabaseClient();
    await client.from('audit_logs').insert({
      ...entry,
    });
  } catch (error) {
    logger.error('Failed to create audit log', {
      error: error instanceof Error ? error.message : 'Unknown',
      action: entry.action,
      resource_type: entry.resource_type,
    });
  }
}

export async function getAuditLogs(options: {
  actor_user_id?: string;
  action?: string;
  resource_type?: string;
  limit?: number;
  offset?: number;
}): Promise<{ logs: unknown[]; total: number }> {
  const client = getSupabaseClient();
  let query = client
    .from('audit_logs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (options.actor_user_id) query = query.eq('actor_user_id', options.actor_user_id);
  if (options.action) query = query.eq('action', options.action);
  if (options.resource_type) query = query.eq('resource_type', options.resource_type);
  if (options.limit) query = query.limit(options.limit);
  if (options.offset) query = query.range(options.offset, options.offset + (options.limit || 50) - 1);

  const { data, error, count } = await query;
  if (error) {
    logger.error('Failed to fetch audit logs', { error: error.message });
    return { logs: [], total: 0 };
  }

  return { logs: data || [], total: count || 0 };
}

// AuditLogger class for route consumers
export class AuditLogger {
  constructor(
    private userId: string,
    private role: string,
    private requestId: string
  ) {}

  async logAction(
    action: string,
    resourceType: string,
    resourceId: string | null,
    beforeData: Record<string, unknown> | null,
    afterData: Record<string, unknown> | null
  ): Promise<void> {
    await createAuditLog({
      actor_user_id: this.userId,
      actor_role: this.role,
      action,
      resource_type: resourceType,
      resource_id: resourceId || undefined,
      request_id: this.requestId,
      before_data: beforeData || undefined,
      after_data: afterData || undefined,
    });
  }
}

export function createAuditLogger(userId: string, role: string, requestId: string): AuditLogger {
  return new AuditLogger(userId, role, requestId);
}
