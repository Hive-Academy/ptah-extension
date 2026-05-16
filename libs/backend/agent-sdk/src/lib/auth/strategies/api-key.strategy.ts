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
import { SDK_TOKENS } from '../../di/tokens';
import type { ProviderModelsService } from '../../provider-models.service';
import {
  getAnthropicProvider,
  getProviderBaseUrl,
  getProviderAuthEnvVar,
  seedStaticModelPricing,
  ANTHROPIC_DIRECT_PROVIDER_ID,
} from '../../providers/_shared/provider-registry';
import type { ITranslationProxy } from '../../providers/_shared/translation';
import { OPENROUTER_PROXY_TOKEN_PLACEHOLDER } from '../../providers/openrouter';

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
    @inject(SDK_TOKENS.SDK_PROVIDER_MODELS)
    private readonly providerModels: ProviderModelsService,
    @inject(SDK_TOKENS.SDK_AUTH_ENV) private readonly authEnv: AuthEnv,
    @inject(SDK_TOKENS.SDK_OPENROUTER_PROXY)
    private readonly openRouterProxy: ITranslationProxy,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
  ) {}

  async configure(context: AuthConfigureContext): Promise<AuthConfigureResult> {
    const { providerId, authEnv, envSnapshot } = context;

    // Direct Anthropic API key flow (providerId is 'anthropic' or legacy 'apiKey' path)
    if (
      providerId === ANTHROPIC_DIRECT_PROVIDER_ID ||
      providerId === 'apiKey'
    ) {
      // Stop the OpenRouter proxy if switching away from OpenRouter
      await this.stopOpenRouterProxyIfRunning();
      return this.configureDirectApiKey(authEnv, envSnapshot);
    }

    // OpenRouter uses a local translation proxy to support ALL providers
    // (Anthropic, OpenAI, Google, Meta, etc.), not just Anthropic-family.
    if (providerId === OPENROUTER_PROVIDER_ID) {
      return this.configureOpenRouterProxy(providerId, authEnv);
    }

    // Third-party Anthropic-compatible providers that speak Anthropic protocol
    // natively (Moonshot, Z.AI) — direct passthrough, no proxy.
    await this.stopOpenRouterProxyIfRunning();
    return this.configureProviderApiKey(providerId, authEnv, envSnapshot);
  }

  async teardown(): Promise<void> {
    // Stop the OpenRouter translation proxy if it was started by this strategy
    await this.stopOpenRouterProxyIfRunning();
  }

  /**
   * Stop the OpenRouter proxy if running.
   * Called when switching away from OpenRouter or on teardown.
   */
  private async stopOpenRouterProxyIfRunning(): Promise<void> {
    if (!this.openRouterProxy.isRunning()) {
      return;
    }
    this.logger.info(
      `[${this.name}] Stopping OpenRouter proxy (switching to different provider)`,
    );
    try {
      await this.openRouterProxy.stop();
    } catch (error) {
      this.sentryService.captureException(
        error instanceof Error ? error : new Error(String(error)),
        { errorSource: 'ApiKeyStrategy.stopOpenRouterProxyIfRunning' },
      );
      this.logger.warn(
        `[${this.name}] Failed to stop OpenRouter proxy: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Configure OpenRouter via the local translation proxy.
   *
   * Reads the OpenRouter API key from SecretStorage, starts the local HTTP
   * proxy (if not already running), and points the SDK at 127.0.0.1:<port>
   * instead of openrouter.ai. The proxy handles Anthropic↔OpenAI translation
   * so every OpenRouter model (not just Anthropic-family) works with the SDK.
   */
  private async configureOpenRouterProxy(
    providerId: string,
    authEnv: AuthEnv,
  ): Promise<AuthConfigureResult> {
    // Step 1: Verify API key is configured
    const providerKey = await this.authSecrets.getProviderKey(providerId);
    if (!providerKey?.trim()) {
      this.logger.debug(
        `[${this.name}] No OpenRouter API key found in SecretStorage`,
      );
      return { configured: false, details: [] };
    }

    const provider = getAnthropicProvider(providerId);
    const providerName = provider?.name ?? providerId;
    const keyLength = providerKey.length;
    const hasExpectedPrefix = provider?.keyPrefix
      ? providerKey.startsWith(provider.keyPrefix)
      : true;

    this.logger.info(
      `[${this.name}] Found OpenRouter API key (length: ${keyLength}, valid format: ${hasExpectedPrefix})`,
    );

    if (!hasExpectedPrefix && provider?.keyPrefix) {
      this.logger.warn(
        `[${this.name}] WARNING: OpenRouter key does not start with "${provider.keyPrefix}". ` +
          `Get valid keys from: ${provider.helpUrl}`,
      );
    }

    // Step 2: Start the translation proxy
    let proxyUrl: string;
    try {
      if (this.openRouterProxy.isRunning()) {
        proxyUrl = this.openRouterProxy.getUrl() ?? '';
        if (!proxyUrl) {
          this.logger.error(
            `[${this.name}] OpenRouter proxy reports running but returned no URL`,
          );
          return {
            configured: false,
            details: [],
            errorMessage:
              'OpenRouter translation proxy URL unavailable. Try restarting.',
          };
        }
        this.logger.info(
          `[${this.name}] OpenRouter translation proxy already running at ${proxyUrl}`,
        );
      } else {
        const result = await this.openRouterProxy.start();
        proxyUrl = result.url;
        this.logger.info(
          `[${this.name}] OpenRouter translation proxy started at ${proxyUrl}`,
        );
      }
    } catch (error) {
      this.sentryService.captureException(
        error instanceof Error ? error : new Error(String(error)),
        {
          errorSource: 'ApiKeyStrategy.configureOpenRouterProxy',
          activeProvider: providerId,
        },
      );
      this.logger.error(
        `[${this.name}] Failed to start OpenRouter translation proxy: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        configured: false,
        details: [],
        errorMessage:
          'Failed to start OpenRouter translation proxy. Check if a local port is available.',
      };
    }

    // Step 3: Point SDK at the local proxy instead of openrouter.ai.
    // The proxy handles auth itself via OpenRouterAuthService, so the SDK only
    // needs a placeholder token. ANTHROPIC_API_KEY is left unset.
    authEnv.ANTHROPIC_BASE_URL = proxyUrl;
    authEnv.ANTHROPIC_AUTH_TOKEN = OPENROUTER_PROXY_TOKEN_PLACEHOLDER;
    authEnv.ANTHROPIC_API_KEY = '';
    process.env['ANTHROPIC_BASE_URL'] = proxyUrl;
    process.env['ANTHROPIC_AUTH_TOKEN'] = OPENROUTER_PROXY_TOKEN_PLACEHOLDER;
    delete process.env['ANTHROPIC_API_KEY'];

    // Step 4: Apply tier mappings and seed pricing for the provider
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
    // Read from snapshot captured before AuthManager's clean slate wipe
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

      // Restore the key from env (it was cleared in clean slate)
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
    return { configured: false, details: [] };
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
      // Env-var fallback: mirror the direct-Anthropic path. Headless flows like
      // the openclaw bridge pre-set ANTHROPIC_AUTH_TOKEN (+ ANTHROPIC_BASE_URL)
      // instead of populating SecretStorage. The clean-slate wipe in
      // AuthManager removed these from process.env, so we read them from the
      // pre-wipe snapshot.
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

        // Apply persisted tier mappings + seed pricing same as the SecretStorage path.
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
      return { configured: false, details: [] };
    }

    const keyLength = providerKey.length;

    // Validate key format if provider has expected prefix
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

    // Set provider-specific env vars
    authEnv.ANTHROPIC_BASE_URL = baseUrl;
    authEnv[authEnvVar as keyof AuthEnv] = providerKey.trim();
    process.env['ANTHROPIC_BASE_URL'] = baseUrl;
    process.env[authEnvVar] = providerKey.trim();

    // Apply persisted tier mappings for this provider
    this.providerModels.switchActiveProvider(providerId);

    // Seed pricing map with static model pricing
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
    // Direct Anthropic (API key or CLI auth): no tier overrides.
    // ANTHROPIC_DEFAULT_*_MODEL env vars are meant for third-party providers
    // (OpenRouter/Moonshot/Z.AI) that need to remap tier → provider model ID.
    // For api.anthropic.com, model IDs are valid as-is and the CLI/SDK handles
    // its own default resolution — setting these env vars pins resolution to
    // stale values and breaks the native tier behavior.
    this.providerModels.clearAllTierEnvVars();
  }
}
