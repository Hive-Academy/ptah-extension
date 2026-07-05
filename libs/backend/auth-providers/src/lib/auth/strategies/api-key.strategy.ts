/**
 * API Key Strategy
 *
 * Handles authentication via direct API key for:
 * - Anthropic direct (ANTHROPIC_API_KEY from SecretStorage or env)
 * - Anthropic-compatible providers (OpenRouter, Moonshot, Z.AI) using per-provider keys
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
import type { AuthEnv } from '@ptah-extension/shared';
import type {
  IAuthStrategy,
  AuthConfigureResult,
  AuthConfigureContext,
} from '../auth-strategy.types';
import { AUTH_PROVIDERS_TOKENS } from '../../di/tokens';
import type { ProviderModelsService } from '../../provider-models.service';
import {
  getAnthropicProvider,
  getProviderBaseUrl,
  getProviderAuthEnvVar,
  seedStaticModelPricing,
  ANTHROPIC_DIRECT_PROVIDER_ID,
} from '@ptah-extension/shared';
import type { ITranslationProxy } from '../../translation';
import { OPENROUTER_PROXY_TOKEN_PLACEHOLDER } from '../../providers/openrouter';
import { SAKANA_PROXY_TOKEN_PLACEHOLDER } from '../../providers/sakana';

/** Provider ID for OpenRouter — matches ANTHROPIC_PROVIDERS registry entry */
const OPENROUTER_PROVIDER_ID = 'openrouter';

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
   * Translation proxy + placeholder token for each apiKey provider that
   * requires a local proxy (`requiresProxy: true`). OpenRouter and Sakana share
   * one generalized configure/stop code path keyed off this map.
   */
  private get proxyProviders(): ReadonlyArray<{
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
    // Any apiKey provider that requires a local translation proxy (OpenRouter,
    // Sakana) shares the generalized proxy configure path, keyed off the
    // registry `requiresProxy` flag rather than a hardcoded provider id.
    if (getAnthropicProvider(providerId)?.requiresProxy === true) {
      const config = this.proxyProviders.find(
        (p) => p.providerId === providerId,
      );
      if (config) {
        // Stop any OTHER apiKey proxy that may be running before starting ours.
        await this.stopProxyIfRunning(providerId);
        return this.configureProxyProvider(
          providerId,
          authEnv,
          config.proxy,
          config.placeholder,
        );
      }
    }
    await this.stopProxyIfRunning(providerId);
    return this.configureProviderApiKey(providerId, authEnv, envSnapshot);
  }

  async teardown(): Promise<void> {
    await this.stopProxyIfRunning();
  }

  /**
   * Stop any apiKey-proxy that is currently running, except the one for
   * `keepProviderId` (the provider being configured). Called when switching
   * away from a proxy provider or on teardown. Mirrors
   * `LocalProxyStrategy.stopProxyIfRunning` but iterates the full apiKey-proxy
   * set so OpenRouter and Sakana are mutually torn down.
   */
  private async stopProxyIfRunning(keepProviderId?: string): Promise<void> {
    for (const { providerId, proxy } of this.proxyProviders) {
      if (providerId === keepProviderId) {
        continue;
      }
      if (!proxy.isRunning()) {
        continue;
      }
      const provider = getAnthropicProvider(providerId);
      const providerName = provider?.name ?? providerId;
      this.logger.info(
        `[${this.name}] Stopping ${providerName} proxy (switching to different provider)`,
      );
      try {
        await proxy.stop();
      } catch (error) {
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'ApiKeyStrategy.stopProxyIfRunning' },
        );
        this.logger.warn(
          `[${this.name}] Failed to stop ${providerName} proxy: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
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
    const override = this.config.get<string>(`provider.${providerId}.baseUrl`);
    if (typeof override === 'string' && override.trim().length > 0) {
      const trimmed = override.trim();
      this.logger.info(
        `[${this.name}] Using user-supplied base URL override for ${providerId}: ${trimmed}`,
      );
      return trimmed;
    }
    return getProviderBaseUrl(providerId);
  }

  private applyDirectProviderTiers(): void {
    this.providerModels.clearAllTierEnvVars();
  }
}
