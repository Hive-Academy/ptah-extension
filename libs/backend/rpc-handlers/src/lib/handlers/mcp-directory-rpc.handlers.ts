/**
 * MCP Server Directory RPC Handlers
 *
 * Handles MCP server discovery and installation RPC methods:
 * - mcpDirectory:search - Search the Official MCP Registry
 * - mcpDirectory:getDetails - Get detailed server info
 * - mcpDirectory:install - Install server to CLI/IDE targets
 * - mcpDirectory:uninstall - Remove server from targets
 * - mcpDirectory:listInstalled - List all installed MCP servers
 * - mcpDirectory:getPopular - Get popular/trending servers (cached)
 *
 * Lifted from
 * `apps/ptah-extension-vscode/src/services/rpc/handlers/` so all three apps
 * (VS Code, Electron, CLI) consume it via `registerAllRpcHandlers()`.
 * Replaced `vscode.workspace.workspaceFolders` with `IWorkspaceProvider`
 * (PLATFORM_TOKENS.WORKSPACE_PROVIDER) for platform parity.
 */

import { injectable, inject } from 'tsyringe';
import { Logger, RpcHandler, TOKENS } from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  McpRegistryProvider,
  McpInstallService,
} from '@ptah-extension/agent-sdk';
import type {
  McpDirectorySearchParams,
  McpDirectorySearchResult,
  McpDirectoryGetDetailsParams,
  McpDirectoryGetDetailsResult,
  McpDirectoryInstallParams,
  McpDirectoryInstallResult,
  McpDirectoryUninstallParams,
  McpDirectoryUninstallResult,
  McpDirectoryListInstalledParams,
  McpDirectoryListInstalledResult,
  McpDirectoryGetPopularParams,
  McpDirectoryGetPopularResult,
  RpcMethodName,
} from '@ptah-extension/shared';

@injectable()
export class McpDirectoryRpcHandlers {
  static readonly METHODS = [
    'mcpDirectory:search',
    'mcpDirectory:getDetails',
    'mcpDirectory:install',
    'mcpDirectory:uninstall',
    'mcpDirectory:listInstalled',
    'mcpDirectory:getPopular',
  ] as const satisfies readonly RpcMethodName[];

