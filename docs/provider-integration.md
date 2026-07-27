# Provider 集成文档

## 概述

Image Relay Studio 通过 Provider 适配层隔离模型调用逻辑。业务代码不直接调用 SDK，而是通过统一的 `ImageGenerationProvider` 接口。

## Provider 接口

```typescript
interface ImageGenerationProvider {
  getCapabilities(): Promise<ProviderCapabilities>;
  generate(request: ProviderGenerationRequest): Promise<ProviderGenerationResult>;
  healthCheck(): Promise<ProviderHealthResult>;
}
```

## 已实现 Provider

### 1. CozeCodingProvider

使用 `coze-coding-dev-sdk` 的图像生成能力。

- **provider_type**: `coze_coding`
- **配置**: 通过环境变量自动获取凭据
- **支持**: 文生图、图生图
- **限制**: 受平台并发和额度限制

```typescript
// 自动从环境变量获取配置
import { createImageGenerationClient } from 'coze-coding-dev-sdk';
```

### 2. CozeWorkflowProvider

调用扣子平台已发布的图像生成工作流。

- **provider_type**: `coze_workflow`
- **配置**: 需要设置 `COZE_API_TOKEN` 和工作流 ID
- **支持**: 取决于工作流配置

### 3. MockProvider

本地开发和自动化测试使用。

- **provider_type**: `mock`
- **配置**: 无需外部服务
- **支持**: 所有能力标记为支持
- **重要**: 不得在生产环境启用

## Provider Router

`ProviderRouter` 根据数据库 `model_configs.provider_type` 动态选择 Provider：

```typescript
const result = await router.generate('coze_coding', {
  modelId: 'external-model-id',
  prompt: '...',
  size: '1024x1024',
  n: 1,
  visibleWatermark: false,
  referenceUrls: [],
  parameters: {},
});
```

## 模型能力映射

每个模型在 `model_configs` 表中定义能力：

| 字段 | 说明 |
|------|------|
| supports_text_to_image | 是否支持文生图 |
| supports_image_to_image | 是否支持图生图 |
| supports_multiple_references | 是否支持多参考图 |
| supports_sequential_generation | 是否支持连续叙事 |
| supports_visible_watermark_control | 是否支持关闭可见水印 |
| supported_sizes | 支持的尺寸列表 |
| max_images_per_request | 单次最大图片数 |

前端根据这些能力动态显示/隐藏参数。

## 超时和重试

- **超时**: 由 `model_configs.timeout_seconds` 控制，默认 120 秒
- **重试**: 仅重试临时错误（网络超时、429、5xx）
- **不重试**: 参数错误、权限错误、内容被拒绝、模型不存在
- **最大重试次数**: 由 `generation_tasks.attempt_count` 控制

## 切换 Provider

1. 在管理后台 `/admin/models` 创建新模型配置
2. 设置正确的 `provider_type` 和 `external_model_id`
3. 启用模型
4. 前端自动显示新模型选项

无需修改代码或重新部署。

## 添加新 Provider

1. 实现 `ImageGenerationProvider` 接口
2. 在 `src/server/providers/images/index.ts` 中注册
3. 在数据库中创建对应模型配置
