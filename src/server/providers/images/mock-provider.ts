import {
  ImageGenerationProvider,
  ProviderCapabilities,
  ProviderGenerationRequest,
  ProviderGenerationResult,
  ProviderHealthResult,
} from './types';

export class MockImageProvider implements ImageGenerationProvider {
  readonly name = 'mock';

  async getCapabilities(): Promise<ProviderCapabilities> {
    return {
      supports_text_to_image: true,
      supports_image_to_image: true,
      supports_multiple_references: true,
      supports_sequential_generation: true,
      supports_visible_watermark_control: true,
      supported_sizes: ['2K', '4K', '2560x1440', '2048x2048', '1024x1024'],
      max_images_per_request: 4,
    };
  }

  async generate(request: ProviderGenerationRequest): Promise<ProviderGenerationResult> {
    // Simulate processing delay
    await new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 1000));

    const count = request.sequential_generation === 'auto'
      ? Math.min(request.sequential_max_images || 4, 4)
      : 1;

    // Generate mock placeholder images (1x1 PNG base64)
    const mockImageB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    return {
      success: true,
      image_urls: [],
      image_b64_list: Array(count).fill(mockImageB64),
      error_messages: [],
      model: request.model_id || 'mock-v1',
      usage: {
        generated_images: count,
      },
    };
  }

  async healthCheck(): Promise<ProviderHealthResult> {
    return {
      healthy: true,
      provider: this.name,
      latency_ms: 1,
    };
  }
}