  private readonly registryProvider = new McpRegistryProvider();
  private readonly installService = new McpInstallService();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
  ) {}

  /**
   * Register all MCP Directory RPC methods
   */
  register(): void {
    this.registerSearch();
    this.registerGetDetails();
    this.registerInstall();
    this.registerUninstall();
    this.registerListInstalled();
    this.registerGetPopular();

    this.logger.debug('MCP Directory RPC handlers registered', {
      methods: [
        'mcpDirectory:search',
        'mcpDirectory:getDetails',
        'mcpDirectory:install',
        'mcpDirectory:uninstall',
        'mcpDirectory:listInstalled',
        'mcpDirectory:getPopular',
      ],
    });
  }

  // ─── RPC Method: mcpDirectory:search ───

  private registerSearch(): void {
    this.rpcHandler.registerMethod<
      McpDirectorySearchParams,
      McpDirectorySearchResult
    >('mcpDirectory:search', async (params) => {
      try {
        this.logger.debug('RPC: mcpDirectory:search', { query: params.query });

        const result = await this.registryProvider.listServers({
          query: params.query,
          limit: params.limit,
          cursor: params.cursor,
        });

        return {
          servers: result.servers,
          nextCursor: result.next_cursor,
        };
      } catch (error) {
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'McpDirectoryRpcHandlers.registerSearch' },
        );
        this.logger.error('RPC: mcpDirectory:search failed', {
          error: String(error),
        });
        return { servers: [] };
      }
    });
  }

  // ─── RPC Method: mcpDirectory:getDetails ───

  private registerGetDetails(): void {
    this.rpcHandler.registerMethod<
      McpDirectoryGetDetailsParams,
      McpDirectoryGetDetailsResult
    >('mcpDirectory:getDetails', async (params) => {
      try {
        this.logger.debug('RPC: mcpDirectory:getDetails', {
          name: params.name,
        });

        const server = await this.registryProvider.getServerDetails(
          params.name,
        );

        if (!server) {
          return { name: params.name };
        }

        return server;
      } catch (error) {
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'McpDirectoryRpcHandlers.registerGetDetails' },
        );
        this.logger.error('RPC: mcpDirectory:getDetails failed', {
          error: String(error),
        });
        return { name: params.name };
      }
    });
  }

  // ─── RPC Method: mcpDirectory:install ───

  private registerInstall(): void {
    this.rpcHandler.registerMethod<
      McpDirectoryInstallParams,
      McpDirectoryInstallResult
    >('mcpDirectory:install', async (params) => {
      try {
        this.logger.info('RPC: mcpDirectory:install', {
          serverName: params.serverName,
          serverKey: params.serverKey,
          targets: params.targets,
          configType: params.config.type,
        });

        const workspaceRoot = this.getWorkspaceRoot();

        const results = await this.installService.install(
          params.serverName,
          params.serverKey,
          params.config,
          params.targets,
          workspaceRoot,
        );

        const successes = results.filter((r) => r.success);
        const failures = results.filter((r) => !r.success);

        if (successes.length > 0) {
          this.logger.info('MCP server installed', {
            serverKey: params.serverKey,
            successTargets: successes.map((r) => r.target),
          });
        }

        if (failures.length > 0) {
          this.logger.warn('MCP server install partial failure', {
            serverKey: params.serverKey,
            failures: failures.map((r) => ({
              target: r.target,
              error: r.error,
            })),
          });
        }

        return { results };
      } catch (error) {
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'McpDirectoryRpcHandlers.registerInstall' },
        );
        this.logger.error('RPC: mcpDirectory:install failed', {
          error: String(error),
        });
        return {
          results: params.targets.map((target) => ({
            target,
            success: false,
            configPath: '',
            error: error instanceof Error ? error.message : String(error),
          })),
        };
      }
    });
  }

  // ─── RPC Method: mcpDirectory:uninstall ───

  private registerUninstall(): void {
    this.rpcHandler.registerMethod<
      McpDirectoryUninstallParams,
      McpDirectoryUninstallResult
    >('mcpDirectory:uninstall', async (params) => {
      try {
        this.logger.info('RPC: mcpDirectory:uninstall', {
          serverKey: params.serverKey,
          targets: params.targets,
        });

        const workspaceRoot = this.getWorkspaceRoot();

        const results = await this.installService.uninstall(
          params.serverKey,
          params.targets,
          workspaceRoot,
        );

        return { results };
      } catch (error) {
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'McpDirectoryRpcHandlers.registerUninstall' },
        );
        this.logger.error('RPC: mcpDirectory:uninstall failed', {
          error: String(error),
        });
        return { results: [] };
      }
    });
  }

  // ─── RPC Method: mcpDirectory:listInstalled ───

  private registerListInstalled(): void {
    this.rpcHandler.registerMethod<
      McpDirectoryListInstalledParams,
      McpDirectoryListInstalledResult
    >('mcpDirectory:listInstalled', async () => {
      try {
        this.logger.debug('RPC: mcpDirectory:listInstalled');

        const workspaceRoot = this.getWorkspaceRoot();
        const servers = await this.installService.listInstalled(workspaceRoot);

        return { servers };
      } catch (error) {
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'McpDirectoryRpcHandlers.registerListInstalled' },
        );
        this.logger.error('RPC: mcpDirectory:listInstalled failed', {
          error: String(error),
        });
        return { servers: [] };
      }
    });
  }

  // ─── RPC Method: mcpDirectory:getPopular ───

  private registerGetPopular(): void {
    this.rpcHandler.registerMethod<
      McpDirectoryGetPopularParams,
      McpDirectoryGetPopularResult
    >('mcpDirectory:getPopular', async () => {
      try {
        this.logger.debug('RPC: mcpDirectory:getPopular');

        const servers = await this.registryProvider.getPopular();
        return { servers };
      } catch (error) {
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'McpDirectoryRpcHandlers.registerGetPopular' },
        );
        this.logger.error('RPC: mcpDirectory:getPopular failed', {
          error: String(error),
        });
        return { servers: [] };
      }
    });
  }

  // ─── Helpers ───

  private getWorkspaceRoot(): string | undefined {
    return this.workspaceProvider.getWorkspaceRoot();
  }
}
