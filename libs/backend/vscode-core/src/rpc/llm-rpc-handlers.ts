/**
 * LLM RPC Handlers
 *
 * TASK_2025_073 Phase 5: RPC handlers for webview API key management
 * SDK-only migration: Simplified to vscode-lm provider only
 *
 * Security: API keys are never sent to webview - only masked status.
 *
 * @packageDocumentation
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../di/tokens';
import type { Logger } from '../logging/logger';
import type { ExtensionContext } from 'vscode';

/**
 * LLM Provider Name type
 * Duplicated here to avoid circular dependency with llm-abstraction
 * Must be kept in sync with @ptah-extension/llm-abstraction
 *
 * SDK-only migration: Only 'vscode-lm' remains as active provider
 */
export type LlmProviderName = 'vscode-lm';

/** LLM Provider capability flags */
export type LlmProviderCapability = 'text-chat' | 'structured-output';

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
  /** Provider capabilities */
  capabilities: LlmProviderCapability[];
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
  getApiKey(provider: LlmProviderName): Promise<string | undefined>;
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
  getAllProviders(): Promise<
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
 * Handles provider status queries and configuration.
 *
 * SDK-only migration: Simplified to vscode-lm provider only.
 * Google GenAI, OpenAI, and CLI auth have been removed.
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
    private readonly configService: ILlmConfigurationService,
    @inject(TOKENS.EXTENSION_CONTEXT)
    private readonly context: ExtensionContext
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
   */
  async getProviderStatus(): Promise<{
    providers: LlmProviderStatus[];
    defaultProvider: LlmProviderName;
  }> {
    try {
      this.logger.debug(
        '[LlmRpcHandlers.getProviderStatus] Fetching provider status'
      );

      // Get ALL providers (configured or not) for settings UI
      const providers = await this.configService.getAllProviders();

      const statuses = providers.map((p) => ({
        provider: p.provider,
        displayName: p.displayName,
        isConfigured: p.isConfigured,
        defaultModel: p.model,
        capabilities: this.getProviderCapabilities(p.provider),
      }));

      const defaultProvider = this.configService.getDefaultProvider();

      this.logger.debug('[LlmRpcHandlers.getProviderStatus] Status retrieved', {
        count: statuses.length,
        configured: statuses.filter((s) => s.isConfigured).length,
        defaultProvider,
      });

      return { providers: statuses, defaultProvider };
    } catch (error) {
      this.logger.error(
        '[LlmRpcHandlers.getProviderStatus] Failed to fetch status',
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );

      // Return empty result on error (graceful degradation)
      return { providers: [], defaultProvider: 'vscode-lm' };
    }
  }

  /**
   * Get capabilities for a specific provider
   */
  getProviderCapabilities(provider: LlmProviderName): LlmProviderCapability[] {
    switch (provider) {
      case 'vscode-lm':
        return ['text-chat'];
      default:
        return ['text-chat'];
    }
  }

  /**
   * Set the default LLM provider
   *
   * Updates VS Code setting `ptah.llm.defaultProvider`.
   *
   * @param provider - Provider name to set as default
   * @returns Success/error response
   */
  async setDefaultProvider(
    provider: LlmProviderName
  ): Promise<{ success: boolean; error?: string }> {
    try {
      this.logger.debug(
        '[LlmRpcHandlers.setDefaultProvider] Setting default provider',
        { provider }
      );

      // Import vscode dynamically to avoid issues if not in extension context
      const vscode = await import('vscode');

      await vscode.workspace
        .getConfiguration('ptah')
        .update(
          'llm.defaultProvider',
          provider,
          vscode.ConfigurationTarget.Global
        );

      this.logger.info(
        '[LlmRpcHandlers.setDefaultProvider] Default provider updated',
        { provider }
      );

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(
        '[LlmRpcHandlers.setDefaultProvider] Failed to set default provider',
        { provider, error: message }
      );

      return { success: false, error: message };
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
   * Set the default model for a specific LLM provider
   *
   * Updates VS Code setting `ptah.llm.{settingsKey}.model`.
   *
   * @param provider - Provider name
   * @param model - Model identifier to set as default
   * @returns Success/error response
   */
  async setDefaultModel(request: {
    provider: LlmProviderName;
    model: string;
  }): Promise<{ success: boolean; error?: string }> {
    const { provider, model } = request;
    const settingsKey = this.getProviderSettingsKey(provider);
    const globalStateKey = `ptah.llm.${settingsKey}.model`;

    try {
      this.logger.debug(
        '[LlmRpcHandlers.setDefaultModel] Setting default model',
        { provider, model }
      );

      const vscode = await import('vscode');

      try {
        await vscode.workspace
          .getConfiguration('ptah')
          .update(
            `llm.${settingsKey}.model`,
            model,
            vscode.ConfigurationTarget.Global
          );
      } catch (settingsError) {
        // VS Code refuses settings write when settings.json has unsaved changes.
        // Fall back to globalState so the selection is still persisted.
        const msg = settingsError instanceof Error ? settingsError.message : '';
        if (msg.includes('unsaved changes')) {
          this.logger.warn(
            '[LlmRpcHandlers.setDefaultModel] Settings write blocked, using globalState fallback',
            { provider, model }
          );
          await this.context.globalState.update(globalStateKey, model);
        } else {
          throw settingsError;
        }
      }

      this.logger.info(
        '[LlmRpcHandlers.setDefaultModel] Default model updated',
        { provider, model }
      );

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(
        '[LlmRpcHandlers.setDefaultModel] Failed to set default model',
        { provider: request.provider, model: request.model, error: message }
      );

      return { success: false, error: message };
    }
  }

  /**
   * List available models for a provider.
   *
   * SDK-only migration: Only vscode-lm model listing remains.
   * Google GenAI and OpenAI dynamic API model listing has been removed.
   *
   * @param provider - The provider to list models for
   * @returns Array of model objects with id and displayName
   */
  async listProviderModels(provider: LlmProviderName): Promise<{
    models: Array<{ id: string; displayName: string }>;
    error?: string;
  }> {
    try {
      this.logger.debug('[LlmRpcHandlers.listProviderModels] Listing models', {
        provider,
      });

      if (provider === 'vscode-lm') {
        const vsModels = await this.listVsCodeModels();
        return {
          models: vsModels.map((m) => ({
            id: m.id,
            displayName: m.displayName,
          })),
        };
      }

      return { models: [], error: `Unsupported provider: ${provider}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        '[LlmRpcHandlers.listProviderModels] Failed to list models',
        { provider, error: message }
      );
      return { models: [], error: message };
    }
  }

  /**
   * Map provider name to settings key (mirrors LlmConfigurationService logic)
   */
  private getProviderSettingsKey(provider: LlmProviderName): string {
    switch (provider) {
      case 'vscode-lm':
        return 'vscode';
      default:
        return provider;
    }
  }

  /**
   * Validate API key format (without storing)
   *
   * @param provider - Provider name
   * @param apiKey - API key to validate
   * @returns Validation result with optional error message
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

        switch (provider) {
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
   * @returns Array of available model identifiers
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
