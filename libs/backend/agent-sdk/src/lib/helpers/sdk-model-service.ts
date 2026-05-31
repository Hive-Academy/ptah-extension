/**
 * SDK Model Service - Fetches and caches supported models from SDK + Anthropic API
 *
 * Extracted from SdkAgentAdapter to separate model management concerns.
 * Models are fetched using a multi-strategy approach (in priority order):
 * 1. SDK's supportedModels() API â€” authoritative, account-filtered
 * 2. Anthropic /v1/models API â€” fast HTTP fallback for all available models
 * 3. Hardcoded fallback â€” never cached, next call retries dynamic sources
 *
 * Single Responsibility: Fetch, cache, and provide model information
 *
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS, ConfigManager } from '@ptah-extension/vscode-core';
import { AuthEnv, isDirectAnthropic } from '@ptah-extension/shared';
import { SDK_TOKENS } from '../di/tokens';
import { AUTH_PROVIDERS_TOKENS } from '@ptah-extension/auth-providers-tokens';
import { ModelInfo } from '../types/sdk-types/claude-sdk.types';
import { SdkModuleLoader } from './sdk-module-loader';
import type { IModelResolver } from '../auth-env.port';
import { normalizeAuthMethod } from '@ptah-extension/shared';

/**
 * Model entry from the Anthropic /v1/models API
 */
/** Internal type for /v1/models API response entries. Not exported â€” consumers use ModelInfo[]. */
interface ApiModelEntry {
  id: string;
  displayName: string;
  createdAt: string;
}

/** Valid tier names for model resolution */
export type ModelTier = 'opus' | 'sonnet' | 'haiku' | 'default';

/** Tier names that have corresponding ANTHROPIC_DEFAULT_*_MODEL env vars */
export type EnvMappedTier = Exclude<ModelTier, 'default'>;

/**
 * Canonical mapping from tier names to their ANTHROPIC_DEFAULT_*_MODEL env var keys.
 * Single source of truth â€” all consumers must import this rather than defining their own.
 *
 * Used by:
 * - SdkModelService.resolveModelId() â€” to check env var overrides
 * - ProviderModelsService.setModelTier() â€” to set env vars for proxy providers
 * - buildTierEnvDefaults() â€” to guarantee env vars for SDK subagent spawning
 * - clearAllTierEnvVars() / applyPersistedTiers() â€” to manage tier env lifecycle
 */
export const TIER_ENV_VAR_MAP: Record<EnvMappedTier, keyof AuthEnv> = {
  opus: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
  sonnet: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
  haiku: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
};

/**
 * Build tier env var defaults for SDK subprocess environments.
 *
 * Only applies to third-party Anthropic-compatible providers (OpenRouter,
 * Moonshot, Z.AI) where bare tier names in subagent subprocesses need to be
 * remapped to provider-specific model IDs via ANTHROPIC_DEFAULT_*_MODEL.
 *
 * For direct Anthropic (CLI or API key â†’ api.anthropic.com), this returns an
 * empty record. The CLI/SDK handles its own tier resolution natively, and
 * setting these env vars pins resolution to our hardcoded defaults, blocking
 * any updates the CLI account has to newer models.
 *
 * @param authEnv - Current AuthEnv (must already reflect active provider)
 * @returns Record of ANTHROPIC_DEFAULT_*_MODEL values (empty for direct Anthropic)
 */
export function buildTierEnvDefaults(authEnv: AuthEnv): Record<string, string> {
  if (isDirectAnthropic(authEnv)) {
    return {};
  }

  const defaults: Record<string, string> = {};
  for (const [, envKey] of Object.entries(TIER_ENV_VAR_MAP)) {
    const value = authEnv[envKey];
    if (value) {
      defaults[envKey] = value;
    }
  }
  return defaults;
}

/** Cache TTL for API models (5 minutes) */
const API_MODELS_CACHE_TTL = 5 * 60 * 1000;

/** Timeout for SDK bridge initialization when fetching supported models */
const SDK_MODELS_TIMEOUT_MS = 15_000;

/**
 * Manages SDK model fetching and caching
 *
 * Responsibilities:
 * - Fetch supported models from SDK's native API (tier slots)
 * - Fetch all available models from Anthropic /v1/models API
 * - Cache models for subsequent calls
 * - Provide fallback models on failure
 * - Get default model selection
 * - Resolve bare tier names to full model IDs
 */
