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
 * TASK_2025_134: Clean Slate pattern - centralized env cleanup before each auth configuration
 */

import { injectable, inject } from 'tsyringe';
import {
  Logger,
  ConfigManager,
  TOKENS,
  IAuthSecretsService,
} from '@ptah-extension/vscode-core';
import type { AuthEnv } from '@ptah-extension/shared';
import {
  getAnthropicProvider,
  getProviderBaseUrl,
  getProviderAuthEnvVar,
  seedStaticModelPricing,
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

/** All auth-related environment variable names (single source of truth) */
const AUTH_ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
] as const;

/** Snapshot of env values captured before cleanup, used for shell fallback detection */
interface EnvSnapshot {
  ANTHROPIC_API_KEY: string | undefined;
  ANTHROPIC_BASE_URL: string | undefined;
  ANTHROPIC_AUTH_TOKEN: string | undefined;
  CLAUDE_CODE_OAUTH_TOKEN: string | undefined;
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
    private providerModels: ProviderModelsService,
    @inject(SDK_TOKENS.SDK_AUTH_ENV) private authEnv: AuthEnv
  ) {}

  /**
   * Configure authentication for SDK
   * Returns auth status and details for logging
   *
   * Uses the "Clean Slate" pattern:
   * 1. Capture env snapshot (for shell fallback detection)
   * 2. Clear ALL auth + tier env vars (single source of truth)
   * 3. Run selected configure method (only sets its own vars)
   * 4. Log env summary (boolean presence, no secrets)
   */
  async configureAuthentication(rawAuthMethod: string): Promise<AuthResult> {
    // Normalize: treat unknown/legacy values (e.g. 'vscode-lm') as 'auto'
    const validMethods = new Set(['oauth', 'apiKey', 'openrouter', 'auto']);
    const authMethod = validMethods.has(rawAuthMethod) ? rawAuthMethod : 'auto';

    if (rawAuthMethod !== authMethod) {
      this.logger.warn(
        `[AuthManager] Unknown auth method '${rawAuthMethod}', falling back to 'auto'`
      );
    }

    this.logger.debug(`[AuthManager] Configuring auth method: ${authMethod}`);

    // Step 1: Capture env snapshot before cleanup (for shell fallback)
    const envSnapshot = this.captureEnvSnapshot();

    // Step 2: Clean slate - clear ALL auth and tier env vars
    this.clearAllAuthEnvVars();
    this.providerModels.clearAllTierEnvVars();

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
        this.logEnvSummary();
        return { configured: true, details: authDetails };
      }
    }

    // Priority 2: OAuth token (from Claude Max/Pro subscription)
    // NOTE: As of SDK v0.1.8+, CLAUDE_CODE_OAUTH_TOKEN is supported and will use your subscription
    // Get token via: claude setup-token
    if (authMethod === 'oauth' || authMethod === 'auto') {
      const oauthResult = await this.configureOAuthToken(envSnapshot);
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
      const apiKeyResult = await this.configureAPIKey(envSnapshot);
      if (apiKeyResult.configured) {
        authConfigured = true;
        authDetails.push(...apiKeyResult.details);
      }
    } else if (hasOAuthToken && authMethod === 'auto') {
      this.logger.info(
        '[AuthManager] Skipping API key check - using OAuth token from subscription'
      );
    }

    // No auth configured — expected on first install, not an error
    if (!authConfigured) {
      const infoMsg =
        'No authentication configured yet. Configure in Ptah Settings > Authentication tab.';
      this.logger.info(`[AuthManager] ${infoMsg}`);
      this.logger.debug(
        '[AuthManager] Option 1 (Provider): Configure in Settings > Authentication > Provider tab'
      );
      this.logger.debug(
        '[AuthManager] Option 2 (Subscription): Run "claude setup-token" and paste the token'
      );
      this.logger.debug(
        '[AuthManager] Option 3 (API Key): Get from https://console.anthropic.com/settings/keys'
      );
      this.logEnvSummary();
      return {
        configured: false,
        details: [],
        errorMessage: infoMsg,
      };
    }

    // Log summary
    this.logger.info(
      `[AuthManager] Authentication configured: ${authDetails.join(', ')}`
    );
    this.logEnvSummary();

    return {
      configured: true,
      details: authDetails,
    };
  }

  /**
   * Configure OAuth token authentication
   * Reads from SecretStorage (primary) or env snapshot (fallback)
   */
  private async configureOAuthToken(
    envSnapshot: EnvSnapshot
  ): Promise<AuthResult> {
    const oauthToken = await this.authSecrets.getCredential('oauthToken');
    const envOAuthToken = envSnapshot.CLAUDE_CODE_OAUTH_TOKEN;
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

      this.authEnv.CLAUDE_CODE_OAUTH_TOKEN = oauthToken.trim();

      this.logger.info(
        '[AuthManager] Using OAuth token from Claude Max/Pro subscription'
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

      // Restore the token from snapshot (it was cleared in clean slate)
      this.authEnv.CLAUDE_CODE_OAUTH_TOKEN = envOAuthToken;

      this.logger.info(
        '[AuthManager] Using OAuth token from environment (subscription mode)'
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
   * - OpenRouter: Multi-model access (200+ models) — ANTHROPIC_AUTH_TOKEN (Bearer)
   * - Moonshot (Kimi): Anthropic-compatible endpoint — ANTHROPIC_AUTH_TOKEN (Bearer)
   * - Z.AI (GLM): Anthropic-compatible endpoint — ANTHROPIC_AUTH_TOKEN (Bearer)
   *
   * Environment variables set:
   * - ANTHROPIC_BASE_URL: Provider's API endpoint (from registry)
   * - Provider's authEnvVar: Either ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY
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
      const authEnvVar = getProviderAuthEnvVar(providerId);

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

      // Set provider-specific env vars only
      // authEnvVar is per-provider: ANTHROPIC_AUTH_TOKEN (Bearer) or ANTHROPIC_API_KEY (X-API-Key)
      this.authEnv.ANTHROPIC_BASE_URL = baseUrl;
      this.authEnv[authEnvVar as keyof AuthEnv] = providerKey.trim();

      // Apply persisted tier mappings for this provider (TASK_2025_132)
      this.providerModels.switchActiveProvider(providerId);

      // Seed pricing map with static model pricing (fallback for models not on OpenRouter)
      seedStaticModelPricing(providerId);

      this.logger.info(
        `[AuthManager] Using ${providerName} (routing via ${baseUrl})`
      );
      this.logger.info(
        `[AuthManager] Set ANTHROPIC_BASE_URL=${baseUrl}, ${authEnvVar}=<set>`
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
   * Reads from SecretStorage (primary) or env snapshot (fallback)
   */
  private async configureAPIKey(envSnapshot: EnvSnapshot): Promise<AuthResult> {
    const apiKey = await this.authSecrets.getCredential('apiKey');
    const envApiKey = envSnapshot.ANTHROPIC_API_KEY;
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

      this.authEnv.ANTHROPIC_API_KEY = apiKey.trim();
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

      // Restore the key from snapshot (it was cleared in clean slate)
      this.authEnv.ANTHROPIC_API_KEY = envApiKey;

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
   * Delegates to centralized cleanup methods
   */
  clearAuthentication(): void {
    this.clearAllAuthEnvVars();
    this.providerModels.clearAllTierEnvVars();
    this.logger.debug(
      '[AuthManager] Cleared authentication environment variables'
    );
  }

  /**
   * Capture current env values before cleanup (for shell fallback detection)
   * When users set env vars in their shell (e.g. ANTHROPIC_API_KEY),
   * we need to detect them even after the clean slate wipe.
   */
  private captureEnvSnapshot(): EnvSnapshot {
    return {
      ANTHROPIC_API_KEY: process.env['ANTHROPIC_API_KEY'],
      ANTHROPIC_BASE_URL: process.env['ANTHROPIC_BASE_URL'],
      ANTHROPIC_AUTH_TOKEN: process.env['ANTHROPIC_AUTH_TOKEN'],
      CLAUDE_CODE_OAUTH_TOKEN: process.env['CLAUDE_CODE_OAUTH_TOKEN'],
    };
  }

  /**
   * Delete ALL auth env vars from the AuthEnv singleton - single source of truth for cleanup.
   * Called once at the top of configureAuthentication() to ensure a clean slate.
   */
  private clearAllAuthEnvVars(): void {
    for (const varName of AUTH_ENV_VARS) {
      delete this.authEnv[varName as keyof AuthEnv];
    }
  }

  /**
   * Log boolean presence of all auth + tier env vars (no secrets)
   * Useful for debugging which auth method is active after configuration.
   */
  private logEnvSummary(): void {
    const authSummary = AUTH_ENV_VARS.map(
      (v) => `${v}=${this.authEnv[v as keyof AuthEnv] ? 'set' : 'unset'}`
    ).join(', ');

    this.logger.debug(`[AuthManager] Env summary: ${authSummary}`);
  }
}
