/**
 * Authentication Manager - Handles SDK authentication configuration
 *
 * Responsibilities:
 * - Anthropic-compatible provider (OpenRouter, Moonshot, Z.AI), OAuth token and API key detection
 * - Environment variable setup
 * - Token format validation
 * - Authentication priority logic (Anthropic Provider > OAuth > API Key)
 *
 * TASK_2025_091: Added OpenRouter as highest-priority auth method
 * TASK_2025_129 Batch 3: Generalized to support multiple Anthropic-compatible providers
 */

import { injectable, inject } from 'tsyringe';
import {
  Logger,
  ConfigManager,
  TOKENS,
  IAuthSecretsService,
} from '@ptah-extension/vscode-core';
import {
  getAnthropicProvider,
  getProviderBaseUrl,
  DEFAULT_PROVIDER_ID,
} from './anthropic-provider-registry';
import { ProviderModelsService } from '../provider-models.service';
import { SDK_TOKENS } from '../di/tokens';

export interface AuthResult {
  configured: boolean;
  details: string[];
  errorMessage?: string;
}

export interface AuthConfig {
  method: 'oauth' | 'apiKey' | 'openrouter' | 'auto';
}

/**
 * Manages SDK authentication setup and validation
 */
@injectable()
export class AuthManager {
  constructor(
    @inject(TOKENS.LOGGER) private logger: Logger,
    @inject(TOKENS.CONFIG_MANAGER) private config: ConfigManager,
    @inject(TOKENS.AUTH_SECRETS_SERVICE)
    private authSecrets: IAuthSecretsService,
    @inject(SDK_TOKENS.SDK_PROVIDER_MODELS)
    private providerModels: ProviderModelsService
  ) {}

  /**
   * Configure authentication for SDK
   * Returns auth status and details for logging
   */
  async configureAuthentication(authMethod: string): Promise<AuthResult> {
    this.logger.debug(`[AuthManager] Configuring auth method: ${authMethod}`);

    let authConfigured = false;
    const authDetails: string[] = [];

    // TASK_2025_129 Batch 3: Priority 1 - Anthropic-compatible provider
    // Supports OpenRouter, Moonshot (Kimi), Z.AI (GLM), and future providers
    if (authMethod === 'openrouter' || authMethod === 'auto') {
      const providerResult = await this.configureAnthropicProvider();
      if (providerResult.configured) {
        authConfigured = true;
        authDetails.push(...providerResult.details);
        // Skip OAuth and API key when provider is configured
        this.logger.info(
          `[AuthManager] Authentication configured: ${authDetails.join(', ')}`
        );
        return { configured: true, details: authDetails };
      }
    }

    // Priority 2: OAuth token (from Claude Max/Pro subscription)
    // NOTE: As of SDK v0.1.8+, CLAUDE_CODE_OAUTH_TOKEN is supported and will use your subscription
    // Get token via: claude setup-token
    if (authMethod === 'oauth' || authMethod === 'auto') {
      const oauthResult = await this.configureOAuthToken();
      if (oauthResult.configured) {
        authConfigured = true;
        authDetails.push(...oauthResult.details);
      }
    }

    // Priority 3: API key (pay-per-token billing, separate from subscription)
    // NOTE: API key takes precedence over OAuth token if both are set
    // In 'auto' mode with OAuth token, we skip API key to use subscription
    const hasOAuthToken = authDetails.some((d) => d.includes('OAuth token'));

    if ((authMethod === 'apiKey' || authMethod === 'auto') && !hasOAuthToken) {
      const apiKeyResult = await this.configureAPIKey();
      if (apiKeyResult.configured) {
        authConfigured = true;
        authDetails.push(...apiKeyResult.details);
      }
    } else if (hasOAuthToken && authMethod === 'auto') {
      this.logger.info(
        '[AuthManager] Skipping API key check - using OAuth token from subscription'
      );
    }

    // Validate at least one auth method is available
    if (!authConfigured) {
      const errorMsg =
        'No authentication configured. Set either: (1) Anthropic-compatible provider key (OpenRouter, Moonshot, Z.AI), (2) OAuth token from "claude setup-token" for Claude Max/Pro subscription, OR (3) API key from console.anthropic.com for pay-per-token billing.';
      this.logger.error(`[AuthManager] ${errorMsg}`);
      this.logger.error(
        '[AuthManager] Option 1 (Provider): Configure in Settings > Authentication > Provider tab'
      );
      this.logger.error(
        '[AuthManager] Option 2 (Subscription): Run "claude setup-token" and paste the token'
      );
      this.logger.error(
        '[AuthManager] Option 3 (API Key): Get from https://console.anthropic.com/settings/keys'
      );
      return {
        configured: false,
        details: [],
        errorMessage: errorMsg,
      };
    }

    // Log summary
    this.logger.info(
      `[AuthManager] Authentication configured: ${authDetails.join(', ')}`
    );

    return {
      configured: true,
      details: authDetails,
    };
  }

