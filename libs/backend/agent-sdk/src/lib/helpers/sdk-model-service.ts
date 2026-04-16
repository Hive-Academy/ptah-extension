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
 * @see TASK_2025_102 - Extracted to reduce SdkAgentAdapter complexity
 * @see TASK_2025_237 - Added API model fetching for dynamic model discovery
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { AuthEnv } from '@ptah-extension/shared';
import { SDK_TOKENS } from '../di/tokens';
import { ModelInfo } from '../types/sdk-types/claude-sdk.types';
import { SdkModuleLoader } from './sdk-module-loader';
import type { ModelResolver } from '../auth/model-resolver';

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
 * 'default' maps to Sonnet as the best cost/capability balance for fallback.
 *
 * MAINTENANCE: Update these when new Claude model versions are released.
 */
export const TIER_TO_MODEL_ID: Record<ModelTier, string> = {
  opus: 'claude-opus-4-6',
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5-20251001',
  default: 'claude-sonnet-4-6',
};

/** Default fallback model ID — Sonnet as the best cost/capability balance */
export const DEFAULT_FALLBACK_MODEL_ID = TIER_TO_MODEL_ID['default'];

/** Type guard: check if a string is a valid ModelTier key */
function isModelTier(value: string): value is ModelTier {
  return value in TIER_TO_MODEL_ID;
}

/** Type guard: check if a string is an EnvMappedTier key */
function isEnvMappedTier(value: string): value is EnvMappedTier {
  return value in TIER_ENV_VAR_MAP;
}

/**
 * Detect which tier family a full Claude model ID belongs to.
 * e.g., 'claude-sonnet-4-6' → 'sonnet', 'claude-opus-4-6' → 'opus'
 *
 * Used by resolveModelId() to check provider overrides for full Claude IDs.
 * When using non-Anthropic providers, 'claude-sonnet-4-6' must map to the
 * provider's equivalent (e.g., 'glm-5.1' for Z.AI).
 */
function detectTierFromClaudeId(model: string): EnvMappedTier | null {
  const lower = model.toLowerCase();
  if (lower.includes('opus')) return 'opus';
  if (lower.includes('sonnet')) return 'sonnet';
  if (lower.includes('haiku')) return 'haiku';
  return null;
}

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
 * The Claude Agent SDK resolves bare tier names ('haiku', 'sonnet', 'opus') in
 * subagent subprocesses by reading ANTHROPIC_DEFAULT_*_MODEL env vars. When using
 * direct Anthropic auth (API key), these vars are never set because
 * ProviderModelsService.setModelTier() is only called for third-party providers.
 *
 * This function returns a Record that guarantees all three tier env vars are
 * present — using existing authEnv values when set (proxy provider), falling
 * back to TIER_TO_MODEL_ID defaults (direct Anthropic).
 *
 * @param authEnv - Current AuthEnv (may have overrides from proxy provider)
 * @returns Record with guaranteed ANTHROPIC_DEFAULT_*_MODEL values
 */
export function buildTierEnvDefaults(authEnv: AuthEnv): Record<string, string> {
  const defaults: Record<string, string> = {};
  for (const [tier, envKey] of Object.entries(TIER_ENV_VAR_MAP)) {
    defaults[envKey] =
      authEnv[envKey] || TIER_TO_MODEL_ID[tier as EnvMappedTier];
  }
  return defaults;
}

/**
 * Resolve a model identifier to a full model ID (static version).
 *
 * Standalone function for contexts where SdkModelService is not injectable
 * (e.g., RPC handlers). Uses the same resolution priority as the instance
 * method:
 *
 * 1. Full Claude ID with provider override → return provider model
 * 2. Full Claude ID without override → return as-is
 * 3. Bare tier with env var override → use provider-specific mapping
 * 4. Known tier in TIER_TO_MODEL_ID → return default mapping
 * 5. Unknown → return as-is
 *
 * @param model - Model string (could be full ID or bare tier name)
 * @param authEnv - Optional AuthEnv for env var override checks (proxy providers)
 */
/**
 * @deprecated Use ModelResolver.resolve() or ModelResolver.resolveStatic() instead.
 * Kept for backward compatibility — logic duplicated in ModelResolver.resolveStatic().
 */
