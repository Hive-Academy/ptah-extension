/**
 * Plugin RPC Handlers
 *
 * Handles plugin configuration RPC methods:
 * - plugins:list-available - List bundled + harness-authored plugins with metadata
 * - plugins:get-config - Get per-workspace plugin configuration
 * - plugins:save-config - Save plugin configuration (enabled plugins + disabled
 *   plugins + disabled skills)
 * - plugins:list-skills - Enumerate skills inside the given plugin IDs
 *
 * ...and the external marketplace surface (TASK_2026_270):
 * - plugins:list-marketplaces / :add-marketplace / :remove-marketplace
 * - plugins:browse-marketplace
 * - plugins:install-external / :uninstall-external
 *
 * ...and the local-item guard around them (TASK_2026_701 B12):
 * - plugins:replace-kept-items - replace items a no-dialog action kept
 * - plugins:resolve-config-home - adopt or dismiss a folder's saved settings
 *
 * Every config read and write, and every reconcile, runs for the HARNESS ROOT
 * of the open folder (8.1): a sub-folder workspace configures, mirrors and
 * reconciles the repository it sits in, never a second copy of its own.
 *
 * Activation asymmetry these handlers must preserve: bundled plugins are
 * opt-in via `enabledPluginIds`, harness-authored ones are opt-out via
 * `disabledPluginIds`. External plugins are opt-in like bundled, and a
 * successful install flips them on here — the consent dialog was the decision
 * point, so a second switch would be ceremony. See `PluginSource` in
 * `@ptah-extension/shared`.
 *
 * WHAT THIS FILE MUST NOT DO: decide whether consent was given.
 * `ExternalPluginInstallerService` owns that, and it answers from the plan it
 * minted, not from anything a caller sends. Keep it that way — an `if` here
 * that skips straight to `confirmInstall` would be a silent bypass of the
 * entire consent gate.
 */

import { injectable, inject } from 'tsyringe';
import { SessionId } from '@ptah-extension/shared';
import { CHAT_TOKENS } from '../chat/tokens';
import type { ChatSessionService } from '../chat/session/chat-session.service';
import type { DependencyContainer } from 'tsyringe';
import {
  Logger,
  RpcHandler,
  RpcUserError,
  TOKENS,
} from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import { SDK_TOKENS, PluginLoaderService } from '@ptah-extension/agent-sdk';
import {
  HARNESS_SYNC_TOKENS,
  NO_CLI_DETECTOR,
  resolveHarnessWorkspaceRoot,
  type HarnessPropagationService,
  type HarnessReconcilerService,
  type IHarnessCliDetector,
} from '@ptah-extension/harness-sync';
import { McpInstallService } from '@ptah-extension/cli-agent-runtime';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { CommandDiscoveryService } from '@ptah-extension/workspace-intelligence';
import {
  ExternalPluginInstallerService,
  ExternalPluginStateStore,
  MarketplaceRegistryService,
  PLUGIN_MARKETPLACE_TOKENS,
  PluginMarketplaceError,
  type ConfirmedExternalInstall,
} from '@ptah-extension/plugin-marketplace';
import {
  EXTERNAL_PLUGIN_MCP_TOKEN,
  ExternalPluginMcpService,
  type ExternalMcpOutcome,
} from './external-plugin-mcp.service';
import type {
  HarnessHealth,
  PluginInfo,
  PluginConfigStateWithHome,
  PluginsGetConfigParams,
  PluginSessionNotice,
  PluginSkillEntry,
  ExternalConsentReason,
  ExternalInstallResponse,
  FileDecision,
  KeptItem,
  LibraryPassStatus,
  LocalItemFamily,
  PluginsReplaceKeptItemsResult,
  PluginsResolveConfigHomeResult,
  ExternalMarketplace,
  ExternalMarketplaceBrowseResult,
  ExternalPluginMcpServer,
  ExternalSkillCollision,
  ExternalUninstallResult,
  ListMarketplacesResult,
} from '@ptah-extension/shared';
import type { RpcMethodName } from '@ptah-extension/shared';
import {
  ExternalInstallParamsSchema,
  GetConfigParamsSchema,
  ExternalUninstallParamsSchema,
  MarketplaceBrowseParamsSchema,
  MarketplaceSourceParamsSchema,
  ReplaceKeptItemsParamsSchema,
  ResolveConfigHomeParamsSchema,
} from './plugin-rpc.schema';
import { LocalItemApprovals } from './marketplace/local-item-approvals';
import { InstallLocalItemsService } from './marketplace/install-local-items.service';
import { PluginLocalItemsService } from './marketplace/plugin-local-items.service';

/**
 * The families whose kept reports `plugins:replace-kept-items` may act on: the
 * actions that show no dialog (R1-3, A30). An external install's items are
 * decided in its consent dialog and applied by its own confirm, so an
 * `external` approval id is refused here.
 */
const KEPT_REPORT_FAMILIES: readonly LocalItemFamily[] = [
  'skills-sh',
  'plugin-enable',
  'plugin-agent',
];

/** One reconcile's health and what it means for the Library. */
interface HarnessPassOutcome {
  health: HarnessHealth | null;
  libraryPass: LibraryPassStatus;
}

/**
 * Resolve the MCP installer for external plugins, or build the shipping one.
 *
 * Mirrors how `McpDirectoryRpcHandlers` and `HarnessMcpInstallService` obtain
 * their `McpInstallService`: a host without `harness-sync` gets a service that
 * records intent and reports a clear per-target error, never a second write
 * path into the config files.
 */
