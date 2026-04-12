/**
 * SDK Model Service - Fetches and caches supported models from SDK + Anthropic API
 *
 * Extracted from SdkAgentAdapter to separate model management concerns.
 * Models are fetched from two sources:
 * 1. SDK's supportedModels() API — returns 3 tier slots (opus/sonnet/haiku)
 * 2. Anthropic /v1/models API — returns ALL available models dynamically
 *
 * The merged result gives users access to specific model versions (e.g.,
 * claude-sonnet-4-5-20250514) while keeping tier shortcuts as recommended options.
 *
 * Single Responsibility: Fetch, cache, and provide model information
 *
 * @see TASK_2025_102 - Extracted to reduce SdkAgentAdapter complexity
 * @see TASK_2025_237 - Added API model fetching for dynamic model discovery
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { AuthEnv } from '@ptah-extension/shared';
import { SDK_TOKENS } from '../di/tokens';
import { ModelInfo } from '../types/sdk-types/claude-sdk.types';
import { SdkModuleLoader } from './sdk-module-loader';

/**
 * Model entry from the Anthropic /v1/models API
 */
export interface ApiModelEntry {
  /** Full model ID (e.g., 'claude-sonnet-4-5-20250514') */
  id: string;
  /** Human-readable name (e.g., 'Claude Sonnet 4.5') */
  displayName: string;
  /** ISO timestamp */
  createdAt: string;
}

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

/** Cache TTL for API models (5 minutes) */
const API_MODELS_CACHE_TTL = 5 * 60 * 1000;

/**
 * Manages SDK model fetching and caching
 *
 * Responsibilities:
 * - Fetch supported models from SDK's native API (tier slots)
 * - Fetch all available models from Anthropic /v1/models API
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

  /**
   * Cached models from Anthropic /v1/models API
   */
  private cachedApiModels: ApiModelEntry[] | null = null;
  private apiModelsCacheTime = 0;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_MODULE_LOADER)
    private readonly moduleLoader: SdkModuleLoader,
    @inject(SDK_TOKENS.SDK_AUTH_ENV) private readonly authEnv: AuthEnv,
  ) {}

  /**
   * Get supported models from SDK's native API
   * Caches successful results; returns fallback on failure WITHOUT caching
   * so the next call retries the SDK (fixes permanent fallback after init race).
   *
   * @returns Array of ModelInfo with value (API ID), displayName, and description
   */
  async getSupportedModels(): Promise<ModelInfo[]> {
    // Return cached if SDK call previously succeeded
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

      // TASK_2025_237: Pass auth env so the SDK can validate credentials.
      // Without this, the query() call fails when auth is required (API key,
      // OAuth, third-party providers) — the original code only passed cwd.
      const tempQuery = query({
        prompt: emptyPrompt,
        options: {
          cwd: require('os').homedir(),
          env: {
            ...process.env,
            ...this.authEnv,
          } as Record<string, string | undefined>,
        },
      });

      // Fetch supported models from SDK
      const models = await tempQuery.supportedModels();
      this.logger.info('[SdkModelService] Fetched supported models from SDK', {
        count: models.length,
        models: models.map((m) => `${m.value}: ${m.displayName}`),
      });

      // SDK returned empty (e.g., auth not yet configured) — use fallback
      // without caching so subsequent calls retry the SDK.
      if (!models || models.length === 0) {
        this.logger.warn(
          '[SdkModelService] SDK returned empty models, using fallback tier slots',
        );
        return FALLBACK_MODELS;
      }

      // Only cache successful SDK results — never cache fallbacks.
      // This ensures subsequent calls retry the SDK instead of being
      // stuck on fallback models forever after an init-time race condition.
      this.cachedModels = models;
      return models;
    } catch (error) {
      this.logger.error(
        '[SdkModelService] Failed to fetch supported models (will retry next call)',
        error instanceof Error ? error : new Error(String(error)),
      );

      // Return fallback WITHOUT caching — next call will retry the SDK
      return FALLBACK_MODELS;
    }
  }

  /**
   * Fetch all available models from the Anthropic /v1/models API
   *
   * TASK_2025_237: Queries the API to discover all available models dynamically,
   * including specific versions (e.g., claude-sonnet-4-5-20250514) that the SDK's
   * supportedModels() doesn't expose.
   *
   * Skipped for:
   * - Local proxy providers (127.0.0.1) — Copilot/Codex proxies may not implement /v1/models
   * - Missing auth credentials
   *
   * @returns Array of ApiModelEntry, or empty array on failure/skip
   */
  async fetchApiModels(): Promise<ApiModelEntry[]> {
    // Return cached if still valid
    if (
      this.cachedApiModels &&
      Date.now() - this.apiModelsCacheTime < API_MODELS_CACHE_TTL
    ) {
      return this.cachedApiModels;
    }

    // Skip for local proxy providers (Copilot/Codex translation proxies)
    const baseUrl = this.authEnv.ANTHROPIC_BASE_URL;
    if (baseUrl && baseUrl.includes('127.0.0.1')) {
      this.logger.debug(
        '[SdkModelService] Skipping /v1/models for local proxy',
      );
      return [];
    }

    // Need auth credentials
    const apiKey = this.authEnv.ANTHROPIC_API_KEY;
    const authToken = this.authEnv.ANTHROPIC_AUTH_TOKEN;
    const oauthToken = this.authEnv.CLAUDE_CODE_OAUTH_TOKEN;
    if (!apiKey && !authToken && !oauthToken) {
      this.logger.debug('[SdkModelService] No auth credentials for /v1/models');
      return [];
    }

    try {
      const url = `${baseUrl || 'https://api.anthropic.com'}/v1/models?limit=100`;
      const headers: Record<string, string> = {
        'anthropic-version': '2023-06-01',
      };

      if (apiKey) {
        headers['x-api-key'] = apiKey;
      } else if (oauthToken) {
        headers['Authorization'] = `Bearer ${oauthToken}`;
      } else if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        this.logger.warn(
          `[SdkModelService] /v1/models returned ${response.status}`,
          { status: response.status },
        );
        return [];
      }

      const body = (await response.json()) as {
        data?: Array<{
          id: string;
          display_name?: string;
          created_at?: string;
          type?: string;
        }>;
      };

      if (!body.data || !Array.isArray(body.data)) {
        this.logger.warn('[SdkModelService] /v1/models returned no data');
        return [];
      }

      // Filter to only Claude models and map to our format
      const models: ApiModelEntry[] = body.data
        .filter((m) => m.id.startsWith('claude-'))
        .map((m) => ({
          id: m.id,
          displayName: m.display_name || m.id,
          createdAt: m.created_at || '',
        }));

      this.cachedApiModels = models;
      this.apiModelsCacheTime = Date.now();

      this.logger.info('[SdkModelService] Fetched models from /v1/models API', {
        total: body.data.length,
        claudeModels: models.length,
        ids: models.map((m) => m.id),
      });

      return models;
    } catch (error) {
      this.logger.warn(
        '[SdkModelService] Failed to fetch /v1/models',
        error instanceof Error ? error : new Error(String(error)),
      );
      return [];
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
    this.cachedApiModels = null;
    this.apiModelsCacheTime = 0;
    this.logger.debug('[SdkModelService] Model cache cleared');
  }
}
