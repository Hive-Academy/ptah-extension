/**
 * API Key Strategy - TASK_AUTH_REFACTOR Phase 2
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
} from '../../helpers/anthropic-provider-registry';

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
  ) {}

  async configure(context: AuthConfigureContext): Promise<AuthConfigureResult> {
    const { providerId, authEnv, envSnapshot } = context;

    // Direct Anthropic API key flow (providerId is 'anthropic' or legacy 'apiKey' path)
    if (
      providerId === ANTHROPIC_DIRECT_PROVIDER_ID ||
      providerId === 'apiKey'
    ) {
      return this.configureDirectApiKey(authEnv, envSnapshot);
    }

    // Third-party Anthropic-compatible provider (OpenRouter, Moonshot, Z.AI)
    return this.configureProviderApiKey(providerId, authEnv);
  }

  async teardown(): Promise<void> {
    // API key strategy has no resources to tear down (no proxies, no caches)
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
  ): Promise<AuthConfigureResult> {
    const provider = getAnthropicProvider(providerId);
    const providerKey = await this.authSecrets.getProviderKey(providerId);

    if (!providerKey?.trim()) {
      this.logger.debug(
        `[${this.name}] No provider key found in SecretStorage for ${providerId}`,
      );
      return { configured: false, details: [] };
    }

    const providerName = provider?.name ?? providerId;
    const baseUrl = getProviderBaseUrl(providerId);
    const authEnvVar = getProviderAuthEnvVar(providerId);
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

  private applyDirectProviderTiers(): void {
    try {
      this.providerModels.applyPersistedTiers(ANTHROPIC_DIRECT_PROVIDER_ID);
    } catch (e) {
      this.logger.warn(
        `[${this.name}] Failed to apply tier mappings for direct auth`,
        e instanceof Error ? e : new Error(String(e)),
      );
    }
  }
}
