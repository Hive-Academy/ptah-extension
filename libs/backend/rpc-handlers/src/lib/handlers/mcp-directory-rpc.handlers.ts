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
 * - mcpDirectory:smitheryAccount - Report the Smithery account + namespaces
 * - mcpDirectory:listSmitheryConnections - List connections in the namespace
 * - mcpDirectory:smitheryConnectionStatus - Report one connection's state
 * - mcpDirectory:openSmitherySetup - Open the browser authorization step
 *
 * Lifted from
 * `apps/ptah-extension-vscode/src/services/rpc/handlers/` so all three apps
 * (VS Code, Electron, CLI) consume it via `registerAllRpcHandlers()`.
 * Replaced `vscode.workspace.workspaceFolders` with `IWorkspaceProvider`
 * (PLATFORM_TOKENS.WORKSPACE_PROVIDER) for platform parity.
 */

import { injectable, inject } from 'tsyringe';
import type { DependencyContainer } from 'tsyringe';
import {
  Logger,
  RpcHandler,
  TOKENS,
  IAuthSecretsService,
} from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import {
  HARNESS_SYNC_TOKENS,
  type HarnessReconcilerService,
} from '@ptah-extension/harness-sync';
import type {
  IWorkspaceProvider,
  IUserInteraction,
  IHttpServerProvider,
  IOAuthCallbackListener,
} from '@ptah-extension/platform-core';
import {
  McpRegistryProvider,
  McpRegistrySourceRegistry,
  McpInstallService,
  SmitheryRegistrySource,
  SmitheryConnectionResolver,
  SmitheryKeyMissingError,
  SmitheryInstalledManifestStore,
  createSmitheryConfigSecretStore,
  SmitheryConnectionsClient,
  SmitheryApiError,
  buildPtahConnectionMetadata,
  McpOAuthService,
  McpOAuthInstalledManifestStore,
  createMcpOAuthTokenStore,
  OAuthDiscoveryError,
  OAUTH_DISCOVERY_ERROR_NAME,
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
  McpDirectorySmitheryAccountParams,
  McpDirectorySmitheryAccountResult,
  McpDirectoryListSmitheryConnectionsParams,
  McpDirectoryListSmitheryConnectionsResult,
  McpDirectorySmitheryConnectionStatusParams,
  McpDirectorySmitheryConnectionStatusResult,
  McpDirectoryOpenSmitherySetupParams,
  McpDirectoryOpenSmitherySetupResult,
  SmitheryConnectionSummary,
  SmitheryConnectionStatus,
  SmitheryInstalledRecord,
  McpDirectoryConnectOAuthParams,
  McpDirectoryConnectOAuthResult,
  McpDirectoryProbeOAuthDiscoveryParams,
  McpDirectoryProbeOAuthDiscoveryResult,
  McpOAuthFailureReason,
  McpDirectoryOAuthStatusParams,
  McpDirectoryOAuthStatusResult,
  McpDirectoryDisconnectOAuthParams,
  McpDirectoryDisconnectOAuthResult,
  McpDirectoryListOAuthConnectedParams,
  McpDirectoryListOAuthConnectedResult,
  McpDirectoryGetOAuthRedirectUriParams,
  McpDirectoryGetOAuthRedirectUriResult,
  McpRegistrySourceKind,
  RpcMethodName,
} from '@ptah-extension/shared';
import {
  SetSmitheryApiKeySchema,
  ResolveSmitherySchema,
  InstallSmitherySchema,
  UninstallSmitherySchema,
  SmitheryServerKeySchema,
  deriveSmitheryConnectionId,
  ConnectOAuthSchema,
  ProbeOAuthDiscoverySchema,
  OAuthStatusSchema,
  DisconnectOAuthSchema,
  deriveSmitheryServerKey,
  SMITHERY_API_KEY_SECRET_ID,
} from './mcp-directory-rpc.schema';

