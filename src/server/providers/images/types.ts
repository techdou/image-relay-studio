export interface ProviderCapabilities {
  supports_text_to_image: boolean;
  supports_image_to_image: boolean;
  supports_multiple_references: boolean;
  supports_sequential_generation: boolean;
  supports_visible_watermark_control: boolean;
  supported_sizes: string[];
  max_images_per_request: number;
}

export interface ProviderGenerationRequest {
  prompt: string;
  model_id: string;
  size?: string;
  watermark?: boolean;
  reference_image_urls?: string[];
  response_format?: 'url' | 'b64_json';
  optimize_prompt_mode?: string;
  sequential_generation?: 'auto' | 'disabled';
  sequential_max_images?: number;
  custom_headers?: Record<string, string>;
}

export interface ProviderGenerationResult {
  success: boolean;
  image_urls: string[];
  image_b64_list: string[];
  error_messages: string[];
  model: string;
  usage?: {
    generated_images: number;
    output_tokens?: number;
    total_tokens?: number;
  };
}

export interface ProviderHealthResult {
  healthy: boolean;
  provider: string;
  latency_ms?: number;
  error?: string;
  details?: Record<string, unknown>;
}

export interface ImageGenerationProvider {
  readonly name: string;
  getCapabilities(): Promise<ProviderCapabilities>;
  generate(request: ProviderGenerationRequest): Promise<ProviderGenerationResult>;
  healthCheck(): Promise<ProviderHealthResult>;
}
