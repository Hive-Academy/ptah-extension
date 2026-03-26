/**
 * Provider Models Service (TASK_2025_132 - generalized from OpenRouterModelsService)
 *
 * Fetches available models from any Anthropic-compatible provider and manages
 * model tier mappings for Sonnet/Opus/Haiku overrides.
 *
 * Supports:
 * - Dynamic model listing via API (OpenRouter)
 * - Hybrid: dynamic with static fallback (Moonshot, Z.AI)
 * - Per-provider model cache and tier config persistence
 *
 * Environment Variables Set:
 * - ANTHROPIC_DEFAULT_SONNET_MODEL
 * - ANTHROPIC_DEFAULT_OPUS_MODEL
 * - ANTHROPIC_DEFAULT_HAIKU_MODEL
 */

import { injectable, inject } from 'tsyringe';
import axios from 'axios';
import { Logger, ConfigManager, TOKENS } from '@ptah-extension/vscode-core';
import type {
  AuthEnv,
  ProviderModelInfo,
  ProviderModelTier,
  ModelPricing,
} from '@ptah-extension/shared';
import { updatePricingMap } from '@ptah-extension/shared';
import {
  getAnthropicProvider,
  type AnthropicProvider,
} from './helpers/anthropic-provider-registry';
import { SDK_TOKENS } from './di/tokens';

/**
 * Raw model response from OpenRouter-style /v1/models API
 * Both OpenRouter and Moonshot use a compatible format
 */
interface ModelsApiModel {
  id: string;
  name?: string;
  description?: string;
  context_length?: number;
  context_window?: number;
  supported_parameters?: string[];
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
  pricing?: {
    prompt?: string;
    completion?: string;
    input_cache_read?: string;
    input_cache_write?: string;
  };
}

interface ModelsApiResponse {
  data: ModelsApiModel[];
}

/** Environment variable names for tier overrides */
const TIER_ENV_VARS = {
  sonnet: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
  opus: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
  haiku: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
} as const;

/** Per-provider cache entry */
interface ProviderCache {
  models: ProviderModelInfo[];
  timestamp: number;
}

/** Callback type for dynamic model fetchers (e.g., Copilot SDK listModels) */
export type DynamicModelFetcher = () => Promise<ProviderModelInfo[]>;

@injectable()
export class ProviderModelsService {
  private readonly modelCache = new Map<string, ProviderCache>();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  /** Per-provider dynamic model fetcher callbacks */
  private readonly dynamicFetchers = new Map<string, DynamicModelFetcher>();

  constructor(
    @inject(TOKENS.LOGGER) private logger: Logger,
    @inject(TOKENS.CONFIG_MANAGER) private config: ConfigManager,
    @inject(SDK_TOKENS.SDK_AUTH_ENV) private authEnv: AuthEnv,
  ) {}

  /**
   * Register a dynamic model fetcher for a specific provider.
   * When registered, fetchModels() will call this instead of using staticModels.
   * Falls back to staticModels if the fetcher throws.
   */
  registerDynamicFetcher(
    providerId: string,
    fetcher: DynamicModelFetcher,
  ): void {
    this.dynamicFetchers.set(providerId, fetcher);
    this.logger.debug(
      '[ProviderModelsService] Registered dynamic model fetcher',
      { providerId },
    );
  }

  /**
   * Get the per-provider config key for a tier
   */
  private getTierConfigKey(
    providerId: string,
    tier: ProviderModelTier,
  ): string {
    return `provider.${providerId}.modelTier.${tier}`;
  }

