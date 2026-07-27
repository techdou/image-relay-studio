import { getSupabaseClient } from '@/storage/database/supabase-client';
import { AppError, ErrorCodes } from '@/server/errors';
import { logger } from '@/server/logging';
import {
  ImageGenerationProvider,
  ProviderCapabilities,
  ProviderGenerationRequest,
  ProviderGenerationResult,
  ProviderHealthResult,
} from './types';
import { CozeCodingImageProvider } from './coze-coding-provider';
import { MockImageProvider } from './mock-provider';

const providerCache = new Map<string, ImageGenerationProvider>();

function getProvider(providerType: string): ImageGenerationProvider {
  if (providerCache.has(providerType)) {
    return providerCache.get(providerType)!;
  }

  let provider: ImageGenerationProvider;
  switch (providerType) {
    case 'coze-coding-sdk':
    case 'coze_coding':
      provider = new CozeCodingImageProvider();
      break;
    case 'mock':
      provider = new MockImageProvider();
      break;
    default:
      throw new AppError(ErrorCodes.PROVIDER_ERROR, `Unknown provider type: ${providerType}`);
  }

  providerCache.set(providerType, provider);
  return provider;
}

export interface ModelConfig {
  id: string;
  code: string;
  display_name: string;
  provider_type: string;
  external_model_id: string | null;
  workflow_id: string | null;
  enabled: boolean;
  sort_order: number;
  supports_text_to_image: boolean;
  supports_image_to_image: boolean;
  supports_multiple_references: boolean;
  supports_sequential_generation: boolean;
  supports_visible_watermark_control: boolean;
  supported_sizes: string[];
  max_images_per_request: number;
  max_provider_concurrency: number;
  timeout_seconds: number;
  default_parameters: Record<string, unknown>;
  capability_metadata: Record<string, unknown>;
}

export async function getModelConfig(code: string): Promise<ModelConfig> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('model_configs')
    .select('*')
    .eq('code', code)
    .eq('enabled', true)
    .single();

  if (error || !data) {
    throw new AppError(ErrorCodes.MODEL_NOT_FOUND, `Model not found: ${code}`);
  }

  return data as unknown as ModelConfig;
}

export async function getEnabledModels(): Promise<ModelConfig[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('model_configs')
    .select('*')
    .eq('enabled', true)
    .order('sort_order', { ascending: true });

  if (error) {
    logger.error('Failed to fetch enabled models', { error: error.message });
    return [];
  }

  return (data || []) as unknown as ModelConfig[];
}

export async function getAllModels(): Promise<ModelConfig[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('model_configs')
    .select('*')
    .order('sort_order', { ascending: true });

  if (error) {
    logger.error('Failed to fetch all models', { error: error.message });
    return [];
  }

  return (data || []) as unknown as ModelConfig[];
}

export async function getProviderForModel(modelCode: string): Promise<ImageGenerationProvider> {
  const config = await getModelConfig(modelCode);
  return getProvider(config.provider_type);
}

export async function generateWithModel(
  modelCode: string,
  request: ProviderGenerationRequest
): Promise<ProviderGenerationResult> {
  const config = await getModelConfig(modelCode);
  const provider = getProvider(config.provider_type);

  // Use external_model_id if configured, otherwise fall back
  if (config.external_model_id) {
    request.model_id = config.external_model_id;
  }

  logger.info('Generating with model', {
    model_code: modelCode,
    provider: config.provider_type,
    action: 'generate',
  });

  return provider.generate(request);
}

export async function checkProviderHealth(providerType: string): Promise<ProviderHealthResult> {
  try {
    const provider = getProvider(providerType);
    return provider.healthCheck();
  } catch (error) {
    return {
      healthy: false,
      provider: providerType,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export { getProvider, CozeCodingImageProvider, MockImageProvider };

// Provider Router for route consumers
export const ProviderRouter = {
  async generate(providerType: string, request: ProviderGenerationRequest): Promise<ProviderGenerationResult> {
    const provider = getProvider(providerType);
    return provider.generate(request);
  },

  async healthCheckAll(): Promise<Array<{ provider: string; healthy: boolean }>> {
    const results: Array<{ provider: string; healthy: boolean }> = [];
    const types = ['coze-coding-sdk', 'coze_coding', 'mock'];
    for (const type of types) {
      try {
        const provider = getProvider(type);
        const result = await provider.healthCheck();
        results.push({ provider: type, healthy: result.healthy });
      } catch {
        results.push({ provider: type, healthy: false });
      }
    }
    return results;
  },
};

export function getProviderRouter() {
  return ProviderRouter;
}
