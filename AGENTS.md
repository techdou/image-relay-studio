# Image Relay Studio - AI 图像生成工作台

## 项目概览

内部 AI 图像生成平台，面向白名单用户使用。通过扣子官方 SDK 调用图像生成能力，统一封装为 Web 工作台和内部 API。

## 版本技术栈

- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5 (strict mode)
- **UI 组件**: shadcn/ui (基于 Radix UI)
- **Styling**: Tailwind CSS 4
- **Database**: PostgreSQL via Supabase (Drizzle ORM)
- **Auth**: Supabase Auth (邮箱登录, x-session header)
- **Storage**: S3 Compatible Object Storage (coze-coding-dev-sdk)
- **Image Generation**: coze-coding-dev-sdk ImageGenerationClient
- **Validation**: Zod 4
- **Package Manager**: pnpm (禁止 npm/yarn)

## 目录结构

```
src/
├── app/
│   ├── (auth)/login/          # 登录页
│   ├── (app)/                 # 主应用布局
│   │   ├── studio/            # 生图工作台
│   │   ├── tasks/             # 任务列表
│   │   ├── gallery/           # 图片库
│   │   ├── gallery/[id]/      # 图片详情
│   │   ├── api-keys/          # API Key 管理
│   │   ├── usage/             # 使用量
│   │   ├── settings/          # 个人设置
│   │   └── admin/             # 管理后台
│   │       ├── users/         # 用户管理
│   │       ├── tasks/         # 任务管理
│   │       ├── assets/        # 资产管理
│   │       ├── models/        # 模型配置
│   │       ├── settings/      # 系统设置
│   │       ├── audit-logs/    # 审计日志
│   │       └── health/        # 健康状态
│   └── api/
│       ├── health/            # 健康检查
│       ├── supabase-config/   # Supabase 前端配置
│       ├── auth/              # 认证接口
│       │   ├── profile/       # 获取当前用户资料
│       │   ├── sign-out/      # 退出登录
│       │   └── bootstrap/     # 管理员初始化 (无需认证，幂等)
│       ├── upload/            # 上传接口
│       ├── v1/                # 统一 API v1
│       │   ├── images/        # 图片接口 (含 generations)
│       │   ├── tasks/         # 任务接口
│       │   ├── models/        # 模型接口
│       │   ├── usage/         # 使用量接口
│       │   ├── api-keys/      # API Key 接口
│       │   └── profile/       # 用户资料接口
│       └── admin/             # 管理接口
├── components/
│   ├── ui/                    # shadcn/ui 组件
│   ├── layout/                # 布局组件 (Sidebar, AppLayout)
│   └── resource-preconnect.tsx # 外部资源预连接
├── server/                    # 服务端核心逻辑
│   ├── auth/                  # 认证服务
│   ├── api-keys/              # API Key 服务
│   ├── audit/                 # 审计服务
│   ├── errors.ts              # 统一错误类型
│   ├── api-helpers.ts         # API 辅助函数
│   ├── logging/               # 结构化日志
│   ├── rate-limit.ts          # 内存限流器
│   ├── providers/images/      # Provider 适配层
│   │   ├── types.ts           # Provider 接口定义
│   │   ├── coze-coding-provider.ts  # Coze SDK Provider
│   │   ├── mock-provider.ts   # Mock Provider
│   │   └── index.ts           # Provider Router
│   ├── tasks/                 # 任务系统
│   │   ├── state-machine.ts   # 任务状态机
│   │   └── executor.ts        # 任务执行器
│   ├── storage/               # 对象存储服务
│   ├── quotas/                # 额度服务
│   └── validation/            # Zod Schema
├── storage/database/          # 数据库层
│   ├── supabase-client.ts     # Supabase 客户端
│   └── shared/schema.ts       # Drizzle Schema
├── lib/                       # 前端工具
│   ├── auth-context.tsx       # 认证上下文
│   ├── supabase-browser.ts    # 浏览器端 Supabase
│   └── supabase-config-inject.tsx
├── hooks/                     # 自定义 Hooks
├── types/                     # 全局类型
├── styles/                    # 样式
└── proxy.ts                   # Next.js 16.1+ Proxy (CSP/CORS/安全头)
```