@injectable()
export class SdkModelService {
  /**
   * Cached models from SDK's supportedModels() API
   * Populated on first call to getSupportedModels()
   */
  private cachedModels: ModelInfo[] = [];

  /**
   * In-flight promise for getSupportedModels() to deduplicate concurrent calls.
   * Prevents multiple SDK bridge subprocesses from spawning simultaneously.
   */
  private pendingModelsPromise: Promise<ModelInfo[]> | null = null;

  /**
   * Cached models from Anthropic /v1/models API
   */
  private cachedApiModels: ApiModelEntry[] | null = null;
  private apiModelsCacheTime = 0;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_MODULE_LOADER)
    private readonly moduleLoader: SdkModuleLoader,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_AUTH_ENV)
    private readonly authEnv: AuthEnv,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_MODEL_RESOLVER)
    private readonly modelResolver: IModelResolver,
    @inject(TOKENS.CONFIG_MANAGER) private readonly config: ConfigManager,
  ) {}

  /**
   * Get supported models for the active auth method.
   *
   * Tier mapping (ANTHROPIC_DEFAULT_*_MODEL resolution) applies ONLY to
   * third-party providers. For Claude-native auth (API key, CLI), models
   * are returned as-is from the source:
   *
   * - claudeCli  â†’ query.supportedModels() directly (tier slots: opus/sonnet/haiku)
   * - apiKey     â†’ /v1/models API directly (full versioned model IDs)
   * - thirdParty â†’ query.supportedModels() + tier mapping to provider model IDs
   */
  async getSupportedModels(): Promise<ModelInfo[]> {
    if (this.cachedModels.length > 0) {
      return this.cachedModels;
    }

    if (this.pendingModelsPromise) {
      this.logger.debug(
        '[SdkModelService] Deduplicating concurrent getSupportedModels() call',
      );
      return this.pendingModelsPromise;
    }

    this.pendingModelsPromise = this.fetchSupportedModelsInternal();
    try {
      return await this.pendingModelsPromise;
    } finally {
      this.pendingModelsPromise = null;
    }
  }

  private async fetchSupportedModelsInternal(): Promise<ModelInfo[]> {
    const rawAuthMethod = this.config.get<string>('authMethod') || 'apiKey';
    const authMethod = normalizeAuthMethod(rawAuthMethod);

    this.logger.info('[SdkModelService] Fetching models', {
      authMethod,
      hasApiKey: !!this.authEnv.ANTHROPIC_API_KEY,
      hasBaseUrl: !!this.authEnv.ANTHROPIC_BASE_URL,
    });

    let models: ModelInfo[];

    if (authMethod === 'claudeCli') {
      models = await this.fetchModelsViaSdk();
    } else if (authMethod === 'apiKey') {
      models = await this.fetchModelsForApiKey();
    } else {
      const sdkModels = await this.fetchModelsViaSdk();
      models = sdkModels.length > 0 ? this.applyTierMapping(sdkModels) : [];
    }

    if (models.length > 0) {
      const isDegradedApiKeyFallback =
        authMethod === 'apiKey' &&
        models.every((m) => !m.value.startsWith('claude-'));
      if (!isDegradedApiKeyFallback) {
        this.cachedModels = models;
      }
      this.logger.info('[SdkModelService] Models resolved', {
        authMethod,
        count: models.length,
        models: models.map((m) => ({
          value: m.value,
          displayName: m.displayName,
        })),
      });
      return isDegradedApiKeyFallback ? models : this.cachedModels;
    }

    this.logger.warn(
      '[SdkModelService] All model sources failed — returning empty list',
      { authMethod },
    );
    return [];
  }

  /**
   * API key auth: try /v1/models first (full versioned list), fall back to
   * SDK tier slots. No tier mapping â€” Anthropic native auth, IDs are valid as-is.
   */
  private async fetchModelsForApiKey(): Promise<ModelInfo[]> {
    const apiModels = await this.fetchModelsViaApi();
    if (apiModels.length > 0) {
      this.logger.info('[SdkModelService] Models from /v1/models API', {
        count: apiModels.length,
      });
      return apiModels;
    }
    this.logger.warn(
      '[SdkModelService] /v1/models failed for API key auth, trying SDK',
    );
    return await this.fetchModelsViaSdk();
  }

  /**
   * Apply tier mapping for third-party providers only.
   *
   * Resolves bare tier names ('opus', 'sonnet', 'haiku') in SDK model values
   * to provider-specific model IDs via ANTHROPIC_DEFAULT_*_MODEL env vars.
   * Deduplicates entries where multiple tiers map to the same provider model.
   *
   * Only called for authMethod === 'thirdParty'. Never called for claudeCli or apiKey.
   */
  private applyTierMapping(models: ModelInfo[]): ModelInfo[] {
    this.logger.info('[SdkModelService] applyTierMapping (third-party)', {
      count: models.length,
      rawValues: models.map((m) => ({
        value: m.value,
        displayName: m.displayName,
      })),
    });
    const seen = new Set<string>();
    const normalized: ModelInfo[] = [];
    let isDefault = false;

    for (const m of models) {
      isDefault = m.value.toLowerCase() === 'default';
      const resolvedValue = isDefault
        ? this.resolveModelId('opus')
        : this.resolveModelId(m.value);
      if (!isDefault) {
        if (seen.has(resolvedValue)) continue;
        seen.add(resolvedValue);
      }

      normalized.push({
        ...m,
        value: isDefault ? 'default' : resolvedValue,
      });
    }

    const collisions = models.length - normalized.length;
    if (collisions > 0) {
      this.logger.debug(
        `[SdkModelService] applyTierMapping: ${collisions} duplicate(s) collapsed (${models.length} â†’ ${normalized.length})`,
      );
    }

    return normalized;
  }

  /**
   * Get all available models from the Anthropic /v1/models API as ModelInfo[].
   * Public counterpart of fetchModelsViaApi() â€” same shape as getSupportedModels()
   * so callers can merge both lists uniformly using `.value` / `.displayName`.
   *
   * API models already have full IDs (e.g., 'claude-sonnet-4-5-20250514').
   */
  async getApiModelsNormalized(): Promise<ModelInfo[]> {
    return this.fetchModelsViaApi();
  }

  /**
   * Fetch models via SDK's supportedModels() API.
   *
   * This spawns a subprocess (the SDK bridge) that authenticates with the
   * configured credentials, initializes, and reports available models. The
   * query is configured to match the real chat query config so auth works
   * identically.
   *
   * @returns ModelInfo[] on success, empty array on failure
   */
  private async fetchModelsViaSdk(): Promise<ModelInfo[]> {
    const cliJsPath = await this.moduleLoader.getCliJsPath();
    if (!cliJsPath) {
      this.logger.warn(
        '[SdkModelService] No CLI js path available â€” SDK bridge cannot start',
      );
      return [];
    }
    const hasApiKey = !!this.authEnv.ANTHROPIC_API_KEY;
    const hasAuthToken = !!this.authEnv.ANTHROPIC_AUTH_TOKEN;

    this.logger.info(
      '[SdkModelService] Fetching models via SDK supportedModels()',
      {
        hasApiKey,
        hasAuthToken,
        hasBaseUrl: !!this.authEnv.ANTHROPIC_BASE_URL,
        cliJsPath,
        note:
          !hasApiKey && !hasAuthToken
            ? 'No env credentials â€” SDK will use CLI credential store'
            : undefined,
      },
    );
    const abortController = new AbortController();
    let tempQuery: ReturnType<
      Awaited<ReturnType<typeof this.moduleLoader.getQueryFunction>>
    > | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      const query = await this.moduleLoader.getQueryFunction();
      const emptyPrompt = (async function* () {})();
      const baseUrl = this.authEnv.ANTHROPIC_BASE_URL?.trim();
      const isThirdParty =
        baseUrl && !/^https?:\/\/api\.anthropic\.com\/?$/i.test(baseUrl);

      const env: Record<string, string | undefined> = {
        ...process.env,
        ...this.authEnv,
        NO_PROXY: '127.0.0.1,localhost',
        ...(isThirdParty
          ? { CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1' }
          : {}),
      };
      const settingSources: Array<'user' | 'project' | 'local'> =
        baseUrl?.includes('127.0.0.1')
          ? ['project', 'local']
          : ['user', 'project', 'local'];
      const stderrLines: string[] = [];

      tempQuery = query({
        prompt: emptyPrompt,
        options: {
          abortController,
          cwd: require('os').homedir(),
          pathToClaudeCodeExecutable: cliJsPath,
          settingSources,
          env,
          stderr: (data: string) => {
            stderrLines.push(data);
            if (data.includes('[ERROR]')) {
              this.logger.error(
                `[SdkModelService] Bridge stderr: ${data.trim()}`,
              );
            }
          },
        },
      });
      const models = await Promise.race([
        tempQuery.supportedModels(),
        new Promise<ModelInfo[]>((_, reject) => {
          timeoutId = setTimeout(
            () =>
              reject(
                new Error(
                  `SDK supportedModels() timed out after ${SDK_MODELS_TIMEOUT_MS}ms`,
                ),
              ),
            SDK_MODELS_TIMEOUT_MS,
          );
        }),
      ]);
      clearTimeout(timeoutId);
      timeoutId = undefined;

      if (!models || models.length === 0) {
        this.logger.warn(
          '[SdkModelService] SDK returned empty models',
          stderrLines.length > 0
            ? { stderr: stderrLines.slice(-5).join('\n') }
            : undefined,
        );
        return [];
      }

      this.logger.info('[SdkModelService] Fetched supported models from SDK', {
        count: models.length,
        models: models.map((m) => `${m.value}: ${m.displayName}`),
      });

      return models;
    } catch (error) {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }

      this.logger.error(
        '[SdkModelService] SDK supportedModels() failed (will try /v1/models API next)',
        error instanceof Error ? error : new Error(String(error)),
      );
      return [];
    } finally {
      tempQuery?.close();
      abortController.abort();
    }
  }

  /**
   * Fetch models via Anthropic /v1/models API and convert to ModelInfo format.
   *
   * This is a fast HTTP call (no subprocess) that works for API key auth.
   * Returns models in ModelInfo format so
   * they can be used interchangeably with SDK's supportedModels() results.
   *
   * @returns ModelInfo[] converted from API models, empty array on failure
   */
  private async fetchModelsViaApi(): Promise<ModelInfo[]> {
    try {
      const apiModels = await this.fetchApiModels();
      if (apiModels.length === 0) return [];
      const models: ModelInfo[] = apiModels.map((m) => ({
        value: m.id,
        displayName: m.displayName,
        description: '',
      }));

      this.logger.info(
        '[SdkModelService] Fetched models from /v1/models API as fallback',
        {
          count: models.length,
        },
      );

      return models;
    } catch (error) {
      this.logger.warn(
        '[SdkModelService] /v1/models API fallback also failed',
        error instanceof Error ? error : new Error(String(error)),
      );
      return [];
    }
  }

  /**
   * Fetch all available models from the Anthropic /v1/models API
   *
   * including specific versions (e.g., claude-sonnet-4-5-20250514) that the SDK's
   * supportedModels() doesn't expose.
   *
   * Skipped for:
   * - Local proxy providers (127.0.0.1) â€” Copilot/Codex proxies may not implement /v1/models
   * - Missing auth credentials
   *
   * @returns Array of ApiModelEntry, or empty array on failure/skip
   */
  async fetchApiModels(): Promise<ApiModelEntry[]> {
    if (
      this.cachedApiModels &&
      Date.now() - this.apiModelsCacheTime < API_MODELS_CACHE_TTL
    ) {
      return this.cachedApiModels;
    }
    const baseUrl = this.authEnv.ANTHROPIC_BASE_URL;
    if (baseUrl && baseUrl.includes('127.0.0.1')) {
      this.logger.debug(
        '[SdkModelService] Skipping /v1/models for local proxy',
      );
      return [];
    }
    const apiKey = this.authEnv.ANTHROPIC_API_KEY;
    const authToken = this.authEnv.ANTHROPIC_AUTH_TOKEN;
    if (!apiKey && !authToken) {
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
   * Get default model - first from supported models.
   *
   * getSupportedModels() already normalizes values to full model IDs,
   * so no additional resolution is needed here.
   *
   * @returns Full model ID string (e.g., 'claude-sonnet-4-6')
   */
  async getDefaultModel(): Promise<string> {
    const models = await this.getSupportedModels();
    return models[0]?.value ?? '';
  }

  /**
   * Resolve a model identifier to the actual model ID to use.
   * Delegates to ModelResolver.resolve() â€” the single source of truth.
   */
  resolveModelId(model: string): string {
    const resolved = this.modelResolver.resolve(model);
    if (resolved !== model) {
      this.logger.debug(
        `[SdkModelService] Resolved '${model}' â†’ '${resolved}' via ModelResolver`,
      );
    }
    return resolved;
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
