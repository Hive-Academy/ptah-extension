/**
 * Custom Agent RPC Handlers
 *
 * Handles custom agent management RPC methods:
 * - customAgent:list - List all configured custom agents
 * - customAgent:create - Create a new custom agent
 * - customAgent:update - Update an existing custom agent
 * - customAgent:delete - Delete a custom agent
 * - customAgent:testConnection - Test connection to a custom agent's provider
 * - customAgent:listModels - List available models for a custom agent's provider
 *
 * TASK_2025_167 Batch 3: RPC Handlers + DI Wiring
 */

import { injectable, inject } from 'tsyringe';
import { Logger, RpcHandler, TOKENS } from '@ptah-extension/vscode-core';
import {
  SDK_TOKENS,
  CustomAgentRegistry,
  getAnthropicProvider,
} from '@ptah-extension/agent-sdk';
import type {
  CustomAgentListParams,
  CustomAgentListResult,
  CustomAgentCreateParams,
  CustomAgentCreateResult,
  CustomAgentUpdateParams,
  CustomAgentUpdateResult,
  CustomAgentDeleteParams,
  CustomAgentDeleteResult,
  CustomAgentTestConnectionParams,
  CustomAgentTestConnectionResult,
  CustomAgentListModelsParams,
  CustomAgentListModelsResult,
} from '@ptah-extension/shared';

/**
 * RPC handlers for custom agent management operations
 */
