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
import {
  Logger,
  RpcHandler,
  TOKENS,
  IAuthSecretsService,
} from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  McpRegistryProvider,
  McpRegistrySourceRegistry,
  McpInstallService,
} from '@ptah-extension/cli-agent-runtime';
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
  McpDirectorySetSmitheryApiKeyParams,
  McpDirectorySetSmitheryApiKeyResult,
  McpDirectoryGetSmitheryKeyStatusParams,
  McpDirectoryGetSmitheryKeyStatusResult,
  RpcMethodName,
} from '@ptah-extension/shared';
import {
  SetSmitheryApiKeySchema,
  SMITHERY_API_KEY_SECRET_ID,
} from './mcp-directory-rpc.schema';

@injectable()
export class McpDirectoryRpcHandlers {
  static readonly METHODS = [
    'mcpDirectory:search',
    'mcpDirectory:getDetails',
    'mcpDirectory:install',
    'mcpDirectory:uninstall',
    'mcpDirectory:listInstalled',
    'mcpDirectory:getPopular',
    'mcpDirectory:setSmitheryApiKey',
    'mcpDirectory:getSmitheryKeyStatus',
  ] as const satisfies readonly RpcMethodName[];

  private readonly registryProvider: McpRegistryProvider;
  private readonly sourceRegistry = new McpRegistrySourceRegistry();
  private readonly installService = new McpInstallService();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
    @inject(TOKENS.AUTH_SECRETS_SERVICE)
    private readonly authSecretsService: IAuthSecretsService,
  ) {
    this.registryProvider = new McpRegistryProvider(this.logger);
    this.sourceRegistry.register(this.registryProvider);
  }

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
    this.registerSetSmitheryApiKey();
    this.registerGetSmitheryKeyStatus();

    this.logger.debug('MCP Directory RPC handlers registered', {
      methods: [
        'mcpDirectory:search',
        'mcpDirectory:getDetails',
        'mcpDirectory:install',
        'mcpDirectory:uninstall',
        'mcpDirectory:listInstalled',
        'mcpDirectory:getPopular',
        'mcpDirectory:setSmitheryApiKey',
        'mcpDirectory:getSmitheryKeyStatus',
      ],
    });
  }

  private registerSearch(): void {
    this.rpcHandler.registerMethod<
      McpDirectorySearchParams,
      McpDirectorySearchResult
    >('mcpDirectory:search', async (params) => {
      try {
        this.logger.debug('RPC: mcpDirectory:search', { query: params.query });

        const source =
          this.sourceRegistry.get('official') ?? this.registryProvider;
        const result = await source.listServers({
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

  private registerGetDetails(): void {
    this.rpcHandler.registerMethod<
      McpDirectoryGetDetailsParams,
      McpDirectoryGetDetailsResult
    >('mcpDirectory:getDetails', async (params) => {
      try {
        this.logger.debug('RPC: mcpDirectory:getDetails', {
          name: params.name,
        });

        const source =
          this.sourceRegistry.get('official') ?? this.registryProvider;
        const server = await source.getServerDetails(params.name);

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
        this.logger.error(
          'RPC: mcpDirectory:getPopular failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        return { servers: [] };
      }
    });
  }

  /**
   * mcpDirectory:setSmitheryApiKey — store (or clear) the Smithery API key in
   * encrypted secret storage.
   *
   * SECURITY: the key is written through `IAuthSecretsService` (encrypted,
   * backend-only). It is never echoed back to the renderer, never logged, and
   * never written to disk config files. An empty / whitespace value clears it.
   */
  private registerSetSmitheryApiKey(): void {
    this.rpcHandler.registerMethod<
      McpDirectorySetSmitheryApiKeyParams,
      McpDirectorySetSmitheryApiKeyResult
    >('mcpDirectory:setSmitheryApiKey', async (params) => {
      try {
        const { apiKey } = SetSmitheryApiKeySchema.parse(params);
        const trimmed = apiKey.trim();

        if (trimmed.length > 0) {
          await this.authSecretsService.setProviderKey(
            SMITHERY_API_KEY_SECRET_ID,
            trimmed,
          );
          this.logger.info('RPC: mcpDirectory:setSmitheryApiKey stored key');
        } else {
          await this.authSecretsService.deleteProviderKey(
            SMITHERY_API_KEY_SECRET_ID,
          );
          this.logger.info('RPC: mcpDirectory:setSmitheryApiKey cleared key');
        }

        return { success: true };
      } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.sentryService.captureException(err, {
          errorSource: 'McpDirectoryRpcHandlers.registerSetSmitheryApiKey',
        });
        this.logger.error('RPC: mcpDirectory:setSmitheryApiKey failed', err);
        return {
          success: false,
          error: err.message,
        };
      }
    });
  }

  /**
   * mcpDirectory:getSmitheryKeyStatus — report whether a Smithery key is
   * configured.
   *
   * SECURITY: returns a boolean only; the key value never crosses this
   * boundary to the renderer.
   */
  private registerGetSmitheryKeyStatus(): void {
    this.rpcHandler.registerMethod<
      McpDirectoryGetSmitheryKeyStatusParams,
      McpDirectoryGetSmitheryKeyStatusResult
    >('mcpDirectory:getSmitheryKeyStatus', async () => {
      try {
        const configured = await this.authSecretsService.hasProviderKey(
          SMITHERY_API_KEY_SECRET_ID,
        );
        return { configured };
      } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.sentryService.captureException(err, {
          errorSource: 'McpDirectoryRpcHandlers.registerGetSmitheryKeyStatus',
        });
        this.logger.error('RPC: mcpDirectory:getSmitheryKeyStatus failed', err);
        return { configured: false };
      }
    });
  }

  private getWorkspaceRoot(): string | undefined {
    return this.workspaceProvider.getWorkspaceRoot();
  }
}