/** How long the resolved Smithery namespace is trusted without a re-fetch. */
const NAMESPACE_CACHE_TTL_MS = 10 * 60 * 1000;

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
    'mcpDirectory:smitheryAccount',
    'mcpDirectory:listSmitheryConnections',
    'mcpDirectory:smitheryConnectionStatus',
    'mcpDirectory:openSmitherySetup',
    'mcpDirectory:connectOAuth',
    'mcpDirectory:probeOAuthDiscovery',
    'mcpDirectory:oauthStatus',
    'mcpDirectory:disconnectOAuth',
    'mcpDirectory:listOAuthConnected',
    'mcpDirectory:getOAuthRedirectUri',
  ] as const satisfies readonly RpcMethodName[];

  private readonly registryProvider: McpRegistryProvider;
  private readonly smitherySource: SmitheryRegistrySource;
  private readonly smitheryResolver: SmitheryConnectionResolver;
  private readonly smitheryManifest: SmitheryInstalledManifestStore;
  private readonly smitheryConnections: SmitheryConnectionsClient;
  /**
   * The namespace Ptah installs into. `/namespaces` is a network call on a
   * value that changes only when the user changes accounts, so it is cached
   * for {@link NAMESPACE_CACHE_TTL_MS} and dropped by `setSmitheryApiKey`.
   */
  private namespaceCache: { value: string | null; at: number } | null = null;
  private readonly sourceRegistry = new McpRegistrySourceRegistry();
  /**
   * Assigned in the constructor, not here: the reconciler comes from the
   * container, and a field initializer runs before the constructor body has it.
   */
  private readonly installService: McpInstallService;
  private readonly oauthManifest = new McpOAuthInstalledManifestStore();
  private readonly oauthService: McpOAuthService;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
    @inject(TOKENS.AUTH_SECRETS_SERVICE)
    private readonly authSecretsService: IAuthSecretsService,
    @inject(PLATFORM_TOKENS.USER_INTERACTION)
    private readonly userInteraction: IUserInteraction,
    @inject(PLATFORM_TOKENS.HTTP_SERVER_PROVIDER)
    private readonly httpServerProvider: IHttpServerProvider,
    @inject(PLATFORM_TOKENS.DI_CONTAINER)
    container: DependencyContainer,
  ) {
    this.registryProvider = new McpRegistryProvider(this.logger);
    this.sourceRegistry.register(this.registryProvider);

    // Installing an MCP server records an intent and asks the reconciler to
    // apply it; the per-target config writers live behind `IHarnessMcpFacet`
    // (TASK_2026_278 Batch 2). A host without `harness-sync` gets a service
    // that reports a clear error per target rather than a second write path.
    this.installService = new McpInstallService(
      container.isRegistered(HARNESS_SYNC_TOKENS.RECONCILER)
        ? container.resolve<HarnessReconcilerService>(
            HARNESS_SYNC_TOKENS.RECONCILER,
          )
        : null,
    );

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

    this.smitheryConnections = new SmitheryConnectionsClient({
      getApiKey: getSmitheryApiKey,
      logger: this.logger,
    });

    this.smitheryManifest = new SmitheryInstalledManifestStore(
      createSmitheryConfigSecretStore({
        getProviderKey: (id) => this.authSecretsService.getProviderKey(id),
        setProviderKey: (id, value) =>
          this.authSecretsService.setProviderKey(id, value),
        deleteProviderKey: (id) =>
          this.authSecretsService.deleteProviderKey(id),
      }),
    );

    // Optional host-native redirect capture. Selection is purely DI: the VS
    // Code host registers OAUTH_CALLBACK_LISTENER (its URI handler); Electron /
    // CLI leave it unregistered → resolves undefined → McpOAuthService falls
    // back to the loopback. No branching on the host.
    const oauthCallbackListener = container.isRegistered(
      PLATFORM_TOKENS.OAUTH_CALLBACK_LISTENER,
    )
      ? container.resolve<IOAuthCallbackListener>(
          PLATFORM_TOKENS.OAUTH_CALLBACK_LISTENER,
        )
      : undefined;

    // Interactive OAuth service — carries the redirect capture + browser opener
    // so `connect()` can run the authorization-code flow. When the host
    // registers a native callback listener (VS Code URI handler), it overrides
    // the loopback; otherwise the loopback httpServerProvider is used. Tokens
    // are stored via the encrypted provider-key slots, never on disk.
    this.oauthService = new McpOAuthService({
      httpServerProvider: this.httpServerProvider,
      callbackListener: oauthCallbackListener,
      openExternal: (url) => this.userInteraction.openExternal(url),
      tokenStore: createMcpOAuthTokenStore({
        getProviderKey: (id) => this.authSecretsService.getProviderKey(id),
        setProviderKey: (id, value) =>
          this.authSecretsService.setProviderKey(id, value),
        deleteProviderKey: (id) =>
          this.authSecretsService.deleteProviderKey(id),
      }),
      manifest: this.oauthManifest,
      logger: this.logger,
    });
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
    this.registerSmitheryAccount();
    this.registerListSmitheryConnections();
    this.registerSmitheryConnectionStatus();
    this.registerOpenSmitherySetup();
    this.registerConnectOAuth();
    this.registerProbeOAuthDiscovery();
    this.registerOAuthStatus();
    this.registerDisconnectOAuth();
    this.registerListOAuthConnected();
    this.registerGetOAuthRedirectUri();

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
        'mcpDirectory:smitheryAccount',
        'mcpDirectory:listSmitheryConnections',
        'mcpDirectory:smitheryConnectionStatus',
        'mcpDirectory:openSmitherySetup',
        'mcpDirectory:connectOAuth',
        'mcpDirectory:probeOAuthDiscovery',
        'mcpDirectory:oauthStatus',
        'mcpDirectory:disconnectOAuth',
        'mcpDirectory:listOAuthConnected',
        'mcpDirectory:getOAuthRedirectUri',
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

        let servers;
        if (params.source === 'smithery') {
          servers = await this.smitherySource.getPopular();
        } else {
          servers = await this.registryProvider.getPopular();
        }
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

        // A new key can belong to a different account, so the cached namespace
        // is no longer trustworthy.
        this.namespaceCache = null;

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
        const connectionId = deriveSmitheryConnectionId(serverKey);

        this.logger.info('RPC: mcpDirectory:installSmithery', {
          qualifiedName: validated.qualifiedName,
          serverKey,
          connectionId,
          hasConfig: Object.keys(validated.config).length > 0,
        });

        // The Connections API is the path that can actually authorize an
        // upstream provider. When it is unreachable the install is still
        // recorded in its legacy form — losing the install because the network
        // blinked is worse than an install the user has to retry.
        const connection = await this.createSmitheryConnection(
          validated.qualifiedName,
          connectionId,
        );

        await this.smitheryManifest.install({
          qualifiedName: validated.qualifiedName,
          serverKey,
          config: validated.config,
          profile: validated.profile,
          namespace: connection.namespace,
          connectionId: connection.namespace ? connectionId : undefined,
        });

        return {
          success: true,
          serverKey,
          status: connection.status,
          ...(connection.setupUrl ? { setupUrl: connection.setupUrl } : {}),
          ...(connection.namespace
            ? { namespace: connection.namespace, connectionId }
            : {}),
          ...(connection.error ? { error: connection.error } : {}),
        };
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

        const record = this.smitheryManifest.get(serverKey);
        if (record?.namespace && record.connectionId) {
          // Best effort: a connection Smithery still holds costs the user
          // nothing, but a manifest record Ptah cannot remove is a server the
          // user cannot get rid of. Never fail the uninstall on this.
          try {
            await this.smitheryConnections.deleteConnection(
              record.namespace,
              record.connectionId,
            );
          } catch (error: unknown) {
            this.logger.warn(
              'Smithery connection delete failed — removing the local record anyway',
              {
                connectionId: record.connectionId,
                error: error instanceof Error ? error.message : String(error),
              },
            );
          }
        }

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

  /**
   * mcpDirectory:smitheryAccount — report which Smithery account the stored key
   * belongs to.
   *
   * SECURITY: namespace NAMES only. The key never crosses this boundary.
   */
  private registerSmitheryAccount(): void {
    this.rpcHandler.registerMethod<
      McpDirectorySmitheryAccountParams,
      McpDirectorySmitheryAccountResult
    >('mcpDirectory:smitheryAccount', async () => {
      const configured = await this.authSecretsService.hasProviderKey(
        SMITHERY_API_KEY_SECRET_ID,
      );
      if (!configured) {
        return { configured: false, namespaces: [], activeNamespace: null };
      }

      try {
        const namespaces = await this.smitheryConnections.listNamespaces();
        return {
          configured: true,
          namespaces,
          activeNamespace: namespaces[0] ?? null,
        };
      } catch (error: unknown) {
        // A rejected key or an unreachable API is a state the surface must be
        // able to show, not a defect worth an alert.
        const err = error instanceof Error ? error : new Error(String(error));
        this.logger.warn('RPC: mcpDirectory:smitheryAccount failed', {
          error: err.message,
        });
        return {
          configured: true,
          namespaces: [],
          activeNamespace: null,
          error: err.message,
        };
      }
    });
  }

  /**
   * mcpDirectory:listSmitheryConnections — the connections in the active
   * namespace, marked with whether Ptah installed them.
   */
  private registerListSmitheryConnections(): void {
    this.rpcHandler.registerMethod<
      McpDirectoryListSmitheryConnectionsParams,
      McpDirectoryListSmitheryConnectionsResult
    >('mcpDirectory:listSmitheryConnections', async () => {
      try {
        const namespace = await this.getActiveSmitheryNamespace();
        if (!namespace) {
          return { connections: [], namespace: null };
        }

        const connections =
          await this.smitheryConnections.listConnections(namespace);
        const byConnectionId = new Map<string, SmitheryInstalledRecord>(
          this.smitheryManifest
            .list()
            .filter((record) => record.connectionId)
            .map((record) => [record.connectionId as string, record]),
        );

        const summaries: SmitheryConnectionSummary[] = connections.map(
          (connection) => {
            const record = byConnectionId.get(connection.connectionId);
            return {
              connectionId: connection.connectionId,
              name: connection.name,
              ...(connection.server ? { server: connection.server } : {}),
              status: connection.status,
              ...(connection.iconUrl ? { iconUrl: connection.iconUrl } : {}),
              ...(connection.createdAt
                ? { createdAt: connection.createdAt }
                : {}),
              managedByPtah: record !== undefined,
              ...(record ? { serverKey: record.serverKey } : {}),
            };
          },
        );

        return { connections: summaries, namespace };
      } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.logger.warn('RPC: mcpDirectory:listSmitheryConnections failed', {
          error: err.message,
        });
        return { connections: [], namespace: null, error: err.message };
      }
    });
  }

  /**
   * mcpDirectory:smitheryConnectionStatus — the live state of one installed
   * server's connection.
   *
   * SECURITY: `setupUrl` is returned to the renderer so it can offer the
   * Authorize action, and is never logged.
   */
  private registerSmitheryConnectionStatus(): void {
    this.rpcHandler.registerMethod<
      McpDirectorySmitheryConnectionStatusParams,
      McpDirectorySmitheryConnectionStatusResult
    >('mcpDirectory:smitheryConnectionStatus', async (params) => {
      try {
        const { serverKey } = SmitheryServerKeySchema.parse(params);
        const record = this.requireConnectionsApiRecord(serverKey);

        const connection = await this.smitheryConnections.getConnection(
          record.namespace,
          record.connectionId,
        );
        if (!connection) {
          return {
            status: 'unknown',
            error: `Smithery has no connection "${record.connectionId}" in namespace "${record.namespace}"`,
          };
        }

        return {
          status: connection.status,
          ...(connection.setupUrl ? { setupUrl: connection.setupUrl } : {}),
          ...(connection.statusMessage
            ? { error: connection.statusMessage }
            : {}),
        };
      } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.logger.warn('RPC: mcpDirectory:smitheryConnectionStatus failed', {
          error: err.message,
        });
        return { status: 'unknown', error: err.message };
      }
    });
  }

  /**
   * mcpDirectory:openSmitherySetup — start the browser authorization step.
   *
   * A `setupUrl` is single use, so this re-PUTs the connection to obtain a
   * fresh one rather than replaying whatever a previous list returned.
   *
   * SECURITY: the URL is handed to `IUserInteraction.openExternal` and returned
   * to the renderer. It is NEVER logged.
   */
  private registerOpenSmitherySetup(): void {
    this.rpcHandler.registerMethod<
      McpDirectoryOpenSmitherySetupParams,
      McpDirectoryOpenSmitherySetupResult
    >('mcpDirectory:openSmitherySetup', async (params) => {
      try {
        const { serverKey } = SmitheryServerKeySchema.parse(params);
        const record = this.requireConnectionsApiRecord(serverKey);

        this.logger.info('RPC: mcpDirectory:openSmitherySetup', {
          serverKey,
          connectionId: record.connectionId,
        });

        const connection = await this.smitheryConnections.upsertConnection(
          record.namespace,
          record.connectionId,
          {
            server: record.qualifiedName,
            metadata: buildPtahConnectionMetadata(record.qualifiedName),
          },
        );

        if (!connection.setupUrl) {
          return {
            opened: false,
            error:
              connection.status === 'connected'
                ? 'This connection is already authorized'
                : `Smithery reported "${connection.status}" and offered no setup URL`,
          };
        }

        await this.userInteraction.openExternal(connection.setupUrl);
        return { opened: true, setupUrl: connection.setupUrl };
      } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.sentryService.captureException(err, {
          errorSource: 'McpDirectoryRpcHandlers.registerOpenSmitherySetup',
        });
        this.logger.error('RPC: mcpDirectory:openSmitherySetup failed', err);
        return { opened: false, error: err.message };
      }
    });
  }

  /**
   * mcpDirectory:connectOAuth — run the interactive OAuth 2.0 + PKCE flow to
   * connect a remote MCP server. Opens the system browser, catches the loopback
   * redirect, exchanges the code, and stores the tokens encrypted.
   *
   * SECURITY: no token crosses this boundary; only a sanitized error message is
   * returned on failure.
   */
  private registerConnectOAuth(): void {
    this.rpcHandler.registerMethod<
      McpDirectoryConnectOAuthParams,
      McpDirectoryConnectOAuthResult
    >('mcpDirectory:connectOAuth', async (params) => {
      try {
        const input = ConnectOAuthSchema.parse(params);
        this.logger.info('RPC: mcpDirectory:connectOAuth', {
          serverUrl: input.serverUrl,
        });
        const { serverKey } = await this.oauthService.connect({
          serverUrl: input.serverUrl,
          name: input.name,
          serverKey: input.serverKey,
          scope: input.scope,
          clientId: input.clientId,
          clientSecret: input.clientSecret,
        });
        return { success: true, serverKey };
      } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.sentryService.captureException(err, {
          errorSource: 'McpDirectoryRpcHandlers.registerConnectOAuth',
        });
        this.logger.error('RPC: mcpDirectory:connectOAuth failed', err);
        return {
          success: false,
          error: err.message,
          reason: classifyOAuthFailure(err),
        };
      }
    });
  }

  /**
   * mcpDirectory:probeOAuthDiscovery — advisory pre-submit probe.
   *
   * Answers two questions: does this server publish OAuth discovery metadata,
   * and does it support dynamic client registration? It runs the discovery
   * fetches only — no browser, no client registration — so the UI may call it
   * while the user is still typing. A transport failure is reported as
   * `supported: false, reason: 'other'`; the UI treats anything but
   * `'no-oauth-discovery'` as silence.
   */
  private registerProbeOAuthDiscovery(): void {
    this.rpcHandler.registerMethod<
      McpDirectoryProbeOAuthDiscoveryParams,
      McpDirectoryProbeOAuthDiscoveryResult
    >('mcpDirectory:probeOAuthDiscovery', async (params) => {
      try {
        const { serverUrl } = ProbeOAuthDiscoverySchema.parse(params);
        const { dynamicRegistration } =
          await this.oauthService.probeDiscovery(serverUrl);
        return { supported: true, dynamicRegistration };
      } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.logger.debug('RPC: mcpDirectory:probeOAuthDiscovery negative', {
          reason: classifyOAuthFailure(err),
        });
        return { supported: false, reason: classifyOAuthFailure(err) };
      }
    });
  }

  /**
   * mcpDirectory:oauthStatus — report the connection state for a server.
   *
   * SECURITY: returns a state enum only — never a token.
   */
  private registerOAuthStatus(): void {
    this.rpcHandler.registerMethod<
      McpDirectoryOAuthStatusParams,
      McpDirectoryOAuthStatusResult
    >('mcpDirectory:oauthStatus', async (params) => {
      try {
        const { serverKey } = OAuthStatusSchema.parse(params);
        const state = await this.oauthService.status(serverKey);
        return { state };
      } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.sentryService.captureException(err, {
          errorSource: 'McpDirectoryRpcHandlers.registerOAuthStatus',
        });
        this.logger.error('RPC: mcpDirectory:oauthStatus failed', err);
        return { state: 'disconnected' };
      }
    });
  }

  /** mcpDirectory:disconnectOAuth — delete tokens + manifest record. */
  private registerDisconnectOAuth(): void {
    this.rpcHandler.registerMethod<
      McpDirectoryDisconnectOAuthParams,
      McpDirectoryDisconnectOAuthResult
    >('mcpDirectory:disconnectOAuth', async (params) => {
      try {
        const { serverKey } = DisconnectOAuthSchema.parse(params);
        this.logger.info('RPC: mcpDirectory:disconnectOAuth', { serverKey });
        await this.oauthService.disconnect(serverKey);
        return { success: true };
      } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.sentryService.captureException(err, {
          errorSource: 'McpDirectoryRpcHandlers.registerDisconnectOAuth',
        });
        this.logger.error('RPC: mcpDirectory:disconnectOAuth failed', err);
        return { success: false, error: err.message };
      }
    });
  }

  /**
   * mcpDirectory:listOAuthConnected — list connected servers.
   *
   * SECURITY: returns non-secret metadata only (never tokens).
   */
  private registerListOAuthConnected(): void {
    this.rpcHandler.registerMethod<
      McpDirectoryListOAuthConnectedParams,
      McpDirectoryListOAuthConnectedResult
    >('mcpDirectory:listOAuthConnected', async () => {
      try {
        return { servers: this.oauthManifest.list() };
      } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.sentryService.captureException(err, {
          errorSource: 'McpDirectoryRpcHandlers.registerListOAuthConnected',
        });
        this.logger.error('RPC: mcpDirectory:listOAuthConnected failed', err);
        return { servers: [] };
      }
    });
  }

  /**
   * mcpDirectory:getOAuthRedirectUri — the redirect URL this host will hand to
   * an authorization server on the next connect.
   *
   * The UI shows it so a user can register it with a provider that has no
   * dynamic client registration. Host-dependent and computed without arming a
   * listener or binding a port.
   *
   * A failure is NOT sent to Sentry: a headless host registers no callback
   * listener and no HTTP provider, so "this host cannot run an interactive
   * OAuth flow" is a legitimate answer rather than a defect.
   */
  private registerGetOAuthRedirectUri(): void {
    this.rpcHandler.registerMethod<
      McpDirectoryGetOAuthRedirectUriParams,
      McpDirectoryGetOAuthRedirectUriResult
    >('mcpDirectory:getOAuthRedirectUri', async () => {
      try {
        const redirectUri = await this.oauthService.describeRedirectUri();
        return { redirectUri };
      } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.logger.warn('RPC: mcpDirectory:getOAuthRedirectUri unavailable', {
          error: err.message,
        });
        return { redirectUri: null, error: err.message };
      }
    });
  }

  /**
   * The namespace Ptah installs into: the first entry of `/namespaces`.
   * Cached for {@link NAMESPACE_CACHE_TTL_MS} and dropped by
   * `setSmitheryApiKey`, because the value changes only when the account does.
   */
  private async getActiveSmitheryNamespace(): Promise<string | null> {
    const cached = this.namespaceCache;
    if (cached && Date.now() - cached.at < NAMESPACE_CACHE_TTL_MS) {
      return cached.value;
    }

    const namespaces = await this.smitheryConnections.listNamespaces();
    const value = namespaces[0] ?? null;
    this.namespaceCache = { value, at: Date.now() };
    return value;
  }

  /**
   * Create (or refresh) the Smithery connection for an install.
   *
   * Never throws: the caller records the install either way, and a returned
   * `error` with `status: 'unknown'` is what lets the surface say the server
   * was installed but not connected.
   */
  private async createSmitheryConnection(
    qualifiedName: string,
    connectionId: string,
  ): Promise<{
    namespace?: string;
    status: SmitheryConnectionStatus;
    setupUrl?: string;
    error?: string;
  }> {
    try {
      const namespace = await this.getActiveSmitheryNamespace();
      if (!namespace) {
        return {
          status: 'unknown',
          error:
            'No Smithery namespace is available for this API key — the server was recorded but is not connected',
        };
      }

      const connection = await this.smitheryConnections.upsertConnection(
        namespace,
        connectionId,
        {
          server: qualifiedName,
          metadata: buildPtahConnectionMetadata(qualifiedName),
        },
      );

      return {
        namespace,
        status: connection.status,
        setupUrl: connection.setupUrl,
      };
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn(
        'Smithery connection create failed — recording a legacy install',
        {
          connectionId,
          status: error instanceof SmitheryApiError ? error.status : undefined,
          error: err.message,
        },
      );
      return { status: 'unknown', error: err.message };
    }
  }

  /**
   * The install record for a serverKey, narrowed to one that carries both a
   * namespace and a connection id. A legacy record cannot answer a Connections
   * API question, and saying so beats reporting a made-up state.
   */
  private requireConnectionsApiRecord(
    serverKey: string,
  ): SmitheryInstalledRecord & { namespace: string; connectionId: string } {
    const record = this.smitheryManifest.get(serverKey);
    if (!record) {
      throw new Error(`No Smithery install record for "${serverKey}"`);
    }
    if (!record.namespace || !record.connectionId) {
      throw new Error(
        `"${serverKey}" was installed before Ptah used Smithery connections — remove it and install it again`,
      );
    }
    return record as SmitheryInstalledRecord & {
      namespace: string;
      connectionId: string;
    };
  }

  private getWorkspaceRoot(): string | undefined {
    return this.workspaceProvider.getWorkspaceRoot();
  }
}

/**
 * Classify an OAuth failure for the wire.
 *
 * `instanceof` first, `name` second: an error that crossed a bundle boundary or
 * a `structuredClone` keeps its `name` but loses its prototype. Never match on
 * the message — the message is user-facing copy and free to change.
 */
function classifyOAuthFailure(error: Error): McpOAuthFailureReason {
  return error instanceof OAuthDiscoveryError ||
    error.name === OAUTH_DISCOVERY_ERROR_NAME
    ? 'no-oauth-discovery'
    : 'other';
}
