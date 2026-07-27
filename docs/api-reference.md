# API 参考文档

## 基础信息

- 基础路径: `/api/v1`
- 认证方式: `x-session` Header 或 `Authorization: Bearer irs_live_xxx`
- 响应格式: JSON

## 统一响应格式

### 成功

```json
{
  "data": {},
  "request_id": "req_xxx"
}
```

### 失败

```json
{
  "error": {
    "code": "QUOTA_EXCEEDED",
    "message": "今日生成额度已用完",
    "details": {}
  },
  "request_id": "req_xxx"
}
```

## 接口列表

### 图像生成

#### POST /api/v1/images/generations

创建图像生成任务。

**请求体**:

```json
{
  "model": "image-pro",
  "prompt": "一座位于河谷中的现代建筑群",
  "size": "1024x1024",
  "n": 1,
  "reference_asset_ids": [],
  "visible_watermark": false,
  "idempotency_key": "client-generated-key"
}
```

**响应** (201):

```json
{
  "data": {
    "task_id": "uuid",
    "status": "queued",
    "created_at": "2024-01-01T00:00:00Z",
    "status_url": "/api/v1/tasks/uuid"
  },
  "request_id": "req_xxx"
}
```

### 任务管理

#### GET /api/v1/tasks

获取当前用户的任务列表。

**查询参数**: page, page_size, status, model

#### GET /api/v1/tasks/:task_id

获取任务详情。

#### POST /api/v1/tasks/:task_id/cancel

取消排队中的任务。

#### POST /api/v1/tasks/:task_id/retry

重试失败的任务。

### 图片

#### GET /api/v1/images

获取当前用户的图片列表。

**查询参数**: page, page_size, favorite, model

#### GET /api/v1/images/:image_id

获取图片详情（含签名 URL）。

#### PATCH /api/v1/images/:image_id

更新图片属性（favorite）。

#### DELETE /api/v1/images/:image_id

软删除图片。

### 模型

#### GET /api/v1/models

获取可用模型列表。

### 使用量

#### GET /api/v1/usage

获取当前用户的使用量统计。

### API Key

#### GET /api/v1/api-keys

获取当前用户的 API Key 列表。

#### POST /api/v1/api-keys

创建新 API Key。

**请求体**:

```json
{
  "name": "My API Key",
  "scopes": ["images:generate", "images:read"],
  "expires_at": "2025-12-31T23:59:59Z"
}
```

**响应** (201):

```json
{
  "data": {
    "id": "uuid",
    "name": "My API Key",
    "key": "irs_live_xxxxxxxxxxxxxxxxx",
    "key_prefix": "irs_live_xxx",
    "scopes": ["images:generate", "images:read"],
    "created_at": "..."
  },
  "request_id": "req_xxx"
}
```

> **注意**: 完整 Key 仅在创建时展示一次。

#### POST /api/v1/api-keys/:key_id/revoke

吊销 API Key。

### 个人资料

#### GET /api/v1/profile

获取当前用户资料。

## 错误码

| 错误码 | HTTP | 说明 |
|--------|------|------|
| UNAUTHORIZED | 401 | 未认证 |
| FORBIDDEN | 403 | 无权限 |
| USER_DISABLED | 403 | 用户已禁用 |
| API_DISABLED | 403 | API 已关闭 |
| GENERATION_DISABLED | 503 | 生成服务已关闭 |
| INVALID_REQUEST | 400 | 请求参数错误 |
| INVALID_FILE | 400 | 文件格式错误 |
| MODEL_NOT_FOUND | 404 | 模型不存在 |
| MODEL_DISABLED | 404 | 模型已禁用 |
| MODEL_NOT_ALLOWED | 403 | 无权使用此模型 |
| SIZE_NOT_ALLOWED | 403 | 无权使用此尺寸 |
| QUOTA_EXCEEDED | 429 | 额度已用完 |
| CONCURRENCY_LIMITED | 429 | 并发已达上限 |
| RATE_LIMITED | 429 | 请求过于频繁 |
| TASK_NOT_FOUND | 404 | 任务不存在 |
| INVALID_TASK_STATE | 400 | 任务状态不允许此操作 |
| PROVIDER_TIMEOUT | 504 | 模型服务超时 |
| PROVIDER_RATE_LIMITED | 503 | 模型服务限流 |
| PROVIDER_REJECTED | 400 | 模型服务拒绝请求 |
| PROVIDER_ERROR | 500 | 模型服务错误 |
| STORAGE_ERROR | 500 | 存储服务错误 |
| INTERNAL_ERROR | 500 | 内部错误 |

## 速率限制

| 接口 | 限制 |
|------|------|
| 图像生成 | 10 次/分钟 |
| 上传 | 20 次/分钟 |
| API Key 创建 | 5 次/小时 |
| 登录 | 5 次/分钟 |
| 管理 API | 60 次/分钟 |