export function resolveModelIdStatic(model: string, authEnv?: AuthEnv): string {
  if (model.startsWith('claude-')) {
    if (authEnv) {
      const tier = detectTierFromClaudeId(model);
      if (tier) {
        const envKey = TIER_ENV_VAR_MAP[tier];
        const override = authEnv[envKey];
        if (override && override !== model) {
          return override;
        }
      }
    }
    return model;
  }
  const tierLower = model.toLowerCase();

  if (authEnv && isEnvMappedTier(tierLower)) {
    const envKey = TIER_ENV_VAR_MAP[tierLower];
    const override = authEnv[envKey];
    if (override) {
      return override;
    }
  }

  return isModelTier(tierLower) ? TIER_TO_MODEL_ID[tierLower] : model;
}

/**
 * Fallback models using full model IDs.
 * The SDK's query() function requires full model IDs (e.g., 'claude-opus-4-6'),
 * NOT bare tier names like 'opus'. When supportedModels() fails and we fall back
 * to these, the IDs must be API-valid so the SDK can use them directly.
 *
 * MAINTENANCE: Update these when new Claude model versions are released.
 */
const FALLBACK_MODELS: ModelInfo[] = [
  {
    value: TIER_TO_MODEL_ID['opus'],
    displayName: 'Claude Opus 4.6',
    description: 'Most capable for complex work',
  },
  {
    value: TIER_TO_MODEL_ID['sonnet'],
    displayName: 'Claude Sonnet 4.6',
    description: 'Best for everyday tasks',
  },
  {
    value: TIER_TO_MODEL_ID['haiku'],
    displayName: 'Claude Haiku 4.5',
    description: 'Fastest for quick answers',
  },
];

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
  ) {}

  /**
   * Get supported models from the best available source.
   *
   * Multi-strategy approach (in priority order):
   * 1. Return cached models if available (SDK or API source)
   * 2. Try SDK's supportedModels() — spawns subprocess with full auth config
   * 3. Try /v1/models API — fast HTTP call, works for API key auth
   * 4. Fallback to hardcoded models (never cached, so next call retries)
   *
   * The SDK's supportedModels() is preferred because it returns the exact models
   * the account has access to (filtered by subscription/permissions), while
   * /v1/models returns all available models regardless of access.
   *
   * @returns Array of ModelInfo with value (API ID), displayName, and description
   */
  async getSupportedModels(): Promise<ModelInfo[]> {
    // Return cached if a previous call succeeded
    if (this.cachedModels.length > 0) {
      return this.cachedModels;
    }

    // Strategy 1: SDK's supportedModels() — authoritative, account-filtered
    const sdkModels = await this.fetchModelsViaSdk();
    if (sdkModels.length > 0) {
      this.logger.info('[SdkModelService] RAW from SDK supportedModels()', {
        source: 'sdk',
        raw: sdkModels.map((m) => ({
          value: m.value,
          displayName: m.displayName,
        })),
      });
      this.cachedModels = this.normalizeModels(sdkModels);
      this.logger.info(
        '[SdkModelService] NORMALIZED models returned to consumers',
        {
          source: 'sdk',
          normalized: this.cachedModels.map((m) => ({
            value: m.value,
            displayName: m.displayName,
          })),
        },
      );
      return this.cachedModels;
    }

    // Strategy 2: /v1/models API — fast HTTP, but returns ALL models (not filtered)
    // API models already have full IDs (e.g., 'claude-sonnet-4-5-20250514')
    const apiModels = await this.fetchModelsViaApi();
    if (apiModels.length > 0) {
      this.logger.info(
        '[SdkModelService] Models from /v1/models API (already full IDs)',
        {
          source: 'api',
          models: apiModels.map((m) => ({
            value: m.value,
            displayName: m.displayName,
          })),
        },
      );
      this.cachedModels = apiModels;
      return this.cachedModels;
    }

    // Fallback: hardcoded models — NOT cached so next call retries
    // FALLBACK_MODELS already use full IDs via TIER_TO_MODEL_ID
    this.logger.warn(
      '[SdkModelService] All strategies failed, using FALLBACK_MODELS',
      {
        source: 'fallback',
        models: FALLBACK_MODELS.map((m) => ({
          value: m.value,
          displayName: m.displayName,
        })),
      },
    );
    return FALLBACK_MODELS;
  }

  /**
   * Check if a non-Anthropic provider is active (e.g., Copilot, Codex, OpenRouter).
   * When true, model values need normalization to provider-specific IDs.
   * When false (direct Anthropic), SDK models are passed through as-is.
   */
  private isThirdPartyProvider(): boolean {
    const baseUrl = this.authEnv.ANTHROPIC_BASE_URL?.trim();
    return !!baseUrl && !/^https?:\/\/api\.anthropic\.com\/?$/i.test(baseUrl);
  }

  /**
   * Normalize SDK models: resolve bare tier names in `.value` to full model IDs
   * and deduplicate.
   *
   * For direct Anthropic auth (API key): pass models through as-is.
   * The SDK returns the correct models for the account and the 'default' tier
   * works natively.
   *
   * For third-party providers: resolve bare tier names to provider-specific
   * model IDs via ANTHROPIC_DEFAULT_*_MODEL env vars, and replace the 'default'
   * meta-tier with 'sonnet' to avoid stale-cache issues (if env vars aren't set
   * at cache time, 'default' resolves to claude-sonnet-4-6 instead of the
   * provider's model).
   */
  private normalizeModels(models: ModelInfo[]): ModelInfo[] {
    // Direct Anthropic: no normalization needed — SDK models are authoritative
    if (!this.isThirdPartyProvider()) {
      this.logger.debug(
        '[SdkModelService] Direct Anthropic provider — returning SDK models as-is',
      );
      return models;
    }

    // Third-party provider: resolve tier names to provider-specific model IDs
    const seen = new Set<string>();
    const normalized: ModelInfo[] = [];

    for (const m of models) {
      // Replace 'default' meta-tier with 'sonnet' before resolving.
      // 'default' always maps to sonnet but can cache the wrong value
      // when env vars aren't set at cache time.
      const value = m.value.toLowerCase() === 'default' ? 'sonnet' : m.value;

      const resolvedValue = this.resolveModelId(value);
      if (seen.has(resolvedValue)) continue;
      seen.add(resolvedValue);

      normalized.push({
        ...m,
        value: resolvedValue,
        ...(m.value.toLowerCase() === 'default' && {
          displayName: 'Sonnet',
        }),
      });
    }

    if (normalized.length !== models.length) {
      this.logger.debug(
        `[SdkModelService] Normalized ${models.length} SDK models to ${normalized.length} (deduplicated)`,
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
    // the bridge process in production (TASK_2025_194)
    const cliJsPath = await this.moduleLoader.getCliJsPath();
    if (!cliJsPath) {
      this.logger.warn(
        '[SdkModelService] No CLI js path available — SDK bridge cannot start',
      );
      return [];
    }

    // Pre-flight auth check — no point spawning a subprocess without credentials
    const hasApiKey = !!this.authEnv.ANTHROPIC_API_KEY;
    const hasAuthToken = !!this.authEnv.ANTHROPIC_AUTH_TOKEN;

    if (!hasApiKey && !hasAuthToken) {
      this.logger.warn(
        '[SdkModelService] No auth credentials in AuthEnv — SDK supportedModels() will fail',
      );
      return [];
    }

    this.logger.debug(
      '[SdkModelService] Fetching models via SDK supportedModels()',
      {
        hasApiKey,
        hasAuthToken,
        hasBaseUrl: !!this.authEnv.ANTHROPIC_BASE_URL,
        cliJsPath,
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
   * Resolve a model identifier to a full model ID suitable for the SDK.
   *
   * The SDK's query() function requires full model IDs (e.g., 'claude-opus-4-6').
   * Bare tier names ('opus', 'sonnet', 'haiku') stored in older configs or from
   * fallback models must be resolved to full IDs.
   *
   * Resolution priority:
   * 1. Full Claude ID with active provider override → return provider model
   *    (e.g., 'claude-sonnet-4-6' → 'glm-5.1' when ANTHROPIC_DEFAULT_SONNET_MODEL is set)
   * 2. Full Claude ID without override → return as-is
   * 3. Bare tier with env var override → use override
   * 4. Bare tier without override → use hardcoded default
   * 5. Unknown → return as-is (let SDK handle it)
   *
   * @param model - Model string (could be full ID or bare tier name)
   * @returns Full model ID (provider-specific when overrides are active)
   */
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
