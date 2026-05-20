/**
 * Autocomplete RPC Handlers
 *
 * Handles autocomplete-related RPC methods: autocomplete:agents, autocomplete:commands.
 * Uses AgentDiscoveryService and CommandDiscoveryService for discovery.
 */

import { injectable, inject } from 'tsyringe';
import { Logger, RpcHandler, TOKENS } from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import {
  AutocompleteAgentsParams,
  AutocompleteCommandsParams,
} from '@ptah-extension/shared';
import type { RpcMethodName } from '@ptah-extension/shared';

interface AgentDiscoveryService {
  searchAgents(request: {
    query: string;
    maxResults?: number;
  }): Promise<unknown>;
}

interface CommandDiscoveryService {
  searchCommands(request: {
    query: string;
    maxResults?: number;
  }): Promise<unknown>;
}

/**
 * RPC handlers for autocomplete operations
 */
@injectable()
export class AutocompleteRpcHandlers {
  static readonly METHODS = [
    'autocomplete:agents',
    'autocomplete:commands',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(TOKENS.AGENT_DISCOVERY_SERVICE)
    private readonly agentDiscovery: AgentDiscoveryService,
    @inject(TOKENS.COMMAND_DISCOVERY_SERVICE)
    private readonly commandDiscovery: CommandDiscoveryService,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
  ) {}

  /**
   * Register all autocomplete RPC methods
   */
  register(): void {
    this.registerAgents();
    this.registerCommands();

    this.logger.debug('Autocomplete RPC handlers registered', {
      methods: ['autocomplete:agents', 'autocomplete:commands'],
    });
  }

  /**
   * autocomplete:agents - Search for agents
   */
  private registerAgents(): void {
    this.rpcHandler.registerMethod<AutocompleteAgentsParams, unknown>(
      'autocomplete:agents',
      async (params) => {
        try {
          const { query, maxResults } = params;
          this.logger.debug('RPC: autocomplete:agents called', {
            query,
            maxResults,
          });
          const result = await this.agentDiscovery.searchAgents({
            query: query || '',
            maxResults,
          });
          return result;
        } catch (error) {
          this.logger.error(
            'RPC: autocomplete:agents failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          this.sentryService.captureException(
            error instanceof Error ? error : new Error(String(error)),
            { errorSource: 'AutocompleteRpcHandlers.registerAgents' },
          );
          throw new Error(
            `Failed to search agents: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      },
    );
  }

  /**
   * autocomplete:commands - Search for commands
   */
  private registerCommands(): void {
    this.rpcHandler.registerMethod<AutocompleteCommandsParams, unknown>(
      'autocomplete:commands',
      async (params) => {
        try {
          const { query, maxResults } = params;
          this.logger.debug('RPC: autocomplete:commands called', {
            query,
            maxResults,
          });
          const result = await this.commandDiscovery.searchCommands({
            query: query || '',
            maxResults,
          });
          return result;
        } catch (error) {
          this.logger.error(
            'RPC: autocomplete:commands failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          this.sentryService.captureException(
            error instanceof Error ? error : new Error(String(error)),
            { errorSource: 'AutocompleteRpcHandlers.registerCommands' },
          );
          throw new Error(
            `Failed to search commands: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      },
    );
  }
}
