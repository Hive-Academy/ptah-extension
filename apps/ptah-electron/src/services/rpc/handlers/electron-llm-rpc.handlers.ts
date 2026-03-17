/**
 * Electron LLM RPC Handlers
 *
 * Handles LLM provider management methods specific to Electron.
 * In Electron, LLM providers are managed via direct API key storage
 * in ISecretStorage rather than through vscode-core's LlmRpcHandlers interface.
 *
 * Methods:
 * - llm:getProviderStatus - Get status of configured providers
 * - llm:setApiKey - Store API key for a provider
 * - llm:removeApiKey - Remove stored API key
 * - llm:getDefaultProvider - Get the default LLM provider
 * - llm:validateApiKeyFormat - Basic format validation
 *
 * TASK_2025_203 Batch 5: Extracted from inline registrations
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { ISecretStorage } from '@ptah-extension/platform-core';

@injectable()
export class ElectronLlmRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(PLATFORM_TOKENS.SECRET_STORAGE)
    private readonly secretStorage: ISecretStorage
  ) {}

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
  }

  private registerGetProviderStatus(): void {
    this.rpcHandler.registerMethod('llm:getProviderStatus', async () => {
      try {
        const anthropicKey = await this.secretStorage.get(
          'ptah.apiKey.anthropic'
        );
        const openrouterKey = await this.secretStorage.get(
          'ptah.apiKey.openrouter'
        );

        return {
          providers: [
            {
              name: 'anthropic',
              displayName: 'Anthropic (Claude)',
              hasApiKey: !!anthropicKey,
              isDefault: true,
            },
            {
              name: 'openrouter',
              displayName: 'OpenRouter',
              hasApiKey: !!openrouterKey,
              isDefault: false,
            },
          ],
        };
      } catch (error) {
        this.logger.warn(
          '[Electron RPC] llm:getProviderStatus failed',
          error instanceof Error ? error : new Error(String(error))
        );
        return { providers: [] };
      }
    });
  }

  private registerSetApiKey(): void {
    this.rpcHandler.registerMethod(
      'llm:setApiKey',
      async (params: { provider: string; apiKey: string } | undefined) => {
        if (!params?.provider || !params?.apiKey) {
          return {
            success: false,
            error: 'provider and apiKey are required',
          };
        }

        try {
          const storageKey = `ptah.apiKey.${params.provider}`;
          await this.secretStorage.store(storageKey, params.apiKey);

          // Set in environment for SDK adapters
          if (params.provider === 'anthropic') {
            process.env['ANTHROPIC_API_KEY'] = params.apiKey;
          } else if (params.provider === 'openrouter') {
            process.env['OPENROUTER_API_KEY'] = params.apiKey;
          }

          return { success: true };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
    );
  }

  private registerRemoveApiKey(): void {
    this.rpcHandler.registerMethod(
      'llm:removeApiKey',
      async (params: { provider: string } | undefined) => {
        if (!params?.provider) {
          return { success: false, error: 'provider is required' };
        }

        try {
          await this.secretStorage.delete(`ptah.apiKey.${params.provider}`);

          if (params.provider === 'anthropic') {
            delete process.env['ANTHROPIC_API_KEY'];
          } else if (params.provider === 'openrouter') {
            delete process.env['OPENROUTER_API_KEY'];
          }

          return { success: true };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
    );
  }

  private registerGetDefaultProvider(): void {
    this.rpcHandler.registerMethod('llm:getDefaultProvider', async () => {
      return { provider: 'anthropic' };
    });
  }

  /**
   * llm:setDefaultProvider - Set default LLM provider.
   * In Electron, this is a no-op since Anthropic is always default.
   */
  private registerSetDefaultProvider(): void {
    this.rpcHandler.registerMethod(
      'llm:setDefaultProvider',
      async (params: { provider: string } | undefined) => {
        this.logger.debug(
          '[Electron RPC] llm:setDefaultProvider called (no-op)',
          { provider: params?.provider } as unknown as Error
        );
        return { success: true };
      }
    );
  }

  /**
   * llm:setDefaultModel - Set default model for a provider.
   * In Electron, this is a no-op (model selection handled by SDK config).
   */
  private registerSetDefaultModel(): void {
    this.rpcHandler.registerMethod(
      'llm:setDefaultModel',
      async (params: { provider: string; model: string } | undefined) => {
        this.logger.debug('[Electron RPC] llm:setDefaultModel called (no-op)', {
          provider: params?.provider,
          model: params?.model,
        } as unknown as Error);
        return { success: true };
      }
    );
  }

  private registerValidateApiKeyFormat(): void {
    this.rpcHandler.registerMethod(
      'llm:validateApiKeyFormat',
      async (params: { provider: string; apiKey: string } | undefined) => {
        if (!params?.provider || !params?.apiKey) {
          return {
            valid: false,
            error: 'provider and apiKey are required',
          };
        }

        const key = params.apiKey.trim();
        if (params.provider === 'anthropic') {
          return { valid: key.startsWith('sk-ant-') && key.length > 20 };
        }
        if (params.provider === 'openrouter') {
          return { valid: key.startsWith('sk-or-') && key.length > 20 };
        }
        return { valid: key.length > 10 };
      }
    );
  }

  /**
   * llm:listVsCodeModels - List VS Code language models.
   * Not applicable in Electron (no VS Code LM API). Returns empty array.
   */
  private registerListVsCodeModels(): void {
    this.rpcHandler.registerMethod('llm:listVsCodeModels', async () => {
      this.logger.debug(
        '[Electron RPC] llm:listVsCodeModels called (not available in Electron)'
      );
      return [];
    });
  }

  /**
   * llm:listProviderModels - List available models for a provider.
   * In Electron, returns an empty model list (provider model discovery not yet implemented).
   */
  private registerListProviderModels(): void {
    this.rpcHandler.registerMethod(
      'llm:listProviderModels',
      async (params: { provider: string } | undefined) => {
        this.logger.debug(
          '[Electron RPC] llm:listProviderModels called (not available in Electron)',
          { provider: params?.provider } as unknown as Error
        );
        return { models: [] };
      }
    );
  }
}