  /**
   * Configure OAuth token authentication
   * Reads from SecretStorage (primary) or environment (fallback)
   */
  private async configureOAuthToken(): Promise<AuthResult> {
    const oauthToken = await this.authSecrets.getCredential('oauthToken');
    const envOAuthToken = process.env['CLAUDE_CODE_OAUTH_TOKEN'];
    const details: string[] = [];

    if (oauthToken?.trim()) {
      const tokenPrefix = oauthToken.substring(0, 15);
      const tokenLength = oauthToken.length;
      const isOAuthFormat = oauthToken.startsWith('sk-ant-oat01-');

      this.logger.info(
        `[AuthManager] Found OAuth token in SecretStorage (length: ${tokenLength}, prefix: ${tokenPrefix}..., OAuth format: ${isOAuthFormat})`
      );

      if (!isOAuthFormat) {
        this.logger.warn(
          '[AuthManager] WARNING: OAuth token does not start with "sk-ant-oat01-". Get token via: claude setup-token'
        );
      }

      // CRITICAL: When using OAuth token, we must REMOVE provider and API key env vars
      // The SDK prioritizes API key over OAuth token, so we need to clear it
      // Also clear provider routing to prevent stale ANTHROPIC_BASE_URL from a previous provider session
      delete process.env['ANTHROPIC_API_KEY'];
      delete process.env['ANTHROPIC_BASE_URL'];
      delete process.env['ANTHROPIC_AUTH_TOKEN'];

      // Clear stale tier env vars from previous provider session (TASK_2025_132)
      this.providerModels.clearAllTierEnvVars();

      // Set the OAuth token
      process.env['CLAUDE_CODE_OAUTH_TOKEN'] = oauthToken.trim();

      this.logger.info(
        '[AuthManager] Using OAuth token from Claude Max/Pro subscription'
      );
      this.logger.info(
        '[AuthManager] Removed ANTHROPIC_API_KEY to prioritize subscription auth'
      );

      details.push(
        `OAuth token from SecretStorage (subscription mode${
          !isOAuthFormat ? ', format may be invalid' : ''
        })`
      );
      return { configured: true, details };
    } else if (envOAuthToken) {
      const tokenLength = envOAuthToken.length;
      const isOAuthFormat = envOAuthToken.startsWith('sk-ant-oat01-');

      this.logger.info(
        `[AuthManager] Found OAuth token in environment (length: ${tokenLength}, OAuth format: ${isOAuthFormat})`
      );

      // Remove API key and provider routing to prioritize OAuth token
      delete process.env['ANTHROPIC_API_KEY'];
      delete process.env['ANTHROPIC_BASE_URL'];
      delete process.env['ANTHROPIC_AUTH_TOKEN'];

      // Clear stale tier env vars from previous provider session (TASK_2025_132)
      this.providerModels.clearAllTierEnvVars();

      this.logger.info(
        '[AuthManager] Using OAuth token from environment (subscription mode)'
      );
      this.logger.info(
        '[AuthManager] Removed ANTHROPIC_API_KEY to prioritize subscription auth'
      );

      details.push(
        `OAuth token from environment (subscription mode${
          !isOAuthFormat ? ', format may be invalid' : ''
        })`
      );
      return { configured: true, details };
    } else {
      this.logger.debug(
        '[AuthManager] No OAuth token found in SecretStorage or environment'
      );
      return { configured: false, details: [] };
    }
  }

