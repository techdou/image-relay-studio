# 故障排查文档

## 常见问题

### 1. 用户无法登录 - "Invalid login credentials"

**症状**: 输入正确密码但仍报 "Invalid login credentials"

**最常见根因：终端会话和部署环境连接了不同的 Supabase 实例**

重新部署后，平台可能创建新的 Supabase 实例，导致：
- 终端环境变量指向旧实例（你在旧实例上重置密码）
- 部署环境使用新实例（浏览器登录走新实例）
- 密码只改了旧实例，新实例没改

**排查步骤**:
1. 对比终端环境变量和线上 API 返回的 Supabase URL 是否一致：
   ```bash
   # 终端环境变量
   echo $COZE_SUPABASE_URL
   
   # 线上部署实际使用的
   curl -s https://你的域名/api/supabase-config
   ```
2. 如果 URL 不同，说明存在多个 Supabase 实例
3. 在**线上部署对应的实例**上重置密码：
   ```bash
   # 使用线上 API 返回的 URL 和 Anon Key 创建客户端
   # 先用旧密码登录，再更新密码
   npx tsx -e "
   import { createClient } from '@supabase/supabase-js';
   const supabase = createClient('线上URL', '线上AnonKey');
   const { data } = await supabase.auth.signInWithPassword({
     email: '邮箱', password: '旧密码'
   });
   await supabase.auth.updateUser({ password: '新密码' });
   console.log('Password reset OK');
   "
   ```

**预防措施**:
- 重置密码时，务必确认操作的是线上部署对应的 Supabase 实例
- 管理员操作优先通过线上 API 执行，而不是通过本地终端
- 重新部署后，检查 `/api/supabase-config` 返回的 URL 是否与之前一致

### 1.1 其他登录问题

**症状**: 登录页面报错或无法跳转（非密码问题）

**排查步骤**:
1. 检查 Supabase Auth 是否启用了邮箱登录
2. 检查用户 profile 是否存在
3. 检查用户是否被禁用（profiles.status = 'disabled'）
4. 查看浏览器控制台错误

### 2. 图像生成失败

**症状**: 任务状态为 failed

**排查步骤**:
1. 查看 `generation_tasks.error_message` 和 `error_code`
2. 区分错误类型：
   - `PROVIDER_TIMEOUT`: 模型服务超时，可重试
   - `PROVIDER_RATE_LIMITED`: 模型服务限流，稍后重试
   - `PROVIDER_REJECTED`: 内容被拒绝，不可重试
   - `PROVIDER_ERROR`: 模型服务错误，检查 Provider 配置
   - `STORAGE_ERROR`: 对象存储问题，检查存储配置
3. 检查模型配置是否正确（external_model_id、workflow_id）
4. 检查环境变量（COZE_API_TOKEN 等）
5. 在管理后台运行健康检查

### 3. 额度异常

**症状**: 用户显示额度不足但实际未使用

**排查步骤**:
1. 检查 `user_quotas` 表中的额度设置
2. 检查 `usage_records` 中的实际使用记录
3. 注意每日/每月限额的统计时间范围

### 4. 图片无法显示

**症状**: Gallery 中图片无法加载

**排查步骤**:
1. 检查对象存储连接（COZE_BUCKET_ENDPOINT_URL）
2. 检查 Signed URL 生成是否正常
3. 检查 `generation_assets.object_key` 是否有效
4. 检查是否有孤立文件（object_key 存在但文件不存在）

### 5. API Key 认证失败

**症状**: 使用 API Key 调用接口返回 401

**排查步骤**:
1. 确认 Key 格式正确（irs_live_ 开头）
2. 检查 Key 是否已被吊销（`revoked_at` 不为空）
3. 检查 Key 是否已过期（`expires_at` 已过）
4. 检查用户 `api_access_enabled` 是否开启
5. 检查 `system_settings.api_enabled` 是否为 true

### 6. 任务卡在 running 状态

**症状**: 任务长时间处于 running 状态

**排查步骤**:
1. 检查 Provider 是否响应
2. 运行清理脚本重置超时任务：
   ```bash
   bash scripts/cleanup-assets.sh
   ```
3. 手动在管理后台取消或重试任务

## 日志位置

- 应用日志: `/app/work/logs/bypass//app.log`
- 调试日志: `/app/work/logs/bypass//dev.log`
- 浏览器日志: `/app/work/logs/bypass//console.log`

## 健康检查

```bash
# 应用健康
curl http://localhost:${DEPLOY_RUN_PORT}/api/health

# 详细诊断（管理员）
# 在管理后台 /admin/health 查看
```

## 紧急操作

### 关闭生成服务

1. 进入 /admin/settings
2. 将 `generation_enabled` 设为 `false`
3. 用户端立即显示维护说明

### 重启服务

```bash
# 开发环境
pnpm dev

# 生产环境
pnpm build && pnpm start
```

### 数据清理

```bash
bash scripts/cleanup-assets.sh
```

此脚本安全可重复运行，清理：
- 超过保留期的软删除记录
- 孤立对象文件
- 过期 API Key
- 卡住的运行任务