function resolveExternalPluginMcpService(
  container: DependencyContainer,
  logger: Logger,
): ExternalPluginMcpService {
  if (container.isRegistered(EXTERNAL_PLUGIN_MCP_TOKEN)) {
    return container.resolve<ExternalPluginMcpService>(
      EXTERNAL_PLUGIN_MCP_TOKEN,
    );
  }

  const reconciler = container.isRegistered(HARNESS_SYNC_TOKENS.RECONCILER)
    ? container.resolve<HarnessReconcilerService>(
        HARNESS_SYNC_TOKENS.RECONCILER,
      )
    : null;
  // The SAME detector the reconciler gates its rival targets on, so "installed"
  // means one thing in this workspace rather than two.
  const detector = container.isRegistered(HARNESS_SYNC_TOKENS.CLI_DETECTOR)
    ? container.resolve<IHarnessCliDetector>(HARNESS_SYNC_TOKENS.CLI_DETECTOR)
    : NO_CLI_DETECTOR;

  return new ExternalPluginMcpService(
    logger,
    new McpInstallService(reconciler),
    detector,
  );
}

/**
 * RPC handlers for plugin configuration operations.
 *
 * Exposes plugin management to the frontend for:
 * - Displaying available plugins in the Plugin Browser modal
 * - Reading per-workspace plugin configuration
 * - Saving user plugin selections
 *
 * Plugin paths are resolved at session start time by ChatRpcHandlers,
 * not by these handlers. These handlers only manage metadata and config.
 */
@injectable()
export class PluginRpcHandlers {
  static readonly METHODS = [
    'plugins:list-available',
    'plugins:get-config',
    'plugins:save-config',
    'plugins:list-skills',
    'plugins:list-marketplaces',
    'plugins:add-marketplace',
    'plugins:remove-marketplace',
    'plugins:browse-marketplace',
    'plugins:install-external',
    'plugins:uninstall-external',
    'plugins:replace-kept-items',
    'plugins:resolve-config-home',
  ] as const satisfies readonly RpcMethodName[];

