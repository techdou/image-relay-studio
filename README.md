# Image Relay Studio

> Internal AI image-generation workbench. Wraps the Coze official SDK behind a web studio and an OpenAI-compatible internal API.

> 面向内部使用的 AI 图像生成平台。通过扣子官方 SDK 调用图像生成能力，统一封装为 Web 工作台与内部 API。

![status](https://img.shields.io/badge/status-internal%20use-orange)
![Next.js](https://img.shields.io/badge/Next.js-16-black)
![React](https://img.shields.io/badge/React-19-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6)
![License](https://img.shields.io/badge/license-MIT-green)

---

## Highlights

- **Web studio** — prompt-driven image generation with model picker, references, and task history.
- **OpenAI-compatible API** at `/api/v1/images/generations` — drop-in `base_url` for existing OpenAI clients.
- **Provider adapter layer** — Coze SDK provider, workflow provider, and a local mock for tests.
- **Per-user quotas** — failed generations don't consume quota; success only.
- **Admin console** — user management, model config, asset review, audit logs, health dashboard.
- **Security by default** — API keys hashed with SHA-256 + pepper, signed URLs (10-min TTL), structured logging with secret redaction, in-memory rate limiter, CSP/CORS via `src/proxy.ts`.

## 技术栈 / Tech Stack

| 层 | 选型 |
|---|---|
| Framework | Next.js 16 (App Router) |
| UI | React 19 · TypeScript 5 (strict) · shadcn/ui · Tailwind CSS 4 |
| Database | PostgreSQL via Supabase · Drizzle ORM |
| Auth | Supabase Auth (email + `x-session` header) |
| Storage | S3-compatible object storage |
| Image gen | `coze-coding-dev-sdk` |
| Validation | Zod 4 |
| Package manager | pnpm (strict — `preinstall` blocks npm/yarn) |

## 项目结构 / Project Structure

```
src/
├── app/                      # App Router
│   ├── (auth)/login/         # 登录页
│   ├── (app)/                # 主应用
│   │   ├── studio/           # 生图工作台
│   │   ├── tasks/            # 任务列表
│   │   ├── gallery/          # 图片库
│   │   ├── api-keys/         # API Key 管理
│   │   ├── usage/            # 使用量
│   │   ├── settings/         # 个人设置
│   │   └── admin/            # 管理后台
│   └── api/
│       ├── v1/               # OpenAI-compatible API
│       └── admin/            # 管理 API
├── components/               # UI 组件 (shadcn/ui + layout)
├── server/                   # 服务端核心逻辑
│   ├── auth/                 # 认证
│   ├── api-keys/             # API Key 服务
│   ├── audit/                # 审计
│   ├── providers/images/     # Provider 适配层
│   ├── tasks/                # 任务状态机与执行器
│   ├── storage/              # 对象存储
│   ├── quotas/               # 额度服务
│   └── validation/           # Zod schema
├── storage/database/         # Drizzle schema + Supabase client
├── lib/                      # 前端工具
├── hooks/                    # 自定义 Hooks
└── proxy.ts                  # CSP / CORS / 安全头
```

## Quick Start

### Prerequisites

- Node.js 20+ (project targets Node 20/24)
- pnpm 9+ (`corepack enable` if needed)
- A Supabase project (URL, anon key, service role key)
- S3-compatible bucket credentials

### Install & Run

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment
cp .env.example .env.local
# Edit .env.local with your real values — NEVER commit this file.

# 3. Apply database migrations
#    On the Coze platform this runs automatically; locally use:
# npx coze-coding-ai db upgrade

# 4. Start dev server
pnpm dev

# 5. Bootstrap the first admin (idempotent)
ADMIN_EMAIL=admin@yourdomain.com BOOTSTRAP_TOKEN=xxx pnpm run bootstrap-admin
```

### Environment Variables

See [`.env.example`](./.env.example) for the full list. Key entries:

| Variable | Description | Required |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | ✅ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (client-safe) | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only service role key | ✅ |
| `COZE_API_TOKEN` | Coze API token for model access (server only) | ✅ |
| `API_KEY_HASH_PEPPER` | Pepper for API key hashing (32+ chars) | ✅ prod |
| `ADMIN_EMAIL` | First admin's email | bootstrap |
| `BOOTSTRAP_TOKEN` | Bootstrap security token (required in PROD) | ✅ prod |
| `BOOTSTRAP_TOKEN` | Bootstrap security token | ✅ prod |

## OpenAI-compatible API

`/api/v1/` exposes an OpenAI-compatible surface. Point any OpenAI client at this service:

```python
from openai import OpenAI

client = OpenAI(
    api_key="irs_live_xxx",          # your API key from the console
    base_url="https://your-host/api/v1",
)

resp = client.images.generate(
    model="image-pro",
    prompt="a cat on a windowsill",
    n=1,
    size="1024x1024",
)
print(resp.data[0].url)
```

### Authentication

- **API Key**: `Authorization: Bearer irs_live_xxx`
- **Web session**: `x-session: <supabase_access_token>`

### Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/models` | List available models (OpenAI format for API Key auth) |
| POST | `/api/v1/images/generations` | Synchronous image generation |

Request body for `/api/v1/images/generations`:

```json
{
  "model": "image-pro",
  "prompt": "a cat on a windowsill",
  "n": 1,
  "size": "2K",
  "response_format": "url"
}
```

`size` accepts both native (`"2K"`) and OpenAI (`"1024x1024"`) forms — auto-mapped.

## Provider System

Three interchangeable providers live in `src/server/providers/images/`:

1. **CozeCodingProvider** — default, wraps `coze-coding-dev-sdk`.
2. **CozeWorkflowProvider** — calls a published Coze workflow.
3. **MockProvider** — local dev/test only. Never enable in production.

Models are configured in the `model_configs` table; admins manage them via the console.

## Database

PostgreSQL via Supabase, schema defined with Drizzle ORM. 11 core tables:

`profiles` · `user_quotas` · `model_configs` · `generation_tasks` · `generation_references` · `generation_assets` · `api_keys` · `usage_records` · `audit_logs` · `system_settings` · `moderation_events`

Apply schema with:

```bash
npx coze-coding-ai db upgrade
```

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start dev server |
| `pnpm build` | Production build |
| `pnpm start` | Start production server |
| `pnpm ts-check` | TypeScript type check |
| `pnpm lint` | ESLint |
| `pnpm validate` | Run `ts-check` + `lint:build` in parallel |
| `pnpm run bootstrap-admin` | Initialize first admin (idempotent) |

## 合规边界 / Compliance Boundaries

This project intentionally scopes itself to officially-supported surfaces.

- 仅使用扣子官方公开接口 — official public APIs only.
- 不使用 Cookie 或网页私有接口 — no cookies or private web endpoints.
- 不共享扣子账号 — no account sharing.
- 不转售调用权益 — no resale of invocation entitlements.
- 不绕过限流 — no rate-limit bypass.
- 不删除隐式 AI 标识 — implicit AI watermarks preserved.
- 仅在官方支持时关闭画面可见水印 — visible watermarks disabled only when officially supported.
- 产品界面保留 AI 生成说明 — UI keeps AI-generated disclosures.

## Security Notes

- All model calls happen server-side; provider credentials never reach the browser.
- API keys are stored as SHA-256 + pepper hashes; plaintext is shown **once** on creation.
- Object storage stores only keys; signed URLs are regenerated per request with a 10-minute TTL.
- Public registration is disabled; admins are bootstrapped via a token-protected endpoint.
- Global security headers (CSP / CORS / `X-Content-Type-Options`) are injected in `src/proxy.ts`.
- In-memory rate limiter caps `/api/v1/images/generations` at 60 req/min/user.
- Quota accounting only counts `succeeded` records; failures don't consume quota.
- Basic prompt moderation blocks CSAM / NCII / violent extremism / self-harm content.

> Found a security issue? Please don't open a public issue. See `docs/security.md` for disclosure guidance.

## Roadmap

- [ ] Streaming generation responses
- [ ] Multi-image edit (image-to-image) workflow
- [ ] Webhook callbacks for async tasks
- [ ] Per-model quota isolation
- [ ] Tighter moderation (third-party classifier)

## Documentation

- [`docs/architecture.md`](./docs/architecture.md) — system architecture
- [`docs/api-reference.md`](./docs/api-reference.md) — API reference
- [`docs/database.md`](./docs/database.md) — schema and migrations
- [`docs/security.md`](./docs/security.md) — security model
- [`docs/admin-guide.md`](./docs/admin-guide.md) — admin operations
- [`docs/provider-integration.md`](./docs/provider-integration.md) — provider adapter guide
- [`docs/compliance-boundaries.md`](./docs/compliance-boundaries.md) — compliance scope
- [`docs/troubleshooting.md`](./docs/troubleshooting.md) — common issues

## License

[MIT](./LICENSE) © TechDou
