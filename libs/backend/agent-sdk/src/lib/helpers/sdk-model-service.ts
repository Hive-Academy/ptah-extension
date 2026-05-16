/**
 * SDK Model Service - Fetches and caches supported models from SDK + Anthropic API
 *
 * Extracted from SdkAgentAdapter to separate model management concerns.
 * Models are fetched using a multi-strategy approach (in priority order):
 * 1. SDK's supportedModels() API — authoritative, account-filtered
 * 2. Anthropic /v1/models API — fast HTTP fallback for all available models
 * 3. Hardcoded fallback — never cached, next call retries dynamic sources
 *
 * Single Responsibility: Fetch, cache, and provide model information
 *
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS, ConfigManager } from '@ptah-extension/vscode-core';
import { AuthEnv } from '@ptah-extension/shared';
import { SDK_TOKENS } from '../di/tokens';
import { ModelInfo } from '../types/sdk-types/claude-sdk.types';
import { SdkModuleLoader } from './sdk-module-loader';
import type { ModelResolver } from '../auth/model-resolver';
import { normalizeAuthMethod } from './auth-method.utils';

/**
 * Model entry from the Anthropic /v1/models API
 */
/** Internal type for /v1/models API response entries. Not exported — consumers use ModelInfo[]. */
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
 * Canonical mapping from bare tier names to full model IDs.
 * Exported as the single source of truth — all consumers must import this
 * rather than maintaining their own copies.
 *
 * The SDK's query() requires full model IDs (e.g., 'claude-opus-4-6').
 * Bare tier names like 'opus' cause "can't access model named opus" errors.
 *
 * 'default' maps to Opus — the CLI SDK's recommended default tier is Opus 4.7.
 * Storing 'default' (the tier name the CLI SDK returns from supportedModels())
 * must resolve to the actual model the CLI uses, not an arbitrary cost-based fallback.
 *
 * MAINTENANCE: Update these when new Claude model versions are released.
 */
export const TIER_TO_MODEL_ID: Record<ModelTier, string> = {
  opus: 'claude-opus-4-7',
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5-20251001',
  default: 'claude-opus-4-7',
};

/** Default fallback model ID — Opus as the CLI's recommended default */
export const DEFAULT_FALLBACK_MODEL_ID = TIER_TO_MODEL_ID['default'];

/**
 * Static fallback model list shown when both SDK supportedModels() and
 * /v1/models API are unavailable (e.g., CLI auth with no network, or
 * first-boot before the SDK bridge initializes).
 *
 * These are never cached — every call to getSupportedModels() retries
 * the dynamic sources. The fallback just keeps the dropdown populated.
 */
const STATIC_FALLBACK_MODELS: ModelInfo[] = [
  {
    value: 'default',
    displayName: 'Default (recommended)',
    description: 'Uses the best available model for your account',
  },
  {
    value: 'opus',
    displayName: 'Claude Opus 4.7',
    description: 'Most capable model for complex tasks',
  },
  {
    value: 'sonnet',
    displayName: 'Claude Sonnet 4.6',
    description: 'Best balance of speed and intelligence',
  },
  {
    value: 'haiku',
    displayName: 'Claude Haiku 4.5',
    description: 'Fastest and most compact model',
  },
];

/**
 * Canonical mapping from tier names to their ANTHROPIC_DEFAULT_*_MODEL env var keys.
 * Single source of truth — all consumers must import this rather than defining their own.
 *
 * Used by:
 * - SdkModelService.resolveModelId() — to check env var overrides
 * - ProviderModelsService.setModelTier() — to set env vars for proxy providers
 * - buildTierEnvDefaults() — to guarantee env vars for SDK subagent spawning
 * - clearAllTierEnvVars() / applyPersistedTiers() — to manage tier env lifecycle
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
 * For direct Anthropic (CLI or API key → api.anthropic.com), this returns an
 * empty record. The CLI/SDK handles its own tier resolution natively, and
 * setting these env vars pins resolution to our hardcoded defaults, blocking
 * any updates the CLI account has to newer models.
 *
 * @param authEnv - Current AuthEnv (must already reflect active provider)
 * @returns Record of ANTHROPIC_DEFAULT_*_MODEL values (empty for direct Anthropic)
 */
