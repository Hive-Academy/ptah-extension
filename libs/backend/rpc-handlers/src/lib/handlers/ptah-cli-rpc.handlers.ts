/**
 * Ptah CLI RPC Handlers
 *
 * Handles Ptah CLI management RPC methods:
 * - ptahCli:list - List all configured Ptah CLI agents
 * - ptahCli:create - Create a new Ptah CLI agent
 * - ptahCli:update - Update an existing Ptah CLI agent
 * - ptahCli:delete - Delete a Ptah CLI agent
 * - ptahCli:testConnection - Test connection to a Ptah CLI agent's provider
 * - ptahCli:listModels - List available models for a Ptah CLI agent's provider
 *
 * TASK_2025_167 Batch 3: RPC Handlers + DI Wiring
 */

import { injectable, inject } from 'tsyringe';
import { Logger, RpcHandler, TOKENS } from '@ptah-extension/vscode-core';
import {
  SDK_TOKENS,
  PtahCliRegistry,
  getAnthropicProvider,
} from '@ptah-extension/agent-sdk';
import type {
  PtahCliListParams,
  PtahCliListResult,
  PtahCliCreateParams,
  PtahCliCreateResult,
  PtahCliUpdateParams,
  PtahCliUpdateResult,
  PtahCliDeleteParams,
  PtahCliDeleteResult,
  PtahCliTestConnectionParams,
  PtahCliTestConnectionResult,
  PtahCliListModelsParams,
  PtahCliListModelsResult,
} from '@ptah-extension/shared';

/**
 * RPC handlers for Ptah CLI management operations
 */
@injectable()
export class PtahCliRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(SDK_TOKENS.SDK_PTAH_CLI_REGISTRY)
    private readonly ptahCliRegistry: PtahCliRegistry
  ) {}

  /**
   * Register all Ptah CLI RPC methods
   */
  register(): void {
    this.registerList();
    this.registerCreate();
    this.registerUpdate();
    this.registerDelete();
    this.registerTestConnection();
    this.registerListModels();

    this.logger.debug('Ptah CLI RPC handlers registered', {
      methods: [
        'ptahCli:list',
        'ptahCli:create',
        'ptahCli:update',
        'ptahCli:delete',
        'ptahCli:testConnection',
        'ptahCli:listModels',
      ],
    });
  }

  /**
   * ptahCli:list - List all configured Ptah CLI agents with status
   */
  private registerList(): void {
    this.rpcHandler.registerMethod<PtahCliListParams, PtahCliListResult>(
      'ptahCli:list',
      async () => {
        try {
          this.logger.debug('RPC: ptahCli:list called');

          const agents = await this.ptahCliRegistry.listAgents();

          this.logger.debug('RPC: ptahCli:list success', {
            agentCount: agents.length,
          });

          return { agents };
        } catch (error) {
          this.logger.error(
            'RPC: ptahCli:list failed',
            error instanceof Error ? error : new Error(String(error))
          );
          throw error;
        }
      }
    );
  }

  /**
   * ptahCli:create - Create a new Ptah CLI agent configuration
   */
  private registerCreate(): void {
    this.rpcHandler.registerMethod<PtahCliCreateParams, PtahCliCreateResult>(
      'ptahCli:create',
      async (params) => {
        try {
          this.logger.debug('RPC: ptahCli:create called', {
            name: params.name,
            providerId: params.providerId,
          });

          const agent = await this.ptahCliRegistry.createAgent(
            params.name,
            params.providerId,
            params.apiKey
          );

          this.logger.info('RPC: ptahCli:create success', {
            agentId: agent.id,
            name: agent.name,
            providerId: agent.providerId,
          });

          return { success: true, agent };
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            'RPC: ptahCli:create failed',
            error instanceof Error ? error : new Error(errorMessage)
          );
          return { success: false, error: errorMessage };
        }
      }
    );
  }

  /**
   * ptahCli:update - Update an existing Ptah CLI agent configuration
   */
  private registerUpdate(): void {
    this.rpcHandler.registerMethod<PtahCliUpdateParams, PtahCliUpdateResult>(
      'ptahCli:update',
      async (params) => {
        try {
          this.logger.debug('RPC: ptahCli:update called', {
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

          await this.ptahCliRegistry.updateAgent(
            params.id,
            updates,
            params.apiKey
          );

          this.logger.info('RPC: ptahCli:update success', {
            id: params.id,
          });

          return { success: true };
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            'RPC: ptahCli:update failed',
            error instanceof Error ? error : new Error(errorMessage)
          );
          return { success: false, error: errorMessage };
        }
      }
    );
  }

  /**
   * ptahCli:delete - Delete a Ptah CLI agent configuration
   */
  private registerDelete(): void {
    this.rpcHandler.registerMethod<PtahCliDeleteParams, PtahCliDeleteResult>(
      'ptahCli:delete',
      async (params) => {
        try {
          this.logger.debug('RPC: ptahCli:delete called', {
            id: params.id,
          });

          await this.ptahCliRegistry.deleteAgent(params.id);

          this.logger.info('RPC: ptahCli:delete success', {
            id: params.id,
          });

          return { success: true };
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            'RPC: ptahCli:delete failed',
            error instanceof Error ? error : new Error(errorMessage)
          );
          return { success: false, error: errorMessage };
        }
      }
    );
  }

  /**
   * ptahCli:testConnection - Test connection to a Ptah CLI agent's provider
   *
   * Performs a minimal API call to validate the API key and provider connectivity.
   */
  private registerTestConnection(): void {
    this.rpcHandler.registerMethod<
      PtahCliTestConnectionParams,
      PtahCliTestConnectionResult
    >('ptahCli:testConnection', async (params) => {
      try {
        this.logger.debug('RPC: ptahCli:testConnection called', {
          id: params.id,
        });

        const result = await this.ptahCliRegistry.testConnection(params.id);

        this.logger.info('RPC: ptahCli:testConnection result', {
          id: params.id,
          success: result.success,
          latencyMs: result.latencyMs,
        });

        return result;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          'RPC: ptahCli:testConnection failed',
          error instanceof Error ? error : new Error(errorMessage)
        );
        return { success: false, error: errorMessage };
      }
    });
  }

  /**
   * ptahCli:listModels - List available models for a Ptah CLI agent's provider
   *
   * Returns static model list from the provider registry. For providers with
   * dynamic model APIs (e.g., OpenRouter), uses the static models as the list
   * since dynamic model fetching is handled by ProviderModelsService separately.
   */
  private registerListModels(): void {
    this.rpcHandler.registerMethod<
      PtahCliListModelsParams,
      PtahCliListModelsResult
    >('ptahCli:listModels', async (params) => {
      try {
        this.logger.debug('RPC: ptahCli:listModels called', {
          id: params.id,
        });

        // Get the agent's config to find its provider
        const agents = await this.ptahCliRegistry.listAgents();
        const agent = agents.find((a) => a.id === params.id);

        if (!agent) {
          this.logger.warn('RPC: ptahCli:listModels - agent not found', {
            id: params.id,
          });
          return { models: [], isStatic: true, error: 'Agent not found' };
        }

        // Look up provider definition for static models
        const provider = getAnthropicProvider(agent.providerId);

        if (!provider) {
          this.logger.warn('RPC: ptahCli:listModels - provider not found', {
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

        this.logger.debug('RPC: ptahCli:listModels success', {
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
          'RPC: ptahCli:listModels failed',
          error instanceof Error ? error : new Error(errorMessage)
        );
        return { models: [], isStatic: true, error: errorMessage };
      }
    });
  }
}
