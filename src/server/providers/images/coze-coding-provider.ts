import { ImageGenerationClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import {
  ImageGenerationProvider,
  ProviderCapabilities,
  ProviderGenerationRequest,
  ProviderGenerationResult,
  ProviderHealthResult,
} from './types';

export class CozeCodingImageProvider implements ImageGenerationProvider {
  readonly name = 'coze-coding-sdk';

  async getCapabilities(): Promise<ProviderCapabilities> {
    return {
      supports_text_to_image: true,
      supports_image_to_image: true,
      supports_multiple_references: true,
      supports_sequential_generation: true,
      supports_visible_watermark_control: true,
      supported_sizes: ['2K', '4K', '2560x1440', '2048x2048', '3840x2160', '4096x4096'],
      max_images_per_request: 4,
    };
  }

  async generate(request: ProviderGenerationRequest): Promise<ProviderGenerationResult> {
    const config = new Config();
    const client = new ImageGenerationClient(config, request.custom_headers);

    const generateRequest: Record<string, unknown> = {
      prompt: request.prompt,
      size: request.size || '2K',
      watermark: request.watermark ?? true,
      responseFormat: request.response_format || 'url',
    };

    if (request.model_id) {
      generateRequest.model = request.model_id;
    }

    if (request.reference_image_urls && request.reference_image_urls.length > 0) {
      generateRequest.image = request.reference_image_urls.length === 1
        ? request.reference_image_urls[0]
        : request.reference_image_urls;
    }

    if (request.sequential_generation && request.sequential_generation !== 'disabled') {
      generateRequest.sequentialImageGeneration = request.sequential_generation;
      generateRequest.sequentialImageGenerationMaxImages = request.sequential_max_images || 5;
    }

    if (request.optimize_prompt_mode) {
      generateRequest.optimizePromptMode = request.optimize_prompt_mode;
    }

    const response = await client.generate(generateRequest as unknown as Parameters<typeof client.generate>[0]);
    const helper = client.getResponseHelper(response);

    if (helper.success) {
      return {
        success: true,
        image_urls: helper.imageUrls,
        image_b64_list: helper.imageB64List,
        error_messages: [],
        model: response.model,
        usage: response.usage
          ? {
              generated_images: response.usage.generated_images,
              output_tokens: response.usage.output_tokens,
              total_tokens: response.usage.total_tokens,
            }
          : undefined,
      };
    }

    return {
      success: false,
      image_urls: [],
      image_b64_list: [],
      error_messages: helper.errorMessages,
      model: response.model,
    };
  }

  async healthCheck(): Promise<ProviderHealthResult> {
    try {
      const start = Date.now();
      const config = new Config();
      const client = new ImageGenerationClient(config);
      const response = await client.generate({
        prompt: 'health check',
        size: '2K',
      });
      const helper = client.getResponseHelper(response);
      const latency = Date.now() - start;

      return {
        healthy: helper.success,
        provider: this.name,
        latency_ms: latency,
        error: helper.success ? undefined : helper.errorMessages.join('; '),
      };
    } catch (error) {
      return {
        healthy: false,
        provider: this.name,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
