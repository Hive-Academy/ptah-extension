/**
 * API Key Strategy
 *
 * Handles authentication via direct API key for:
 * - Anthropic direct (ANTHROPIC_API_KEY from SecretStorage or env)
 * - Anthropic-compatible providers (OpenRouter, Moonshot, Z.AI) using per-provider keys
 * - User-defined provider entries from `provider.custom.entries`
 *
 * Custom entries take one of two existing paths, chosen by the registry's
 * `requiresProxy` flag (itself derived from the entry's `lane`):
 * - `lane: 'anthropic'` -> `requiresProxy: false` -> the direct-passthrough
 *   path, identical to Moonshot/Z.AI (base URL + per-provider auth token).
 * - `lane: 'openai'` -> `requiresProxy: true` -> a `CustomOpenAiTranslationProxy`
 *   built for that id on demand, alongside the built-in OpenRouter/Sakana
 *   proxy singletons.
 *
 * Extracted from AuthManager.configureAPIKey() and the API-key path
 * of configureAnthropicProvider().
 */

import { injectable, inject } from 'tsyringe';
import {
  Logger,
  ConfigManager,
  TOKENS,
  type IAuthSecretsService,
} from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import type { AuthEnv, AnthropicProvider } from '@ptah-extension/shared';
import type {
  IAuthStrategy,
  AuthConfigureResult,
  AuthConfigureContext,
} from '../auth-strategy.types';
import { AUTH_PROVIDERS_TOKENS } from '../../di/tokens';
import type { ProviderModelsService } from '../../provider-models.service';
import {
  isCustomProviderId,
  getAnthropicProvider,
  getProviderBaseUrl,
  getProviderAuthEnvVar,
  seedStaticModelPricing,
  ANTHROPIC_DIRECT_PROVIDER_ID,
} from '@ptah-extension/shared';
import type { ITranslationProxy } from '../../translation';
import { OPENROUTER_PROXY_TOKEN_PLACEHOLDER } from '../../providers/openrouter';
import { SAKANA_PROXY_TOKEN_PLACEHOLDER } from '../../providers/sakana';
import {
  createCustomOpenAiProxy,
  CUSTOM_PROXY_TOKEN_PLACEHOLDER,
} from '../../providers/custom';

/** Provider ID for OpenRouter — matches ANTHROPIC_PROVIDERS registry entry */
const OPENROUTER_PROVIDER_ID = 'openrouter';

/**
 * Outcome of resolving a proxy instance for a `requiresProxy` provider.
 *
 * `unavailable` is distinct from "no result": it means this IS a user-defined
 * OpenAI-lane entry that we must not silently downgrade. Falling through to the
 * Anthropic passthrough path would point the SDK at an OpenAI-protocol endpoint
 * and fail on the first turn with an opaque upstream error, so we surface the
 * real reason instead.
 */
type ProxyResolution =
  | { kind: 'proxy'; proxy: ITranslationProxy; placeholder: string }
  | { kind: 'unavailable'; errorMessage: string };

/**
 * A dynamically-created custom-provider proxy, tagged with the base URL it was
 * built against so an edited entry invalidates the cached instance.
 */
interface CustomProxyEntry {
  proxy: ITranslationProxy;
  baseUrl: string;
}

