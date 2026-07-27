# 管理员操作手册

## 概述

管理后台位于 `/admin`，仅 `admin` 角色可访问。

## 总览页面 (/admin)

显示系统关键指标：
- 今日任务数和图片数
- 成功率和失败率
- 平均耗时
- 排队和运行中的任务
- 活跃用户数
- Provider 健康状态
- 最近错误

所有数据来自数据库真实记录。

## 用户管理 (/admin/users)

### 查看用户列表

- 搜索用户（邮箱、昵称）
- 按状态筛选（active/disabled/pending）
- 分页浏览

### 创建用户

1. 点击"添加用户"
2. 填写邮箱和昵称
3. 选择角色（admin/user）
4. 系统自动创建 profile 和默认额度

### 管理用户 (/admin/users/:id)

- 查看基本信息和今日用量
- 启用/禁用用户
- 编辑额度配置：
  - 每日生成限额
  - 每月生成限额
  - 最大并发任务数
  - 单次最大图片数
  - API 访问开关
  - 允许的模型列表
  - 允许的尺寸列表
  - 数据保留天数

## 任务管理 (/admin/tasks)

- 查看所有用户的任务
- 按状态、用户、模型筛选
- 查看任务详情和错误信息
- 取消排队中的任务
- 重试失败的任务
- 查看 Provider Request ID

## 资产管理 (/admin/assets)

- 查看所有生成图片
- 按用户筛选
- 查看存储状态
- 软删除资产

## 模型配置 (/admin/models)

### 添加模型

1. 点击"添加模型"
2. 填写内部代码（如 image-pro）
3. 填写显示名称（如 Image Pro）
4. 选择 Provider 类型
5. 配置外部模型 ID 或工作流 ID
6. 设置能力参数
7. 启用/禁用

### 编辑模型

- 修改显示名称
- 更新 Provider 配置
- 调整能力参数
- 修改并发和超时设置

**注意**: 真实密钥（Coze Token 等）通过环境变量配置，不在界面回显。

## 系统设置 (/admin/settings)

| 设置项 | 说明 | 默认值 |
|--------|------|--------|
| generation_enabled | 全局生成开关 | true |
| api_enabled | API 总开关 | true |
| default_daily_limit | 新用户每日限额 | 50 |
| default_monthly_limit | 新用户每月限额 | 500 |
| default_max_concurrency | 新用户最大并发 | 3 |
| default_retention_days | 数据保留天数 | 90 |
| prompt_logging_mode | Prompt 日志模式 | redacted |
| maintenance_message | 维护公告 | (空) |

### 紧急停止

将 `generation_enabled` 设为 `false`：
- 不接受新任务
- 用户端显示维护说明
- API 返回 GENERATION_DISABLED 错误

## 审计日志 (/admin/audit-logs)

记录所有管理操作：
- 操作者
- 操作类型（create_user, update_user, create_model 等）
- 资源类型和 ID
- 变更前后数据
- 时间和请求 ID

## 健康检查 (/admin/health)

- 数据库连接状态
- 对象存储状态
- Provider 状态
- 当前队列状态
- 最近失败率
- 配置缺失项

不暴露完整环境变量，仅显示状态摘要。
