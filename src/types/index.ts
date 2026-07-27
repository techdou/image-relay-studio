export type UserRole = 'admin' | 'user';
export type UserStatus = 'active' | 'disabled' | 'pending';

export type TaskType = 'text_to_image' | 'image_to_image';
export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type RequestSource = 'web' | 'api' | 'admin_retry';

export type ProviderType = 'coze_coding' | 'coze_workflow' | 'mock';

export interface Profile {
  id: string;
  user_id: string;
  email: string;
  display_name: string | null;
  avatar_key: string | null;
  role: UserRole;
  status: UserStatus;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserQuota {
  id: string;
  user_id: string;
  daily_image_limit: number;
  monthly_image_limit: number;
  max_concurrent_tasks: number;
  max_images_per_request: number;
  api_access_enabled: boolean;
  allowed_model_codes: string[];
  allowed_sizes: string[];
  retention_days: number;
  created_at: string;
  updated_at: string;
}

export interface ModelConfig {
  id: string;
  code: string;
  display_name: string;
  provider_type: ProviderType;
  external_model_id: string | null;
  workflow_id: string | null;
  enabled: boolean;
  sort_order: number;
  supports_text_to_image: boolean;
  supports_image_to_image: boolean;
  supports_multiple_references: boolean;
  supports_sequential_generation: boolean;
  supports_visible_watermark_control: boolean;
  supported_sizes: string[];
  max_images_per_request: number;
  max_provider_concurrency: number;
  timeout_seconds: number;
  default_parameters: Record<string, unknown>;
  capability_metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface GenerationTask {
  id: string;
  user_id: string;
  model_config_id: string;
  task_type: TaskType;
  status: TaskStatus;
  prompt: string;
  request_parameters: Record<string, unknown>;
  idempotency_key: string | null;
  provider_request_id: string | null;
  provider_task_id: string | null;
  attempt_count: number;
  progress: number;
  queued_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  error_code: string | null;
  error_message: string | null;
  error_details: Record<string, unknown> | null;
  latency_ms: number | null;
  cancelled_at: string | null;
  url?: string;
  thumbnail_url?: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface GenerationReference {
  id: string;
  task_id: string;
  user_id: string;
  object_key: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  width: number | null;
  height: number | null;
  sha256: string;
  created_at: string;
}

export interface GenerationAsset {
  id: string;
  task_id: string;
  user_id: string;
  object_key: string;
  thumbnail_key: string | null;
  original_filename: string | null;
  mime_type: string | null;
  file_size: number | null;
  width: number | null;
  height: number | null;
  sha256: string | null;
  provider_metadata: Record<string, unknown> | null;
  ai_generated: boolean;
  visible_watermark_disabled: boolean;
  favorite: boolean;
  url?: string;
  thumbnail_url?: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiKey {
  id: string;
  user_id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  scopes: string[];
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface UsageRecord {
  id: string;
  user_id: string;
  task_id: string;
  api_key_id: string | null;
  model_config_id: string;
  request_source: RequestSource;
  requested_image_count: number;
  generated_image_count: number;
  status: string;
  latency_ms: number | null;
  provider_request_id: string | null;
  created_at: string;
}

export interface AuditLog {
  id: string;
  actor_user_id: string | null;
  actor_role: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  request_id: string | null;
  ip_hash: string | null;
  user_agent: string | null;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface SystemSetting {
  id: string;
  key: string;
  value: string;
  description: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ModerationEvent {
  id: string;
  task_id: string;
  user_id: string;
  stage: string;
  decision: string;
  reason: string | null;
  rule_codes: string[] | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

// API Response types
export interface ApiSuccessResponse<T> {
  data: T;
  request_id: string;
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  request_id: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  page_size: number;
  request_id: string;
}
