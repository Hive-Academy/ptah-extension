/**
 * OpenRouter Models Service (TASK_2025_091 Phase 2)
 *
 * Fetches available models from OpenRouter API and manages
 * model tier mappings for Sonnet/Opus/Haiku overrides.
 *
 * API Endpoint: https://openrouter.ai/api/v1/models
 *
 * Environment Variables Set:
 * - ANTHROPIC_DEFAULT_SONNET_MODEL
 * - ANTHROPIC_DEFAULT_OPUS_MODEL
 * - ANTHROPIC_DEFAULT_HAIKU_MODEL
 */

import { injectable, inject } from 'tsyringe';
import { Logger, ConfigManager, TOKENS } from '@ptah-extension/vscode-core';
import type {
  OpenRouterModelInfo,
  OpenRouterModelTier,
} from '@ptah-extension/shared';

/**
 * Raw model response from OpenRouter API
 * @see https://openrouter.ai/api/v1/models
 */
interface OpenRouterApiModel {
  id: string;
  name: string;
  description?: string;
  context_length: number;
  supported_parameters?: string[];
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
  pricing?: {
    prompt?: string;
    completion?: string;
  };
}

interface OpenRouterApiResponse {
  data: OpenRouterApiModel[];
}

/** Config keys for persisted tier mappings */
const TIER_CONFIG_KEYS = {
  sonnet: 'openrouter.modelTier.sonnet',
  opus: 'openrouter.modelTier.opus',
  haiku: 'openrouter.modelTier.haiku',
} as const;

/** Environment variable names for tier overrides */
const TIER_ENV_VARS = {
  sonnet: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
  opus: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
  haiku: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
} as const;

@injectable()
export class OpenRouterModelsService {
  private cachedModels: OpenRouterModelInfo[] = [];
  private cacheTimestamp = 0;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(
    @inject(TOKENS.LOGGER) private logger: Logger,
    @inject(TOKENS.CONFIG_MANAGER) private config: ConfigManager
  ) {}

  /**
   * Fetch models from OpenRouter API
   *
   * @param apiKey - OpenRouter API key for authentication
   * @param toolUseOnly - Filter to only models supporting tool use
   * @returns Array of model info with tool use capability flag
   */
  async fetchModels(
    apiKey: string,
    toolUseOnly = false
  ): Promise<{ models: OpenRouterModelInfo[]; totalCount: number }> {
    // Check cache
    const now = Date.now();
    if (
      this.cachedModels.length > 0 &&
      now - this.cacheTimestamp < this.CACHE_TTL_MS
    ) {
      this.logger.debug('[OpenRouterModelsService] Returning cached models', {
        count: this.cachedModels.length,
      });
      const filtered = toolUseOnly
        ? this.cachedModels.filter((m) => m.supportsToolUse)
        : this.cachedModels;
      return { models: filtered, totalCount: this.cachedModels.length };
    }

    try {
      this.logger.info(
        '[OpenRouterModelsService] Fetching models from OpenRouter API'
      );

      const response = await fetch('https://openrouter.ai/api/v1/models', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(
          `OpenRouter API error: ${response.status} ${response.statusText}`
        );
      }

      const data = (await response.json()) as OpenRouterApiResponse;

      if (!data.data || !Array.isArray(data.data)) {
        throw new Error('Invalid response format from OpenRouter API');
      }

      // Transform to our model format
      this.cachedModels = data.data.map((model) => ({
        id: model.id,
        name: model.name,
        description: model.description || '',
        contextLength: model.context_length || 0,
        supportsToolUse: model.supported_parameters?.includes('tools') ?? false,
      }));

      this.cacheTimestamp = now;

      this.logger.info(
        '[OpenRouterModelsService] Fetched models from OpenRouter',
        {
          total: this.cachedModels.length,
          withToolUse: this.cachedModels.filter((m) => m.supportsToolUse)
            .length,
        }
      );

      const filtered = toolUseOnly
        ? this.cachedModels.filter((m) => m.supportsToolUse)
        : this.cachedModels;

      return { models: filtered, totalCount: this.cachedModels.length };
    } catch (error) {
      this.logger.error(
        '[OpenRouterModelsService] Failed to fetch models',
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  }

  /**
   * Set model override for a tier
   *
   * This sets both:
   * 1. Environment variable for immediate use
   * 2. Config setting for persistence
   *
   * @param tier - Sonnet, Opus, or Haiku
   * @param modelId - OpenRouter model ID (e.g., "openai/gpt-5.1-codex-max")
   */
  async setModelTier(
    tier: OpenRouterModelTier,
    modelId: string
  ): Promise<void> {
    const envVar = TIER_ENV_VARS[tier];
    const configKey = TIER_CONFIG_KEYS[tier];

    // Set environment variable for immediate use
    process.env[envVar] = modelId;

    // Persist to config for restart persistence
    await this.config.set(configKey, modelId);

    this.logger.info('[OpenRouterModelsService] Set model tier', {
      tier,
      modelId,
      envVar,
    });
  }

  /**
   * Get current model tier mappings
   *
   * Reads from config (persisted) or environment (runtime)
   */
  getModelTiers(): {
    sonnet: string | null;
    opus: string | null;
    haiku: string | null;
  } {
    return {
      sonnet: this.getTierValue('sonnet'),
      opus: this.getTierValue('opus'),
      haiku: this.getTierValue('haiku'),
    };
  }

  /**
   * Clear a model tier override (reset to default)
   *
   * @param tier - Sonnet, Opus, or Haiku
   */
  async clearModelTier(tier: OpenRouterModelTier): Promise<void> {
    const envVar = TIER_ENV_VARS[tier];
    const configKey = TIER_CONFIG_KEYS[tier];

    // Clear environment variable
    delete process.env[envVar];

    // Clear config
    await this.config.set(configKey, undefined);

    this.logger.info('[OpenRouterModelsService] Cleared model tier', { tier });
  }

  /**
   * Apply persisted tier mappings to environment
   * Call this during authentication setup when OpenRouter is active
   */
  applyPersistedTiers(): void {
    const tiers = this.getModelTiers();

    if (tiers.sonnet) {
      process.env[TIER_ENV_VARS.sonnet] = tiers.sonnet;
    }
    if (tiers.opus) {
      process.env[TIER_ENV_VARS.opus] = tiers.opus;
    }
    if (tiers.haiku) {
      process.env[TIER_ENV_VARS.haiku] = tiers.haiku;
    }

    this.logger.debug(
      '[OpenRouterModelsService] Applied persisted tier mappings',
      {
        tiers,
      }
    );
  }

  /**
   * Clear cache to force refresh on next fetch
   */
  clearCache(): void {
    this.cachedModels = [];
    this.cacheTimestamp = 0;
  }

  private getTierValue(tier: OpenRouterModelTier): string | null {
    // Check environment first (runtime override)
    const envValue = process.env[TIER_ENV_VARS[tier]];
    if (envValue) {
      return envValue;
    }

    // Check config (persisted)
    const configValue = this.config.get<string>(TIER_CONFIG_KEYS[tier]);
    return configValue || null;
  }
}
