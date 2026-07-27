# Image Relay Studio

面向白名单用户的内部 AI 图像生成工作台。项目通过 Provider 适配层封装扣子官方图像生成能力，同时提供 Web 控制台和 OpenAI Images API 兼容接口。

![status](https://img.shields.io/badge/status-internal%20use-orange)
![Next.js](https://img.shields.io/badge/Next.js-16-black)
![React](https://img.shields.io/badge/React-19-149eca)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)
![License](https://img.shields.io/badge/license-MIT-green)

## 核心能力

- 图像工作台：文生图、参考图编辑、模型与尺寸选择、任务记录和图片库。
- OpenAI 兼容 API：支持 `/api/v1/models` 和 `/api/v1/images/generations`。
- 统一任务系统：状态迁移、取消、重试和 Provider 并发领取均由数据库原子操作约束。
- 额度与权限：日/月额度、并发限制、模型白名单和细粒度 API Key Scope。
- 管理后台：用户、任务、资产、模型、系统设置、审计日志和健康状态。
- 安全基线：Supabase Auth、行级安全策略（Row Level Security，RLS）、服务端密钥、短时签名 URL、结构化日志脱敏、内容审核与安全响应头。

## 技术栈

| 范畴 | 选型 |
|---|---|
| Web | Next.js 16 App Router、React 19 |
| 语言 | TypeScript 5，strict mode |
| UI | shadcn/ui、Radix UI、Tailwind CSS 4 |
| 数据库 | PostgreSQL、Supabase、Drizzle ORM |
| 认证 | Supabase Auth；Web Session 与内部 API Key |
| 存储 | S3 兼容对象存储 |
| 图像 Provider | `coze-coding-dev-sdk` |
| 校验与测试 | Zod 4、Node Test Runner、ESLint |
| 包管理器 | pnpm 9+ |

## 目录约定

```text
.
├── public/                    # 需要随应用发布的静态资源
├── scripts/                   # 构建、启动、校验和运维脚本
├── src/
│   ├── app/
│   │   ├── (auth)/           # 登录等公开认证页面
│   │   ├── (app)/            # 登录后的工作台与管理后台
│   │   └── api/              # 健康、认证、v1 与 admin API
│   ├── components/           # 通用 UI 与布局组件
│   ├── hooks/                # React Hooks
│   ├── lib/                  # 浏览器端基础设施
│   ├── server/               # 认证、任务、额度、Provider、存储等服务端逻辑
│   ├── storage/database/     # Supabase 客户端与 Drizzle Schema
│   └── proxy.ts              # CSP、CORS 与其他安全响应头
├── supabase/
│   ├── migrations/           # 按编号追加的数据库迁移
│   └── seed.sql              # 初始模型与系统数据
├── tests/                    # 不依赖生产服务的自动化测试
├── docs/                     # 架构、API、安全和运维文档
└── assets/                   # 本地调试素材；已忽略，不参与发布
```

新增代码应放在职责对应的目录中。可发布资源放入 `public/`；个人素材、临时脚本、IDE 和 AI 开发工具配置不得进入版本库。

## 本地开发

### 前置条件

- Node.js 24（与 `.coze` 运行清单一致）
- pnpm 9+
- Bash 环境；Windows 可使用 Git Bash 或 WSL
- Supabase 项目
- S3 兼容对象存储
- 可用的扣子图像生成运行环境

### 1. 安装依赖

```bash
corepack enable
pnpm install --frozen-lockfile
```

### 2. 配置环境变量

```bash
cp .env.example .env.local
```

PowerShell 可使用：

```powershell
Copy-Item .env.example .env.local
```

只在 `.env.local` 或部署平台的 Secret 管理中填写真实值。`.env.local` 已被忽略，禁止把真实 API Key、Service Role Key、Cookie、Token 或私钥写入代码、文档、日志和提交历史。

关键变量如下，完整说明见 [`.env.example`](./.env.example)。

| 变量 | 用途 | 可暴露到浏览器 |
|---|---|---|
| `COZE_SUPABASE_URL` | 服务端 Supabase 地址 | 否 |
| `COZE_SUPABASE_ANON_KEY` | 服务端 RLS 访问使用的匿名 Key | 否 |
| `COZE_SUPABASE_SERVICE_ROLE_KEY` | 服务端管理操作；可绕过 RLS | **绝对不可** |
| `NEXT_PUBLIC_SUPABASE_URL` | 浏览器端 Supabase 地址 | 是 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 浏览器端匿名 Key | 是 |
| `COZE_BUCKET_ENDPOINT_URL` | 对象存储地址 | 否 |
| `COZE_BUCKET_NAME` | 对象存储桶名 | 否 |
| `API_KEY_HASH_PEPPER` | 内部 API Key 哈希 Pepper | **绝对不可** |
| `BOOTSTRAP_ADMIN_EMAIL` | 首位管理员邮箱 | 否 |
| `BOOTSTRAP_ADMIN_PASSWORD` | 首位管理员初始密码 | **绝对不可** |
| `BOOTSTRAP_TOKEN` | 管理员初始化接口令牌 | **绝对不可** |
| `COZE_PROJECT_ENV` | `DEV` 或 `PROD` | 否 |

所有 `NEXT_PUBLIC_*` 变量都会进入浏览器 Bundle，只允许放置可公开值。

### 3. 升级数据库

```bash
pnpm dlx coze-coding-ai db upgrade
```

数据库迁移必须先于应用版本发布。当前服务端依赖 `supabase/migrations/0003_identity_rls_atomic_quota.sql` 中的 RLS、原子额度预留、任务领取、取消和重试函数；未执行迁移时不要部署对应代码。

### 4. 启动与初始化

```bash
pnpm dev
```

默认监听 `http://localhost:5000`。首次部署时设置 `BOOTSTRAP_ADMIN_EMAIL`、`BOOTSTRAP_ADMIN_PASSWORD` 和 `BOOTSTRAP_TOKEN`，再调用一次：

```text
POST /api/auth/bootstrap
X-Bootstrap-Token: <BOOTSTRAP_TOKEN>
```

该接口幂等；已有管理员时不会重复创建。生产环境必须配置非空 `BOOTSTRAP_TOKEN`。

## 常用命令

| 命令 | 说明 |
|---|---|
| `pnpm dev` | 启动开发服务 |
| `pnpm build` | 生成 Next.js 产物并打包 Node 服务 |
| `pnpm start` | 启动生产服务 |
| `pnpm ts-check` | TypeScript 类型检查 |
| `pnpm lint` | ESLint 全量检查 |
| `pnpm test` | 运行自动化测试 |
| `pnpm validate` | 依次运行类型检查、构建级 Lint 和测试 |
| `bash scripts/health-check.sh` | 检查本地服务健康状态 |
| `bash scripts/test-api.sh` | 使用独立测试 Key 运行 API Smoke Test |

提交前至少运行：

```bash
pnpm validate
pnpm build
```

## OpenAI 兼容 API

### 认证

- API Key：`Authorization: Bearer <your-internal-api-key>`
- Web Session：`x-session: <supabase-access-token>`

API Key 可按资源授予 `images:*`、`tasks:*`、`models:read`、`usage:read`、`api_keys:*` 和 `profile:*` Scope。明文 Key 仅在创建时返回一次。

### Python 示例

```python
from openai import OpenAI

client = OpenAI(
    api_key="irs_live_<replace-me>",
    base_url="https://your-host/api/v1",
)

response = client.images.generate(
    model="image-pro",
    prompt="a cat sitting on a windowsill",
    n=1,
    size="1024x1024",
)

print(response.data[0].url)
```

### 图像生成请求

```http
POST /api/v1/images/generations
Authorization: Bearer <your-internal-api-key>
Content-Type: application/json
```

```json
{
  "model": "image-pro",
  "prompt": "a cat sitting on a windowsill",
  "n": 1,
  "size": "2K",
  "response_format": "url"
}
```

`n` 支持 1–4，最终上限还受用户额度和模型配置约束。`size` 同时接受原生尺寸与 `1024x1024` 等 OpenAI 格式。`response_format` 支持 `url` 和 `b64_json`。

## 数据与安全

- 服务端 Provider 凭据和 Supabase Service Role Key 不会发送到浏览器。
- API Key 使用随机数生成，并以 SHA-256 + Pepper 哈希保存。
- 核心表启用 RLS；业务表统一以 Supabase Auth 用户 ID 作为资源所有者。
- 额度预留、任务领取、取消和重试使用 PostgreSQL 原子函数，避免并发超额和重复执行。
- 数据库只保存对象存储 Key；访问时按需生成短时签名 URL。
- 日志组件对认证 Header、Session、Token 和密钥字段执行脱敏。
- 生成接口当前使用进程内限流。多实例部署时应在网关或共享存储层补充全局限流。
- 远程资源抓取包含协议、私网地址、大小和超时限制；生产环境仍建议配置网络出口白名单。
- 管理员初始化完成后应轮换或移除 Bootstrap 凭据。

如果发现安全问题，请不要创建公开 Issue，按 [安全披露说明](./docs/security.md) 私下报告。

## 发布顺序

1. 在预发布数据库执行新增迁移并验证回滚/兼容策略。
2. 配置部署环境变量和 Secret，确认没有 `NEXT_PUBLIC_*` 私密值。
3. 运行 `pnpm validate` 与 `pnpm build`。
4. 部署应用，检查 `/api/health`。
5. 使用专用低权限 API Key 执行模型列表、生成、任务和额度 Smoke Test。
6. 观察错误率、Provider 延迟、额度记录和审计日志后再扩大流量。

本项目不会自动修改生产数据库，也不会自动部署；迁移和发布应分别经过审批。

## 协作规范

- 仅使用 pnpm，不使用 npm 或 Yarn 安装依赖。
- 提交信息采用 Conventional Commits，例如 `fix: prevent duplicate task execution`。
- 数据库迁移只追加新文件，不修改已经发布的迁移。
- 修复缺陷时优先增加可复现测试；行为变更需同步更新 README 或 `docs/`。
- 提交前检查 `git status`，确保 `.env*`、本地工具配置、调试素材和构建产物未被暂存。

## 进一步阅读

- [架构说明](./docs/architecture.md)
- [API 参考](./docs/api-reference.md)
- [数据库说明](./docs/database.md)
- [安全模型](./docs/security.md)
- [管理员指南](./docs/admin-guide.md)
- [Provider 集成](./docs/provider-integration.md)
- [合规边界](./docs/compliance-boundaries.md)
- [故障排查](./docs/troubleshooting.md)

## License

[MIT](./LICENSE) © TechDou
