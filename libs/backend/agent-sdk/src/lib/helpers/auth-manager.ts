/**
 * Authentication Manager - Handles SDK authentication configuration
 *
 * Responsibilities:
 * - OpenRouter, OAuth token and API key detection
 * - Environment variable setup
 * - Token format validation
 * - Authentication priority logic (OpenRouter > OAuth > API Key)
 *
 * TASK_2025_091: Added OpenRouter as highest-priority auth method
 */

import { injectable, inject } from 'tsyringe';
import {
  Logger,
  ConfigManager,
  TOKENS,
  IAuthSecretsService,
} from '@ptah-extension/vscode-core';

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
    private authSecrets: IAuthSecretsService
  ) {}

  /**
   * Configure authentication for SDK
   * Returns auth status and details for logging
   */
  async configureAuthentication(authMethod: string): Promise<AuthResult> {
    this.logger.debug(`[AuthManager] Configuring auth method: ${authMethod}`);

    let authConfigured = false;
    const authDetails: string[] = [];

    // TASK_2025_091: Priority 1 - OpenRouter (takes precedence over all other auth)
    // OpenRouter provides access to 200+ models via unified API
    if (authMethod === 'openrouter' || authMethod === 'auto') {
      const openRouterResult = await this.configureOpenRouter();
      if (openRouterResult.configured) {
        authConfigured = true;
        authDetails.push(...openRouterResult.details);
        // Skip OAuth and API key when OpenRouter is configured
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
        'No authentication configured. Set either: (1) OpenRouter API key for multi-model access, (2) OAuth token from "claude setup-token" for Claude Max/Pro subscription, OR (3) API key from console.anthropic.com for pay-per-token billing.';
      this.logger.error(`[AuthManager] ${errorMsg}`);
      this.logger.error(
        '[AuthManager] Option 1 (OpenRouter): Get from https://openrouter.ai/keys'
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

      // CRITICAL: When using OAuth token, we must REMOVE ANTHROPIC_API_KEY
      // The SDK prioritizes API key over OAuth token, so we need to clear it
      // This forces the SDK to use subscription authentication
      delete process.env['ANTHROPIC_API_KEY'];

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

      // Remove API key to prioritize OAuth token
      delete process.env['ANTHROPIC_API_KEY'];

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
   * Configure OpenRouter authentication (TASK_2025_091)
   *
   * OpenRouter provides an "Anthropic Skin" that allows Claude SDK to
   * communicate directly with OpenRouter using its native protocol.
   *
   * Environment variables set:
   * - ANTHROPIC_BASE_URL: https://openrouter.ai/api
   * - ANTHROPIC_AUTH_TOKEN: OpenRouter API key
   * - ANTHROPIC_API_KEY: Empty (must be cleared to prevent conflicts)
   *
   * @see https://openrouter.ai/docs/guides/claude-code-integration
   */
  private async configureOpenRouter(): Promise<AuthResult> {
    const openRouterKey = await this.authSecrets.getCredential('openrouterKey');
    const details: string[] = [];

    if (openRouterKey?.trim()) {
      const keyPrefix = openRouterKey.substring(0, 10);
      const keyLength = openRouterKey.length;
      const isValidFormat = openRouterKey.startsWith('sk-or-');

      this.logger.info(
        `[AuthManager] Found OpenRouter key in SecretStorage (length: ${keyLength}, prefix: ${keyPrefix}..., valid format: ${isValidFormat})`
      );

      if (!isValidFormat) {
        this.logger.warn(
          '[AuthManager] WARNING: OpenRouter key does not start with "sk-or-". Expected format: sk-or-v1-...'
        );
        this.logger.warn(
          '[AuthManager] Get valid OpenRouter keys from: https://openrouter.ai/keys'
        );
      }

      // CRITICAL: Configure environment for OpenRouter "Anthropic Skin"
      // This allows Claude SDK to route through OpenRouter
      process.env['ANTHROPIC_BASE_URL'] = 'https://openrouter.ai/api';
      process.env['ANTHROPIC_AUTH_TOKEN'] = openRouterKey.trim();

      // MUST clear API key and OAuth token to prevent conflicts
      process.env['ANTHROPIC_API_KEY'] = '';
      delete process.env['CLAUDE_CODE_OAUTH_TOKEN'];

      this.logger.info(
        '[AuthManager] Using OpenRouter API key (routing via openrouter.ai)'
      );
      this.logger.info(
        '[AuthManager] Set ANTHROPIC_BASE_URL=https://openrouter.ai/api'
      );
      this.logger.info(
        '[AuthManager] Cleared ANTHROPIC_API_KEY and CLAUDE_CODE_OAUTH_TOKEN to use OpenRouter'
      );

      details.push(
        `OpenRouter API key (routing via openrouter.ai${
          !isValidFormat ? ', format may be invalid' : ''
        })`
      );
      return { configured: true, details };
    } else {
      this.logger.debug(
        '[AuthManager] No OpenRouter key found in SecretStorage'
      );
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
