-- Seed data for Image Relay Studio
-- Run this after migrations to set up default system settings and model configs

-- ============================================
-- System Settings
-- ============================================
INSERT INTO system_settings (key, value, description) VALUES
  ('generation_enabled', 'true', '全局图像生成开关'),
  ('api_enabled', 'true', 'API 访问总开关'),
  ('public_registration_enabled', 'false', '公开注册开关'),
  ('default_daily_limit', '50', '默认每日生成限额'),
  ('default_monthly_limit', '500', '默认每月生成限额'),
  ('default_max_concurrency', '3', '默认最大并发数'),
  ('default_retention_days', '90', '默认数据保留天数'),
  ('prompt_logging_mode', 'redacted', 'Prompt 日志模式: full/redacted/disabled'),
  ('maintenance_message', '', '维护公告信息')
ON CONFLICT (key) DO NOTHING;

-- ============================================
-- Default Model Configs
-- ============================================
-- Note: external_model_id and workflow_id should be updated
-- with real values when Coze provider is configured.

INSERT INTO model_configs (code, display_name, provider_type, external_model_id, enabled, sort_order,
  supports_text_to_image, supports_image_to_image, supports_multiple_references,
  supports_sequential_generation, supports_visible_watermark_control,
  supported_sizes, max_images_per_request, max_provider_concurrency, timeout_seconds,
  default_parameters, capability_metadata) VALUES

('image-pro', 'Image Pro', 'coze_coding', '', true, 1,
  true, true, false, false, false,
  '["1024x1024","1024x1792","1792x1024"]', 4, 5, 120,
  '{}', '{"description": "高质量图像生成模型"}'),

('image-standard', 'Image Standard', 'coze_coding', '', true, 2,
  true, false, false, false, false,
  '["1024x1024"]', 4, 10, 90,
  '{}', '{"description": "标准图像生成模型"}'),

('image-mock', 'Mock Provider', 'mock', 'mock-model', false, 99,
  true, true, true, true, true,
  '["512x512","1024x1024","1024x1792","1792x1024"]', 4, 100, 30,
  '{}', '{"description": "本地开发和测试用 Mock 模型"}')

ON CONFLICT DO NOTHING;