## 构建和测试命令

- 开发：`coze dev` 或 `pnpm dev`
- 构建：`pnpm build`
- 启动：`pnpm start`
- 类型检查：`pnpm ts-check`
- Lint：`pnpm lint`
- 数据库升级：`npx coze-coding-ai db upgrade`

## 代码风格指南

- TypeScript strict mode，禁止隐式 any
- 错误处理：使用 `AppError` + `ErrorCodes`
- API 响应：使用 `successResponse` / `errorResponse` / `paginatedResponse`
- 认证：所有 API 使用 `authenticateRequest` 验证
- 权限：admin 路由需额外检查 `profile.role === 'admin'`
- 日志：使用 `createLogger` 结构化日志，自动脱敏敏感信息
- 数据库：使用 `getSupabaseClient()` 获取服务端客户端
- 存储：使用 `createStorageClient()` 获取对象存储客户端
- Provider：使用 `getProviderRouter()` 获取 Provider 路由

## 数据库

11 张核心表，使用 Drizzle ORM 定义 Schema，通过 `npx coze-coding-ai db upgrade` 同步。

核心表：profiles, user_quotas, model_configs, generation_tasks, generation_references, generation_assets, api_keys, usage_records, audit_logs, system_settings, moderation_events

## 关键设计决策

- 所有模型调用在服务端，通过 Provider Adapter 隔离
- API Key 使用 SHA-256 + pepper 哈希存储，明文只展示一次
- 任务状态机严格约束迁移规则
- 对象存储只存 key，Signed URL 动态生成（默认 10 分钟过期）
- 默认关闭公开注册，管理员通过 Bootstrap 初始化
- 全局安全头通过 `src/proxy.ts` 注入（CSP、CORS、X-Content-Type-Options）
- 内存限流器保护 `/api/v1/images/generations`（60 req/min/user）
- 配额统计仅计算 succeeded 记录，失败不消耗额度
- 基础 prompt 内容审核（禁止 CSAM/NCII/暴力极端主义/自残内容）

## OpenAI 兼容 API

`/api/v1/` 下的接口兼容 OpenAI API 格式，支持 `base_url` 指向本服务。

### 认证方式
- API Key: `Authorization: Bearer irs_live_xxx`
- Web Session: `x-session: <supabase_access_token>`

### 接口列表

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/v1/models` | GET | 列出可用模型（API Key 认证返回 OpenAI 格式） |
| `/api/v1/images/generations` | POST | 同步生成图片，兼容 OpenAI Images API |

### 请求格式（/api/v1/images/generations）

```json
{
  "model": "image-pro",        // 支持 image-pro, image-standard, 或 dall-e-2/dall-e-3 映射
  "prompt": "a cat on a windowsill",
  "n": 1,                      // 1-4
  "size": "2K",                // 支持 OpenAI 格式如 "1024x1024" 自动映射
  "response_format": "url"     // "url" 或 "b64_json"
}
```

### 响应格式（OpenAI 兼容）

```json
{
  "created": 1234567890,
  "data": [
    {
      "url": "https://signed-url-to-image.png",
      "revised_prompt": "a cat on a windowsill"
    }
  ]
}
```

### 错误格式（OpenAI 兼容）

```json
{
  "error": {
    "code": "QUOTA_EXCEEDED",
    "message": "Daily image generation quota exceeded",
    "type": "invalid_request_error"
  }
}
```

### 使用示例

```python
from openai import OpenAI

client = OpenAI(
    api_key="irs_live_xxx",
    base_url="https://your-domain/api/v1"
)

response = client.images.generate(
    model="image-pro",
    prompt="a cat sitting on a windowsill",
    n=1,
    size="1024x1024"
)

print(response.data[0].url)
```
