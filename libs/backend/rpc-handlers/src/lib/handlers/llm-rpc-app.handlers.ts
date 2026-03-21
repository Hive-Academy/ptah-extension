/**
 * LLM RPC Handlers (Platform-Agnostic)
 *
 * Handles LLM provider management RPC methods: llm:getProviderStatus, llm:setApiKey,
 * llm:removeApiKey, llm:getDefaultProvider, llm:validateApiKeyFormat, llm:listVsCodeModels
 *
 * TASK_2025_074: Extracted from monolithic RpcMethodRegistrationService
 * TASK_2025_209: Rewritten to be platform-agnostic. Uses ISecretStorage directly
 * instead of delegating to vscode-core's LlmRpcHandlers interface.
 */

import { injectable, inject, DependencyContainer } from 'tsyringe';
import { Logger, RpcHandler, TOKENS } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { ISecretStorage } from '@ptah-extension/platform-core';
import type {
  LlmListProviderModelsParams,
  LlmListProviderModelsResponse,
} from '@ptah-extension/shared';
import type { IModelDiscovery } from '../platform-abstractions';

/** Secret storage key prefix for provider API keys */
const API_KEY_PREFIX = 'ptah.apiKey';

/** Provider display information and env var mappings */
interface ProviderInfo {
  displayName: string;
  envVar: string;
  keyPrefix?: string;
  minLength: number;
}

const PROVIDER_INFO: Record<string, ProviderInfo> = {
  anthropic: {
    displayName: 'Anthropic (Claude)',
    envVar: 'ANTHROPIC_API_KEY',
    keyPrefix: 'sk-ant-',
    minLength: 20,
  },
  openrouter: {
    displayName: 'OpenRouter',
    envVar: 'OPENROUTER_API_KEY',
    keyPrefix: 'sk-or-',
    minLength: 20,
  },
  moonshot: {
    displayName: 'Moonshot AI',
    envVar: 'MOONSHOT_API_KEY',
    minLength: 10,
  },
  'z-ai': {
    displayName: 'Z.AI',
    envVar: 'Z_AI_API_KEY',
    minLength: 10,
  },
};

/** Providers shown in the status UI */
const STATUS_PROVIDERS = ['anthropic', 'openrouter'];

/**
 * RPC handlers for LLM provider operations (platform-agnostic)
 *
 * Uses ISecretStorage directly for API key management and IModelDiscovery
 * for platform-specific model listing. Works on both VS Code and Electron.
 */
