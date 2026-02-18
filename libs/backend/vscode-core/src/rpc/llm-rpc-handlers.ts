/**
 * LLM RPC Handlers
 *
 * TASK_2025_073 Phase 5: RPC handlers for webview API key management
 *
 * Security: API keys are never sent to webview - only masked status.
 *
 * @packageDocumentation
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../di/tokens';
import type { Logger } from '../logging/logger';

/**
 * LLM Provider Name type
 * Duplicated here to avoid circular dependency with llm-abstraction
 * Must be kept in sync with @ptah-extension/llm-abstraction
 */
export type LlmProviderName = 'openai' | 'google-genai' | 'vscode-lm';

/**
 * Provider status information (without exposing API keys)
 */
export interface LlmProviderStatus {
  /** Provider identifier */
  provider: LlmProviderName;
  /** Human-readable display name */
  displayName: string;
  /** Whether provider has a configured API key */
  isConfigured: boolean;
  /** Default model for this provider */
  defaultModel: string;
}

/**
 * Request to set API key for a provider
 */
export interface SetApiKeyRequest {
  /** Provider to set key for */
  provider: LlmProviderName;
  /** API key to store (will be encrypted in SecretStorage) */
  apiKey: string;
}

/**
 * Response from API key operations
 */
export interface SetApiKeyResponse {
  /** Whether operation succeeded */
  success: boolean;
  /** Error message if operation failed */
  error?: string;
}

/**
 * Secrets service interface (avoid circular dependency)
 */
interface ILlmSecretsService {
  hasApiKey(provider: LlmProviderName): Promise<boolean>;
  setApiKey(provider: LlmProviderName, apiKey: string): Promise<void>;
  deleteApiKey(provider: LlmProviderName): Promise<void>;
  validateKeyFormat(provider: LlmProviderName, apiKey: string): boolean;
}

/**
 * Configuration service interface (avoid circular dependency)
 */
interface ILlmConfigurationService {
  getDefaultProvider(): LlmProviderName;
  getDefaultModel(provider: LlmProviderName): string;
  getProviderDisplayName(provider: LlmProviderName): string;
  getAvailableProviders(): Promise<
    Array<{
      provider: LlmProviderName;
      model: string;
      isConfigured: boolean;
      displayName: string;
    }>
  >;
}

/**
 * LLM RPC Handlers Service
 *
 * Provides webview API for LLM provider configuration management.
 * Handles API key storage, provider status queries, and configuration.
 *
 * SECURITY CRITICAL: API keys are NEVER exposed to webview.
 * Only masked status (isConfigured: boolean) is returned.
 *
 * Error Handling Pattern:
 * - Public methods return { success, error? } for RPC safety
 * - Never throw - always return error in response
 * - All errors logged with context before returning
 */
