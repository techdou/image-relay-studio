# 架构文档

## 系统架构

```mermaid
graph TB
    Browser[浏览器]
    
    subgraph NextJS[Next.js Application]
        Pages[页面路由]
        API[API Routes]
        ServerActions[Server Actions]
    end
    
    subgraph Services[Application Services]
        AuthService[Auth Service]
        UserService[User Service]
        QuotaService[Quota Service]
        GenerationService[Generation Service]
        TaskService[Task Service]
        StorageService[Storage Service]
        APIKeyService[API Key Service]
        AuditService[Audit Service]
        ProviderRouter[Provider Router]
    end
    
    subgraph Infrastructure[Infrastructure]
        DB[(Supabase PostgreSQL)]
        Auth[Supabase Auth]
        S3[S3 Object Storage]
        CozeSDK[Coze SDK Provider]
        CozeWF[Coze Workflow Provider]
        MockProvider[Mock Provider]
    end
    
    Browser --> Pages
    Browser --> API
    
    Pages --> ServerActions
    API --> Services
    
    ServerActions --> AuthService
    ServerActions --> GenerationService
    ServerActions --> StorageService
    
    AuthService --> Auth
    GenerationService --> QuotaService
    GenerationService --> ProviderRouter
    GenerationService --> TaskService
    GenerationService --> StorageService
    GenerationService --> AuditService
    
    ProviderRouter --> CozeSDK
    ProviderRouter --> CozeWF
    ProviderRouter --> MockProvider
    
    TaskService --> DB
    QuotaService --> DB
    AuditService --> DB
    APIKeyService --> DB
    StorageService --> S3
    AuthService --> DB
```

## 核心流程

### 图像生成流程

```mermaid
sequenceDiagram
    participant U as 用户
    participant API as API Route
    participant Q as QuotaService
    participant P as ProviderRouter
    participant T as TaskService
    participant S as StorageService
    participant DB as Database
    
    U->>API: POST /api/v1/images/generations
    API->>API: 认证 & 参数验证
    API->>Q: 检查额度 & 并发
    Q->>DB: 查询 user_quotas
    Q-->>API: 额度检查通过
    API->>T: 创建任务 (queued)
    T->>DB: INSERT generation_tasks
    API->>T: 执行任务 (running)
    T->>DB: UPDATE status = running
    T->>P: 调用 Provider.generate()
    P-->>T: 返回生成结果
    T->>S: 转存图片到对象存储
    S-->>T: 转存完成
    T->>DB: INSERT generation_assets
    T->>DB: INSERT usage_records
    T->>T: 更新任务 (succeeded)
    T->>DB: UPDATE status = succeeded
    API-->>U: 返回 task_id & status_url
```

### 任务状态机

```mermaid
stateDiagram-v2
    [*] --> queued: 创建任务
    queued --> running: 获取执行锁
    queued --> cancelled: 用户取消
    running --> succeeded: 生成成功
    running --> failed: 生成失败
    running --> cancelled: 用户取消
    failed --> queued: 重试
    
    succeeded --> [*]
    cancelled --> [*]
```

## Provider 适配层

所有模型调用通过 `ImageGenerationProvider` 接口隔离：

```typescript
interface ImageGenerationProvider {
  getCapabilities(): Promise<ProviderCapabilities>;
  generate(request: ProviderGenerationRequest): Promise<ProviderGenerationResult>;
  healthCheck(): Promise<ProviderHealthResult>;
}
```

三种实现：
1. **CozeCodingProvider** - 使用 `coze-coding-dev-sdk` 的 `images.generate()`
2. **CozeWorkflowProvider** - 调用扣子工作流 OpenAPI
3. **MockProvider** - 返回占位图，用于开发和测试

Provider 由 `model_configs.provider_type` 动态选择，未来添加新 Provider 不需要修改业务代码。

## 安全架构

- 所有模型调用在服务端执行
- API Key 只保存哈希，明文仅创建时展示一次
- Supabase Auth 管理用户认证
- RLS 保护数据库行级访问
- Signed URL 短时效，不永久存储
- 审计日志记录所有管理操作
- 日志自动脱敏敏感字段

## 部署架构

项目以 Next.js 单体部署，平台自动构建和运行。

- 开发环境: `pnpm dev` (端口 5000)
- 生产环境: `pnpm build && pnpm start`
- 数据库: Supabase PostgreSQL (平台托管)
- 对象存储: S3 兼容存储 (平台托管)
- 认证: Supabase Auth (平台托管)
