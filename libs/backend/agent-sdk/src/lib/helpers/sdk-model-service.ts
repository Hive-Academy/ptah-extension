/**
 * SDK Model Service - Fetches and caches supported models from SDK
 *
 * Extracted from SdkAgentAdapter to separate model management concerns.
 * Models are fetched from SDK's supportedModels() API and cached to avoid
 * repeated API calls.
 *
 * Single Responsibility: Fetch, cache, and provide model information
 *
 * @see TASK_2025_102 - Extracted to reduce SdkAgentAdapter complexity
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from '../di/tokens';
import { ModelInfo } from '../types/sdk-types/claude-sdk.types';
import { SdkModuleLoader } from './sdk-module-loader';

/**
 * Fallback models when SDK call fails
 */
/**
 * Fallback models using SDK tier names (not hardcoded model IDs).
 * The SDK resolves tier names to the latest model version at runtime.
 * Only used when the SDK's supportedModels() API call fails.
 */
/**
 * Fallback models using SDK tier names (not hardcoded model IDs).
 * The SDK resolves tier names to the latest model version at runtime.
 * Using explicit tiers (opus/sonnet/haiku) instead of "default" so the
 * user always knows exactly which tier they're on — no silent changes
 * when Anthropic remaps "default" to a different tier.
 */
const FALLBACK_MODELS: ModelInfo[] = [
  {
    value: 'opus',
    displayName: 'Opus',
    description: 'Most capable for complex work',
  },
  {
    value: 'sonnet',
    displayName: 'Sonnet',
    description: 'Best for everyday tasks',
  },
  {
    value: 'haiku',
    displayName: 'Haiku',
    description: 'Fastest for quick answers',
  },
];

/**
 * Manages SDK model fetching and caching
 *
 * Responsibilities:
 * - Fetch supported models from SDK's native API
 * - Cache models for subsequent calls
 * - Provide fallback models on failure
 * - Get default model selection
 */
@injectable()
export class SdkModelService {
  /**
   * Cached models from SDK's supportedModels() API
   * Populated on first call to getSupportedModels()
   */
  private cachedModels: ModelInfo[] = [];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_MODULE_LOADER)
    private readonly moduleLoader: SdkModuleLoader
  ) {}

  /**
   * Get supported models from SDK's native API
   * Fetches once and caches for subsequent calls
   *
   * @returns Array of ModelInfo with value (API ID), displayName, and description
   */
  async getSupportedModels(): Promise<ModelInfo[]> {
    // Return cached if available
    if (this.cachedModels.length > 0) {
      return this.cachedModels;
    }

    try {
      // Get cached SDK query function (imported once)
      const query = await this.moduleLoader.getQueryFunction();

      // Create a minimal query just to access supportedModels()
      // We use an async generator that yields nothing
      const emptyPrompt = (async function* () {
        // Don't yield anything - we just need to call supportedModels()
      })();

      const tempQuery = query({
        prompt: emptyPrompt,
        options: {
          cwd: process.cwd(),
        },
      });

      // Fetch supported models from SDK
      const models = await tempQuery.supportedModels();
      this.logger.info('[SdkModelService] Fetched supported models from SDK', {
        count: models.length,
        models: models.map((m) => m.value),
      });

      this.cachedModels = models;
      return models;
    } catch (error) {
      this.logger.error(
        '[SdkModelService] Failed to fetch supported models',
        error instanceof Error ? error : new Error(String(error))
      );

      // Fallback to safe defaults if SDK call fails
      this.cachedModels = FALLBACK_MODELS;
      return FALLBACK_MODELS;
    }
  }

  /**
   * Get default model - first from supported models
   *
   * Resolves SDK's 'default' tier to an explicit tier name based on the model's
   * description, since the SDK's query() API doesn't always resolve 'default'
   * to the model advertised by supportedModels().
   *
   * @returns Model tier string (e.g., 'opus', 'sonnet', 'haiku')
   */
  async getDefaultModel(): Promise<string> {
    const models = await this.getSupportedModels();
    const first = models[0];
    if (!first) return 'default';

    // If SDK returns 'default' as the value, resolve to explicit tier
    if (first.value.toLowerCase() === 'default') {
      const desc = (
        (first.displayName || '') +
        ' ' +
        (first.description || '')
      ).toLowerCase();
      if (desc.includes('opus')) return 'opus';
      if (desc.includes('sonnet')) return 'sonnet';
      if (desc.includes('haiku')) return 'haiku';
    }

    return first.value;
  }

  /**
   * Check if models are already cached
   */
  hasCachedModels(): boolean {
    return this.cachedModels.length > 0;
  }

  /**
   * Clear the cached models (useful for testing or re-initialization)
   */
  clearCache(): void {
    this.cachedModels = [];
    this.logger.debug('[SdkModelService] Model cache cleared');
  }
}
