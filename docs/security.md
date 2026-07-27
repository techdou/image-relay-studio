# 安全文档

## Secret 管理

所有 Secret 只允许放在环境变量中，不得出现在代码、日志或客户端 Bundle 中。

### 环境变量清单

见 `.env.example` 文件。关键 Secret：

- `SUPABASE_SERVICE_ROLE_KEY` - 仅服务端使用
- `COZE_API_TOKEN` - 仅服务端使用
- `API_KEY_HASH_PEPPER` - API Key 哈希盐
- `INTERNAL_DISPATCHER_SECRET` - 内部调度 API 密钥

### 禁止行为

- 禁止将 Secret 写入代码
- 禁止将 Secret 写入日志
- 禁止将 Secret 返回到 API 响应
- 禁止将 Secret 发送到客户端

## API Key 安全

- 使用 `crypto.randomBytes(32)` 生成强随机 Key
- 格式: `irs_live_xxxxxxxxxxxxxxxxx`
- 只保存 SHA-256 哈希 + Pepper
- 明文仅在创建时展示一次
- 验证使用恒定时间比较
- 支持即时吊销
- 支持过期时间
- 记录最后使用时间
- Key 不得出现在 URL Query 中

## 权限控制

### 服务端权限判断

所有资源访问必须在服务端验证：

1. 认证检查 - 验证用户身份
2. 角色检查 - 判断 admin/user
3. 所有权检查 - 资源必须属于当前用户
4. 管理员例外 - 必须显式 `role === 'admin'`

### 前端路由保护

前端路由保护仅是体验层，真正权限判断在服务端 API 层。

### 数据库 RLS

- 所有核心表启用行级安全
- 普通用户只能访问自己的记录
- Service Role 绕过 RLS（仅服务端）

## 文件安全

### 上传校验

- MIME Type 验证
- 文件扩展名验证
- 文件大小限制 (10MB)
- 图片尺寸验证
- SHA-256 校验
- 默认拒绝 SVG（除非经过净化）

### 下载安全

- 使用 fetch + blob 模式下载跨域签名 URL
- 不直接使用 `<a download>` 处理跨域资源

### 对象存储

- 数据库只保存 object_key
- Signed URL 短时效生成
- 不永久保存临时 URL

## SSRF 防护

如需支持远程图片 URL：

- 只允许 HTTPS
- 拒绝 localhost
- 拒绝内网 IP
- 拒绝云元数据地址 (169.254.169.254)
- 防止 DNS Rebinding
- 限制响应大小
- 限制重定向次数
- 限制请求超时

当前版本默认不开放远程 URL 输入。

## 日志脱敏

统一日志工具自动隐藏以下字段：

- authorization
- cookie
- x-session
- api_key
- access_token
- refresh_token
- service_role_key
- provider_token

## 审计

所有管理操作写入 `audit_logs`：

- 操作者 ID 和角色
- 操作类型
- 资源类型和 ID
- 变更前后数据
- 请求 ID
- IP 哈希（不记录完整 IP）
- 时间戳

不得写入审计日志的内容：
- API Key 明文
- Coze Token
- Service Role Key
- 用户密码
- 完整敏感 Header
