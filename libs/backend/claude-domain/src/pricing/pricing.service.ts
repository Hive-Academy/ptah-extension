/**
 * PricingService - Dynamic LLM Pricing Management
 *
 * Fetches and caches model pricing from LiteLLM's public pricing database.
 * Filters to only include Anthropic and OpenAI models (for Claude Code + VS Code LM API).
 *
 * Features:
 * - Fetches pricing from LiteLLM GitHub at extension startup
 * - Caches pricing in VS Code globalState for 24 hours
 * - Falls back to bundled default pricing when offline
 * - Filters out irrelevant models to minimize extension bloat
 *
 * @see https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json
 */

import { injectable, inject } from 'tsyringe';
import type { Memento } from 'vscode';
import {
  ModelPricing,
  updatePricingMap,
  DEFAULT_MODEL_PRICING,
} from '@ptah-extension/shared';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';

/** LiteLLM pricing JSON URL */
const LITELLM_PRICING_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

/** Cache key for VS Code globalState */
const PRICING_CACHE_KEY = 'ptah.pricingCache';

/** Cache TTL in milliseconds (24 hours) */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Fetch timeout in milliseconds */
const FETCH_TIMEOUT_MS = 10000;

/** Providers we care about (filter out AWS, Azure, Google, etc.) */
const SUPPORTED_PROVIDERS = new Set([
  'anthropic',
  'openai',
  'azure',
  'azure_ai',
]);

/** Model name patterns to include */
const SUPPORTED_MODEL_PATTERNS = [
  // Anthropic Claude models
  /^claude-/i,
  /^anthropic\./i,
  // OpenAI models (for VS Code Copilot/LM API)
  /^gpt-/i,
  /^openai\//i,
  /^o1-/i,
  /^o3-/i,
];

/**
 * Cached pricing data structure
 */
interface PricingCache {
  /** Timestamp when pricing was fetched */
  readonly fetchedAt: number;
  /** Filtered pricing data */
  readonly pricing: Record<string, ModelPricing>;
}

/**
 * LiteLLM model entry structure (partial - only fields we need)
 */
interface LiteLLMModelEntry {
  readonly input_cost_per_token?: number;
  readonly output_cost_per_token?: number;
  readonly cache_read_input_token_cost?: number;
  readonly cache_creation_input_token_cost?: number;
  readonly max_tokens?: number;
  readonly max_input_tokens?: number;
  readonly litellm_provider?: string;
  readonly mode?: string;
}

@injectable()
export class PricingService {
  private initialized = false;

  constructor(
    @inject(TOKENS.GLOBAL_STATE) private readonly globalState: Memento,
    @inject(TOKENS.LOGGER) private readonly logger: Logger
  ) {}

  /**
   * Initialize pricing service
   *
   * Should be called once at extension activation.
   * Loads cached pricing or fetches fresh data from LiteLLM.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.debug('[PricingService] Already initialized, skipping');
      return;
    }

    this.logger.info('[PricingService] Initializing...');

    try {
      // Try to load from cache first
      const cached = this.loadFromCache();

      if (cached && !this.isCacheStale(cached)) {
        this.logger.info(
          `[PricingService] Using cached pricing (${
            Object.keys(cached.pricing).length
          } models)`
        );
        updatePricingMap(cached.pricing);
        this.initialized = true;
        return;
      }

      // Cache is stale or missing - fetch fresh data
      this.logger.info(
        '[PricingService] Cache stale or missing, fetching from LiteLLM...'
      );
      const freshPricing = await this.fetchFromLiteLLM();

      if (freshPricing && Object.keys(freshPricing).length > 0) {
        // Save to cache and update runtime map
        await this.saveToCache(freshPricing);
        updatePricingMap(freshPricing);
        this.logger.info(
          `[PricingService] Loaded ${
            Object.keys(freshPricing).length
          } models from LiteLLM`
        );
      } else {
        // Fetch failed - use cached data if available, otherwise defaults
        if (cached) {
          this.logger.warn('[PricingService] Fetch failed, using stale cache');
          updatePricingMap(cached.pricing);
        } else {
          this.logger.warn(
            '[PricingService] Fetch failed and no cache, using bundled defaults'
          );
          // DEFAULT_MODEL_PRICING is already loaded
        }
      }

      this.initialized = true;
    } catch (error) {
      this.logger.error(
        '[PricingService] Initialization failed',
        error instanceof Error ? error : new Error(String(error))
      );
      // Continue with default pricing
      this.initialized = true;
    }
  }

  /**
   * Force refresh pricing from LiteLLM
   */
  async refresh(): Promise<void> {
    this.logger.info('[PricingService] Force refreshing pricing...');

    const freshPricing = await this.fetchFromLiteLLM();

    if (freshPricing && Object.keys(freshPricing).length > 0) {
      await this.saveToCache(freshPricing);
      updatePricingMap(freshPricing);
      this.logger.info(
        `[PricingService] Refreshed ${Object.keys(freshPricing).length} models`
      );
    } else {
      this.logger.warn('[PricingService] Refresh failed');
    }
  }

