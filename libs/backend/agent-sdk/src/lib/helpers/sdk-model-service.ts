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
export const TIER_TO_MODEL_ID: Record<string, string> = {
  opus: 'claude-opus-4-6',
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5-20251001',
  default: 'claude-sonnet-4-6',
};

/** Default fallback model ID — Sonnet as the best cost/capability balance */
export const DEFAULT_FALLBACK_MODEL_ID = 'claude-sonnet-4-6';

/**
 * Known tier names that have corresponding ANTHROPIC_DEFAULT_*_MODEL env vars.
 * Used to safely construct env var keys without unsound `as keyof AuthEnv` casts.
 */
const TIER_ENV_VAR_MAP: Record<string, keyof AuthEnv> = {
  opus: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
  sonnet: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
  haiku: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
};

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
  ) {}

  /**
   * Get supported models from the best available source.
   *
   * Multi-strategy approach (in priority order):
   * 1. Return cached models if available (SDK or API source)
   * 2. Try SDK's supportedModels() — spawns subprocess with full auth config
   * 3. Try /v1/models API — fast HTTP call, works for API key and some OAuth
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
      this.cachedModels = sdkModels;
      return sdkModels;
    }

    // Strategy 2: /v1/models API — fast HTTP, but returns ALL models (not filtered)
    const apiModels = await this.fetchModelsViaApi();
    if (apiModels.length > 0) {
      this.cachedModels = apiModels;
      return apiModels;
    }

    // Fallback: hardcoded models — NOT cached so next call retries
    this.logger.warn(
      '[SdkModelService] All model fetch strategies failed, using hardcoded fallback',
    );
    return FALLBACK_MODELS;
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
    const hasOAuth = !!this.authEnv.CLAUDE_CODE_OAUTH_TOKEN;
    const hasAuthToken = !!this.authEnv.ANTHROPIC_AUTH_TOKEN;

    if (!hasApiKey && !hasOAuth && !hasAuthToken) {
      this.logger.warn(
        '[SdkModelService] No auth credentials in AuthEnv — SDK supportedModels() will fail',
      );
      return [];
    }

    this.logger.debug(
      '[SdkModelService] Fetching models via SDK supportedModels()',
      {
        hasApiKey,
        hasOAuth,
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
   * This is a fast HTTP call (no subprocess) that works for API key auth and
   * may work for OAuth Bearer tokens. Returns models in ModelInfo format so
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
   * Returns a full model ID suitable for the SDK's query() function.
   * Resolves SDK's 'default' tier and bare tier names to full model IDs.
   *
   * @returns Full model ID string (e.g., 'claude-sonnet-4-6')
   */
  async getDefaultModel(): Promise<string> {
    const models = await this.getSupportedModels();
    const first = models[0];
    if (!first) return DEFAULT_FALLBACK_MODEL_ID;

    // If SDK returns 'default' as the value, resolve to a full model ID
    if (first.value.toLowerCase() === 'default') {
      const desc = (
        (first.displayName || '') +
        ' ' +
        (first.description || '')
      ).toLowerCase();
      if (desc.includes('opus')) return this.resolveModelId('opus');
      if (desc.includes('sonnet')) return this.resolveModelId('sonnet');
      if (desc.includes('haiku')) return this.resolveModelId('haiku');
      return this.resolveModelId('sonnet'); // safe fallback
    }

    // Ensure the returned value is a full model ID, not a bare tier name
    return this.resolveModelId(first.value);
  }

  /**
   * Resolve a model identifier to a full model ID suitable for the SDK.
   *
   * The SDK's query() function requires full model IDs (e.g., 'claude-opus-4-6').
   * Bare tier names ('opus', 'sonnet', 'haiku') stored in older configs or from
   * fallback models must be resolved to full IDs.
   *
   * Resolution priority:
   * 1. Already a full ID (starts with 'claude-') → return as-is
   * 2. Env var override (ANTHROPIC_DEFAULT_*_MODEL) → use override
   * 3. Known tier mapping → use hardcoded default
   * 4. Unknown → return as-is (let SDK handle it)
   *
   * @param model - Model string (could be full ID or bare tier name)
   * @returns Full model ID
   */
  resolveModelId(model: string): string {
    // Already a full model ID — no resolution needed
    if (model.startsWith('claude-')) {
      return model;
    }

    const tierLower = model.toLowerCase();

    // Check env var overrides first (set by ProviderModelsService.setModelTier).
    // Only check known tiers that have corresponding env vars — avoids
    // constructing invalid env key names from arbitrary input.
    const envVarKey = TIER_ENV_VAR_MAP[tierLower];
    if (envVarKey) {
      const envOverride = this.authEnv[envVarKey];
      if (envOverride) {
        this.logger.debug(
          `[SdkModelService] Resolved '${model}' to '${envOverride}' via ${envVarKey}`,
        );
        return envOverride;
      }
    }

    // Fall back to known tier-to-model-ID mapping
    const knownId = TIER_TO_MODEL_ID[tierLower];
    if (knownId) {
      this.logger.debug(
        `[SdkModelService] Resolved bare tier name '${model}' to '${knownId}'`,
      );
      return knownId;
    }

    // Unknown model identifier — return as-is and let SDK handle it.
    // This is expected for third-party provider models (e.g., 'kimi-k2-pro').
    this.logger.debug(
      `[SdkModelService] Unknown model identifier '${model}', passing through to SDK`,
    );
    return model;
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