  /**
   * Installs the MCP servers an external plugin DECLARES.
   *
   * Built from the container rather than injected by token so no host needs a
   * new registration line — the same reason `McpDirectoryRpcHandlers` builds
   * its own `McpInstallService`. A registered {@link EXTERNAL_PLUGIN_MCP_TOKEN}
   * wins, which is how a spec substitutes an installer that does not write to
   * the developer's real `~/.ptah/mcp-installed.json`.
   */
  private readonly externalMcp: ExternalPluginMcpService;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(SDK_TOKENS.SDK_PLUGIN_LOADER)
    private readonly pluginLoader: PluginLoaderService,
    @inject(HARNESS_SYNC_TOKENS.PROPAGATION)
    private readonly harnessPropagation: HarnessPropagationService,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(TOKENS.COMMAND_DISCOVERY_SERVICE)
    private readonly commandDiscovery: CommandDiscoveryService,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
    @inject(PLUGIN_MARKETPLACE_TOKENS.REGISTRY)
    private readonly marketplaceRegistry: MarketplaceRegistryService,
    @inject(PLUGIN_MARKETPLACE_TOKENS.INSTALLER)
    private readonly externalInstaller: ExternalPluginInstallerService,
    /**
     * The consent record, read for the ONE field nothing else in this repo
     * consumed: `mcpServers`. It is the authoritative list of what the user
     * approved, which is exactly the list this handler is allowed to install.
     */
    @inject(PLUGIN_MARKETPLACE_TOKENS.STATE_STORE)
    private readonly externalState: ExternalPluginStateStore,
    @inject(PLATFORM_TOKENS.DI_CONTAINER)
    container: DependencyContainer,
    /** The local-item steps of a plan, a confirm and a save (A17). */
    @inject(PluginLocalItemsService)
    private readonly localItems: PluginLocalItemsService,
    /** Applies replace decisions, each through its own family's route. */
    @inject(InstallLocalItemsService)
    private readonly installLocalItems: InstallLocalItemsService,
    /** Read-only here: which family issued an approval id. */
    @inject(LocalItemApprovals)
    private readonly approvals: LocalItemApprovals,
    @inject(CHAT_TOKENS.SESSION, { isOptional: true })
    private readonly sessionRoots: Pick<
      ChatSessionService,
      'readSessionPolicyRoots'
    > | null = null,
  ) {
    this.externalMcp = resolveExternalPluginMcpService(container, this.logger);
  }

  /**
   * Register all plugin RPC methods
   */
  register(): void {
    this.registerListAvailable();
    this.registerGetConfig();
    this.registerSaveConfig();
    this.registerListSkills();
    this.registerListMarketplaces();
    this.registerAddMarketplace();
    this.registerRemoveMarketplace();
    this.registerBrowseMarketplace();
    this.registerInstallExternal();
    this.registerUninstallExternal();
    this.registerReplaceKeptItems();
    this.registerResolveConfigHome();

    this.logger.debug('Plugin RPC handlers registered', {
      methods: PluginRpcHandlers.METHODS,
    });
  }

  /**
   * plugins:list-available - List every visible plugin with metadata
   *
   * Returns the bundled Ptah Orchestra plugins PLUS one entry per
   * harness-authored `ptah-harness-*` directory, each with names, descriptions,
   * categories, skill/command counts, keywords, and a `source` discriminator.
   * This data is used by the Plugin Browser modal for display and search.
   */
  private registerListAvailable(): void {
    this.rpcHandler.registerMethod<
      Record<string, never>,
      { plugins: PluginInfo[] }
    >('plugins:list-available', async () => {
      try {
        this.logger.debug('RPC: plugins:list-available called');

        const plugins = this.pluginLoader.getAvailablePlugins();

        this.logger.debug('RPC: plugins:list-available success', {
          pluginCount: plugins.length,
        });

        return { plugins };
      } catch (error) {
        this.logger.error(
          'RPC: plugins:list-available failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'PluginRpcHandlers.registerListAvailable' },
        );
        throw error;
      }
    });
  }

  /**
   * plugins:get-config - Get per-workspace plugin configuration
   *
   * Returns the plugin configuration of the open folder's harness root,
   * including enabled plugin IDs and the last update timestamp, and the
   * config-home notice (D14) when one applies. Returns default empty config
   * if no configuration has been saved.
   */
  private registerGetConfig(): void {
    this.rpcHandler.registerMethod<
      PluginsGetConfigParams,
      PluginConfigStateWithHome
    >('plugins:get-config', async (params) => {
      let config: PluginConfigStateWithHome;
      try {
        this.logger.debug('RPC: plugins:get-config called');

        const harnessRoot = this.harnessRoot();
        const body = this.pluginLoader.getWorkspacePluginConfig(
          this.configRoot(harnessRoot),
        );
        const configHome =
          harnessRoot === undefined
            ? null
            : this.pluginLoader.getConfigHomeStatus(harnessRoot);

        this.logger.debug('RPC: plugins:get-config success', {
          enabledCount: body.enabledPluginIds.length,
          lastUpdated: body.lastUpdated,
          configHome: configHome?.state,
        });

        config = configHome === null ? body : { ...body, configHome };
      } catch (error) {
        this.logger.error(
          'RPC: plugins:get-config failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'PluginRpcHandlers.registerGetConfig' },
        );
        throw error;
      }
      const sessionNotice = await this.sessionNoticeFor(params);
      return sessionNotice ? { ...config, sessionNotice } : config;
    });
  }

  private async sessionNoticeFor(
    params: PluginsGetConfigParams,
  ): Promise<PluginSessionNotice | undefined> {
    if (params?.sessionId === undefined) return undefined;
    const parsed = GetConfigParamsSchema.safeParse(params);
    if (!parsed.success) {
      this.logger.warn('RPC: plugins:get-config invalid session hint', {
        issuePaths: parsed.error.issues.map((issue) => issue.path.join('.')),
      });
      return undefined;
    }
    if (!this.sessionRoots) return undefined;
    const projectRoot = this.harnessRoot();
    if (projectRoot === undefined) return undefined;
    try {
      const { folder, ancestorRoots } =
        await this.sessionRoots.readSessionPolicyRoots(
          SessionId.from(parsed.data.sessionId!),
        );
      return (
        this.pluginLoader.getSessionPluginNotice(
          folder,
          ancestorRoots,
          projectRoot,
        ) ?? undefined
      );
    } catch (error) {
      // degradation-audit: reported — logged below; the notice is optional,
      // so plugins:get-config still returns the project configuration.
      if (error instanceof RpcUserError) {
        this.logger.debug(
          'RPC: plugins:get-config session notice unavailable',
          {
            code: error.errorCode,
          },
        );
      } else {
        this.logger.warn(
          'RPC: plugins:get-config session notice failed',
          error instanceof Error ? error : new Error(String(error)),
        );
      }
      return undefined;
    }
  }

  /**
   * plugins:save-config - Save plugin configuration
   *
   * Persists the user's plugin selection and disabled skills to workspace state.
   * Re-creates skill junctions immediately so changes take effect without restart.
   *
   * @param params.enabledPluginIds - Array of plugin IDs to enable
   * @param params.disabledSkillIds - Array of skill IDs to disable (optional, preserves existing if omitted)
   * @param params.disabledPluginIds - Array of default-enabled (harness) plugin IDs to disable
   *   (optional, preserves existing if omitted)
   * @returns Success status with optional error message, the local items the
   *   newly enabled plugins left as the user's (`kept`), and `libraryPass:
   *   'failed'` when the reconcile after a successful save did not complete.
   *   A failed save returns the error and no kept report (8.10).
   */
  private registerSaveConfig(): void {
    this.rpcHandler.registerMethod<
      {
        enabledPluginIds: string[];
        disabledSkillIds?: string[];
        disabledPluginIds?: string[];
      },
      {
        success: boolean;
        error?: string;
        kept?: KeptItem[];
        libraryPass?: LibraryPassStatus;
      }
    >('plugins:save-config', async (params) => {
      try {
        const harnessRoot = this.harnessRoot();
        const configRoot = this.configRoot(harnessRoot);
        const existingConfig =
          this.pluginLoader.getWorkspacePluginConfig(configRoot);
        const rawIds = params?.enabledPluginIds ?? [];
        // Includes the discovered ptah-harness-* directories, so a harness ID
        // survives this filter while a genuinely unknown ID is still dropped.
        const knownPluginIds = this.pluginLoader
          .getAvailablePlugins()
          .map((p) => p.id);
        const enabledPluginIds = [
          ...new Set(
            rawIds.filter(
              (id): id is string =>
                typeof id === 'string' && knownPluginIds.includes(id),
            ),
          ),
        ];
        const pluginPaths =
          this.pluginLoader.resolvePluginPaths(enabledPluginIds);

        // Undefined => preserve whatever is persisted (TUI/CLI clients never
        // send this field and must not re-enable a plugin the user turned off).
        const disabledPluginIds = Array.isArray(params?.disabledPluginIds)
          ? [
              ...new Set(
                params.disabledPluginIds.filter(
                  (id): id is string =>
                    typeof id === 'string' && knownPluginIds.includes(id),
                ),
              ),
            ]
          : undefined;

        let disabledSkillIds: string[];
        if (Array.isArray(params?.disabledSkillIds)) {
          disabledSkillIds = [
            ...new Set(
              params.disabledSkillIds.filter(
                (id): id is string => typeof id === 'string' && id.length > 0,
              ),
            ),
          ];
        } else {
          disabledSkillIds = existingConfig.disabledSkillIds;
        }
        // Skill IDs are validated against the enabled bundled plugins PLUS
        // every harness directory: harness plugins are opt-out and so never
        // appear in enabledPluginIds, and without them the per-skill toggle for
        // a harness skill would be silently discarded as an unknown ID.
        const skillScopePaths = [
          ...new Set([
            ...pluginPaths,
            ...this.pluginLoader.discoverHarnessPluginPaths(),
          ]),
        ];
        const discoveredSkills =
          this.pluginLoader.discoverSkillsForPlugins(skillScopePaths);
        const knownSkillIds = new Set(discoveredSkills.map((s) => s.skillId));
        const validatedDisabledSkillIds = disabledSkillIds.filter((id) =>
          knownSkillIds.has(id),
        );

        if (validatedDisabledSkillIds.length !== disabledSkillIds.length) {
          this.logger.debug(
            'RPC: plugins:save-config filtered unknown disabled skill IDs',
            {
              provided: disabledSkillIds.length,
              valid: validatedDisabledSkillIds.length,
            },
          );
        }

        this.logger.debug('RPC: plugins:save-config called', {
          enabledPluginIds,
          disabledSkillIds: validatedDisabledSkillIds,
          disabledPluginIds,
        });

        await this.pluginLoader.saveWorkspacePluginConfig(
          {
            enabledPluginIds,
            disabledSkillIds: validatedDisabledSkillIds,
            disabledPluginIds,
          },
          configRoot,
        );
        this.commandDiscovery.invalidateCache();
        // The reconciler re-reads the config we just saved through its source
        // resolver, so the newly disabled skills are reaped and the newly
        // enabled ones copied in the same pass.
        //
        // `skipUserLayerRefresh` because this is the one trigger that provably
        // cannot need it: enabling or disabling a plugin changes which sources
        // the desired state FILTERS IN, never what any source contains. Paying
        // for a full mirror + reconcileAll on every checkbox toggle would make
        // the Plugins panel feel broken for no gain.
        const pass = await this.reconcileHarness(
          harnessRoot,
          'plugins:save-config',
          { skipUserLayerRefresh: true },
        );
        // ...but a plugin that owns agents still needs its Library copy, so
        // the user layer catches up in the background (A13) and the Library
        // change signal reports it. The toggle answers without waiting.
        if (harnessRoot !== undefined) {
          this.harnessPropagation.refreshUserLayerInBackground(
            harnessRoot,
            'plugins:save-config',
          );
        }
        const kept =
          harnessRoot === undefined
            ? []
            : await this.localItems.keptForSave({
                harnessRoot,
                previous: existingConfig,
                enabledPluginIds,
                disabledPluginIds,
                health: pass.health,
              });

        this.logger.debug('RPC: plugins:save-config success', {
          enabledCount: enabledPluginIds.length,
          disabledSkillCount: validatedDisabledSkillIds.length,
          disabledPluginCount: disabledPluginIds?.length,
          pluginPaths: pluginPaths.length,
          kept: kept.length,
        });

        return {
          success: true,
          kept,
          ...(pass.libraryPass === 'failed'
            ? { libraryPass: pass.libraryPass }
            : {}),
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        this.logger.error(
          'RPC: plugins:save-config failed',
          error instanceof Error ? error : new Error(errorMessage),
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(errorMessage),
          { errorSource: 'PluginRpcHandlers.registerSaveConfig' },
        );

        return { success: false, error: errorMessage };
      }
    });
  }

  /**
   * plugins:list-skills - Enumerate skills within specified plugins
   *
   * Returns skill metadata (ID, display name, description, parent plugin)
   * for all skills found in the given plugin IDs. Used by the frontend
   * Plugin Browser to display per-skill toggle checkboxes.
   */
  private registerListSkills(): void {
    this.rpcHandler.registerMethod<
      { pluginIds: string[] },
      { skills: PluginSkillEntry[] }
    >('plugins:list-skills', async (params) => {
      try {
        const pluginIds = Array.isArray(params?.pluginIds)
          ? params.pluginIds.filter(
              (id): id is string => typeof id === 'string',
            )
          : [];

        this.logger.debug('RPC: plugins:list-skills called', {
          pluginIds,
        });

        const pluginPaths = this.pluginLoader.resolvePluginPaths(pluginIds);
        const skills = this.pluginLoader.discoverSkillsForPlugins(pluginPaths);

        this.logger.debug('RPC: plugins:list-skills success', {
          skillCount: skills.length,
        });

        return { skills };
      } catch (error) {
        this.logger.error(
          'RPC: plugins:list-skills failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'PluginRpcHandlers.registerListSkills' },
        );
        throw error;
      }
    });
  }

  /**
   * plugins:list-marketplaces - Registered external marketplaces + suggestions
   *
   * Suggestions (currently `dotnet/skills`) are served from the backend rather
   * than hardcoded in the UI so the recommendation list is one thing, not two.
   */
  private registerListMarketplaces(): void {
    this.rpcHandler.registerMethod<
      Record<string, never>,
      ListMarketplacesResult
    >('plugins:list-marketplaces', async () =>
      this.guard('registerListMarketplaces', () =>
        Promise.resolve(this.marketplaceRegistry.listMarketplaces()),
      ),
    );
  }

  /**
   * plugins:add-marketplace - Register an `owner/repo`
   *
   * The registry fetches and validates the manifest before persisting, so a
   * repo that is not a marketplace fails here rather than half-registering.
   */
  private registerAddMarketplace(): void {
    this.rpcHandler.registerMethod<
      { source: string },
      { marketplace: ExternalMarketplace }
    >('plugins:add-marketplace', async (params) => {
      const parsed = MarketplaceSourceParamsSchema.parse(params);
      return this.guard('registerAddMarketplace', async () => ({
        marketplace: await this.marketplaceRegistry.addMarketplace(
          parsed.source,
        ),
      }));
    });
  }

  /** plugins:remove-marketplace - Deregister. Installed plugins are kept. */
  private registerRemoveMarketplace(): void {
    this.rpcHandler.registerMethod<{ source: string }, { removed: boolean }>(
      'plugins:remove-marketplace',
      async (params) => {
        const parsed = MarketplaceSourceParamsSchema.parse(params);
        return this.guard('registerRemoveMarketplace', async () => ({
          removed: await this.marketplaceRegistry.removeMarketplace(
            parsed.source,
          ),
        }));
      },
    );
  }

  /** plugins:browse-marketplace - Plugins a registered marketplace advertises. */
  private registerBrowseMarketplace(): void {
    this.rpcHandler.registerMethod<
      { source: string; refresh?: boolean },
      ExternalMarketplaceBrowseResult
    >('plugins:browse-marketplace', async (params) => {
      const parsed = MarketplaceBrowseParamsSchema.parse(params);
      return this.guard('registerBrowseMarketplace', () =>
        this.marketplaceRegistry.browse(parsed.source, {
          refresh: parsed.refresh,
        }),
      );
    });
  }

  /**
   * plugins:install-external - The two-call consent protocol
   *
   * No `consentToken` ⇒ build a plan, write nothing, return
   * `status: 'consent-required'`. With a token ⇒ install exactly the payload
   * that plan described.
   *
   * The handler is deliberately thin here: it does NOT decide whether consent
   * was given. `ExternalPluginInstallerService.confirmInstall` rejects an
   * unknown or expired token, so there is no branch in this file that could be
   * edited into a bypass. What the handler adds is the two things the
   * installer cannot know — which skills are currently junctioned (for the
   * collision warning) and how to activate the plugin once it is on disk.
   *
   * Local items (B12): the plan lists what stands where the plugin would land,
   * each under a server-issued `approvalId`. After a SUCCESSFUL confirm and
   * activation, the ids the user chose to replace — and only ids this plan
   * issued — are applied through `PluginLocalItemsService`. When any item was
   * replaced, one more awaited pass runs and is the `libraryPass` reported.
   * A failed confirm throws before that step, so a failure never carries a
   * kept report.
   */
  private registerInstallExternal(): void {
    this.rpcHandler.registerMethod<
      {
        source: string;
        plugin: string;
        consentToken?: string;
        localItemDecisions?: Record<string, FileDecision>;
      },
      ExternalInstallResponse
    >('plugins:install-external', async (params) => {
      const parsed = ExternalInstallParamsSchema.parse(params);

      return this.guard('registerInstallExternal', async () => {
        if (!parsed.consentToken) {
          return this.buildConsentResponse(
            parsed.source,
            parsed.plugin,
            'not-yet-approved',
          );
        }

        let confirmed: ConfirmedExternalInstall;
        try {
          confirmed = await this.externalInstaller.confirmInstall(
            parsed.consentToken,
          );
        } catch (error: unknown) {
          // A token that no longer validates is not an error the user can do
          // anything with — the plan expired, the host restarted, or upstream
          // moved. Re-plan and ask again rather than dead-ending, so consent
          // is re-obtained against current facts. This is also the version-
          // change path: the token hashes the payload, so a new upstream
          // version can never satisfy an old approval.
          if (
            error instanceof PluginMarketplaceError &&
            error.code === 'consent-required'
          ) {
            return this.buildConsentResponse(
              parsed.source,
              parsed.plugin,
              'approval-expired',
            );
          }
          throw error;
        }

        // BEFORE `activateExternalPlugin`, which reconciles: the reconciler's
        // desired MCP state IS `~/.ptah/mcp-installed.json`, so an intent
        // recorded after the pass would not be applied until some later
        // trigger fired.
        const { planLocalItems, ...result } = confirmed;
        const harnessRoot = this.harnessRoot();
        const mcp = await this.installDeclaredMcpServers(result.pluginId);
        const activation = await this.activateExternalPlugin(
          result.pluginId,
          harnessRoot,
        );
        const collisions = activation.collisions;
        const localReport = await this.localItems.applyPlanDecisions(
          harnessRoot,
          planLocalItems,
          parsed.localItemDecisions ?? {},
        );
        // A replaced item changes a source the Library mirrors (an agent, a
        // clone) or a target copy AFTER the activation pass, so one more
        // awaited full pass brings both up to date and is the one reported.
        // The install stays a success when it fails (`libraryPass: 'failed'`).
        const libraryPass =
          localReport.replaced.length === 0
            ? activation.libraryPass
            : (
                await this.reconcileHarness(
                  harnessRoot,
                  'plugins:install-external',
                )
              ).libraryPass;

        this.logger.debug('RPC: plugins:install-external installed', {
          pluginId: result.pluginId,
          version: result.installedVersion,
          filesWritten: result.filesWritten,
          skipped: result.skippedBinaryFiles.length,
          collisions: collisions.length,
          mcpServers: mcp.serverKeys.length,
          mcpWarnings: mcp.warnings.length,
          replaced: localReport.replaced.length,
          kept: localReport.kept.length,
        });

        return {
          status: 'installed' as const,
          result: {
            ...result,
            collisions,
            mcpServersInstalled: mcp.serverKeys,
            mcpWarnings: mcp.warnings,
            kept: localReport.kept,
            replaced: localReport.replaced,
            libraryPass,
          },
        };
      });
    });
  }

  /**
   * Record an install intent for every MCP server the plugin declared.
   *
   * The list comes from the CONSENT RECORD, not from a fresh manifest read:
   * that record is the exact set the dialog showed and the user approved, so
   * installing from it cannot widen the consent surface even if upstream
   * changed between the plan and the confirm.
   *
   * Non-fatal throughout. A plugin whose files landed is installed; an MCP
   * server that could not be recorded is a warning on the result, not a failed
   * install the user has to retry.
   */
  private async installDeclaredMcpServers(
    pluginId: string,
  ): Promise<ExternalMcpOutcome> {
    try {
      const record = this.externalState.findInstalled(pluginId);
      const servers = record?.mcpServers ?? [];
      if (servers.length === 0) return { serverKeys: [], warnings: [] };
      return await this.externalMcp.install(
        pluginId,
        servers,
        this.workspaceProvider.getWorkspaceRoot() ?? undefined,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn('External plugin MCP install failed (non-fatal)', {
        pluginId,
        error: message,
      });
      return {
        serverKeys: [],
        warnings: [`Declared MCP servers were not installed: ${message}`],
      };
    }
  }

  /** plugins:uninstall-external - Remove the tree, the record and the toggle. */
  private registerUninstallExternal(): void {
    this.rpcHandler.registerMethod<
      { pluginId: string },
      ExternalUninstallResult
    >('plugins:uninstall-external', async (params) => {
      const parsed = ExternalUninstallParamsSchema.parse(params);

      return this.guard('registerUninstallExternal', async () => {
        // Captured BEFORE the uninstall: `uninstall()` deletes the consent
        // record, and that record is the only thing that says which MCP keys
        // belonged to this plugin. Read it afterwards and its servers would sit
        // in every config file forever, outliving the plugin that declared
        // them.
        const declared =
          this.externalState.findInstalled(parsed.pluginId)?.mcpServers ?? [];

        const removed = await this.externalInstaller.uninstall(parsed.pluginId);
        if (!removed) return { pluginId: parsed.pluginId, removed };

        const mcp = await this.uninstallDeclaredMcpServers(
          parsed.pluginId,
          declared,
        );
        await this.deactivateExternalPlugin(parsed.pluginId);

        return {
          pluginId: parsed.pluginId,
          removed,
          mcpServersRemoved: mcp.serverKeys,
          mcpWarnings: mcp.warnings,
        };
      });
    });
  }

  /**
   * Drop the install intent for every MCP server this plugin declared.
   *
   * Runs only after the tree and the record are actually gone (`removed`), and
   * before `deactivateExternalPlugin` reconciles — so the same pass that reaps
   * the plugin's skills also reaps its MCP entries.
   */
  private async uninstallDeclaredMcpServers(
    pluginId: string,
    servers: readonly ExternalPluginMcpServer[],
  ): Promise<ExternalMcpOutcome> {
    if (servers.length === 0) return { serverKeys: [], warnings: [] };
    try {
      return await this.externalMcp.uninstall(
        pluginId,
        servers,
        this.workspaceProvider.getWorkspaceRoot() ?? undefined,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn('External plugin MCP uninstall failed (non-fatal)', {
        pluginId,
        error: message,
      });
      return {
        serverKeys: [],
        warnings: [`Declared MCP servers were not removed: ${message}`],
      };
    }
  }

  /**
   * Build a fresh plan and wrap it as a `consent-required` response.
   *
   * The one place a plan is enriched with collisions, so the "first ask" and
   * the "ask again" paths cannot drift into showing different information.
   */
  private async buildConsentResponse(
    source: string,
    plugin: string,
    reason: ExternalConsentReason,
  ): Promise<ExternalInstallResponse> {
    const plan = await this.externalInstaller.planInstall(source, plugin);
    const localItems = await this.localItems.planForInstall(
      this.harnessRoot(),
      plan,
    );
    return {
      status: 'consent-required',
      reason,
      plan: {
        ...plan,
        collisions: this.predictCollisions(plan.pluginId, plan.skills),
        ...(localItems.length > 0 ? { localItems } : {}),
      },
    };
  }

  /**
   * Turn a freshly-installed plugin on in this workspace and re-junction.
   *
   * Installing implies enabling: the consent dialog already listed the skills,
   * the scripts and the declared MCP servers, so making the user find a second
   * switch afterwards would add ceremony without adding a decision.
   *
   * @returns the skills that ended up shadowed by an already-active skill,
   *   and whether the Library pass after the install completed.
   */
  private async activateExternalPlugin(
    pluginId: string,
    harnessRoot: string | undefined,
  ): Promise<{
    collisions: ExternalSkillCollision[];
    libraryPass: LibraryPassStatus;
  }> {
    const configRoot = this.configRoot(harnessRoot);
    const config = this.pluginLoader.getWorkspacePluginConfig(configRoot);
    const enabledPluginIds = [
      ...new Set([...config.enabledPluginIds, pluginId]),
    ];

    await this.pluginLoader.saveWorkspacePluginConfig(
      {
        enabledPluginIds,
        disabledSkillIds: config.disabledSkillIds,
        // Undefined preserves the persisted denylist — see saveWorkspacePluginConfig.
        disabledPluginIds: undefined,
      },
      configRoot,
    );

    this.commandDiscovery.invalidateCache();
    const { health, libraryPass } = await this.reconcileHarness(
      harnessRoot,
      'plugins:install-external',
    );

    // Now that the copies have been rebuilt, report what actually lost, rather
    // than what we predicted would lose. The reconciler records a collision for
    // every source that could not claim its slug; we only care about the ones
    // this plugin brought.
    const collisions = (health?.collisions ?? [])
      .filter((collision) => collision.shadowedPluginId === pluginId)
      .map((collision) => ({
        skillName: collision.slug,
        shadowedBy: this.findSkillOwner(collision.slug) ?? 'another plugin',
      }));
    return { collisions, libraryPass };
  }

  /**
   * Drop an uninstalled plugin from the workspace config and re-propagate.
   *
   * Unlike `save-config`, this one MUST refresh the user layer, which is why it
   * passes no `skipUserLayerRefresh`. `uninstall()` deleted the plugin tree
   * under `~/.ptah/plugins/external/`, but the user-layer CLONES of its skills
   * are still sitting in `~/.ptah/user/skills` — and the user layer is the
   * desired state. A bare reconcile therefore saw the uninstalled plugin's
   * skills as still wanted and kept copying them into every target forever
   * (TASK_2026_278 defect 7). `reconcileAll`'s reap pass, which the refresher
   * runs, is the only thing that removes them.
   */
  private async deactivateExternalPlugin(pluginId: string): Promise<void> {
    const harnessRoot = this.harnessRoot();
    const configRoot = this.configRoot(harnessRoot);
    const config = this.pluginLoader.getWorkspacePluginConfig(configRoot);

    await this.pluginLoader.saveWorkspacePluginConfig(
      {
        enabledPluginIds: config.enabledPluginIds.filter(
          (id) => id !== pluginId,
        ),
        disabledSkillIds: config.disabledSkillIds,
        disabledPluginIds: (config.disabledPluginIds ?? []).filter(
          (id) => id !== pluginId,
        ),
      },
      configRoot,
    );

    this.commandDiscovery.invalidateCache();
    await this.reconcileHarness(harnessRoot, 'plugins:uninstall-external');
  }

  /**
   * plugins:replace-kept-items - replace items a no-dialog action kept.
   *
   * Accepts only server-issued approval ids from a kept report of a no-dialog
   * family (skills.sh install, plugin enable, plugin agents), issued for this
   * harness root. Each id is applied through its OWN family's route; an id
   * that is unknown, expired, already used, issued for another repository or
   * issued to the external consent dialog rejects the whole request before
   * anything is written.
   */
  private registerReplaceKeptItems(): void {
    this.rpcHandler.registerMethod<
      { decisions: Record<string, FileDecision> },
      PluginsReplaceKeptItemsResult
    >('plugins:replace-kept-items', async (params) => {
      const parsed = ReplaceKeptItemsParamsSchema.safeParse(params);
      if (!parsed.success) {
        throw new RpcUserError(
          'That replace request is not valid.',
          'INVALID_PARAMS',
        );
      }
      const harnessRoot = this.requireHarnessRoot();
      const replaceIds = Object.entries(parsed.data.decisions)
        .filter(([, decision]) => decision === 'replace')
        .map(([approvalId]) => approvalId);
      if (replaceIds.length === 0) {
        return { replaced: [], kept: [], libraryPass: 'not-applicable' };
      }

      const byFamily = new Map<LocalItemFamily, string[]>();
      const offered = new Map<string, KeptItem>();
      for (const approvalId of replaceIds) {
        const approval =
          KEPT_REPORT_FAMILIES.map((candidate) =>
            this.approvals.peek(approvalId, candidate, harnessRoot),
          ).find((entry) => entry !== null) ?? null;
        if (approval === null) {
          throw new RpcUserError(
            'Some of these items can no longer be replaced from here. Run the action again to review them.',
            'INVALID_PARAMS',
          );
        }
        const family = approval.family;
        byFamily.set(family, [...(byFamily.get(family) ?? []), approvalId]);
        offered.set(approvalId, {
          approvalId,
          family,
          ...(approval.target !== undefined ? { target: approval.target } : {}),
          relPath: approval.relPath,
          reason: 'changed-since-approval',
        });
      }

      return this.guard('registerReplaceKeptItems', async () => {
        const replaced: KeptItem[] = [];
        const kept: Array<KeptItem & { error?: string }> = [];
        for (const [family, approvalIds] of byFamily) {
          const report = await this.installLocalItems.apply({
            family,
            harnessRoot,
            approvalIds,
          });
          replaced.push(...report.replaced);
          kept.push(...report.kept);
          // An id that lapsed between the check above and the apply.
          for (const approvalId of report.unknown) {
            const item = offered.get(approvalId);
            if (item !== undefined) kept.push(item);
          }
        }
        // A replaced item changes a source the Library mirrors (an agent, a
        // clone) or a target copy; one full pass brings both up to date.
        const libraryPass =
          replaced.length === 0
            ? 'not-applicable'
            : (
                await this.reconcileHarness(
                  harnessRoot,
                  'plugins:replace-kept-items',
                )
              ).libraryPass;
        return { replaced, kept, libraryPass };
      });
    });
  }

  /**
   * plugins:resolve-config-home - adopt or dismiss one folder's saved plugin
   * settings for the open repository (D14).
   *
   * `folder` is accepted only when it is one of the server's own candidates
   * for this harness root, and the candidate's value — never the client's —
   * is what is passed on. `adopt` copies that folder's configuration to the
   * repository home, then runs the same awaited reconcile and background
   * Library refresh as `plugins:save-config`. Both answer the new status.
   */
  private registerResolveConfigHome(): void {
    this.rpcHandler.registerMethod<
      { action: 'adopt' | 'dismiss'; folder: string },
      PluginsResolveConfigHomeResult
    >('plugins:resolve-config-home', async (params) => {
      const parsed = ResolveConfigHomeParamsSchema.safeParse(params);
      if (!parsed.success) {
        throw new RpcUserError(
          'That plugin settings request is not valid.',
          'INVALID_PARAMS',
        );
      }
      const harnessRoot = this.requireHarnessRoot();
      const candidate = this.pluginLoader
        .getConfigHomeStatus(harnessRoot)
        ?.candidates.find((entry) => entry.folder === parsed.data.folder);
      if (candidate === undefined) {
        throw new RpcUserError(
          'That folder has no saved plugin settings for this repository.',
          'INVALID_PARAMS',
        );
      }

      return this.guard('registerResolveConfigHome', async () => {
        let libraryPass: LibraryPassStatus | undefined;
        if (parsed.data.action === 'adopt') {
          await this.pluginLoader.adoptFolderConfig(
            harnessRoot,
            candidate.folder,
          );
          this.commandDiscovery.invalidateCache();
          const pass = await this.reconcileHarness(
            harnessRoot,
            'plugins:resolve-config-home',
            { skipUserLayerRefresh: true },
          );
          this.harnessPropagation.refreshUserLayerInBackground(
            harnessRoot,
            'plugins:resolve-config-home',
          );
          if (pass.libraryPass === 'failed') libraryPass = pass.libraryPass;
        } else {
          await this.pluginLoader.dismissFolderConfig(
            harnessRoot,
            candidate.folder,
          );
        }
        const configHome = this.pluginLoader.getConfigHomeStatus(harnessRoot);
        return {
          ...(configHome !== null ? { configHome } : {}),
          ...(libraryPass !== undefined ? { libraryPass } : {}),
        };
      });
    });
  }

  /** Harness root of the open folder (8.1), or undefined with none open. */
  private harnessRoot(): string | undefined {
    const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
    return workspaceRoot === undefined ||
      workspaceRoot === null ||
      workspaceRoot === ''
      ? undefined
      : resolveHarnessWorkspaceRoot(workspaceRoot);
  }

  private requireHarnessRoot(): string {
    const harnessRoot = this.harnessRoot();
    if (harnessRoot === undefined) {
      throw new RpcUserError(
        'Open a folder to change its plugins.',
        'WORKSPACE_NOT_OPEN',
      );
    }
    return harnessRoot;
  }

  /**
   * The root plugin configuration is read and written for: the harness root
   * when this host keeps state for it (always, with the D14 config home), else
   * the open folder's own state — a host without the home has nowhere to put
   * a configuration for a root it never registered.
   */
  private configRoot(harnessRoot: string | undefined): string | undefined {
    if (harnessRoot === undefined) return undefined;
    return this.pluginLoader.hasWorkspaceState(harnessRoot)
      ? harnessRoot
      : undefined;
  }

  /**
   * Reconcile `{ws}/.claude/{skills,commands}` after a config change.
   *
   * Non-fatal: an RPC that saved the user's plugin selection must report
   * success even if the workspace copy failed, because the selection IS saved
   * and the next activation heals the copy. Returns the health report so
   * callers can read the collision list (`null` when there is no workspace or
   * the pass failed), and `libraryPass`: `failed` when the reconcile or the
   * user-layer refresh did not complete (8.10a).
   */
  private async reconcileHarness(
    harnessRoot: string | undefined,
    reason: string,
    options: { skipUserLayerRefresh?: boolean } = {},
  ): Promise<HarnessPassOutcome> {
    if (harnessRoot === undefined) {
      return { health: null, libraryPass: 'not-applicable' };
    }
    try {
      const report = await this.harnessPropagation.propagateWithReport(
        harnessRoot,
        reason,
        options,
      );
      const libraryPass: LibraryPassStatus =
        report.health === null || report.userLayer === 'failed'
          ? 'failed'
          : report.userLayer === 'refreshed'
            ? 'updated'
            : 'not-applicable';
      return { health: report.health, libraryPass };
    } catch (error: unknown) {
      // Non-fatal: the harness copy is a derived
      // artifact the next activation heals; the caller reports
      // libraryPass 'failed' while the user's plugin selection stays saved.
      this.logger.warn('Harness reconcile failed (non-fatal)', {
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
      return { health: null, libraryPass: 'failed' };
    }
  }

  /**
   * Which skills in `candidateSkills` an already-active skill would shadow.
   *
   * Computed here, not in the marketplace lib, because "currently installed in
   * the workspace" is state that lib has no business knowing. Prediction is
   * necessarily approximate — it compares names against the skills discoverable
   * right now — which is why the post-install result reports the real outcome
   * from `HarnessHealth.collisions` instead of repeating this.
   */
  private predictCollisions(
    pluginId: string,
    candidateSkills: string[],
  ): ExternalSkillCollision[] {
    if (candidateSkills.length === 0) return [];

    const owners = this.activeSkillOwners();

    return candidateSkills
      .filter((skillName) => {
        const owner = owners.get(skillName);
        return owner !== undefined && owner !== pluginId;
      })
      .map((skillName) => ({
        skillName,
        shadowedBy: owners.get(skillName) ?? 'another plugin',
      }));
  }

  /** Owner plugin id for every skill currently discoverable, first wins. */
  private activeSkillOwners(): Map<string, string> {
    const owners = new Map<string, string>();
    const active = this.pluginLoader.discoverSkillsForPlugins(
      this.pluginLoader.resolveCurrentPluginPaths(),
    );

    for (const skill of active) {
      if (!owners.has(skill.skillId)) owners.set(skill.skillId, skill.pluginId);
    }

    return owners;
  }

  /** Plugin id that currently owns `skillName`, or undefined. */
  private findSkillOwner(skillName: string): string | undefined {
    return this.activeSkillOwners().get(skillName);
  }

  /**
   * Run `operation`, logging + reporting failures once.
   *
   * `PluginMarketplaceError` messages are written for end users and are
   * re-thrown verbatim. Anything else is reported to Sentry and re-thrown with
   * its own message — these are Ptah's own errors, not third-party library
   * output, so there is nothing here to sanitize away.
   */
  private async guard<T>(
    errorSource: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (error instanceof PluginMarketplaceError) {
        this.logger.warn(`RPC: plugins external operation rejected`, {
          errorSource,
          code: error.code,
          message: error.message,
        });
        throw error;
      }

      const normalized =
        error instanceof Error ? error : new Error(String(error));
      this.logger.error(`RPC: plugins external operation failed`, normalized);
      this.sentryService.captureException(normalized, {
        errorSource: `PluginRpcHandlers.${errorSource}`,
      });
      throw normalized;
    }
  }
}