  /**
   * Configure Anthropic-compatible provider authentication (TASK_2025_129 Batch 3)
   *
   * Supports multiple providers that implement the Anthropic API protocol:
   * - OpenRouter: Multi-model access (200+ models)
   * - Moonshot (Kimi): Anthropic-compatible endpoint
   * - Z.AI (GLM): Anthropic-compatible endpoint
   *
   * Environment variables set:
   * - ANTHROPIC_BASE_URL: Provider's API endpoint (from registry)
   * - ANTHROPIC_AUTH_TOKEN: Provider's API key
   * - ANTHROPIC_API_KEY: Empty (must be cleared to prevent conflicts)
   *
   * @see https://openrouter.ai/docs/guides/claude-code-integration
   * @see https://platform.moonshot.ai/docs/guide/agent-support.en-US
   * @see https://docs.z.ai/devpack/tool/claude
   */
  private async configureAnthropicProvider(): Promise<AuthResult> {
    // Read selected provider from config (default: openrouter for backward compat)
    const providerId = this.config.getWithDefault<string>(
      'anthropicProviderId',
      DEFAULT_PROVIDER_ID
    );

    // Per-provider key lookup: each provider has its own isolated storage slot
    const providerKey = await this.authSecrets.getProviderKey(providerId);
    const details: string[] = [];

    if (providerKey?.trim()) {
      const provider = getAnthropicProvider(providerId);
      const providerName = provider?.name ?? providerId;
      const baseUrl = getProviderBaseUrl(providerId);

      const keyLength = providerKey.length;
      const keyPrefix = providerKey.substring(0, 10);

      // Validate key format if provider has expected prefix
      const hasExpectedPrefix = provider?.keyPrefix
        ? providerKey.startsWith(provider.keyPrefix)
        : true;

      this.logger.info(
        `[AuthManager] Found provider key in SecretStorage (provider: ${providerName}, length: ${keyLength}, prefix: ${keyPrefix}..., valid format: ${hasExpectedPrefix})`
      );

      if (!hasExpectedPrefix && provider?.keyPrefix) {
        this.logger.warn(
          `[AuthManager] WARNING: Key does not start with "${provider.keyPrefix}". Expected format for ${providerName}.`
        );
        this.logger.warn(
          `[AuthManager] Get valid keys from: ${provider.helpUrl}`
        );
      }

      // Configure environment for Anthropic-compatible provider
      process.env['ANTHROPIC_BASE_URL'] = baseUrl;
      process.env['ANTHROPIC_AUTH_TOKEN'] = providerKey.trim();

      // MUST clear API key and OAuth token to prevent conflicts
      process.env['ANTHROPIC_API_KEY'] = '';
      delete process.env['CLAUDE_CODE_OAUTH_TOKEN'];

      // Apply persisted tier mappings for this provider (TASK_2025_132)
      this.providerModels.switchActiveProvider(providerId);

      this.logger.info(
        `[AuthManager] Using ${providerName} (routing via ${baseUrl})`
      );
      this.logger.info(`[AuthManager] Set ANTHROPIC_BASE_URL=${baseUrl}`);
      this.logger.info(
        '[AuthManager] Cleared ANTHROPIC_API_KEY and CLAUDE_CODE_OAUTH_TOKEN'
      );

      details.push(
        `${providerName} API key (routing via ${baseUrl}${
          !hasExpectedPrefix && provider?.keyPrefix
            ? ', format may be invalid'
            : ''
        })`
      );
      return { configured: true, details };
    } else {
      this.logger.debug('[AuthManager] No provider key found in SecretStorage');
      return { configured: false, details: [] };
    }
  }

  /**
   * Configure API key authentication
   * Reads from SecretStorage (primary) or environment (fallback)
   */
  private async configureAPIKey(): Promise<AuthResult> {
    const apiKey = await this.authSecrets.getCredential('apiKey');
    const envApiKey = process.env['ANTHROPIC_API_KEY'];
    const details: string[] = [];

    if (apiKey?.trim()) {
      const keyPrefix = apiKey.substring(0, 10);
      const keyLength = apiKey.length;
      const isValidFormat = apiKey.startsWith('sk-ant-api');

      this.logger.info(
        `[AuthManager] Found API key in SecretStorage (length: ${keyLength}, prefix: ${keyPrefix}..., valid format: ${isValidFormat})`
      );

      if (!isValidFormat) {
        this.logger.warn(
          '[AuthManager] WARNING: API key does not start with "sk-ant-api". Expected format: sk-ant-api03-...'
        );
        this.logger.warn(
          '[AuthManager] Get valid API keys from: https://console.anthropic.com/settings/keys'
        );
      }

      // Clear provider routing to prevent stale ANTHROPIC_BASE_URL from a previous provider session
      delete process.env['ANTHROPIC_BASE_URL'];
      delete process.env['ANTHROPIC_AUTH_TOKEN'];

      // Clear stale tier env vars from previous provider session (TASK_2025_132)
      this.providerModels.clearAllTierEnvVars();

      process.env['ANTHROPIC_API_KEY'] = apiKey.trim();
      details.push(
        `API key from SecretStorage (pay-per-token, format ${
          isValidFormat ? 'valid' : 'INVALID'
        })`
      );
      return { configured: true, details };
    } else if (envApiKey) {
      const keyLength = envApiKey.length;
      const isValidFormat = envApiKey.startsWith('sk-ant-api');

      this.logger.info(
        `[AuthManager] Found API key in environment (length: ${keyLength}, valid format: ${isValidFormat})`
      );

      if (!isValidFormat) {
        this.logger.warn(
          '[AuthManager] WARNING: Environment API key format may be invalid'
        );
      }

      details.push(
        `API key from environment (pay-per-token, format ${
          isValidFormat ? 'valid' : 'INVALID'
        })`
      );
      return { configured: true, details };
    } else {
      this.logger.debug(
        '[AuthManager] No API key found in SecretStorage or environment'
      );
      return { configured: false, details: [] };
    }
  }

  /**
   * Clear all authentication environment variables
   */
  clearAuthentication(): void {
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['CLAUDE_CODE_OAUTH_TOKEN'];
    // TASK_2025_091: Clear OpenRouter environment variables
    delete process.env['ANTHROPIC_BASE_URL'];
    delete process.env['ANTHROPIC_AUTH_TOKEN'];
    this.logger.debug(
      '[AuthManager] Cleared authentication environment variables'
    );
  }
}
