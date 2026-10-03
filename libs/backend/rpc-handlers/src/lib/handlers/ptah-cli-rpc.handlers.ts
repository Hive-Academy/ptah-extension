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
 */

import { injectable, inject } from 'tsyringe';
import { Logger, RpcHandler, RpcUserError, TOKENS } from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import { getAnthropicProvider } from '@ptah-extension/agent-sdk';
import {
  CLI_AGENT_RUNTIME_TOKENS,
  PtahCliRegistry,
} from '@ptah-extension/cli-agent-runtime';
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
import type { RpcMethodName } from '@ptah-extension/shared';

/**
 * Fixed client-facing text for each RPC's unexpected-failure catch. A thrown
 * error's message can carry an API key or a local path, so it never goes into
 * the RPC result, the log or Sentry (see `reportFailure`).
 */
const PTAH_CLI_RPC_ERRORS = {
  create: 'Could not create the Ptah CLI agent.',
  update: 'Could not save the Ptah CLI agent.',
  delete: 'Could not delete the Ptah CLI agent.',
  testConnection: 'Could not test the connection.',
  listModels: 'Could not load the model list.',
} as const;

/**
 * RPC handlers for Ptah CLI management operations
 */
@injectable()
export class PtahCliRpcHandlers {
  static readonly METHODS = [
    'ptahCli:list',
    'ptahCli:create',
    'ptahCli:update',
    'ptahCli:delete',
    'ptahCli:testConnection',
    'ptahCli:listModels',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(CLI_AGENT_RUNTIME_TOKENS.SDK_PTAH_CLI_REGISTRY)
    private readonly ptahCliRegistry: PtahCliRegistry,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
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
        } catch (error: unknown) {
          this.reportFailure('ptahCli:list', 'registerList', error);
          if (error instanceof RpcUserError) throw error;
          throw new RpcUserError(
            'Could not load the CLI agents.',
            'PERSISTENCE_UNAVAILABLE',
          );
        }
      },
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
            params.apiKey,
          );

          this.logger.info('RPC: ptahCli:create success', {
            agentId: agent.id,
            name: agent.name,
            providerId: agent.providerId,
          });

          return { success: true, agent };
        } catch (error: unknown) {
          this.reportFailure('ptahCli:create', 'registerCreate', error);
          return { success: false, error: PTAH_CLI_RPC_ERRORS.create };
        }
      },
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
            params.apiKey,
          );

          this.logger.info('RPC: ptahCli:update success', {
            id: params.id,
          });

          return { success: true };
        } catch (error: unknown) {
          this.reportFailure('ptahCli:update', 'registerUpdate', error);
          return { success: false, error: PTAH_CLI_RPC_ERRORS.update };
        }
      },
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
        } catch (error: unknown) {
          this.reportFailure('ptahCli:delete', 'registerDelete', error);
          return { success: false, error: PTAH_CLI_RPC_ERRORS.delete };
        }
      },
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
      } catch (error: unknown) {
        this.reportFailure(
          'ptahCli:testConnection',
          'registerTestConnection',
          error,
        );
        // Only this outer catch is fixed; the registry's own result above
        // keeps its already-sanitized `error` (the UI's `reason`).
        return { success: false, error: PTAH_CLI_RPC_ERRORS.testConnection };
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
        const agents = await this.ptahCliRegistry.listAgents();
        const agent = agents.find((a) => a.id === params.id);

        if (!agent) {
          this.logger.warn('RPC: ptahCli:listModels - agent not found', {
            id: params.id,
          });
          return { models: [], isStatic: true, error: 'Agent not found' };
        }
        const provider = getAnthropicProvider(agent.providerId);

        if (!provider) {
          this.logger.warn('RPC: ptahCli:listModels - provider not found', {
            providerId: agent.providerId,
          });
          return { models: [], isStatic: true, error: 'Provider not found' };
        }
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
      } catch (error: unknown) {
        this.reportFailure('ptahCli:listModels', 'registerListModels', error);
        return {
          models: [],
          isStatic: true,
          error: PTAH_CLI_RPC_ERRORS.listModels,
        };
      }
    });
  }

  /**
   * Log and capture an unexpected failure by error TYPE only. These calls can
   * carry an API key (`ptahCli:create`/`update` take `apiKey`), and a registry
   * or secret-store error can echo it, so the message never reaches the log
   * or Sentry (the auth handlers' `keyStoreReadFailure` rule).
   */
  private reportFailure(method: string, source: string, error: unknown): void {
    const errorType = error instanceof Error ? error.name : 'unknown';
    this.logger.error(`RPC: ${method} failed`, { errorType });
    this.sentryService.captureException(
      new Error(`${method} failed (${errorType})`),
      { errorSource: `PtahCliRpcHandlers.${source}` },
    );
  }
}