@injectable()
export class ApiKeyStrategy implements IAuthStrategy {
  readonly name = 'ApiKeyStrategy';

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.CONFIG_MANAGER) private readonly config: ConfigManager,
    @inject(TOKENS.AUTH_SECRETS_SERVICE)
    private readonly authSecrets: IAuthSecretsService,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_MODELS)
    private readonly providerModels: ProviderModelsService,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_AUTH_ENV)
    private readonly authEnv: AuthEnv,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_OPENROUTER_PROXY)
    private readonly openRouterProxy: ITranslationProxy,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_SAKANA_PROXY)
    private readonly sakanaProxy: ITranslationProxy,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
  ) {}

  /**
   * Live proxies for user-defined `lane: 'openai'` entries, keyed by provider
   * id. Built on demand (the id set is not knowable at container build time)
   * and cached for the lifetime of the strategy so re-selecting the same custom
   * provider reuses its already-listening proxy instead of leaking a new one.
   */
  private readonly customProxies = new Map<string, CustomProxyEntry>();

  /**
   * Translation proxy + placeholder token for each BUILT-IN apiKey provider
   * that requires a local proxy (`requiresProxy: true`). These are DI
   * singletons; user-defined entries are resolved separately in
   * {@link resolveProxyForProvider}.
   */
  private get builtInProxyProviders(): ReadonlyArray<{
    providerId: string;
    proxy: ITranslationProxy;
    placeholder: string;
  }> {
    return [
      {
        providerId: OPENROUTER_PROVIDER_ID,
        proxy: this.openRouterProxy,
        placeholder: OPENROUTER_PROXY_TOKEN_PLACEHOLDER,
      },
      {
        providerId: 'sakana',
        proxy: this.sakanaProxy,
        placeholder: SAKANA_PROXY_TOKEN_PLACEHOLDER,
      },
    ];
  }

  async configure(context: AuthConfigureContext): Promise<AuthConfigureResult> {
    const { providerId, authEnv, envSnapshot } = context;
    if (
      providerId === ANTHROPIC_DIRECT_PROVIDER_ID ||
      providerId === 'apiKey'
    ) {
      await this.stopProxyIfRunning(providerId);
      return this.configureDirectApiKey(authEnv, envSnapshot);
    }
    // Any apiKey provider that requires a local translation proxy — built-in
    // (OpenRouter, Sakana) or user-defined (`lane: 'openai'`) — shares the
    // generalized proxy configure path, keyed off the registry `requiresProxy`
    // flag rather than a hardcoded provider id.
    if (getAnthropicProvider(providerId)?.requiresProxy === true) {
      const resolved = await this.resolveProxyForProvider(providerId);
      if (resolved?.kind === 'proxy') {
        // Stop any OTHER apiKey proxy that may be running before starting ours.
        await this.stopProxyIfRunning(providerId);
        return this.configureProxyProvider(
          providerId,
          authEnv,
          resolved.proxy,
          resolved.placeholder,
        );
      }
      if (resolved?.kind === 'unavailable') {
        await this.stopProxyIfRunning();
        return {
          configured: false,
          details: [],
          errorMessage: resolved.errorMessage,
        };
      }
    }
    await this.stopProxyIfRunning(providerId);
    return this.configureProviderApiKey(providerId, authEnv, envSnapshot);
  }

  /**
   * Resolve the proxy instance for a provider that declares
   * `requiresProxy: true`.
   *
   * Built-ins map to their DI singleton. Anything else is a user-defined
   * `lane: 'openai'` entry: build a `CustomOpenAiTranslationProxy` bound to
   * that id and cache it. A cached instance whose base URL no longer matches
   * the resolved one (the user edited the entry, or set/cleared a
   * `provider.<id>.baseUrl` override) is stopped and rebuilt — a live proxy is
   * never re-pointed underneath an in-flight request.
   *
   * Returns `undefined` when this provider is not this strategy's to proxy, in
   * which case {@link configure} falls through to the direct-passthrough path
   * exactly as before. A user-defined entry that IS ours but cannot be built
   * returns `unavailable` instead, so the failure surfaces rather than
   * degrading into a protocol mismatch.
   */
  private async resolveProxyForProvider(
    providerId: string,
  ): Promise<ProxyResolution | undefined> {
    const builtIn = this.builtInProxyProviders.find(
      (p) => p.providerId === providerId,
    );
    if (builtIn) {
      return {
        kind: 'proxy',
        proxy: builtIn.proxy,
        placeholder: builtIn.placeholder,
      };
    }

    // Only user-defined entries get a dynamically-built proxy. A BUILT-IN that
    // requires a proxy but has no singleton above is owned by a different
    // strategy (Copilot/Codex -> OAuthProxyStrategy, LM Studio ->
    // LocalProxyStrategy), so return undefined and let the caller fall through
    // exactly as it did before this path existed.
    if (!isCustomProviderId(providerId)) {
      return undefined;
    }

    const provider = getAnthropicProvider(providerId);
    if (!provider) {
      // requiresProxy was true a moment ago, so this is unreachable in
      // practice; guard rather than assert so a registry race cannot throw.
      return undefined;
    }

    const baseUrl = this.resolveCustomProviderBaseUrl(providerId, provider);
    if (!baseUrl) {
      this.logger.error(
        `[${this.name}] Custom provider ${providerId} requires a translation proxy ` +
          'but has no base URL configured.',
      );
      return {
        kind: 'unavailable',
        errorMessage: `No base URL configured for ${provider.name}. Edit the provider entry in Settings and set its base URL.`,
      };
    }

    const cached = this.customProxies.get(providerId);
    if (cached && cached.baseUrl === baseUrl) {
      return {
        kind: 'proxy',
        proxy: cached.proxy,
        placeholder: CUSTOM_PROXY_TOKEN_PLACEHOLDER,
      };
    }
    if (cached) {
      this.logger.info(
        `[${this.name}] Base URL for ${providerId} changed ` +
          `(${cached.baseUrl} -> ${baseUrl}); rebuilding its translation proxy`,
      );
      await this.stopProxy(providerId, cached.proxy);
      this.customProxies.delete(providerId);
    }

    try {
      const proxy = createCustomOpenAiProxy({
        provider,
        baseUrl,
        logger: this.logger,
        authSecrets: this.authSecrets,
      });
      this.customProxies.set(providerId, { proxy, baseUrl });
      return {
        kind: 'proxy',
        proxy,
        placeholder: CUSTOM_PROXY_TOKEN_PLACEHOLDER,
      };
    } catch (error: unknown) {
      this.sentryService.captureException(
        error instanceof Error ? error : new Error(String(error)),
        {
          errorSource: 'ApiKeyStrategy.resolveProxyForProvider',
          activeProvider: providerId,
        },
      );
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[${this.name}] Cannot build a translation proxy for ${providerId}: ${message}`,
      );
      return {
        kind: 'unavailable',
        errorMessage: `Cannot start a translation proxy for ${provider.name}: ${message}`,
      };
    }
  }

  async teardown(): Promise<void> {
    await this.stopProxyIfRunning();
  }

  /**
   * Every apiKey proxy this strategy could have started — the built-in DI
   * singletons plus any custom-provider proxies created during this session.
   *
   * Mutual exclusion is load-bearing: exactly one apiKey proxy may be
   * listening at a time, because they all compete for the single global
   * `ANTHROPIC_BASE_URL`. A dynamically-created proxy left running after a
   * provider switch would keep a stale listener alive, so the custom instances
   * must be part of this set, not just the built-ins.
   */
  private allKnownProxies(): ReadonlyArray<{
    providerId: string;
    proxy: ITranslationProxy;
  }> {
    return [
      ...this.builtInProxyProviders.map(({ providerId, proxy }) => ({
        providerId,
        proxy,
      })),
      ...[...this.customProxies.entries()].map(([providerId, entry]) => ({
        providerId,
        proxy: entry.proxy,
      })),
    ];
  }

  /**
   * Stop any apiKey-proxy that is currently running, except the one for
   * `keepProviderId` (the provider being configured). Called when switching
   * away from a proxy provider or on teardown. Mirrors
   * `LocalProxyStrategy.stopProxyIfRunning` but iterates the full apiKey-proxy
   * set so OpenRouter, Sakana and every custom-provider proxy are mutually
   * torn down.
   */
  private async stopProxyIfRunning(keepProviderId?: string): Promise<void> {
    for (const { providerId, proxy } of this.allKnownProxies()) {
      if (providerId === keepProviderId) {
        continue;
      }
      if (!proxy.isRunning()) {
        continue;
      }
      this.logger.info(
        `[${this.name}] Stopping ${this.providerDisplayName(
          providerId,
        )} proxy (switching to different provider)`,
      );
      await this.stopProxy(providerId, proxy);
    }
  }

  /**
   * Stop one proxy, best-effort. Teardown must never throw: a proxy that
   * refuses to close cleanly is reported (Sentry + warning) but does not
   * abort the provider switch that is already underway.
   */
  private async stopProxy(
    providerId: string,
    proxy: ITranslationProxy,
  ): Promise<void> {
    try {
      await proxy.stop();
    } catch (error: unknown) {
      this.sentryService.captureException(
        error instanceof Error ? error : new Error(String(error)),
        { errorSource: 'ApiKeyStrategy.stopProxyIfRunning' },
      );
      this.logger.warn(
        `[${this.name}] Failed to stop ${this.providerDisplayName(
          providerId,
        )} proxy: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Registry display name for a provider id, falling back to the id itself. */
  private providerDisplayName(providerId: string): string {
    return getAnthropicProvider(providerId)?.name ?? providerId;
  }

  /**
   * Configure an apiKey provider via its local translation proxy
   * (OpenRouter, Sakana).
   *
   * Reads the per-provider API key from SecretStorage, starts the local HTTP
   * proxy (if not already running), and points the SDK at 127.0.0.1:<port>
   * instead of the provider's remote endpoint. The proxy handles
   * Anthropic↔OpenAI translation so every model works with the SDK.
   */
  private async configureProxyProvider(
    providerId: string,
    authEnv: AuthEnv,
    proxy: ITranslationProxy,
    placeholder: string,
  ): Promise<AuthConfigureResult> {
    const provider = getAnthropicProvider(providerId);
    const providerName = provider?.name ?? providerId;

    const providerKey = await this.authSecrets.getProviderKey(providerId);
    if (!providerKey?.trim()) {
      this.logger.debug(
        `[${this.name}] No ${providerName} API key found in SecretStorage`,
      );
      return {
        configured: false,
        details: [],
        errorMessage: `No ${providerName} API key configured. Add one in Settings, or choose a different provider.`,
      };
    }

    const keyLength = providerKey.length;
    const hasExpectedPrefix = provider?.keyPrefix
      ? providerKey.startsWith(provider.keyPrefix)
      : true;

    this.logger.info(
      `[${this.name}] Found ${providerName} API key (length: ${keyLength}, valid format: ${hasExpectedPrefix})`,
    );

    if (!hasExpectedPrefix && provider?.keyPrefix) {
      this.logger.warn(
        `[${this.name}] WARNING: ${providerName} key does not start with "${provider.keyPrefix}". ` +
          `Get valid keys from: ${provider.helpUrl}`,
      );
    }
    let proxyUrl: string;
    try {
      if (proxy.isRunning()) {
        proxyUrl = proxy.getUrl() ?? '';
        if (!proxyUrl) {
          this.logger.error(
            `[${this.name}] ${providerName} proxy reports running but returned no URL`,
          );
          return {
            configured: false,
            details: [],
            errorMessage: `${providerName} translation proxy URL unavailable. Try restarting.`,
          };
        }
        this.logger.info(
          `[${this.name}] ${providerName} translation proxy already running at ${proxyUrl}`,
        );
      } else {
        const result = await proxy.start();
        proxyUrl = result.url;
        this.logger.info(
          `[${this.name}] ${providerName} translation proxy started at ${proxyUrl}`,
        );
      }
    } catch (error) {
      this.sentryService.captureException(
        error instanceof Error ? error : new Error(String(error)),
        {
          errorSource: 'ApiKeyStrategy.configureProxyProvider',
          activeProvider: providerId,
        },
      );
      this.logger.error(
        `[${this.name}] Failed to start ${providerName} translation proxy: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        configured: false,
        details: [],
        errorMessage: `Failed to start ${providerName} translation proxy. Check if a local port is available.`,
      };
    }
    authEnv.ANTHROPIC_BASE_URL = proxyUrl;
    authEnv.ANTHROPIC_AUTH_TOKEN = placeholder;
    authEnv.ANTHROPIC_API_KEY = '';
    process.env['ANTHROPIC_BASE_URL'] = proxyUrl;
    process.env['ANTHROPIC_AUTH_TOKEN'] = placeholder;
    delete process.env['ANTHROPIC_API_KEY'];
    this.providerModels.switchActiveProvider(providerId);
    seedStaticModelPricing(providerId);

    this.logger.info(
      `[${this.name}] Using ${providerName} via translation proxy (${proxyUrl})`,
    );
    this.logger.info(
      `[${this.name}] Set ANTHROPIC_BASE_URL=${proxyUrl}, ANTHROPIC_AUTH_TOKEN=<proxy-managed>`,
    );

    return {
      configured: true,
      details: [
        `${providerName} API key (routing via translation proxy at ${proxyUrl}${
          !hasExpectedPrefix && provider?.keyPrefix
            ? ', format may be invalid'
            : ''
        })`,
      ],
    };
  }

  /**
   * Configure direct Anthropic API key authentication.
   * Reads from SecretStorage (primary) or process.env snapshot (fallback).
   */
  private async configureDirectApiKey(
    authEnv: AuthEnv,
    envSnapshot?: { ANTHROPIC_API_KEY?: string },
  ): Promise<AuthConfigureResult> {
    const envApiKey = envSnapshot?.ANTHROPIC_API_KEY;

    const apiKey = await this.authSecrets.getCredential('apiKey');
    const details: string[] = [];

    if (apiKey?.trim()) {
      const keyLength = apiKey.length;
      const isValidFormat = apiKey.startsWith('sk-ant-api');

      this.logger.info(
        `[${this.name}] Found API key in SecretStorage (length: ${keyLength}, valid format: ${isValidFormat})`,
      );

      if (!isValidFormat) {
        this.logger.warn(
          `[${this.name}] WARNING: API key does not start with "sk-ant-api". Expected format: sk-ant-api03-...`,
        );
        this.logger.warn(
          `[${this.name}] Get valid API keys from: https://console.anthropic.com/settings/keys`,
        );
      }

      authEnv.ANTHROPIC_API_KEY = apiKey.trim();
      process.env['ANTHROPIC_API_KEY'] = apiKey.trim();
      details.push(
        `API key from SecretStorage (pay-per-token, format ${
          isValidFormat ? 'valid' : 'INVALID'
        })`,
      );

      this.applyDirectProviderTiers();
      return { configured: true, details };
    } else if (envApiKey) {
      const keyLength = envApiKey.length;
      const isValidFormat = envApiKey.startsWith('sk-ant-api');

      this.logger.info(
        `[${this.name}] Found API key in environment (length: ${keyLength}, valid format: ${isValidFormat})`,
      );

      if (!isValidFormat) {
        this.logger.warn(
          `[${this.name}] WARNING: Environment API key format may be invalid`,
        );
      }
      authEnv.ANTHROPIC_API_KEY = envApiKey;
      process.env['ANTHROPIC_API_KEY'] = envApiKey;

      details.push(
        `API key from environment (pay-per-token, format ${
          isValidFormat ? 'valid' : 'INVALID'
        })`,
      );

      this.applyDirectProviderTiers();
      return { configured: true, details };
    }

    this.logger.debug(
      `[${this.name}] No API key found in SecretStorage or environment`,
    );
    return {
      configured: false,
      details: [],
      errorMessage:
        'No Anthropic API key configured. Add an API key in Settings, or switch to Claude CLI.',
    };
  }

  /**
   * Configure a third-party Anthropic-compatible provider via per-provider API key.
   * Supports: OpenRouter, Moonshot (Kimi), Z.AI (GLM).
   */
  private async configureProviderApiKey(
    providerId: string,
    authEnv: AuthEnv,
    envSnapshot?: {
      ANTHROPIC_API_KEY?: string;
      ANTHROPIC_AUTH_TOKEN?: string;
      ANTHROPIC_BASE_URL?: string;
    },
  ): Promise<AuthConfigureResult> {
    const provider = getAnthropicProvider(providerId);
    const providerName = provider?.name ?? providerId;
    const baseUrl = this.resolveProviderBaseUrl(providerId);
    const authEnvVar = getProviderAuthEnvVar(providerId);

    const providerKey = await this.authSecrets.getProviderKey(providerId);

    if (!providerKey?.trim()) {
      const envProviderKey =
        envSnapshot?.[authEnvVar] ??
        envSnapshot?.ANTHROPIC_AUTH_TOKEN ??
        envSnapshot?.ANTHROPIC_API_KEY;

      if (envProviderKey?.trim()) {
        const trimmed = envProviderKey.trim();
        this.logger.info(
          `[${this.name}] Found provider key in environment (provider: ${providerName}, length: ${trimmed.length})`,
        );

        authEnv.ANTHROPIC_BASE_URL = baseUrl;
        authEnv[authEnvVar as keyof AuthEnv] = trimmed;
        process.env['ANTHROPIC_BASE_URL'] = baseUrl;
        process.env[authEnvVar] = trimmed;
        this.providerModels.switchActiveProvider(providerId);
        seedStaticModelPricing(providerId);

        this.logger.info(
          `[${this.name}] Using ${providerName} via environment fallback (routing via ${baseUrl})`,
        );

        return {
          configured: true,
          details: [`${providerName} API key (from environment)`],
        };
      }

      this.logger.debug(
        `[${this.name}] No provider key found in SecretStorage or environment for ${providerId}`,
      );
      return {
        configured: false,
        details: [],
        errorMessage: `No API key configured for ${providerName}. Add one in Settings, or choose a different provider.`,
      };
    }

    const keyLength = providerKey.length;
    const hasExpectedPrefix = provider?.keyPrefix
      ? providerKey.startsWith(provider.keyPrefix)
      : true;

    this.logger.info(
      `[${this.name}] Found provider key in SecretStorage (provider: ${providerName}, length: ${keyLength}, valid format: ${hasExpectedPrefix})`,
    );

    if (!hasExpectedPrefix && provider?.keyPrefix) {
      this.logger.warn(
        `[${this.name}] WARNING: Key does not start with "${provider.keyPrefix}". Expected format for ${providerName}.`,
      );
      this.logger.warn(
        `[${this.name}] Get valid keys from: ${provider.helpUrl}`,
      );
    }
    authEnv.ANTHROPIC_BASE_URL = baseUrl;
    authEnv[authEnvVar as keyof AuthEnv] = providerKey.trim();
    process.env['ANTHROPIC_BASE_URL'] = baseUrl;
    process.env[authEnvVar] = providerKey.trim();
    this.providerModels.switchActiveProvider(providerId);
    seedStaticModelPricing(providerId);

    this.logger.info(
      `[${this.name}] Using ${providerName} (routing via ${baseUrl})`,
    );
    this.logger.info(
      `[${this.name}] Set ANTHROPIC_BASE_URL=${baseUrl}, ${authEnvVar}=<set>`,
    );

    const details = [
      `${providerName} API key (routing via ${baseUrl}${
        !hasExpectedPrefix && provider?.keyPrefix
          ? ', format may be invalid'
          : ''
      })`,
    ];
    return { configured: true, details };
  }

  /**
   * Resolve the effective base URL for a provider.
   *
   * Returns the user-supplied override stored at
   * `provider.<id>.baseUrl` in `~/.ptah/settings.json` when present, otherwise
   * the static registry default from `getProviderBaseUrl()`. Used by both the
   * direct-passthrough flow (Moonshot, Z-AI, Ollama, etc.) and the OpenRouter
   * proxy flow (CLI parity: `provider base-url set ...` and `provider ollama
   * set-endpoint ...`).
   *
   * The override is trimmed; empty/whitespace strings fall back to the
   * registry default so users can clear an override by setting an empty value
   * (in addition to the explicit `provider base-url clear` path).
   */
  private resolveProviderBaseUrl(providerId: string): string {
    return (
      this.readBaseUrlOverride(providerId) ?? getProviderBaseUrl(providerId)
    );
  }

  /**
   * Resolve the upstream base URL for a user-defined proxy entry.
   *
   * Same precedence as {@link resolveProviderBaseUrl} — a
   * `provider.<id>.baseUrl` override wins over the entry's own `baseUrl`, so
   * `ptah provider base-url set <custom-id> <url>` re-points a custom entry
   * without editing it — but the fallback is the entry's OWN `baseUrl` rather
   * than `getProviderBaseUrl()`. That matters: `getProviderBaseUrl()` silently
   * returns the DEFAULT provider's URL (OpenRouter's) for an id it cannot
   * find, which for a custom entry would mean quietly forwarding the user's
   * key to the wrong vendor. Reading `provider.baseUrl` directly cannot
   * mis-resolve.
   */
  private resolveCustomProviderBaseUrl(
    providerId: string,
    provider: AnthropicProvider,
  ): string {
    return this.readBaseUrlOverride(providerId) ?? provider.baseUrl.trim();
  }

  /**
   * The user-supplied `provider.<id>.baseUrl` override, or `undefined` when
   * absent/blank. Empty and whitespace-only values are treated as "no
   * override" so users can clear one by blanking it, in addition to the
   * explicit `provider base-url clear` path.
   */
  private readBaseUrlOverride(providerId: string): string | undefined {
    const override = this.config.get<string>(`provider.${providerId}.baseUrl`);
    if (typeof override !== 'string' || override.trim().length === 0) {
      return undefined;
    }
    const trimmed = override.trim();
    this.logger.info(
      `[${this.name}] Using user-supplied base URL override for ${providerId}: ${trimmed}`,
    );
    return trimmed;
  }

  private applyDirectProviderTiers(): void {
    this.providerModels.clearAllTierEnvVars();
  }
}