@injectable()
export class LlmRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    private readonly container: DependencyContainer
  ) {}

  /**
   * Register all LLM RPC methods
   */
  register(): void {
    this.registerGetProviderStatus();
    this.registerSetApiKey();
    this.registerRemoveApiKey();
    this.registerGetDefaultProvider();
    this.registerSetDefaultProvider();
    this.registerSetDefaultModel();
    this.registerValidateApiKeyFormat();
    this.registerListVsCodeModels();
    this.registerListProviderModels();

    this.logger.debug('LLM RPC handlers registered', {
      methods: [
        'llm:getProviderStatus',
        'llm:setApiKey',
        'llm:removeApiKey',
        'llm:getDefaultProvider',
        'llm:setDefaultProvider',
        'llm:setDefaultModel',
        'llm:validateApiKeyFormat',
        'llm:listVsCodeModels',
        'llm:listProviderModels',
      ],
    });
  }

  /**
   * Lazily resolve ISecretStorage from the DI container.
   * Uses lazy resolution because the container may not have all registrations
   * at construction time (factory pattern).
   */
  private getSecretStorage(): ISecretStorage {
    return this.container.resolve<ISecretStorage>(
      PLATFORM_TOKENS.SECRET_STORAGE
    );
  }

  /**
   * Lazily resolve IModelDiscovery from the DI container.
   */
  private getModelDiscovery(): IModelDiscovery {
    return this.container.resolve<IModelDiscovery>(TOKENS.MODEL_DISCOVERY);
  }

  /**
   * Get the config manager shim for reading/writing settings.
   */
  private getConfigManager(): {
    get<T>(key: string): T | undefined;
    set<T>(key: string, value: T): Promise<void>;
  } {
    return this.container.resolve(TOKENS.CONFIG_MANAGER);
  }

  /**
   * llm:getProviderStatus - Get status of all LLM providers (without exposing API keys)
   */
  private registerGetProviderStatus(): void {
    this.rpcHandler.registerMethod<void, unknown>(
      'llm:getProviderStatus',
      async () => {
        try {
          this.logger.debug('RPC: llm:getProviderStatus called');

          const secretStorage = this.getSecretStorage();
          const configManager = this.getConfigManager();
          const defaultProvider =
            configManager.get<string>('llm.defaultProvider') ?? 'anthropic';

          const providers = await Promise.all(
            STATUS_PROVIDERS.map(async (provider) => {
              const key = await secretStorage.get(
                `${API_KEY_PREFIX}.${provider}`
              );
              const info = PROVIDER_INFO[provider];
              return {
                name: provider,
                displayName: info.displayName,
                hasApiKey: !!key,
                isDefault: provider === defaultProvider,
              };
            })
          );

          return { providers, defaultProvider };
        } catch (error) {
          this.logger.error(
            'RPC: llm:getProviderStatus failed',
            error instanceof Error ? error : new Error(String(error))
          );
          return { providers: [] };
        }
      }
    );
  }

  /**
   * llm:setApiKey - Set API key for a provider
   */
  private registerSetApiKey(): void {
    this.rpcHandler.registerMethod<
      { provider: string; apiKey: string },
      { success: boolean; error?: string }
    >(
      'llm:setApiKey',
      async (params: { provider: string; apiKey: string } | undefined) => {
        if (!params?.provider || !params?.apiKey) {
          return {
            success: false,
            error: 'provider and apiKey are required',
          };
        }

        try {
          // SECURITY: Never log the actual API key
          this.logger.debug('RPC: llm:setApiKey called', {
            provider: params.provider,
          });

          const secretStorage = this.getSecretStorage();
          const storageKey = `${API_KEY_PREFIX}.${params.provider}`;
          await secretStorage.store(storageKey, params.apiKey);

          // Set in environment for SDK adapters
          const providerInfo = PROVIDER_INFO[params.provider];
          if (providerInfo) {
            process.env[providerInfo.envVar] = params.apiKey;
          }

          return { success: true };
        } catch (error) {
          this.logger.error(
            'RPC: llm:setApiKey failed',
            error instanceof Error ? error : new Error(String(error))
          );
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
    );
  }

  /**
   * llm:removeApiKey - Remove API key for a provider
   */
  private registerRemoveApiKey(): void {
    this.rpcHandler.registerMethod<
      { provider: string },
      { success: boolean; error?: string }
    >('llm:removeApiKey', async (params: { provider: string } | undefined) => {
      if (!params?.provider) {
        return { success: false, error: 'provider is required' };
      }

      try {
        this.logger.debug('RPC: llm:removeApiKey called', {
          provider: params.provider,
        });

        const secretStorage = this.getSecretStorage();
        await secretStorage.delete(`${API_KEY_PREFIX}.${params.provider}`);

        // Clear from environment
        const providerInfo = PROVIDER_INFO[params.provider];
        if (providerInfo) {
          delete process.env[providerInfo.envVar];
        }

        return { success: true };
      } catch (error) {
        this.logger.error(
          'RPC: llm:removeApiKey failed',
          error instanceof Error ? error : new Error(String(error))
        );
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });
  }

  /**
   * llm:getDefaultProvider - Get default provider from settings
   */
  private registerGetDefaultProvider(): void {
    this.rpcHandler.registerMethod<void, { provider: string }>(
      'llm:getDefaultProvider',
      async () => {
        try {
          this.logger.debug('RPC: llm:getDefaultProvider called');
          const configManager = this.getConfigManager();
          const provider =
            configManager.get<string>('llm.defaultProvider') ?? 'anthropic';
          return { provider };
        } catch (error) {
          this.logger.error(
            'RPC: llm:getDefaultProvider failed',
            error instanceof Error ? error : new Error(String(error))
          );
          return { provider: 'anthropic' };
        }
      }
    );
  }

  /**
   * llm:setDefaultProvider - Set default LLM provider
   */
  private registerSetDefaultProvider(): void {
    this.rpcHandler.registerMethod<
      { provider: string },
      { success: boolean; error?: string }
    >(
      'llm:setDefaultProvider',
      async (params: { provider: string } | undefined) => {
        try {
          this.logger.debug('RPC: llm:setDefaultProvider called', {
            provider: params?.provider,
          });

          const configManager = this.getConfigManager();
          await configManager.set(
            'llm.defaultProvider',
            params?.provider ?? 'anthropic'
          );

          return { success: true };
        } catch (error) {
          this.logger.error(
            'RPC: llm:setDefaultProvider failed',
            error instanceof Error ? error : new Error(String(error))
          );
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
    );
  }

  /**
   * llm:setDefaultModel - Set default model for a provider
   */
  private registerSetDefaultModel(): void {
    this.rpcHandler.registerMethod<
      { provider: string; model: string },
      { success: boolean; error?: string }
    >(
      'llm:setDefaultModel',
      async (params: { provider: string; model: string } | undefined) => {
        try {
          this.logger.debug('RPC: llm:setDefaultModel called', {
            provider: params?.provider,
            model: params?.model,
          });

          const configManager = this.getConfigManager();
          const settingsKey = params?.provider ?? 'anthropic';
          await configManager.set(
            `llm.${settingsKey}.model`,
            params?.model ?? ''
          );

          return { success: true };
        } catch (error) {
          this.logger.error(
            'RPC: llm:setDefaultModel failed',
            error instanceof Error ? error : new Error(String(error))
          );
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
    );
  }

  /**
   * llm:validateApiKeyFormat - Validate API key format (without storing)
   */
  private registerValidateApiKeyFormat(): void {
    this.rpcHandler.registerMethod<
      { provider: string; apiKey: string },
      { valid: boolean; error?: string }
    >(
      'llm:validateApiKeyFormat',
      async (params: { provider: string; apiKey: string } | undefined) => {
        if (!params?.provider || !params?.apiKey) {
          return {
            valid: false,
            error: 'provider and apiKey are required',
          };
        }

        try {
          // SECURITY: Never log the actual API key
          this.logger.debug('RPC: llm:validateApiKeyFormat called', {
            provider: params.provider,
          });

          const key = params.apiKey.trim();
          const providerInfo = PROVIDER_INFO[params.provider];

          if (providerInfo) {
            const valid = providerInfo.keyPrefix
              ? key.startsWith(providerInfo.keyPrefix) &&
                key.length > providerInfo.minLength
              : key.length > providerInfo.minLength;
            return valid
              ? { valid: true }
              : {
                  valid: false,
                  error: `API key should start with '${providerInfo.keyPrefix}' and be at least ${providerInfo.minLength} characters`,
                };
          }

          // Generic fallback for unknown providers
          return { valid: key.length > 10 };
        } catch (error) {
          this.logger.error(
            'RPC: llm:validateApiKeyFormat failed',
            error instanceof Error ? error : new Error(String(error))
          );
          return {
            valid: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
    );
  }

  /**
   * llm:listVsCodeModels - List available VS Code language models.
   * Delegates to IModelDiscovery.getCopilotModels() which returns real models
   * in VS Code and empty array in Electron.
   */
  private registerListVsCodeModels(): void {
    this.rpcHandler.registerMethod<void, unknown[]>(
      'llm:listVsCodeModels',
      async () => {
        try {
          this.logger.debug('RPC: llm:listVsCodeModels called');

          const modelDiscovery = this.getModelDiscovery();
          const models = await modelDiscovery.getCopilotModels();

          return models.map((m) => ({
            id: m.id,
            displayName: m.name,
            contextLength: m.contextLength,
          }));
        } catch (error) {
          this.logger.error(
            'RPC: llm:listVsCodeModels failed',
            error instanceof Error ? error : new Error(String(error))
          );
          return [];
        }
      }
    );
  }

  /**
   * llm:listProviderModels - List available models for a provider
   */
  private registerListProviderModels(): void {
    this.rpcHandler.registerMethod<
      LlmListProviderModelsParams,
      LlmListProviderModelsResponse
    >(
      'llm:listProviderModels',
      async (params: LlmListProviderModelsParams | undefined) => {
        if (!params?.provider) {
          return { models: [], error: 'provider is required' };
        }

        try {
          this.logger.debug('RPC: llm:listProviderModels called', {
            provider: params.provider,
          });

          const modelDiscovery = this.getModelDiscovery();

          // Route to appropriate discovery method based on provider
          const models =
            params.provider === 'copilot'
              ? await modelDiscovery.getCopilotModels()
              : await modelDiscovery.getCodexModels();

          return {
            models: models.map((m) => ({
              id: m.id,
              displayName: m.name,
            })),
          };
        } catch (error) {
          this.logger.error(
            'RPC: llm:listProviderModels failed',
            error instanceof Error ? error : new Error(String(error))
          );
          return {
            models: [],
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
    );
  }
}