@injectable()
export class CustomAgentRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(SDK_TOKENS.SDK_CUSTOM_AGENT_REGISTRY)
    private readonly customAgentRegistry: CustomAgentRegistry
  ) {}

  /**
   * Register all custom agent RPC methods
   */
  register(): void {
    this.registerList();
    this.registerCreate();
    this.registerUpdate();
    this.registerDelete();
    this.registerTestConnection();
    this.registerListModels();

    this.logger.debug('Custom agent RPC handlers registered', {
      methods: [
        'customAgent:list',
        'customAgent:create',
        'customAgent:update',
        'customAgent:delete',
        'customAgent:testConnection',
        'customAgent:listModels',
      ],
    });
  }

  /**
   * customAgent:list - List all configured custom agents with status
   */
  private registerList(): void {
    this.rpcHandler.registerMethod<
      CustomAgentListParams,
      CustomAgentListResult
    >('customAgent:list', async () => {
      try {
        this.logger.debug('RPC: customAgent:list called');

        const agents = await this.customAgentRegistry.listAgents();

        this.logger.debug('RPC: customAgent:list success', {
          agentCount: agents.length,
        });

        return { agents };
      } catch (error) {
        this.logger.error(
          'RPC: customAgent:list failed',
          error instanceof Error ? error : new Error(String(error))
        );
        throw error;
      }
    });
  }

  /**
   * customAgent:create - Create a new custom agent configuration
   */
  private registerCreate(): void {
    this.rpcHandler.registerMethod<
      CustomAgentCreateParams,
      CustomAgentCreateResult
    >('customAgent:create', async (params) => {
      try {
        this.logger.debug('RPC: customAgent:create called', {
          name: params.name,
          providerId: params.providerId,
        });

        const agent = await this.customAgentRegistry.createAgent(
          params.name,
          params.providerId,
          params.apiKey
        );

        this.logger.info('RPC: customAgent:create success', {
          agentId: agent.id,
          name: agent.name,
          providerId: agent.providerId,
        });

        return { success: true, agent };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          'RPC: customAgent:create failed',
          error instanceof Error ? error : new Error(errorMessage)
        );
        return { success: false, error: errorMessage };
      }
    });
  }

  /**
   * customAgent:update - Update an existing custom agent configuration
   */
  private registerUpdate(): void {
    this.rpcHandler.registerMethod<
      CustomAgentUpdateParams,
      CustomAgentUpdateResult
    >('customAgent:update', async (params) => {
      try {
        this.logger.debug('RPC: customAgent:update called', {
          id: params.id,
        });

        // Extract config-level updates (excluding id and apiKey)
        const updates: {
          name?: string;
          enabled?: boolean;
          tierMappings?: { sonnet?: string; opus?: string; haiku?: string };
          selectedModel?: string;
        } = {};

        if (params.name !== undefined) {
          updates.name = params.name;
        }
        if (params.enabled !== undefined) {
          updates.enabled = params.enabled;
        }
        if (params.tierMappings !== undefined) {
          updates.tierMappings = params.tierMappings;
        }
        if (params.selectedModel !== undefined) {
          updates.selectedModel = params.selectedModel;
        }

        await this.customAgentRegistry.updateAgent(
          params.id,
          updates,
          params.apiKey
        );

        this.logger.info('RPC: customAgent:update success', {
          id: params.id,
        });

        return { success: true };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          'RPC: customAgent:update failed',
          error instanceof Error ? error : new Error(errorMessage)
        );
        return { success: false, error: errorMessage };
      }
    });
  }

  /**
   * customAgent:delete - Delete a custom agent configuration
   */
  private registerDelete(): void {
    this.rpcHandler.registerMethod<
      CustomAgentDeleteParams,
      CustomAgentDeleteResult
    >('customAgent:delete', async (params) => {
      try {
        this.logger.debug('RPC: customAgent:delete called', {
          id: params.id,
        });

        await this.customAgentRegistry.deleteAgent(params.id);

        this.logger.info('RPC: customAgent:delete success', {
          id: params.id,
        });

        return { success: true };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          'RPC: customAgent:delete failed',
          error instanceof Error ? error : new Error(errorMessage)
        );
        return { success: false, error: errorMessage };
      }
    });
  }

  /**
   * customAgent:testConnection - Test connection to a custom agent's provider
   *
   * Performs a minimal API call to validate the API key and provider connectivity.
   */
  private registerTestConnection(): void {
    this.rpcHandler.registerMethod<
      CustomAgentTestConnectionParams,
      CustomAgentTestConnectionResult
    >('customAgent:testConnection', async (params) => {
      try {
        this.logger.debug('RPC: customAgent:testConnection called', {
          id: params.id,
        });

        const result = await this.customAgentRegistry.testConnection(params.id);

        this.logger.info('RPC: customAgent:testConnection result', {
          id: params.id,
          success: result.success,
          latencyMs: result.latencyMs,
        });

        return result;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          'RPC: customAgent:testConnection failed',
          error instanceof Error ? error : new Error(errorMessage)
        );
        return { success: false, error: errorMessage };
      }
    });
  }

  /**
   * customAgent:listModels - List available models for a custom agent's provider
   *
   * Returns static model list from the provider registry. For providers with
   * dynamic model APIs (e.g., OpenRouter), uses the static models as the list
   * since dynamic model fetching is handled by ProviderModelsService separately.
   */
  private registerListModels(): void {
    this.rpcHandler.registerMethod<
      CustomAgentListModelsParams,
      CustomAgentListModelsResult
    >('customAgent:listModels', async (params) => {
      try {
        this.logger.debug('RPC: customAgent:listModels called', {
          id: params.id,
        });

        // Get the agent's config to find its provider
        const agents = await this.customAgentRegistry.listAgents();
        const agent = agents.find((a) => a.id === params.id);

        if (!agent) {
          this.logger.warn('RPC: customAgent:listModels - agent not found', {
            id: params.id,
          });
          return { models: [], isStatic: true, error: 'Agent not found' };
        }

        // Look up provider definition for static models
        const provider = getAnthropicProvider(agent.providerId);

        if (!provider) {
          this.logger.warn('RPC: customAgent:listModels - provider not found', {
            providerId: agent.providerId,
          });
          return { models: [], isStatic: true, error: 'Provider not found' };
        }

        // Return static models from the provider registry
        const models = (provider.staticModels ?? []).map((m) => ({
          id: m.id,
          name: m.name,
          description: m.description,
          contextLength: m.contextLength,
        }));

        const hasDynamicEndpoint = !!(
          'modelsEndpoint' in provider && provider.modelsEndpoint
        );

        this.logger.debug('RPC: customAgent:listModels success', {
          id: params.id,
          providerId: agent.providerId,
          modelCount: models.length,
          isStatic: !hasDynamicEndpoint,
        });

        return {
          models,
          isStatic: !hasDynamicEndpoint,
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          'RPC: customAgent:listModels failed',
          error instanceof Error ? error : new Error(errorMessage)
        );
        return { models: [], isStatic: true, error: errorMessage };
      }
    });
  }
}