  /**
   * Fetch pricing from LiteLLM GitHub
   */
  private async fetchFromLiteLLM(): Promise<Record<
    string,
    ModelPricing
  > | null> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      const response = await fetch(LITELLM_PRICING_URL, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as Record<string, LiteLLMModelEntry>;

      if (!data || typeof data !== 'object') {
        throw new Error('Invalid pricing data structure');
      }

      // Filter and transform to our format
      return this.filterAndTransform(data);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        this.logger.warn('[PricingService] Fetch timed out');
      } else {
        this.logger.warn(
          '[PricingService] Fetch failed:',
          error instanceof Error ? error.message : String(error)
        );
      }
      return null;
    }
  }

  /**
   * Filter LiteLLM data to only include supported models
   */
  private filterAndTransform(
    data: Record<string, LiteLLMModelEntry>
  ): Record<string, ModelPricing> {
    const result: Record<string, ModelPricing> = {};

    for (const [modelId, entry] of Object.entries(data)) {
      // Skip if no pricing info
      if (!entry.input_cost_per_token && !entry.output_cost_per_token) {
        continue;
      }

      // Check if model matches our supported patterns
      const isSupported = SUPPORTED_MODEL_PATTERNS.some((pattern) =>
        pattern.test(modelId)
      );

      // Also check provider if available
      const providerSupported =
        !entry.litellm_provider ||
        SUPPORTED_PROVIDERS.has(entry.litellm_provider.toLowerCase());

      if (!isSupported && !providerSupported) {
        continue;
      }

      // Transform to our format
      result[modelId.toLowerCase()] = {
        inputCostPerToken: entry.input_cost_per_token ?? 0,
        outputCostPerToken: entry.output_cost_per_token ?? 0,
        cacheReadCostPerToken: entry.cache_read_input_token_cost,
        cacheCreationCostPerToken: entry.cache_creation_input_token_cost,
        maxTokens: entry.max_tokens ?? entry.max_input_tokens,
        provider: entry.litellm_provider ?? 'unknown',
      };
    }

    this.logger.debug(
      `[PricingService] Filtered ${Object.keys(result).length} models from ${
        Object.keys(data).length
      } total`
    );

    return result;
  }

  /**
   * Load pricing from VS Code globalState cache
   */
  private loadFromCache(): PricingCache | null {
    try {
      const cached = this.globalState.get<PricingCache>(PRICING_CACHE_KEY);

      // Validate cache structure
      if (cached && (!cached.fetchedAt || !cached.pricing)) {
        this.logger.warn(
          '[PricingService] Corrupted cache detected, resetting'
        );
        return null;
      }

      return cached ?? null;
    } catch (error) {
      this.logger.warn(
        '[PricingService] Cache load failed, will refetch',
        error
      );
      return null;
    }
  }

  /**
   * Save pricing to VS Code globalState cache
   */
  private async saveToCache(
    pricing: Record<string, ModelPricing>
  ): Promise<void> {
    try {
      const cache: PricingCache = {
        fetchedAt: Date.now(),
        pricing,
      };

      await this.globalState.update(PRICING_CACHE_KEY, cache);
    } catch (error) {
      this.logger.warn('[PricingService] Cache save failed', error);
      // Don't throw - failing to cache shouldn't break pricing
    }
  }

  /**
   * Check if cache is stale (older than TTL)
   */
  private isCacheStale(cache: PricingCache): boolean {
    return Date.now() - cache.fetchedAt > CACHE_TTL_MS;
  }
}