@injectable()
export class LlmRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger,
    @inject(TOKENS.LLM_SECRETS_SERVICE)
    private readonly secretsService: ILlmSecretsService,
    @inject(TOKENS.LLM_CONFIGURATION_SERVICE)
    private readonly configService: ILlmConfigurationService
  ) {
    this.logger.info('[LlmRpcHandlers.constructor] RPC handlers initialized');
  }

  /**
   * Get status of all LLM providers (without exposing API keys)
   *
   * Returns list of all supported providers with:
   * - Display name for UI
   * - Configuration status (boolean - never actual key)
   * - Default model
   *
   * SECURITY: API keys are NEVER included in response.
   *
   * @returns Array of provider status objects
   *
   * @example
   * ```typescript
   * const statuses = await rpcHandlers.getProviderStatus();
   * statuses.forEach(s => {
   *   console.log(`${s.displayName}: ${s.isConfigured ? 'Configured' : 'Not configured'}`);
   * });
   * ```
   */
  async getProviderStatus(): Promise<LlmProviderStatus[]> {
    try {
      this.logger.debug(
        '[LlmRpcHandlers.getProviderStatus] Fetching provider status'
      );

      // Get configured providers with their settings
      const providers = await this.configService.getAvailableProviders();

      // Transform to response format (API keys never exposed)
      const statuses = providers.map((p) => ({
        provider: p.provider,
        displayName: p.displayName,
        isConfigured: p.isConfigured,
        defaultModel: p.model,
      }));

      this.logger.debug('[LlmRpcHandlers.getProviderStatus] Status retrieved', {
        count: statuses.length,
        configured: statuses.filter((s) => s.isConfigured).length,
      });

      return statuses;
    } catch (error) {
      this.logger.error(
        '[LlmRpcHandlers.getProviderStatus] Failed to fetch status',
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );

      // Return empty array on error (graceful degradation)
      return [];
    }
  }

  /**
   * Set API key for a provider
   *
   * Validates key format before storing in SecretStorage.
   * Keys are encrypted by VS Code's SecretStorage API.
   *
   * @param request - Provider and API key
   * @returns Success/error response (never returns the key)
   *
   * @example
   * ```typescript
   * const result = await rpcHandlers.setApiKey({
   *   provider: 'openai',
   *   apiKey: 'sk-...'
   * });
   *
   * if (!result.success) {
   *   console.error(result.error);
   * }
   * ```
   */
  async setApiKey(request: SetApiKeyRequest): Promise<SetApiKeyResponse> {
    try {
      const { provider, apiKey } = request;

      // SECURITY: Never log the actual API key - only metadata
      this.logger.debug('[LlmRpcHandlers.setApiKey] Setting API key', {
        provider,
        keyLength: apiKey.length,
        keyPrefix: apiKey.substring(0, Math.min(10, apiKey.length)) + '...',
      });

      // Validate format before storing
      const isValid = this.secretsService.validateKeyFormat(provider, apiKey);
      if (!isValid) {
        const error = `Invalid API key format for ${provider}`;
        this.logger.warn('[LlmRpcHandlers.setApiKey] Validation failed', {
          provider,
          reason: 'Invalid format',
        });
        return { success: false, error };
      }

      // Store in SecretStorage (encrypted)
      await this.secretsService.setApiKey(provider, apiKey);

      this.logger.info(
        '[LlmRpcHandlers.setApiKey] API key saved successfully',
        {
          provider,
        }
      );

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      this.logger.error('[LlmRpcHandlers.setApiKey] Failed to save API key', {
        provider: request.provider,
        error: message,
      });

      return { success: false, error: message };
    }
  }

  /**
   * Remove API key for a provider
   *
   * Deletes the encrypted key from VS Code's SecretStorage.
   *
   * @param provider - Provider to remove key for
   * @returns Success/error response
   *
   * @example
   * ```typescript
   * const result = await rpcHandlers.removeApiKey('openai');
   * if (result.success) {
   *   console.log('API key removed');
   * }
   * ```
   */
  async removeApiKey(provider: LlmProviderName): Promise<SetApiKeyResponse> {
    try {
      this.logger.debug('[LlmRpcHandlers.removeApiKey] Removing API key', {
        provider,
      });

      // Delete from SecretStorage
      await this.secretsService.deleteApiKey(provider);

      this.logger.info(
        '[LlmRpcHandlers.removeApiKey] API key removed successfully',
        {
          provider,
        }
      );

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(
        '[LlmRpcHandlers.removeApiKey] Failed to remove API key',
        {
          provider,
          error: message,
        }
      );

      return { success: false, error: message };
    }
  }

  /**
   * Get default provider from settings
   *
   * Reads `ptah.llm.defaultProvider` setting.
   * Falls back to 'vscode-lm' if not configured.
   *
   * @returns Default provider name
   *
   * @example
   * ```typescript
   * const defaultProvider = rpcHandlers.getDefaultProvider();
   * console.log(`Default: ${defaultProvider}`); // "google-genai" or "vscode-lm"
   * ```
   */
  getDefaultProvider(): LlmProviderName {
    try {
      const provider = this.configService.getDefaultProvider();

      this.logger.debug(
        '[LlmRpcHandlers.getDefaultProvider] Retrieved default provider',
        {
          provider,
        }
      );

      return provider;
    } catch (error) {
      this.logger.error(
        '[LlmRpcHandlers.getDefaultProvider] Failed to get default provider',
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );

      // Fallback to safe default
      return 'vscode-lm';
    }
  }

  /**
   * Validate API key format (without storing)
   *
   * Performs provider-specific format validation:
   * - openai: Must start with 'sk-' and be at least 20 characters
   * - google-genai: Must be at least 30 characters
   * - vscode-lm: Always returns false (no API key needed)
   *
   * @param provider - Provider name
   * @param apiKey - API key to validate
   * @returns Validation result with optional error message
   *
   * @example
   * ```typescript
   * const result = rpcHandlers.validateApiKeyFormat('openai', userInput);
   * if (!result.valid) {
   *   console.error(result.error);
   * }
   * ```
   */
  validateApiKeyFormat(
    provider: LlmProviderName,
    apiKey: string
  ): { valid: boolean; error?: string } {
    try {
      // SECURITY: Never log the actual API key
      this.logger.debug(
        '[LlmRpcHandlers.validateApiKeyFormat] Validating key format',
        {
          provider,
          keyLength: apiKey.length,
        }
      );

      // Use secrets service validation logic
      const isValid = this.secretsService.validateKeyFormat(provider, apiKey);

      if (!isValid) {
        let error = 'Invalid API key format';

        // Provide provider-specific hints
        switch (provider) {
          case 'openai':
            error =
              'OpenAI API keys must start with "sk-" and be at least 20 characters';
            break;
          case 'google-genai':
            error = 'Google API keys must be at least 30 characters';
            break;
          case 'vscode-lm':
            error = 'VS Code Language Model does not require an API key';
            break;
        }

        return { valid: false, error };
      }

      return { valid: true };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Validation failed';

      this.logger.error(
        '[LlmRpcHandlers.validateApiKeyFormat] Validation error',
        {
          provider,
          error: message,
        }
      );

      return { valid: false, error: message };
    }
  }

  /**
   * List available VS Code language models
   *
   * Queries VS Code's Language Model API for available models.
   * Returns models in vendor/family format for UI display.
   *
   * @returns Array of available model identifiers (e.g., ['copilot/gpt-4o', 'copilot/gpt-4o-mini'])
   *
   * @example
   * ```typescript
   * const models = await rpcHandlers.listVsCodeModels();
   * models.forEach(m => console.log(`Available: ${m}`));
   * ```
   */
  async listVsCodeModels(): Promise<VsCodeModelInfo[]> {
    try {
      this.logger.debug(
        '[LlmRpcHandlers.listVsCodeModels] Querying available models'
      );

      // Import vscode dynamically to avoid issues if not in extension context
      const vscode = await import('vscode');

      // Query all available chat models
      const models = await vscode.lm.selectChatModels();

      // Transform to response format
      const modelInfos: VsCodeModelInfo[] = models.map((m) => ({
        id: `${m.vendor}/${m.family}`,
        vendor: m.vendor,
        family: m.family,
        version: m.version,
        maxInputTokens: m.maxInputTokens,
        displayName: `${m.vendor}/${m.family}${
          m.version ? ` (${m.version})` : ''
        }`,
      }));

      this.logger.debug(
        '[LlmRpcHandlers.listVsCodeModels] Found available models',
        {
          count: modelInfos.length,
          models: modelInfos.map((m) => m.id),
        }
      );

      return modelInfos;
    } catch (error) {
      this.logger.error(
        '[LlmRpcHandlers.listVsCodeModels] Failed to list models',
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );

      // Return empty array on error
      return [];
    }
  }
}

/**
 * VS Code model information
 */
export interface VsCodeModelInfo {
  /** Model identifier in vendor/family format */
  id: string;
  /** Model vendor (e.g., 'copilot') */
  vendor: string;
  /** Model family (e.g., 'gpt-4o') */
  family: string;
  /** Model version if available */
  version?: string;
  /** Maximum input tokens supported */
  maxInputTokens?: number;
  /** Display name for UI */
  displayName: string;
}
