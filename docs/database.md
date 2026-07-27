# 数据库设计文档

## 表结构

### 1. profiles - 用户档案

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键 |
| user_id | uuid | Supabase Auth 用户 ID |
| email | text | 用户邮箱 |
| display_name | text | 显示名称 |
| avatar_key | text | 头像对象存储 key |
| role | text | 角色: admin / user |
| status | text | 状态: active / disabled / pending |
| last_login_at | timestamptz | 最后登录时间 |
| created_at | timestamptz | 创建时间 |
| updated_at | timestamptz | 更新时间 |

### 2. user_quotas - 用户额度

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键 |
| user_id | uuid | 关联用户 |
| daily_image_limit | integer | 每日生成限额 |
| monthly_image_limit | integer | 每月生成限额 |
| max_concurrent_tasks | integer | 最大并发任务 |
| max_images_per_request | integer | 单次最大图片数 |
| api_access_enabled | boolean | API 访问开关 |
| allowed_model_codes | jsonb | 允许的模型代码列表 |
| allowed_sizes | jsonb | 允许的图片尺寸列表 |
| retention_days | integer | 数据保留天数 |
| created_at | timestamptz | 创建时间 |
| updated_at | timestamptz | 更新时间 |

### 3. model_configs - 模型配置

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键 |
| code | text | 内部模型代码 (唯一) |
| display_name | text | 前台显示名称 |
| provider_type | text | Provider 类型 |
| external_model_id | text | 外部模型 ID |
| workflow_id | text | 工作流 ID |
| enabled | boolean | 是否启用 |
| sort_order | integer | 排序 |
| supports_text_to_image | boolean | 支持文生图 |
| supports_image_to_image | boolean | 支持图生图 |
| supports_multiple_references | boolean | 支持多参考图 |
| supports_sequential_generation | boolean | 支持连续叙事 |
| supports_visible_watermark_control | boolean | 支持关闭可见水印 |
| supported_sizes | jsonb | 支持的尺寸列表 |
| max_images_per_request | integer | 单次最大图片数 |
| max_provider_concurrency | integer | Provider 最大并发 |
| timeout_seconds | integer | 超时时间 |
| default_parameters | jsonb | 默认参数 |
| capability_metadata | jsonb | 能力元数据 |
| created_at | timestamptz | 创建时间 |
| updated_at | timestamptz | 更新时间 |

### 4. generation_tasks - 生成任务

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键 |
| user_id | uuid | 关联用户 |
| model_config_id | uuid | 关联模型 |
| task_type | text | 类型: text_to_image / image_to_image |
| status | text | 状态: queued / running / succeeded / failed / cancelled |
| prompt | text | 生成提示词 |
| request_parameters | jsonb | 请求参数 |
| idempotency_key | text | 幂等键 |
| provider_request_id | text | Provider 请求 ID |
| provider_task_id | text | Provider 任务 ID |
| attempt_count | integer | 尝试次数 |
| progress | integer | 进度百分比 |
| queued_at | timestamptz | 排队时间 |
| started_at | timestamptz | 开始时间 |
| completed_at | timestamptz | 完成时间 |
| error_code | text | 错误代码 |
| error_message | text | 错误消息 |
| error_details | jsonb | 错误详情 |
| latency_ms | integer | 耗时毫秒 |
| cancelled_at | timestamptz | 取消时间 |
| deleted_at | timestamptz | 软删除时间 |
| created_at | timestamptz | 创建时间 |
| updated_at | timestamptz | 更新时间 |

### 5-11. 其他表

- `generation_references` - 参考图记录
- `generation_assets` - 生成资产记录
- `api_keys` - API 密钥 (仅存哈希)
- `usage_records` - 使用量记录
- `audit_logs` - 审计日志
- `system_settings` - 系统设置
- `moderation_events` - 内容审核事件

详细字段见 `supabase/migrations/` 中的 SQL 文件。

## RLS 策略

所有核心表启用行级安全：

- **普通用户**: 只能访问 `user_id = auth.uid()` 的记录
- **管理员**: 通过 service_role 绕过 RLS 访问全局
- **Service Role**: 仅服务端使用，绕过 RLS

实际权限判断在服务端 API 层执行，RLS 作为额外安全层。

## 索引

- `profiles.user_id` - 唯一索引
- `profiles.email` - 唯一索引
- `generation_tasks.user_id` - 查询用户任务
- `generation_tasks.status` - 查询任务状态
- `generation_tasks.model_config_id` - 按模型筛选
- `generation_assets.user_id` - 查询用户资产
- `generation_assets.task_id` - 关联任务
- `api_keys.key_hash` - API Key 验证
- `api_keys.user_id` - 查询用户 Key
- `usage_records.user_id` - 使用量查询
- `audit_logs.actor_user_id` - 审计查询
- `audit_logs.created_at` - 时间范围查询