export function buildTierEnvDefaults(authEnv: AuthEnv): Record<string, string> {
  const baseUrl = authEnv.ANTHROPIC_BASE_URL?.trim();
  const isDirectAnthropic =
    !baseUrl || /^https?:\/\/api\.anthropic\.com\/?$/i.test(baseUrl);

  if (isDirectAnthropic) {
    return {};
  }

  const defaults: Record<string, string> = {};
  for (const [tier, envKey] of Object.entries(TIER_ENV_VAR_MAP)) {
    const value = authEnv[envKey];
    if (value) {
      defaults[envKey] = value;
    } else {
      defaults[envKey] = TIER_TO_MODEL_ID[tier as EnvMappedTier];
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
    @inject(SDK_TOKENS.SDK_AUTH_ENV) private readonly authEnv: AuthEnv,
    @inject(SDK_TOKENS.SDK_MODEL_RESOLVER)
    private readonly modelResolver: ModelResolver,
    @inject(TOKENS.CONFIG_MANAGER) private readonly config: ConfigManager,
  ) {}

  /**
   * Get supported models for the active auth method.
   *
   * Tier mapping (ANTHROPIC_DEFAULT_*_MODEL resolution) applies ONLY to
   * third-party providers. For Claude-native auth (API key, CLI), models
   * are returned as-is from the source:
   *
   * - claudeCli  → query.supportedModels() directly (tier slots: opus/sonnet/haiku)
   * - apiKey     → /v1/models API directly (full versioned model IDs)
   * - thirdParty → query.supportedModels() + tier mapping to provider model IDs
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
    // Route through the shared normalizer so new spellings ('claude-cli',
    // 'oauth') and legacy ones ('openrouter', 'claudeCli') resolve identically.
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
      '[SdkModelService] All model sources failed — using static fallback list',
      { authMethod },
    );
    return STATIC_FALLBACK_MODELS;
  }

  /**
   * API key auth: try /v1/models first (full versioned list), fall back to
   * SDK tier slots. No tier mapping — Anthropic native auth, IDs are valid as-is.
   */
  private async fetchModelsForApiKey(): Promise<ModelInfo[]> {
    const apiModels = await this.fetchModelsViaApi();
    if (apiModels.length > 0) {
      this.logger.info('[SdkModelService] Models from /v1/models API', {
        count: apiModels.length,
      });
      return apiModels;
    }

    // API call failed (network, rate limit, etc.) — fall back to SDK tier slots.
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

    // Third-party providers: resolve tiers to provider-specific model IDs
    // and deduplicate (different tiers may map to the same provider model).
    // 'default' resolves as opus but keeps its own display name and is NOT
    // deduplicated against opus — users can select either.
    const seen = new Set<string>();
    const normalized: ModelInfo[] = [];
    let isDefault = false;

    for (const m of models) {
      isDefault = m.value.toLowerCase() === 'default';
      const resolvedValue = isDefault
        ? this.resolveModelId('opus')
        : this.resolveModelId(m.value);

      // Don't deduplicate 'default' against opus — both should appear
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
        `[SdkModelService] applyTierMapping: ${collisions} duplicate(s) collapsed (${models.length} → ${normalized.length})`,
      );
    }

    return normalized;
  }

  /**
   * Get all available models from the Anthropic /v1/models API as ModelInfo[].
   * Public counterpart of fetchModelsViaApi() — same shape as getSupportedModels()
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
    // Resolve pathToClaudeCodeExecutable — required for the SDK to start
    // the bridge process in production
    const cliJsPath = await this.moduleLoader.getCliJsPath();
    if (!cliJsPath) {
      this.logger.warn(
        '[SdkModelService] No CLI js path available — SDK bridge cannot start',
      );
      return [];
    }

    // No pre-flight auth check — the SDK bridge can authenticate via CLI's
    // credential store (~/.claude/) even when authEnv has no explicit credentials.
    // Blocking here caused CLI auth users to always fall through to hardcoded fallback.
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
            ? 'No env credentials — SDK will use CLI credential store'
            : undefined,
      },
    );

    // AbortController to clean up the subprocess after we get models
    const abortController = new AbortController();

    // Track the temp query reference outside try so finally can clean it up
    let tempQuery: ReturnType<
      Awaited<ReturnType<typeof this.moduleLoader.getQueryFunction>>
    > | null = null;

    // Track the timeout so we can clear it and avoid unhandled rejections
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      const query = await this.moduleLoader.getQueryFunction();

      // Empty prompt — we only need the initialization response.
      // The generator yields nothing; the SDK reads it as "no user messages".
      const emptyPrompt = (async function* () {
        // Intentionally empty — we only call supportedModels(), not chat
      })();

      // Build env matching the real chat query config — the SDK bridge reads
      // auth from these env vars during initialization. Any mismatch from the
      // chat query config causes models to fail while chat works.
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

      // settingSources: match the chat query. When using a translation proxy
      // (127.0.0.1), exclude 'user' to prevent ~/.claude/settings.json from
      // overriding ANTHROPIC_BASE_URL and routing requests away from the proxy.
      const settingSources: Array<'user' | 'project' | 'local'> =
        baseUrl?.includes('127.0.0.1')
          ? ['project', 'local']
          : ['user', 'project', 'local'];

      // Collect stderr from the SDK bridge for debugging
      const stderrLines: string[] = [];

      tempQuery = query({
        prompt: emptyPrompt,
        options: {
          abortController,
          cwd: require('os').homedir(),
          pathToClaudeCodeExecutable: cliJsPath,
          settingSources,
          env,
          // Capture stderr — critical for debugging why the bridge fails
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

      // Race the supportedModels() call against a timeout.
      // The bridge subprocess can hang if auth is misconfigured or the
      // network is unreachable. Without a timeout, getSupportedModels()
      // would block forever.
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

      // Clear timeout immediately — prevents unhandled rejection from the
      // timeout Promise firing after supportedModels() already resolved.
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
      // Clear timeout on error path too
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }

      this.logger.error(
        '[SdkModelService] SDK supportedModels() failed (will try /v1/models API next)',
        error instanceof Error ? error : new Error(String(error)),
      );
      return [];
    } finally {
      // Always clean up the subprocess — whether success, error, or timeout.
      // Without this, the bridge process leaks on timeout.
      try {
        tempQuery?.close();
      } catch {
        // close() may throw if the process already exited — ignore
      }
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

      // Convert ApiModelEntry[] to ModelInfo[] format
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
   * Get default model - first from supported models.
   *
   * getSupportedModels() already normalizes values to full model IDs,
   * so no additional resolution is needed here.
   *
   * @returns Full model ID string (e.g., 'claude-sonnet-4-6')
   */
  async getDefaultModel(): Promise<string> {
    const models = await this.getSupportedModels();
    return models[0]?.value ?? DEFAULT_FALLBACK_MODEL_ID;
  }

  /**
   * Resolve a model identifier to the actual model ID to use.
   * Delegates to ModelResolver.resolve() — the single source of truth.
   */
  resolveModelId(model: string): string {
    const resolved = this.modelResolver.resolve(model);
    if (resolved !== model) {
      this.logger.debug(
        `[SdkModelService] Resolved '${model}' → '${resolved}' via ModelResolver`,
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
