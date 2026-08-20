/**
 * Provider Models Service
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
  ProviderTierScope,
  ModelPricing,
} from '@ptah-extension/shared';
import { updatePricingMap } from '@ptah-extension/shared';
import {
  SdkError,
  TIER_ENV_VAR_MAP,
  TIER_METADATA_ENV_VAR_MAP,
  ALL_TIER_ENV_KEYS,
} from '@ptah-extension/agent-sdk';
import {
  getAnthropicProvider,
  type AnthropicProvider,
} from '@ptah-extension/shared';
import { AUTH_PROVIDERS_TOKENS } from './di/tokens';
import { ActiveProviderResolver } from './auth/active-provider-resolver';
import {
  deriveTiersFromCatalog,
  type DerivedTierMap,
} from './model-tier-derivation';

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

  /**
   * Providers whose catalogue is being refreshed for tier derivation right now.
   *
   * Bounds the work to one in-flight refresh per provider and, because the
   * entry is only cleared after the re-application, stops the re-application
   * from scheduling a refresh of its own. One activation, at most one fetch.
   */
  private readonly tierRefreshInFlight = new Set<string>();

  constructor(
    @inject(TOKENS.LOGGER) private logger: Logger,
    @inject(TOKENS.CONFIG_MANAGER) private config: ConfigManager,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_AUTH_ENV) private authEnv: AuthEnv,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_ACTIVE_PROVIDER_RESOLVER)
    private activeProviderResolver: ActiveProviderResolver,
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
   * Get the per-provider, per-scope config key for a tier.
   *
   * Key shape: `provider.<providerId>.<scope>.modelTier.<tier>`
   * e.g.  `provider.moonshot.mainAgent.modelTier.haiku`
   *       `provider.moonshot.cliAgent.modelTier.haiku`
   *
   * The legacy (pre-scope) key `provider.<providerId>.modelTier.<tier>` is
   * still honoured on read for the `mainAgent` scope via
   * `getPersistedTierValue` â€” no migration writes are needed.
   */
  private getTierConfigKey(
    providerId: string,
    tier: ProviderModelTier,
    scope: ProviderTierScope,
  ): string {
    return `provider.${providerId}.${scope}.modelTier.${tier}`;
  }

  /** Config key holding the last catalog a provider successfully returned. */
  private getCatalogConfigKey(providerId: string): string {
    return `provider.${providerId}.modelCatalog`;
  }

  /**
   * Remember the catalog a provider just returned so a later fetch failure can
   * fall back to real data instead of the hardcoded `staticModels` snapshot.
   *
   * Fire-and-forget: a failed write must never break the fetch that produced
   * the data, so this swallows its own errors after logging.
   */
  private async persistCatalog(
    providerId: string,
    models: ProviderModelInfo[],
  ): Promise<void> {
    try {
      await this.config.set(this.getCatalogConfigKey(providerId), {
        models,
        timestamp: Date.now(),
      });
    } catch (error: unknown) {
      this.logger.debug(
        '[ProviderModelsService] Failed to persist model catalog',
        {
          providerId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  /**
   * Read the persisted catalog. Returns null when absent or malformed — the
   * value survives across releases, so treat its shape as untrusted.
   */
  private readPersistedCatalog(providerId: string): ProviderModelInfo[] | null {
    const stored = this.config.get<{ models?: unknown }>(
      this.getCatalogConfigKey(providerId),
    );
    const models = stored?.models;
    if (!Array.isArray(models)) return null;
    const valid = models.filter(
      (m): m is ProviderModelInfo =>
        !!m &&
        typeof m === 'object' &&
        typeof (m as ProviderModelInfo).id === 'string' &&
        typeof (m as ProviderModelInfo).name === 'string',
    );
    return valid.length > 0 ? valid : null;
  }

  /**
   * Legacy config key shape used before scope was introduced.
   * Only used as a read-fallback for the `mainAgent` scope.
   */
  private getLegacyTierConfigKey(
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
    const dynamicFetcher = this.dynamicFetchers.get(providerId);
    if (dynamicFetcher) {
      try {
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
          void this.persistCatalog(providerId, models);

          const filtered = toolUseOnly
            ? models.filter((m) => m.supportsToolUse)
            : models;
          return {
            models: filtered,
            totalCount: models.length,
            isStatic: false,
          };
        }
      } catch (error) {
        this.logger.warn(
          '[ProviderModelsService] Dynamic fetcher failed, falling back to static models',
          {
            providerId,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
      if (!getAnthropicProvider(providerId)) {
        return { models: [], totalCount: 0, isStatic: false };
      }
    }

    const provider = getAnthropicProvider(providerId);
    if (!provider) {
      throw new SdkError(`Unknown provider: ${providerId}`);
    }
    if (provider.modelsEndpoint && apiKey) {
      try {
        const result = await this.fetchDynamicModels(
          providerId,
          provider,
          apiKey,
          toolUseOnly,
        );
        result.models = this.mergeStaticMetadata(result.models, provider);
        if (result.models.length > 0) {
          void this.persistCatalog(providerId, result.models);
        }
        return result;
      } catch (error) {
        this.logger.warn(
          '[ProviderModelsService] Dynamic fetch failed, falling back to static models',
          {
            providerId,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }
    // Prefer the last catalog this provider actually returned over the
    // hardcoded one. `staticModels` is a snapshot frozen at release time and
    // goes stale on every provider model launch; a persisted catalog is real
    // provider data that merely isn't live.
    const persisted = this.readPersistedCatalog(providerId);
    if (persisted && persisted.length > 0) {
      this.logger.info(
        '[ProviderModelsService] Live fetch unavailable — using the last catalog this provider returned',
        { providerId, count: persisted.length },
      );
      const filtered = toolUseOnly
        ? persisted.filter((m) => m.supportsToolUse)
        : persisted;
      return {
        models: filtered,
        totalCount: persisted.length,
        isStatic: false,
      };
    }

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
      throw new SdkError(
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
        throw new SdkError(`Invalid response format from ${provider.name} API`);
      }
      const models = this.transformApiModels(data.data);
      this.feedPricingMap(models);
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
          throw new SdkError(
            `${provider.name} API key is invalid or expired. Please delete your key and re-enter a valid one.`,
          );
        }
        throw new SdkError(
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
        name:
          model.name !== model.id ? model.name : staticInfo.name || model.name,
        description: model.description || staticInfo.description,
        contextLength: model.contextLength || staticInfo.contextLength,
      };
    });
  }

  /**
   * Set model override for a tier on a specific provider.
   *
   * Always persists to the scoped config key.
   * Mutates `this.authEnv` and `process.env` ONLY when `scope === 'mainAgent'`
   * so that CLI sub-agent configurations cannot poison the main agent's
   * runtime environment.
   *
   * @param providerId - Provider ID
   * @param tier - Sonnet, Opus, or Haiku
   * @param modelId - Model ID (e.g., "openai/gpt-5.1-codex-max")
   * @param scope - Whether this write is for the main agent or a CLI sub-agent
   */
  async setModelTier(
    providerId: string,
    tier: ProviderModelTier,
    modelId: string,
    scope: ProviderTierScope,
  ): Promise<void> {
    const envVar = TIER_ENV_VAR_MAP[tier];
    const configKey = this.getTierConfigKey(providerId, tier, scope);
    await this.config.set(configKey, modelId);
    if (scope === 'mainAgent') {
      this.authEnv[envVar as keyof AuthEnv] = modelId;
      process.env[envVar] = modelId;
      this.applyTierMetadata(providerId, tier, modelId);
    }

    this.logger.info('[ProviderModelsService] Set model tier', {
      providerId,
      tier,
      modelId,
      scope,
      envVar: scope === 'mainAgent' ? envVar : '(not set â€” cliAgent scope)',
    });
  }

  /**
   * Get current model tier mappings for a specific provider and scope.
   *
   * Reads from the scoped config key
   * (`provider.<id>.<scope>.modelTier.<tier>`). For `mainAgent` scope,
   * transparently falls back to the legacy unscoped key
   * (`provider.<id>.modelTier.<tier>`) so existing user configurations
   * continue to work without any data migration.
   *
   * @param providerId - Provider ID
   * @param scope - Which agent's tier mapping to retrieve
   */
  getModelTiers(
    providerId: string,
    scope: ProviderTierScope,
  ): {
    sonnet: string | null;
    opus: string | null;
    haiku: string | null;
  } {
    return {
      sonnet: this.getPersistedTierValue(providerId, 'sonnet', scope),
      opus: this.getPersistedTierValue(providerId, 'opus', scope),
      haiku: this.getPersistedTierValue(providerId, 'haiku', scope),
    };
  }

  /**
   * Clear a model tier override for a specific provider and scope.
   *
   * Always clears the scoped config key. Removes the global env var entry
   * ONLY when `scope === 'mainAgent'` to avoid clearing main-agent runtime
   * state when a CLI sub-agent tier is reset.
   *
   * @param providerId - Provider ID
   * @param tier - Sonnet, Opus, or Haiku
   * @param scope - Which agent's tier mapping to clear
   */
  async clearModelTier(
    providerId: string,
    tier: ProviderModelTier,
    scope: ProviderTierScope,
  ): Promise<void> {
    const envVar = TIER_ENV_VAR_MAP[tier];
    const configKey = this.getTierConfigKey(providerId, tier, scope);
    await this.config.set(configKey, undefined);
    if (scope === 'mainAgent') {
      delete this.authEnv[envVar as keyof AuthEnv];
    }

    this.logger.info('[ProviderModelsService] Cleared model tier', {
      providerId,
      tier,
      scope,
    });
  }

  /**
   * The most recent catalogue this provider itself returned, read
   * SYNCHRONOUSLY. In-memory cache first, then the copy persisted by
   * {@link persistCatalog}. Never the hardcoded `staticModels` snapshot: that
   * is a repo literal frozen at release time, and the whole point of deriving
   * tiers from a catalogue is that the provider vouched for the ids.
   *
   * Synchronous by requirement, not by preference. `ModelResolver.resolve` is
   * `string`-returning and sits on per-message hot paths, so everything that
   * feeds it has to be readable without awaiting.
   */
  private readLiveCatalog(providerId: string): ProviderModelInfo[] | null {
    const cached = this.modelCache.get(providerId);
    if (cached && cached.models.length > 0) return cached.models;
    return this.readPersistedCatalog(providerId);
  }

  /**
   * The tier mapping this provider's OWN catalogue implies — the third link of
   * the `userTiers ?? defaultTiers ?? liveDerived` chain, on its own so that
   * every site that owns a copy of that chain shares ONE implementation.
   *
   * There are three such sites and they are not interchangeable, which is why
   * this is a method rather than an inlined expression:
   *
   *  - {@link applyPersistedTiers} — mutates the shared `authEnv` and
   *    `process.env` for the ACTIVE provider (the foreground chat path);
   *  - `WorkspaceProviderProfileResolver.applyProviderTiers` — builds an
   *    isolated per-workspace SNAPSHOT and must never touch a global;
   *  - `ProviderAuthResolver.buildTierValues` — builds a background lane's /
   *    curator's override env, with the chat provider's tier keys blanked.
   *
   * They agree on WHAT a tier means and differ only in WHERE they write it. A
   * second copy of the derivation would be a second thing to get wrong, and it
   * would drift silently: all three land on the same three env var names, so a
   * disagreement shows up as one surface resolving a tier and another sending
   * the bare word.
   *
   * Pure with respect to globals: a synchronous catalogue read plus arithmetic
   * on an array. No network, no env write, no `setModelTier`. That is what
   * makes it safe for the two snapshot callers, whose whole reason to exist is
   * that they do not disturb the live chat session.
   *
   * Returns `{}` — never a guess — when the provider has no catalogue on hand.
   */
  getLiveDerivedTiers(providerId: string): DerivedTierMap {
    return deriveTiersFromCatalog(this.readLiveCatalog(providerId));
  }

  /**
   * Apply persisted tier mappings to environment for a specific provider.
   * Call this during authentication setup when a provider is active.
   *
   * Always reads from the `mainAgent` scope â€” this method's job is to
   * populate the main agent's runtime env vars, not CLI sub-agent configs.
   *
   * ## Precedence: user tier → registry `defaultTiers` → live catalogue
   *
   * The third link is TASK_2026_262. `openrouter`, `lm-studio` and `requesty`
   * declare no `defaultTiers`, so before it this method ran and legitimately
   * wrote NOTHING for them — leaving `ModelResolver.resolve` to send the bare
   * string `'opus'` (which is what the chat path's `'default'` becomes) to an
   * endpoint that cannot serve it. Deriving the missing tiers from the
   * catalogue the provider itself returned closes that for the chat path, the
   * lane-alias path and the pinned-id path at once, because all three read
   * these same three env vars.
   *
   * The order is deliberate and load-bearing: a tier the user picked, and a
   * tier map the registry actually verified, both outrank a heuristic over a
   * live list. The derivation is consulted only where the two of them left a
   * hole.
   *
   * @param providerId provider whose tiers should populate the runtime env
   * @param options.apiKey the provider's API key, when the caller has it in
   *   hand. Used only by the out-of-band refresh below — this method itself
   *   never makes a network call. Callers that hold a placeholder rather than
   *   a real key should pass nothing.
   */
  applyPersistedTiers(
    providerId: string,
    options: { apiKey?: string | null } = {},
  ): void {
    const userTiers = this.getModelTiers(providerId, 'mainAgent');
    const providerDefaults =
      getAnthropicProvider(providerId)?.defaultTiers ?? {};

    let liveDerived: DerivedTierMap | undefined;
    const derivedFor = (tier: ProviderModelTier): string | undefined => {
      liveDerived ??= this.getLiveDerivedTiers(providerId);
      return liveDerived[tier];
    };

    const effectiveTiers: Record<string, string | undefined> = {};
    for (const tier of Object.keys(TIER_ENV_VAR_MAP)) {
      const key = tier as keyof typeof TIER_ENV_VAR_MAP;
      effectiveTiers[tier] =
        userTiers[key as keyof typeof userTiers] ??
        providerDefaults[key as keyof typeof providerDefaults] ??
        derivedFor(key);
    }

    for (const [tier, envKey] of Object.entries(TIER_ENV_VAR_MAP)) {
      const value = effectiveTiers[tier];
      if (value) {
        this.authEnv[envKey as keyof AuthEnv] = value;
        process.env[envKey] = value;
        this.applyTierMetadata(providerId, tier as ProviderModelTier, value);
      }
    }

    this.logger.debug(
      '[ProviderModelsService] Applied persisted tier mappings',
      { providerId, userTiers, providerDefaults, liveDerived, effectiveTiers },
    );

    const unresolved = Object.keys(TIER_ENV_VAR_MAP).filter(
      (tier) => !effectiveTiers[tier],
    );
    if (unresolved.length > 0) {
      void this.refreshTiersFromLiveCatalog(
        providerId,
        options.apiKey ?? null,
        unresolved,
      );
    }
  }

  /**
   * Fetch the provider's catalogue out of band, then re-apply its tiers.
   *
   * The cold-cache case this exists for: a fresh install where the user has
   * just entered a key for a provider that declares no `defaultTiers` and has
   * never opened the model picker. Nothing is cached, nothing is persisted, so
   * the synchronous derivation above finds no catalogue and writes nothing —
   * exactly the state the bug was filed about. One fetch turns that into a
   * populated catalogue and a second, now-successful, tier application.
   *
   * Deliberately fire-and-forget, matching {@link persistCatalog}: this runs
   * off a provider activation, and a slow or failing model list must never
   * block or fail the activation, still less a message send. Every failure
   * mode ends in a debug line and a return — an offline LM Studio, whose
   * fetcher throws and whose `fetchModels` swallows that and returns an empty
   * list, simply leaves the tiers where they were.
   *
   * The single `await` before any work is not incidental. Two strategies
   * register their dynamic fetcher on the statement immediately AFTER
   * `switchActiveProvider` (`local-proxy.strategy.ts:101-102`,
   * `local-native.strategy.ts:153-161`), so looking for a fetcher in the same
   * synchronous turn would always miss it and LM Studio — the provider with no
   * `modelsEndpoint` and no static models, i.e. the one with nowhere else to
   * get a catalogue — would never resolve.
   */
  private async refreshTiersFromLiveCatalog(
    providerId: string,
    apiKey: string | null,
    unresolved: string[],
  ): Promise<void> {
    if (this.tierRefreshInFlight.has(providerId)) return;
    this.tierRefreshInFlight.add(providerId);
    try {
      await Promise.resolve();
      const hasRoute =
        this.dynamicFetchers.has(providerId) ||
        !!getAnthropicProvider(providerId)?.modelsEndpoint;
      if (!hasRoute) return;

      this.logger.debug(
        '[ProviderModelsService] Tiers unresolved from static data — refreshing the live catalog',
        { providerId, unresolved },
      );
      const { models } = await this.fetchModels(providerId, apiKey);
      if (models.length === 0) return;

      this.applyPersistedTiers(providerId, { apiKey });
    } catch (error: unknown) {
      this.logger.debug(
        '[ProviderModelsService] Live catalog refresh for tier derivation failed',
        {
          providerId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    } finally {
      this.tierRefreshInFlight.delete(providerId);
    }
  }

  /**
   * Re-apply the ACTIVE provider's tiers after SOMEBODY ELSE warmed its
   * catalogue.
   *
   * ## The hole this fills
   *
   * `applyPersistedTiers` derives from whatever catalogue is on hand *at the
   * moment it runs*, and it runs once, at provider activation. `fetchModels`
   * warms both catalogue caches — in-memory and persisted — but writes no tier
   * env var of its own. So the model picker (`provider:listModels`) produces
   * exactly the data the derivation wants and then leaves it sitting there:
   * the user has a populated catalogue on screen while
   * `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL` stay unset, and the next
   * resolution still sends the bare tier word. Before this, that state cleared
   * only on the next provider activation — an auth flow the user has no reason
   * to re-enter.
   *
   * This is the trigger for writer #1 and NOT a fourth writer: the precedence
   * chain, the derivation and the env write all stay in
   * {@link applyPersistedTiers}. The caller reports an event; it decides
   * nothing.
   *
   * ## The three guards, each load-bearing
   *
   * 1. **Activeness.** `applyPersistedTiers` does not check whether the
   *    provider it is given is the active one, and it writes process-global
   *    env. Re-applying for a provider the user merely browsed in the picker
   *    would repoint the ACTIVE provider's tiers at another provider's model
   *    ids — a silent wrong-model send, which is worse than the 404 this whole
   *    carrier is about. A second writer on the fetch path used to have exactly
   *    this hazard and was deleted for it (TASK_2026_265); do not reintroduce a
   *    tier write that runs off a fetch without this guard.
   * 2. **Only fill a hole.** Returns when every tier env var already has a
   *    value. This is what makes the method incapable of disturbing a working
   *    configuration; combined with `applyPersistedTiers`' own
   *    `userTiers ?? providerDefaults ?? liveDerived` order, a user's explicit
   *    pick is safe twice over — it is never reached, and it would win if it
   *    were.
   * 3. **Something new to derive from.** Returns when the catalogue on hand
   *    still implies no tiers. Without it, a picker open against a provider
   *    with no catalogue would reach `applyPersistedTiers`, find the same hole
   *    and schedule ANOTHER out-of-band fetch — turning a UI action into a
   *    network round trip that cannot possibly succeed where the one the user
   *    just triggered did not.
   *
   * Synchronous and total, for the same reason the refresh is fire-and-forget:
   * it hangs off an RPC handler that has already done its job, so it must not
   * throw into it and must not make it wait. Every failure ends in a debug
   * line.
   *
   * @param providerId the provider whose catalogue was just fetched
   */
  reapplyTiersForWarmedCatalog(providerId: string): void {
    try {
      if (providerId !== this.resolveActiveProviderId()) return;

      const unresolved = Object.values(TIER_ENV_VAR_MAP).filter(
        (envKey) => !this.authEnv[envKey as keyof AuthEnv],
      );
      if (unresolved.length === 0) return;

      if (Object.keys(this.getLiveDerivedTiers(providerId)).length === 0)
        return;

      this.logger.debug(
        '[ProviderModelsService] Catalog warmed out of band — re-applying tiers',
        { providerId, unresolved },
      );
      this.applyPersistedTiers(providerId);
    } catch (error: unknown) {
      this.logger.debug(
        '[ProviderModelsService] Re-applying tiers after a catalog warm failed',
        {
          providerId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  /**
   * Publish the display metadata the SDK pairs with a remapped tier.
   *
   * Without `_NAME`/`_DESCRIPTION` the picker labels a mapped tier with its raw
   * model id and shows Claude's own description. Resolved from the provider's
   * last known model list, so it is only available for models we've actually
   * listed — a tier pointing at a hand-typed custom id keeps the bare id.
   * That lookup reads the same cache-then-persisted catalogue the tier
   * derivation does: a live-derived tier is by construction an id from that
   * catalogue, so it must not lose its label just because the in-memory cache
   * is cold on this run.
   *
   * `_SUPPORTED_CAPABILITIES` is deliberately only written when the provider
   * declares capabilities: the SDK treats that var as an allowlist and reports
   * anything absent from it as unsupported, so guessing would silently disable
   * working features.
   */
  private applyTierMetadata(
    providerId: string,
    tier: ProviderModelTier,
    modelId: string,
  ): void {
    const keys = TIER_METADATA_ENV_VAR_MAP[tier];
    const model = this.readLiveCatalog(providerId)?.find(
      (m) => m.id === modelId,
    );

    const write = (key: keyof AuthEnv, value: string | undefined): void => {
      if (value) {
        this.authEnv[key] = value;
        process.env[key] = value;
      } else {
        delete this.authEnv[key];
        delete process.env[key];
      }
    };

    write(keys.name, model?.name);
    write(keys.description, model?.description);
    write(keys.capabilities, model?.capabilities?.join(','));
  }

  /**
   * Clear all tier environment variables
   * Call this when switching providers or switching to OAuth/API key auth
   */
  clearAllTierEnvVars(): void {
    for (const envKey of ALL_TIER_ENV_KEYS) {
      delete this.authEnv[envKey as keyof AuthEnv];
      delete process.env[envKey];
    }

    this.logger.debug(
      '[ProviderModelsService] Cleared all tier environment variables',
    );
  }

  /**
   * Switch the active provider's tier mappings
   * Clears all tier env vars, then applies persisted tiers for the new provider
   *
   * Still synchronous, and stays that way: all eight production call sites are
   * inside strategy `configure` methods that treat this as a fast local
   * bookkeeping step. Any catalogue fetch it triggers happens out of band —
   * see {@link refreshTiersFromLiveCatalog}.
   *
   * @param options.apiKey the provider key, when the caller already holds it.
   *   Only the out-of-band refresh uses it, and only for providers whose
   *   catalogue lives behind an authenticated `modelsEndpoint`.
   */
  switchActiveProvider(
    providerId: string,
    options: { apiKey?: string | null } = {},
  ): void {
    this.clearAllTierEnvVars();
    this.applyPersistedTiers(providerId, options);

    this.logger.info(
      `[ProviderModelsService] Switched active provider tiers to ${providerId}`,
    );
  }

  /**
   * Resolve the active provider ID based on the current auth method.
   *
   * Single source of truth for auth-method â†’ provider-ID mapping.
   * Used by config:models-list (tier overrides) and anywhere else
   * that needs to know which provider's tier config is active.
   *
   * Mapping:
   *  - apiKey / claudeCli     â†’ ANTHROPIC_DIRECT_PROVIDER_ID (Anthropic native)
   *  - thirdParty             â†’ saved anthropicProviderId (OpenRouter, Moonshot, etc.)
   */
  resolveActiveProviderId(): string {
    return this.activeProviderResolver.resolveActiveAuth().providerId;
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
    await new Promise((resolve) => setTimeout(resolve, 3000));
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
      const fullId = model.id.toLowerCase();
      pricingEntries[fullId] = pricing;
      if (fullId.includes('/')) {
        const stripped = fullId.split('/').slice(1).join('/');
        pricingEntries[stripped] = pricing;
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
   * Get persisted tier value from config for a specific scope.
   *
   * Read order:
   * 1. Scoped key: `provider.<id>.<scope>.modelTier.<tier>`
   * 2. (mainAgent only) Legacy key: `provider.<id>.modelTier.<tier>`
   *    â€” transparent fallback for existing user config written before this
   *    scope field was introduced. No migration writes are performed.
   *
   * The legacy fallback is intentionally limited to `mainAgent` scope so
   * that CLI sub-agents do not accidentally inherit main-agent tier
   * overrides that were written before the scope split.
   */
  private getPersistedTierValue(
    providerId: string,
    tier: ProviderModelTier,
    scope: ProviderTierScope,
  ): string | null {
    const scopedKey = this.getTierConfigKey(providerId, tier, scope);
    const scopedValue = this.config.get<string>(scopedKey);
    if (scopedValue) return scopedValue;
    if (scope === 'mainAgent') {
      const legacyKey = this.getLegacyTierConfigKey(providerId, tier);
      const legacyValue = this.config.get<string>(legacyKey);
      if (legacyValue) return legacyValue;
    }

    return null;
  }
}
