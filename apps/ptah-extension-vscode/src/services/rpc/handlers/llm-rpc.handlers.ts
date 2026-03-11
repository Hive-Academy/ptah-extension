/**
 * LLM RPC Handlers
 *
 * Handles LLM provider management RPC methods: llm:getProviderStatus, llm:setApiKey,
 * llm:removeApiKey, llm:getDefaultProvider, llm:validateApiKeyFormat, llm:listVsCodeModels
 *
 * TASK_2025_074: Extracted from monolithic RpcMethodRegistrationService
 * TASK_2025_073: LLM provider management integration
 * SDK-only migration: Removed CLI auth, simplified to vscode-lm only
 */

import { injectable, inject, DependencyContainer } from 'tsyringe';
import {
  Logger,
  RpcHandler,
  TOKENS,
  LlmRpcHandlers as LlmRpcHandlersInterface,
  SetApiKeyRequest,
  SetApiKeyResponse,
  LlmProviderName,
} from '@ptah-extension/vscode-core';
import type {
  LlmListProviderModelsParams,
  LlmListProviderModelsResponse,
} from '@ptah-extension/shared';

/**
 * RPC handlers for LLM provider operations
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
   * llm:getProviderStatus - Get status of all LLM providers (without exposing API keys)
   */
  private registerGetProviderStatus(): void {
    this.rpcHandler.registerMethod<void, unknown>(
      'llm:getProviderStatus',
      async () => {
        try {
          this.logger.debug('RPC: llm:getProviderStatus called');

          const handlers = this.container.resolve<LlmRpcHandlersInterface>(
            TOKENS.LLM_RPC_HANDLERS
          );
          const statuses = await handlers.getProviderStatus();

          return statuses;
        } catch (error) {
          this.logger.error(
            'RPC: llm:getProviderStatus failed',
            error instanceof Error ? error : new Error(String(error))
          );
          throw error;
        }
      }
    );
  }

  /**
   * llm:setApiKey - Set API key for a provider
   */
  private registerSetApiKey(): void {
    this.rpcHandler.registerMethod<SetApiKeyRequest, SetApiKeyResponse>(
      'llm:setApiKey',
      async (request: SetApiKeyRequest) => {
        try {
          // SECURITY: Never log the actual API key
          this.logger.debug('RPC: llm:setApiKey called', {
            provider: request.provider,
          });

          const handlers = this.container.resolve<LlmRpcHandlersInterface>(
            TOKENS.LLM_RPC_HANDLERS
          );
          const result = await handlers.setApiKey(request);

          return result;
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
    this.rpcHandler.registerMethod<LlmProviderName, SetApiKeyResponse>(
      'llm:removeApiKey',
      async (provider: LlmProviderName) => {
        try {
          this.logger.debug('RPC: llm:removeApiKey called', { provider });

          const handlers = this.container.resolve<LlmRpcHandlersInterface>(
            TOKENS.LLM_RPC_HANDLERS
          );
          const result = await handlers.removeApiKey(provider);

          return result;
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
      }
    );
  }

  /**
   * llm:getDefaultProvider - Get default provider from settings
   */
  private registerGetDefaultProvider(): void {
    this.rpcHandler.registerMethod<void, LlmProviderName>(
      'llm:getDefaultProvider',
      async () => {
        try {
          this.logger.debug('RPC: llm:getDefaultProvider called');

          const handlers = this.container.resolve<LlmRpcHandlersInterface>(
            TOKENS.LLM_RPC_HANDLERS
          );
          const provider = handlers.getDefaultProvider();

          return provider;
        } catch (error) {
          this.logger.error(
            'RPC: llm:getDefaultProvider failed',
            error instanceof Error ? error : new Error(String(error))
          );
          throw error;
        }
      }
    );
  }

  /**
   * llm:setDefaultProvider - Set default LLM provider
   */
  private registerSetDefaultProvider(): void {
    this.rpcHandler.registerMethod<
      { provider: LlmProviderName },
      { success: boolean; error?: string }
    >(
      'llm:setDefaultProvider',
      async (params: { provider: LlmProviderName }) => {
        try {
          this.logger.debug('RPC: llm:setDefaultProvider called', {
            provider: params.provider,
          });

          const handlers = this.container.resolve<LlmRpcHandlersInterface>(
            TOKENS.LLM_RPC_HANDLERS
          );
          const result = await handlers.setDefaultProvider(params.provider);

          return result;
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
      { provider: LlmProviderName; model: string },
      { success: boolean; error?: string }
    >(
      'llm:setDefaultModel',
      async (params: { provider: LlmProviderName; model: string }) => {
        try {
          this.logger.debug('RPC: llm:setDefaultModel called', {
            provider: params.provider,
            model: params.model,
          });

          const handlers = this.container.resolve<LlmRpcHandlersInterface>(
            TOKENS.LLM_RPC_HANDLERS
          );
          const result = await handlers.setDefaultModel(params);

          return result;
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
      { provider: LlmProviderName; apiKey: string },
      { valid: boolean; error?: string }
    >(
      'llm:validateApiKeyFormat',
      async (params: { provider: LlmProviderName; apiKey: string }) => {
        try {
          // SECURITY: Never log the actual API key
          this.logger.debug('RPC: llm:validateApiKeyFormat called', {
            provider: params.provider,
          });

          const handlers = this.container.resolve<LlmRpcHandlersInterface>(
            TOKENS.LLM_RPC_HANDLERS
          );
          const result = handlers.validateApiKeyFormat(
            params.provider,
            params.apiKey
          );

          return result;
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
   * llm:listVsCodeModels - List available VS Code language models
   */
  private registerListVsCodeModels(): void {
    this.rpcHandler.registerMethod<void, unknown[]>(
      'llm:listVsCodeModels',
      async () => {
        try {
          this.logger.debug('RPC: llm:listVsCodeModels called');

          const handlers = this.container.resolve<LlmRpcHandlersInterface>(
            TOKENS.LLM_RPC_HANDLERS
          );
          const models = await handlers.listVsCodeModels();

          return models;
        } catch (error) {
          this.logger.error(
            'RPC: llm:listVsCodeModels failed',
            error instanceof Error ? error : new Error(String(error))
          );
          // Return empty array on error
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
    >('llm:listProviderModels', async (params: LlmListProviderModelsParams) => {
      try {
        this.logger.debug('RPC: llm:listProviderModels called', {
          provider: params.provider,
        });

        const handlers = this.container.resolve<LlmRpcHandlersInterface>(
          TOKENS.LLM_RPC_HANDLERS
        );
        const result = await handlers.listProviderModels(params.provider);

        return result;
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
    });
  }
}