  /**
   * Fetch models for a provider
   *
   * For providers with modelsEndpoint: fetches from API (with caching)
   * For providers with staticModels: returns the static list
   *
   * @param providerId - Provider ID to fetch models for
   * @param apiKey - Provider API key (not needed for static-model providers)
   * @param toolUseOnly - Filter to only models supporting tool use
   * @returns Array of model info with metadata
   */
  async fetchModels(
    providerId: string,
    apiKey: string | null,
    toolUseOnly = false,
  ): Promise<{
    models: ProviderModelInfo[];
    totalCount: number;
    isStatic: boolean;
  }> {
    const provider = getAnthropicProvider(providerId);
    if (!provider) {
      throw new Error(`Unknown provider: ${providerId}`);
    }

    // Path 0: Registered dynamic fetcher (e.g., Copilot SDK listModels)
    const dynamicFetcher = this.dynamicFetchers.get(providerId);
    if (dynamicFetcher) {
      try {
        // Check cache first
        const cached = this.modelCache.get(providerId);
        const now = Date.now();
        if (
          cached &&
          cached.models.length > 0 &&
          now - cached.timestamp < this.CACHE_TTL_MS
        ) {
          const filtered = toolUseOnly
            ? cached.models.filter((m) => m.supportsToolUse)
            : cached.models;
          return {
            models: filtered,
            totalCount: cached.models.length,
            isStatic: false,
          };
        }

        const models = await dynamicFetcher();
        if (models.length > 0) {
          this.modelCache.set(providerId, { models, timestamp: now });

          const filtered = toolUseOnly
            ? models.filter((m) => m.supportsToolUse)
            : models;
          return {
            models: filtered,
            totalCount: models.length,
            isStatic: false,
          };
        }
        // Empty result — fall through to static fallback
      } catch (error) {
        this.logger.warn(
          '[ProviderModelsService] Dynamic fetcher failed, falling back to static models',
          {
            providerId,
            error: error instanceof Error ? error.message : String(error),
          },
        );
        // Fall through to existing paths
      }
    }

    // Path 1: Has API endpoint AND key → try dynamic first
    if (provider.modelsEndpoint && apiKey) {
      try {
        const result = await this.fetchDynamicModels(
          providerId,
          provider,
          apiKey,
          toolUseOnly,
        );
        // Merge static metadata (pricing, toolUse flags) into dynamic results
        result.models = this.mergeStaticMetadata(result.models, provider);
        return result;
      } catch (error) {
        this.logger.warn(
          '[ProviderModelsService] Dynamic fetch failed, falling back to static models',
          {
            providerId,
            error: error instanceof Error ? error.message : String(error),
          },
        );
        // Fall through to static fallback
      }
    }

    // Path 2: Static fallback (no key, or dynamic failed)
    if (provider.staticModels && provider.staticModels.length > 0) {
      const models: ProviderModelInfo[] = provider.staticModels.map((m) => ({
        id: m.id,
        name: m.name,
        description: m.description,
        contextLength: m.contextLength,
        supportsToolUse: m.supportsToolUse,
      }));

      const filtered = toolUseOnly
        ? models.filter((m) => m.supportsToolUse)
        : models;

      return { models: filtered, totalCount: models.length, isStatic: true };
    }

    // No models available (dynamic-only without key, or provider misconfigured)
    this.logger.debug(
      '[ProviderModelsService] No models available for provider',
      {
        providerId,
        hasEndpoint: !!provider.modelsEndpoint,
        hasStatic: !!provider.staticModels?.length,
        hasKey: !!apiKey,
      },
    );
    return { models: [], totalCount: 0, isStatic: false };
  }

  /**
   * Fetch models from a provider's /v1/models API endpoint
   */
  private async fetchDynamicModels(
    providerId: string,
    provider: AnthropicProvider,
    apiKey: string | null,
    toolUseOnly: boolean,
  ): Promise<{
    models: ProviderModelInfo[];
    totalCount: number;
    isStatic: boolean;
  }> {
    // Check cache
    const now = Date.now();
    const cached = this.modelCache.get(providerId);
    if (
      cached &&
      cached.models.length > 0 &&
      now - cached.timestamp < this.CACHE_TTL_MS
    ) {
      this.logger.debug(
        `[ProviderModelsService] Returning cached models for ${providerId}`,
        {
          count: cached.models.length,
        },
      );
      const filtered = toolUseOnly
        ? cached.models.filter((m) => m.supportsToolUse)
        : cached.models;
      return {
        models: filtered,
        totalCount: cached.models.length,
        isStatic: false,
      };
    }

    if (!apiKey) {
      throw new Error(
        `${provider.name} API key not configured. Please add your key in Settings.`,
      );
    }

    try {
      this.logger.info(
        `[ProviderModelsService] Fetching models from ${provider.name} API`,
      );

      const { data } = await axios.get<ModelsApiResponse>(
        provider.modelsEndpoint as string,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'User-Agent': 'Ptah-Extension/1.0',
          },
          timeout: 10_000,
        },
      );

      if (!data.data || !Array.isArray(data.data)) {
        throw new Error(`Invalid response format from ${provider.name} API`);
      }

      // Transform to our model format and extract pricing
      const models = this.transformApiModels(data.data);

      // Feed dynamic pricing into the shared pricing map
      this.feedPricingMap(models);

      // Update cache
      this.modelCache.set(providerId, { models, timestamp: now });

      this.logger.info(
        `[ProviderModelsService] Fetched models from ${provider.name}`,
        {
          total: models.length,
          withToolUse: models.filter((m) => m.supportsToolUse).length,
        },
      );

      const filtered = toolUseOnly
        ? models.filter((m) => m.supportsToolUse)
        : models;

