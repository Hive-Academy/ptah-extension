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
  SmitheryRegistrySource,
  SmitheryConnectionResolver,
  SmitheryKeyMissingError,
  SmitheryInstalledManifestStore,
  createSmitheryConfigSecretStore,
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
  McpDirectoryResolveSmitheryParams,
  McpDirectoryResolveSmitheryResult,
  McpDirectoryInstallSmitheryParams,
  McpDirectoryInstallSmitheryResult,
  McpDirectoryUninstallSmitheryParams,
  McpDirectoryUninstallSmitheryResult,
  McpDirectoryListSmitheryInstalledParams,
  McpDirectoryListSmitheryInstalledResult,
  McpRegistrySourceKind,
  RpcMethodName,
} from '@ptah-extension/shared';
import {
  SetSmitheryApiKeySchema,
  ResolveSmitherySchema,
  InstallSmitherySchema,
  UninstallSmitherySchema,
  deriveSmitheryServerKey,
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
    'mcpDirectory:resolveSmithery',
    'mcpDirectory:installSmithery',
    'mcpDirectory:uninstallSmithery',
    'mcpDirectory:listSmitheryInstalled',
  ] as const satisfies readonly RpcMethodName[];

  private readonly registryProvider: McpRegistryProvider;
  private readonly smitherySource: SmitheryRegistrySource;
  private readonly smitheryResolver: SmitheryConnectionResolver;
  private readonly smitheryManifest: SmitheryInstalledManifestStore;
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

    const getSmitheryApiKey = async (): Promise<string | null> =>
      (await this.authSecretsService.getProviderKey(
        SMITHERY_API_KEY_SECRET_ID,
      )) ?? null;

    this.smitherySource = new SmitheryRegistrySource({
      getApiKey: getSmitheryApiKey,
      logger: this.logger,
    });
    this.sourceRegistry.register(this.smitherySource);

    this.smitheryResolver = new SmitheryConnectionResolver(
      getSmitheryApiKey,
      this.smitherySource,
    );

    this.smitheryManifest = new SmitheryInstalledManifestStore(
      createSmitheryConfigSecretStore({
        getProviderKey: (id) => this.authSecretsService.getProviderKey(id),
        setProviderKey: (id, value) =>
          this.authSecretsService.setProviderKey(id, value),
        deleteProviderKey: (id) =>
          this.authSecretsService.deleteProviderKey(id),
      }),
    );
  }

  /** Resolve the requested source, defaulting to the official registry. */
  private resolveSource(source: McpRegistrySourceKind | undefined) {
    return (
      this.sourceRegistry.get(source ?? 'official') ?? this.registryProvider
    );
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
    this.registerResolveSmithery();
    this.registerInstallSmithery();
    this.registerUninstallSmithery();
    this.registerListSmitheryInstalled();

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
        'mcpDirectory:resolveSmithery',
        'mcpDirectory:installSmithery',
        'mcpDirectory:uninstallSmithery',
        'mcpDirectory:listSmitheryInstalled',
      ],
    });
  }

  private registerSearch(): void {
    this.rpcHandler.registerMethod<
      McpDirectorySearchParams,
      McpDirectorySearchResult
    >('mcpDirectory:search', async (params) => {
      try {
        this.logger.debug('RPC: mcpDirectory:search', {
          query: params.query,
          source: params.source ?? 'official',
        });

        const source = this.resolveSource(params.source);
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
        if (error instanceof SmitheryKeyMissingError) {
          this.logger.warn('RPC: mcpDirectory:search missing Smithery key');
          return { servers: [] };
        }
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
          source: params.source ?? 'official',
        });

        const source = this.resolveSource(params.source);
        const server = await source.getServerDetails(params.name);

        if (!server) {
          return { name: params.name };
        }

        return server;
      } catch (error) {
        if (error instanceof SmitheryKeyMissingError) {
          this.logger.warn('RPC: mcpDirectory:getDetails missing Smithery key');
          return { name: params.name };
        }
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
    >('mcpDirectory:getPopular', async (params) => {
      try {
        this.logger.debug('RPC: mcpDirectory:getPopular', {
          source: params.source ?? 'official',
        });

        const servers =
          params.source === 'smithery'
            ? await this.smitherySource.getPopular()
            : await this.registryProvider.getPopular();
        return { servers };
      } catch (error) {
        if (error instanceof SmitheryKeyMissingError) {
          this.logger.warn('RPC: mcpDirectory:getPopular missing Smithery key');
          return { servers: [] };
        }
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

  /**
   * mcpDirectory:resolveSmithery — resolve a Smithery server + collected config
   * into a session-time `McpHttpConfig`.
   *
   * SECURITY: the resolved URL carries the key/config in its query string and
   * is NEVER logged here or in the resolver.
   */
  private registerResolveSmithery(): void {
    this.rpcHandler.registerMethod<
      McpDirectoryResolveSmitheryParams,
      McpDirectoryResolveSmitheryResult
    >('mcpDirectory:resolveSmithery', async (params) => {
      try {
        const validated = ResolveSmitherySchema.parse(params);
        this.logger.debug('RPC: mcpDirectory:resolveSmithery', {
          qualifiedName: validated.qualifiedName,
        });

        const config = await this.smitheryResolver.resolve({
          qualifiedName: validated.qualifiedName,
          config: validated.config,
          profile: validated.profile,
        });

        return { config };
      } catch (error: unknown) {
        if (error instanceof SmitheryKeyMissingError) {
          this.logger.warn(
            'RPC: mcpDirectory:resolveSmithery missing Smithery key',
          );
          return { error: error.message };
        }
        const err = error instanceof Error ? error : new Error(String(error));
        this.sentryService.captureException(err, {
          errorSource: 'McpDirectoryRpcHandlers.registerResolveSmithery',
        });
        this.logger.error('RPC: mcpDirectory:resolveSmithery failed', err);
        return { error: err.message };
      }
    });
  }

  /**
   * mcpDirectory:installSmithery — record a Smithery install WITHOUT writing a
   * secret-bearing URL to any of the 5 disk config files.
   *
   * SECURITY: the per-server `config` (which may carry credentials) is routed
   * to the encrypted secret store via the manifest. Only non-secret metadata is
   * persisted to `~/.ptah/smithery-installed.json`. The live, secret-bearing
   * connection URL is rebuilt at chat query time into `mcpServersOverride`.
   */
  private registerInstallSmithery(): void {
    this.rpcHandler.registerMethod<
      McpDirectoryInstallSmitheryParams,
      McpDirectoryInstallSmitheryResult
    >('mcpDirectory:installSmithery', async (params) => {
      try {
        const validated = InstallSmitherySchema.parse(params);
        const serverKey =
          validated.serverKey ??
          deriveSmitheryServerKey(validated.qualifiedName);

        this.logger.info('RPC: mcpDirectory:installSmithery', {
          qualifiedName: validated.qualifiedName,
          serverKey,
          hasConfig: Object.keys(validated.config).length > 0,
        });

        await this.smitheryManifest.install({
          qualifiedName: validated.qualifiedName,
          serverKey,
          config: validated.config,
          profile: validated.profile,
        });

        return { success: true, serverKey };
      } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.sentryService.captureException(err, {
          errorSource: 'McpDirectoryRpcHandlers.registerInstallSmithery',
        });
        this.logger.error('RPC: mcpDirectory:installSmithery failed', err);
        return { success: false, error: err.message };
      }
    });
  }

  /**
   * mcpDirectory:uninstallSmithery — remove a Smithery install record and its
   * encrypted config slot.
   */
  private registerUninstallSmithery(): void {
    this.rpcHandler.registerMethod<
      McpDirectoryUninstallSmitheryParams,
      McpDirectoryUninstallSmitheryResult
    >('mcpDirectory:uninstallSmithery', async (params) => {
      try {
        const { serverKey } = UninstallSmitherySchema.parse(params);
        this.logger.info('RPC: mcpDirectory:uninstallSmithery', { serverKey });

        await this.smitheryManifest.uninstall(serverKey);
        return { success: true };
      } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.sentryService.captureException(err, {
          errorSource: 'McpDirectoryRpcHandlers.registerUninstallSmithery',
        });
        this.logger.error('RPC: mcpDirectory:uninstallSmithery failed', err);
        return { success: false, error: err.message };
      }
    });
  }

  /**
   * mcpDirectory:listSmitheryInstalled — list Smithery install records.
   *
   * SECURITY: returns non-secret metadata only (never the config or URL).
   */
  private registerListSmitheryInstalled(): void {
    this.rpcHandler.registerMethod<
      McpDirectoryListSmitheryInstalledParams,
      McpDirectoryListSmitheryInstalledResult
    >('mcpDirectory:listSmitheryInstalled', async () => {
      try {
        const servers = this.smitheryManifest.list();
        return { servers };
      } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.sentryService.captureException(err, {
          errorSource: 'McpDirectoryRpcHandlers.registerListSmitheryInstalled',
        });
        this.logger.error(
          'RPC: mcpDirectory:listSmitheryInstalled failed',
          err,
        );
        return { servers: [] };
      }
    });
  }

  private getWorkspaceRoot(): string | undefined {
    return this.workspaceProvider.getWorkspaceRoot();
  }
}