      return { models: filtered, totalCount: models.length, isStatic: false };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        if (error.response.status === 401 || error.response.status === 403) {
          throw new Error(
            `${provider.name} API key is invalid or expired. Please delete your key and re-enter a valid one.`,
          );
        }
        throw new Error(
          `${provider.name} API error: ${error.response.status} ${error.response.statusText}`,
        );
      }
      this.logger.error(
        `[ProviderModelsService] Failed to fetch models from ${provider.name}`,
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    }
  }

  /**
   * Merge static model metadata (pricing, toolUse, descriptions) into
   * dynamically fetched models. OpenAI-format /v1/models responses typically
   * lack pricing and tool-use information, so we enrich them from the
   * hardcoded static definitions when available.
   */
  private mergeStaticMetadata(
    dynamicModels: ProviderModelInfo[],
    provider: AnthropicProvider,
  ): ProviderModelInfo[] {
    if (!provider.staticModels?.length) return dynamicModels;

    const staticMap = new Map(
      provider.staticModels.map((m) => [m.id.toLowerCase(), m]),
    );

    return dynamicModels.map((model) => {
      const staticInfo = staticMap.get(model.id.toLowerCase());
      if (!staticInfo) return model;

      return {
        ...model,
        // OR logic: static can supplement dynamic (APIs often underreport tool support)
        supportsToolUse: model.supportsToolUse || staticInfo.supportsToolUse,
        inputCostPerToken:
          model.inputCostPerToken ?? staticInfo.inputCostPerToken,
        outputCostPerToken:
          model.outputCostPerToken ?? staticInfo.outputCostPerToken,
        cacheReadCostPerToken:
          model.cacheReadCostPerToken ?? staticInfo.cacheReadCostPerToken,
        cacheCreationCostPerToken:
          model.cacheCreationCostPerToken ??
          staticInfo.cacheCreationCostPerToken,
        // Prefer static display name if dynamic is just the raw ID
        name:
          model.name !== model.id ? model.name : staticInfo.name || model.name,
        description: model.description || staticInfo.description,
        contextLength: model.contextLength || staticInfo.contextLength,
      };
    });
  }

  /**
   * Set model override for a tier on a specific provider
   *
   * Sets both:
   * 1. Environment variable for immediate use
   * 2. Per-provider config setting for persistence
   *
   * @param providerId - Provider ID
   * @param tier - Sonnet, Opus, or Haiku
   * @param modelId - Model ID (e.g., "openai/gpt-5.1-codex-max")
   */
  async setModelTier(
    providerId: string,
    tier: ProviderModelTier,
    modelId: string,
  ): Promise<void> {
    const envVar = TIER_ENV_VARS[tier];
    const configKey = this.getTierConfigKey(providerId, tier);

    // Set AuthEnv variable for immediate use
    this.authEnv[envVar as keyof AuthEnv] = modelId;
    // Sync to process.env (SDK reads model tiers from process.env internally)
    process.env[envVar] = modelId;

    // Persist to config
    await this.config.set(configKey, modelId);

    this.logger.info('[ProviderModelsService] Set model tier', {
      providerId,
      tier,
      modelId,
      envVar,
    });
  }

  /**
   * Get current model tier mappings for a specific provider
   *
   * Reads from per-provider config keys
   */
  getModelTiers(providerId: string): {
    sonnet: string | null;
    opus: string | null;
    haiku: string | null;
  } {
    return {
      sonnet: this.getPersistedTierValue(providerId, 'sonnet'),
      opus: this.getPersistedTierValue(providerId, 'opus'),
      haiku: this.getPersistedTierValue(providerId, 'haiku'),
    };
  }

  /**
   * Clear a model tier override for a specific provider
   *
   * @param providerId - Provider ID
   * @param tier - Sonnet, Opus, or Haiku
   */
  async clearModelTier(
    providerId: string,
    tier: ProviderModelTier,
  ): Promise<void> {
    const envVar = TIER_ENV_VARS[tier];
    const configKey = this.getTierConfigKey(providerId, tier);

    // Clear AuthEnv variable
    delete this.authEnv[envVar as keyof AuthEnv];

    // Clear config
    await this.config.set(configKey, undefined);

    this.logger.info('[ProviderModelsService] Cleared model tier', {
      providerId,
      tier,
    });
  }

  /**
   * Apply persisted tier mappings to environment for a specific provider
   * Call this during authentication setup when a provider is active
   */
  applyPersistedTiers(providerId: string): void {
    const tiers = this.getModelTiers(providerId);

    if (tiers.sonnet) {
      this.authEnv.ANTHROPIC_DEFAULT_SONNET_MODEL = tiers.sonnet;
      process.env['ANTHROPIC_DEFAULT_SONNET_MODEL'] = tiers.sonnet;
    }
    if (tiers.opus) {
      this.authEnv.ANTHROPIC_DEFAULT_OPUS_MODEL = tiers.opus;
      process.env['ANTHROPIC_DEFAULT_OPUS_MODEL'] = tiers.opus;
    }
    if (tiers.haiku) {
      this.authEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL = tiers.haiku;
      process.env['ANTHROPIC_DEFAULT_HAIKU_MODEL'] = tiers.haiku;
    }

    this.logger.debug(
      '[ProviderModelsService] Applied persisted tier mappings',
      { providerId, tiers },
    );
  }

  /**
   * Clear all tier environment variables
   * Call this when switching providers or switching to OAuth/API key auth
   */
  clearAllTierEnvVars(): void {
    delete this.authEnv.ANTHROPIC_DEFAULT_SONNET_MODEL;
    delete this.authEnv.ANTHROPIC_DEFAULT_OPUS_MODEL;
    delete this.authEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL;
    delete process.env['ANTHROPIC_DEFAULT_SONNET_MODEL'];
    delete process.env['ANTHROPIC_DEFAULT_OPUS_MODEL'];
    delete process.env['ANTHROPIC_DEFAULT_HAIKU_MODEL'];

    this.logger.debug(
      '[ProviderModelsService] Cleared all tier environment variables',
    );
  }

  /**
   * Switch the active provider's tier mappings
   * Clears all tier env vars, then applies persisted tiers for the new provider
   */
  switchActiveProvider(providerId: string): void {
    this.clearAllTierEnvVars();
    this.applyPersistedTiers(providerId);

    this.logger.info(
      `[ProviderModelsService] Switched active provider tiers to ${providerId}`,
    );
  }

  /**
   * Clear cache for a specific provider (or all if no ID provided)
   */
  clearCache(providerId?: string): void {
    if (providerId) {
      this.modelCache.delete(providerId);
    } else {
      this.modelCache.clear();
    }
  }

  /**
   * Pre-fetch pricing data from OpenRouter (no auth required)
   *
   * OpenRouter's /api/v1/models endpoint is publicly accessible and returns
   * pricing, display names, and context windows for 200+ models. This method
   * fetches that data at startup to populate the dynamic pricing map before
   * the user configures any API keys.
   *
   * Uses a separate cache key ('openrouter:pricing') so authenticated model
   * fetches are not short-circuited by the unauthenticated prefetch data.
   *
   * @returns Number of models with pricing data loaded
   */
  async prefetchPricing(): Promise<number> {
    const PREFETCH_CACHE_KEY = 'openrouter:pricing';
    const openRouter = getAnthropicProvider('openrouter');
    if (!openRouter?.modelsEndpoint) {
      return 0;
    }

    // Check pricing-specific cache
    const cached = this.modelCache.get(PREFETCH_CACHE_KEY);
    if (
      cached &&
      cached.models.length > 0 &&
      Date.now() - cached.timestamp < this.CACHE_TTL_MS
    ) {
      this.feedPricingMap(cached.models);
      return cached.models.filter((m) => m.inputCostPerToken !== undefined)
        .length;
    }

    // Delay initial fetch to let VS Code networking initialize fully.
    // Extension activation fires early; network stack may not be ready.
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Attempt with one retry — network may be transiently unavailable at startup
    const maxAttempts = 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        this.logger.info(
          '[ProviderModelsService] Pre-fetching pricing from OpenRouter (no auth)',
          { attempt },
        );

        const { data } = await axios.get<ModelsApiResponse>(
          openRouter.modelsEndpoint,
          {
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'Ptah-Extension/1.0',
            },
            timeout: 15_000,
          },
        );
        if (!data.data || !Array.isArray(data.data)) {
          return 0;
        }

        const models = this.transformApiModels(data.data);

        // Cache under pricing-specific key (separate from authenticated model list)
        this.modelCache.set(PREFETCH_CACHE_KEY, {
          models,
          timestamp: Date.now(),
        });

        const pricedCount = this.feedPricingMap(models);

        this.logger.info(
          '[ProviderModelsService] Pre-fetched pricing from OpenRouter',
          { totalModels: models.length, modelsWithPricing: pricedCount },
        );

        return pricedCount;
      } catch (error) {
        // HTTP errors (non-2xx) return 0 immediately — no retry
        if (axios.isAxiosError(error) && error.response) {
          this.logger.warn(
            `[ProviderModelsService] OpenRouter pricing pre-fetch failed: ${error.response.status}`,
          );
          return 0;
        }

        const errorMsg = error instanceof Error ? error.message : String(error);

        if (attempt < maxAttempts) {
          this.logger.info(
            `[ProviderModelsService] Pricing pre-fetch attempt ${attempt} failed, retrying in 5s`,
            { error: errorMsg },
          );
          await new Promise((resolve) => setTimeout(resolve, 5000));
        } else {
          this.logger.warn(
            '[ProviderModelsService] Pricing pre-fetch failed after retries (will use bundled fallback)',
            { error: errorMsg, attempts: maxAttempts },
          );
        }
      }
    }

    return 0;
  }

  /**
   * Transform raw API models to ProviderModelInfo with pricing extraction.
   * Shared by both fetchDynamicModels() and prefetchPricing().
   */
  private transformApiModels(rawModels: ModelsApiModel[]): ProviderModelInfo[] {
    return rawModels.map((model) => ({
      id: model.id,
      name: model.name || model.id,
      description: model.description || '',
      contextLength: model.context_length || model.context_window || 0,
      supportsToolUse: model.supported_parameters?.includes('tools') ?? false,
      inputCostPerToken: this.parsePricingField(model.pricing?.prompt),
      outputCostPerToken: this.parsePricingField(model.pricing?.completion),
      cacheReadCostPerToken: this.parsePricingField(
        model.pricing?.input_cache_read,
      ),
      cacheCreationCostPerToken: this.parsePricingField(
        model.pricing?.input_cache_write,
      ),
    }));
  }

  /**
   * Parse a pricing field string to a number.
   * OpenRouter returns pricing as strings (e.g., "0.000005" for $5/1M tokens).
   *
   * @returns Parsed number, or undefined if empty/invalid/negative
   */
  private parsePricingField(value: string | undefined): number | undefined {
    if (value === undefined || value === '') return undefined;
    const parsed = parseFloat(value);
    if (isNaN(parsed) || parsed < 0) return undefined;
    return parsed;
  }

  /**
   * Feed model pricing data into the shared pricing map
   * (calls {@link updatePricingMap} from `@ptah-extension/shared`).
   *
   * Creates pricing map entries keyed by:
   * 1. Full provider model ID (e.g., "anthropic/claude-opus-4.5")
   * 2. Model ID without provider prefix (e.g., "claude-opus-4.5")
   * 3. Normalized model ID with dots to hyphens (e.g., "claude-opus-4-5")
   *
   * This ensures findModelPricing() partial matching works for both
   * OpenRouter-style IDs and SDK-reported model IDs (e.g., "claude-opus-4-5-20251101").
   *
   * @returns Number of models with pricing data
   */
  private feedPricingMap(models: ProviderModelInfo[]): number {
    const pricingEntries: Record<string, ModelPricing> = {};
    let pricedCount = 0;

    for (const model of models) {
      if (
        model.inputCostPerToken === undefined ||
        model.outputCostPerToken === undefined
      ) {
        continue;
      }

      pricedCount++;

      const pricing: ModelPricing = {
        inputCostPerToken: model.inputCostPerToken,
        outputCostPerToken: model.outputCostPerToken,
        cacheReadCostPerToken: model.cacheReadCostPerToken,
        cacheCreationCostPerToken: model.cacheCreationCostPerToken,
      };

      // Key 1: Full provider model ID
      const fullId = model.id.toLowerCase();
      pricingEntries[fullId] = pricing;

      // Key 2: Strip provider prefix (e.g., "anthropic/claude-opus-4.5" -> "claude-opus-4.5")
      if (fullId.includes('/')) {
        const stripped = fullId.split('/').slice(1).join('/');
        pricingEntries[stripped] = pricing;

        // Key 3: Normalize dots to hyphens for SDK model ID matching
        // "claude-opus-4.5" -> "claude-opus-4-5" (matches "claude-opus-4-5-20251101")
        const normalized = stripped.replace(/\./g, '-');
        if (normalized !== stripped) {
          pricingEntries[normalized] = pricing;
        }
      }
    }

    if (Object.keys(pricingEntries).length > 0) {
      updatePricingMap(pricingEntries);
    }

    return pricedCount;
  }

  /**
   * Get persisted tier value from config (not env var - this is per-provider)
   */
  private getPersistedTierValue(
    providerId: string,
    tier: ProviderModelTier,
  ): string | null {
    const configKey = this.getTierConfigKey(providerId, tier);
    const configValue = this.config.get<string>(configKey);
    return configValue || null;
  }
}
