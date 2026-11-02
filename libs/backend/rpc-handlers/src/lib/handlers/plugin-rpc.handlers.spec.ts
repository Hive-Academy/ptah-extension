/**
 * PluginRpcHandlers — unit specs.
 *
 * Surface under test: four RPC methods (`plugins:list-available`,
 * `plugins:get-config`, `plugins:save-config`, `plugins:list-skills`) plus the
 * two external-marketplace mutations that change the active plugin set. These
 * specs lock in the sanitisation + harness-reconcile behaviour the Plugin
 * Browser modal relies on.
 *
 * Behavioural contracts locked in here:
 *
 *   - Registration: `register()` wires all four methods into the mock
 *     RpcHandler.
 *
 *   - `plugins:list-available`: Delegates straight to
 *     `PluginLoaderService.getAvailablePlugins()`. Errors bubble through the
 *     RPC error channel after a Sentry capture.
 *
 *   - `plugins:get-config`: Delegates to
 *     `PluginLoaderService.getWorkspacePluginConfig()` — forwards the full
 *     `{ enabledPluginIds, disabledSkillIds }` shape without mutation.
 *
 *   - `plugins:save-config`:
 *       - Validates `enabledPluginIds` against the known-plugin registry
 *         (bundled catalogue + discovered `ptah-harness-*` dirs) — unknown IDs
 *         are silently dropped, not errored.
 *       - `disabledPluginIds` is the opt-out denylist for harness plugins:
 *         validated against the same registry, and `undefined` means "preserve
 *         what is persisted" for clients that never send it.
 *       - Deduplicates IDs via `new Set(...)` so round-tripped payloads don't
 *         bloat the saved config.
 *       - Back-compat: when `disabledSkillIds` is undefined (TUI clients),
 *         preserves the existing disabled-skills array from saved config;
 *         when an array is provided, it replaces the saved value entirely.
 *       - Validates disabled skill IDs against the set actually discovered
 *         for the enabled plugins — skill IDs not in that set are dropped.
 *       - Invalidates the command-discovery cache AND reconciles the workspace
 *         harness after saving, so the change takes effect without a
 *         VS Code reload.
 *       - Returns structured `{ success: false, error }` on exceptions
 *         (not a throw) — saveWorkspacePluginConfig failures MUST NOT be
 *         propagated as RPC errors because the frontend settings UI relies
 *         on a non-error payload to display save status.
 *
 *   - `plugins:list-skills`: Filters non-string IDs before resolving paths;
 *     returns `{ skills: [] }` when no valid IDs are provided.
 *
 * Mocking posture: direct constructor injection, narrow `jest.Mocked<Pick<T,...>>`
 * surfaces, no `as any` casts, no tsyringe container.
 *
 * Source-under-test:
 *   `libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.handlers.ts`
 */

import 'reflect-metadata';

// The SUT now imports `McpInstallService` from `@ptah-extension/cli-agent-runtime`,
// whose barrel transitively pulls `@ptah-extension/workspace-intelligence`.
// That lib's TreeSitter module evaluates `import.meta.url` at top level, which
// ts-jest's CJS transform cannot parse. Stub it — the same stub, for the same
// reason, as `mcp-directory-rpc.handlers.spec.ts` and
// `ptah-cli-rpc.handlers.spec.ts`. Nothing under test here touches
// workspace-intelligence: this handler holds `CommandDiscoveryService` only to
// call `invalidateCache()`, and the spec passes its own mock for that.
jest.mock('@ptah-extension/workspace-intelligence', () => ({
  ProjectType: {},
  Framework: {},
  MonorepoType: {},
  FileType: {},
  TreeSitterParserService: class TreeSitterParserServiceStub {},
  AstAnalysisService: class AstAnalysisServiceStub {},
  DependencyGraphService: class DependencyGraphServiceStub {},
  WorkspaceAnalyzerService: class WorkspaceAnalyzerServiceStub {},
  ContextService: class ContextServiceStub {},
  ContextOrchestrationService: class ContextOrchestrationServiceStub {},
  WorkspaceService: class WorkspaceServiceStub {},
  TokenCounterService: class TokenCounterServiceStub {},
  FileSystemService: class FileSystemServiceStub {},
  FileSystemError: class FileSystemErrorStub extends Error {},
  ProjectDetectorService: class ProjectDetectorServiceStub {},
  FrameworkDetectorService: class FrameworkDetectorServiceStub {},
  DependencyAnalyzerService: class DependencyAnalyzerServiceStub {},
  MonorepoDetectorService: class MonorepoDetectorServiceStub {},
  PatternMatcherService: class PatternMatcherServiceStub {},
  IgnorePatternResolverService: class IgnorePatternResolverServiceStub {},
  WorkspaceIndexerService: class WorkspaceIndexerServiceStub {},
  FileTypeClassifierService: class FileTypeClassifierServiceStub {},
  FileRelevanceScorerService: class FileRelevanceScorerServiceStub {},
  ContextSizeOptimizerService: class ContextSizeOptimizerServiceStub {},
  ContextEnrichmentService: class ContextEnrichmentServiceStub {},
  CommandDiscoveryService: class CommandDiscoveryServiceStub {},
}));

import type { Logger, SentryService } from '@ptah-extension/vscode-core';
import {
  createMockRpcHandler,
  createMockSentryService,
  type MockRpcHandler,
  type MockSentryService,
} from '@ptah-extension/vscode-core/testing';
import type { PluginLoaderService } from '@ptah-extension/agent-sdk';
import {
  resolveHarnessWorkspaceRoot,
  type HarnessPropagationService,
} from '@ptah-extension/harness-sync';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';
import type { CommandDiscoveryService } from '@ptah-extension/workspace-intelligence';
import type {
  ExternalInstallPlan,
  ExternalLocalItem,
  HarnessCollision,
  HarnessHealth,
  KeptItem,
  PluginConfigHomeStatus,
  PluginInfo,
  PluginConfigState,
  PluginSkillEntry,
} from '@ptah-extension/shared';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import type { DependencyContainer } from 'tsyringe';

import { PluginRpcHandlers } from './plugin-rpc.handlers';
import {
  EXTERNAL_PLUGIN_MCP_TOKEN,
  ExternalPluginMcpService,
  NO_WORKSPACE_MCP_WARNING,
  type ExternalMcpInstaller,
} from './external-plugin-mcp.service';
import { LocalItemApprovals } from './marketplace/local-item-approvals';
import type { InstallLocalItemsService } from './marketplace/install-local-items.service';
import type { MarketplaceLocalItemsService } from './marketplace/marketplace-local-items.service';
import { PluginLocalItemsService } from './marketplace/plugin-local-items.service';

/** The workspace folder every handler in this suite sees as open. */
const WORKSPACE_ROOT = 'C:\\ws';

/**
 * The harness root every config write and reconcile targets (8.1). Equal to
 * {@link WORKSPACE_ROOT} on a Windows runner; resolved so the suite agrees
 * with the handler on any platform.
 */
const HARNESS_ROOT = resolveHarnessWorkspaceRoot(WORKSPACE_ROOT);

// ---------------------------------------------------------------------------
// Narrow mock surfaces — only what the handler touches
// ---------------------------------------------------------------------------

type MockPluginLoader = jest.Mocked<
  Pick<
    PluginLoaderService,
    | 'getAvailablePlugins'
    | 'getWorkspacePluginConfig'
    | 'saveWorkspacePluginConfig'
    | 'resolvePluginPaths'
    | 'resolveCurrentPluginPaths'
    | 'discoverHarnessPluginPaths'
    | 'discoverSkillsForPlugins'
    | 'hasWorkspaceState'
    | 'getConfigHomeStatus'
    | 'adoptFolderConfig'
    | 'dismissFolderConfig'
    | 'getPluginSourceDescriptors'
  >
>;

function createMockPluginLoader(
  overrides: {
    availablePlugins?: PluginInfo[];
    workspaceConfig?: PluginConfigState;
    resolvedPaths?: string[];
    /**
     * What `resolveCurrentPluginPaths()` returns — the harness-inclusive view
     * the handler uses to work out who currently OWNS a skill name. Defaults to
     * `resolvedPaths`; set it explicitly to model harness-authored
     * `ptah-harness-*` dirs being appended.
     */
    currentPluginPaths?: string[];
    /** Harness dirs on disk, as `discoverHarnessPluginPaths()` reports them. */
    harnessPaths?: string[];
    discoveredSkills?: PluginSkillEntry[];
  } = {},
): MockPluginLoader {
  return {
    getAvailablePlugins: jest
      .fn()
      .mockReturnValue(overrides.availablePlugins ?? []),
    getWorkspacePluginConfig: jest.fn().mockReturnValue(
      overrides.workspaceConfig ?? {
        enabledPluginIds: [],
        disabledSkillIds: [],
        disabledPluginIds: [],
        lastUpdated: 0,
      },
    ),
    saveWorkspacePluginConfig: jest.fn().mockResolvedValue(undefined),
    resolvePluginPaths: jest
      .fn()
      .mockReturnValue(overrides.resolvedPaths ?? []),
    resolveCurrentPluginPaths: jest
      .fn()
      .mockReturnValue(
        overrides.currentPluginPaths ?? overrides.resolvedPaths ?? [],
      ),
    discoverHarnessPluginPaths: jest
      .fn()
      .mockReturnValue(overrides.harnessPaths ?? []),
    discoverSkillsForPlugins: jest
      .fn()
      .mockReturnValue(overrides.discoveredSkills ?? []),
    hasWorkspaceState: jest.fn().mockReturnValue(true),
    getConfigHomeStatus: jest.fn().mockReturnValue(null),
    adoptFolderConfig: jest.fn().mockResolvedValue(undefined),
    dismissFolderConfig: jest.fn().mockResolvedValue(undefined),
    getPluginSourceDescriptors: jest.fn().mockReturnValue({}),
  };
}

type MockHarnessPropagation = jest.Mocked<
  Pick<
    HarnessPropagationService,
    'propagate' | 'propagateWithReport' | 'refreshUserLayerInBackground'
  >
>;

/**
 * A `HarnessHealth` with everything clean, which is what a reconcile of an
 * untouched fixture workspace reports. Pass `collisions` to model a shadowed
 * skill; the other fields are never read by this handler.
 */
function makeHealth(overrides: Partial<HarnessHealth> = {}): HarnessHealth {
  return {
    workspaceRoot: WORKSPACE_ROOT,
    generatedAt: '2026-01-01T00:00:00.000Z',
    mode: 'full',
    reason: 'test',
    sources: 'ok',
    targets: [],
    collisions: [],
    ...overrides,
  };
}

/**
 * `propagateWithReport` answers through `propagate`, so a test that shapes
 * the health (or a rejection) with `propagate` shapes the report too, and the
 * call assertions on `propagate` keep describing the one pass that ran.
 */
function createMockHarnessPropagation(): MockHarnessPropagation {
  const propagate = jest.fn().mockResolvedValue(makeHealth());
  return {
    propagate,
    propagateWithReport: jest.fn(
      async (...args: Parameters<HarnessPropagationService['propagate']>) => ({
        health: (await propagate(...args)) as HarnessHealth | null,
        userLayer:
          args[2]?.skipUserLayerRefresh === true
            ? ('skipped' as const)
            : ('refreshed' as const),
      }),
    ),
    refreshUserLayerInBackground: jest.fn(),
  } as unknown as MockHarnessPropagation;
}

type MockCommandDiscovery = jest.Mocked<
  Pick<CommandDiscoveryService, 'invalidateCache'>
>;

function createMockCommandDiscovery(): MockCommandDiscovery {
  return { invalidateCache: jest.fn() };
}

/**
 * The external-marketplace collaborators. These specs cover the bundled-plugin
 * namespace only; the marketplace methods have their own suite. Both mocks are
 * inert so a bundled-plugin test can never reach the network by accident.
 */
interface MockMarketplaceRegistry {
  listMarketplaces: jest.Mock;
  addMarketplace: jest.Mock;
  removeMarketplace: jest.Mock;
  browse: jest.Mock;
}

function createMockMarketplaceRegistry(): MockMarketplaceRegistry {
  return {
    listMarketplaces: jest.fn().mockReturnValue({ marketplaces: [] }),
    addMarketplace: jest.fn(),
    removeMarketplace: jest.fn().mockResolvedValue(false),
    browse: jest.fn(),
  };
}

interface MockExternalInstaller {
  planInstall: jest.Mock;
  confirmInstall: jest.Mock;
  uninstall: jest.Mock;
  planItemSlugs: jest.Mock;
  attachLocalItems: jest.Mock;
}

function createMockExternalInstaller(): MockExternalInstaller {
  return {
    planInstall: jest.fn(),
    confirmInstall: jest.fn(),
    uninstall: jest.fn().mockResolvedValue(false),
    planItemSlugs: jest.fn().mockReturnValue(null),
    attachLocalItems: jest.fn().mockReturnValue(true),
  };
}

/** Local-item discovery (B12): inert unless a test shapes it. */
interface MockLocalItems {
  planLocalItems: jest.Mock;
  keptReport: jest.Mock;
}

function createMockLocalItems(): MockLocalItems {
  return {
    planLocalItems: jest.fn().mockResolvedValue([]),
    keptReport: jest.fn().mockResolvedValue([]),
  };
}

interface MockInstallLocalItems {
  apply: jest.Mock;
}

function createMockInstallLocalItems(): MockInstallLocalItems {
  return {
    apply: jest.fn().mockResolvedValue({ replaced: [], kept: [], unknown: [] }),
  };
}

/** The consent record store — read for `mcpServers`, the approved server list. */
interface MockExternalState {
  findInstalled: jest.Mock;
}

function createMockExternalState(): MockExternalState {
  return { findInstalled: jest.fn().mockReturnValue(null) };
}

/**
 * The MCP installer for declared servers.
 *
 * Substituted through `EXTERNAL_PLUGIN_MCP_TOKEN` rather than passed
 * positionally, because the shipping handler builds its own from the container
 * — and the real one's `McpIntentStore` writes to the developer's actual
 * `~/.ptah/mcp-installed.json`, which no spec may touch.
 */
interface MockExternalMcp {
  install: jest.Mock;
  uninstall: jest.Mock;
}

function createMockExternalMcp(): MockExternalMcp {
  return {
    install: jest.fn().mockResolvedValue({ serverKeys: [], warnings: [] }),
    uninstall: jest.fn().mockResolvedValue({ serverKeys: [], warnings: [] }),
  };
}

/**
 * A container that answers for exactly one token and denies everything else.
 *
 * `isRegistered` returning false for the reconciler is what would make the
 * handler build a REAL `McpInstallService`; registering the override means it
 * never gets that far.
 */
function createStubContainer(
  entries: ReadonlyMap<symbol, unknown>,
): DependencyContainer {
  return {
    isRegistered: (token: symbol) => entries.has(token),
    resolve: (token: symbol) => entries.get(token),
  } as unknown as DependencyContainer;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePluginInfo(id: string, name = id): PluginInfo {
  return {
    id,
    name,
    description: `desc for ${id}`,
    category: 'development',
    skillCount: 0,
    commandCount: 0,
    keywords: [],
    source: 'bundled',
  } as unknown as PluginInfo;
}

/** A discovered, user-authored `ptah-harness-*` plugin (opt-out semantics). */
function makeHarnessPluginInfo(id: string, name = id): PluginInfo {
  return {
    id,
    name,
    description: `desc for ${id}`,
    category: 'harness-tools',
    skillCount: 1,
    commandCount: 0,
    isDefault: false,
    keywords: [],
    source: 'harness',
  } as unknown as PluginInfo;
}

function makeSkillEntry(skillId: string, pluginId: string): PluginSkillEntry {
  return {
    skillId,
    descriptorId: `${pluginId}:${skillId}`,
    invocationName: skillId,
    pluginId,
    sourceId: pluginId,
    source: 'bundled',
    invocability: 'invocable',
    displayName: skillId,
    description: `desc ${skillId}`,
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Harness {
  handlers: PluginRpcHandlers;
  logger: MockLogger;
  rpcHandler: MockRpcHandler;
  pluginLoader: MockPluginLoader;
  harnessPropagation: MockHarnessPropagation;
  workspaceProvider: IWorkspaceProvider;
  commandDiscovery: MockCommandDiscovery;
  sentry: MockSentryService;
  marketplaceRegistry: MockMarketplaceRegistry;
  externalInstaller: MockExternalInstaller;
  externalState: MockExternalState;
  externalMcp: MockExternalMcp;
  localItems: MockLocalItems;
  installLocalItems: MockInstallLocalItems;
  /** The real registry: in-memory, and what the family check reads. */
  approvals: LocalItemApprovals;
}

function makeHarness(
  opts: {
    availablePlugins?: PluginInfo[];
    workspaceConfig?: PluginConfigState;
    resolvedPaths?: string[];
    currentPluginPaths?: string[];
    harnessPaths?: string[];
    discoveredSkills?: PluginSkillEntry[];
    /** The open folder; defaults to {@link WORKSPACE_ROOT}. `null`: none. */
    workspaceRoot?: string | null;
    /** Replaces the mock MCP service registered under the override token. */
    externalMcp?: ExternalPluginMcpService;
  } = {},
): Harness {
  const logger = createMockLogger();
  const rpcHandler = createMockRpcHandler();
  const pluginLoader = createMockPluginLoader(opts);
  const harnessPropagation = createMockHarnessPropagation();
  const workspaceProvider = createMockWorkspaceProvider({
    folders:
      opts.workspaceRoot === null ? [] : [opts.workspaceRoot ?? WORKSPACE_ROOT],
  }) as unknown as IWorkspaceProvider;
  const commandDiscovery = createMockCommandDiscovery();
  const sentry = createMockSentryService();
  const marketplaceRegistry = createMockMarketplaceRegistry();
  const externalInstaller = createMockExternalInstaller();
  const externalState = createMockExternalState();
  const externalMcp = createMockExternalMcp();
  const container = createStubContainer(
    new Map<symbol, unknown>([
      [EXTERNAL_PLUGIN_MCP_TOKEN, opts.externalMcp ?? externalMcp],
    ]),
  );
  const localItems = createMockLocalItems();
  const installLocalItems = createMockInstallLocalItems();
  const approvals = new LocalItemApprovals();
  // The real local-item steps over the mocked collaborators, so every
  // plan / confirm / save case below exercises the code the handler delegates to.
  const pluginLocalItems = new PluginLocalItemsService(
    logger as unknown as Logger,
    sentry as unknown as SentryService,
    pluginLoader as unknown as PluginLoaderService,
    externalInstaller as unknown as ConstructorParameters<
      typeof PluginLocalItemsService
    >[3],
    localItems as unknown as MarketplaceLocalItemsService,
    installLocalItems as unknown as InstallLocalItemsService,
  );

  const handlers = new PluginRpcHandlers(
    logger as unknown as Logger,
    rpcHandler as unknown as import('@ptah-extension/vscode-core').RpcHandler,
    pluginLoader as unknown as PluginLoaderService,
    harnessPropagation as unknown as HarnessPropagationService,
    workspaceProvider,
    commandDiscovery as unknown as CommandDiscoveryService,
    sentry as unknown as SentryService,
    marketplaceRegistry as unknown as ConstructorParameters<
      typeof PluginRpcHandlers
    >[7],
    externalInstaller as unknown as ConstructorParameters<
      typeof PluginRpcHandlers
    >[8],
    externalState as unknown as ConstructorParameters<
      typeof PluginRpcHandlers
    >[9],
    container,
    pluginLocalItems,
    installLocalItems as unknown as InstallLocalItemsService,
    approvals,
  );

  return {
    handlers,
    logger,
    rpcHandler,
    pluginLoader,
    harnessPropagation,
    workspaceProvider,
    commandDiscovery,
    sentry,
    marketplaceRegistry,
    externalInstaller,
    externalState,
    externalMcp,
    localItems,
    installLocalItems,
    approvals,
  };
}

async function call<TResult>(
  h: Harness,
  method: string,
  params: unknown = {},
): Promise<TResult> {
  const response = await h.rpcHandler.handleMessage({
    method,
    params: params as Record<string, unknown>,
    correlationId: `corr-${method}`,
  });
  if (!response.success) {
    throw new Error(`RPC ${method} failed: ${response.error}`);
  }
  return response.data as TResult;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PluginRpcHandlers', () => {
  describe('register()', () => {
    it('registers every plugin RPC method — bundled config and external marketplaces', () => {
      const h = makeHarness();
      h.handlers.register();

      // Asserted as a whole list rather than a count: the transport rejects any
      // prefix it does not know, so a method that is declared but never
      // registered fails at runtime, not here.
      expect(h.rpcHandler.getRegisteredMethods().sort()).toEqual(
        [
          'plugins:get-config',
          'plugins:list-available',
          'plugins:list-skills',
          'plugins:save-config',
          'plugins:list-marketplaces',
          'plugins:add-marketplace',
          'plugins:remove-marketplace',
          'plugins:browse-marketplace',
          'plugins:install-external',
          'plugins:uninstall-external',
          'plugins:replace-kept-items',
          'plugins:resolve-config-home',
        ].sort(),
      );
    });

    it('declares exactly the methods it registers', () => {
      const h = makeHarness();
      h.handlers.register();

      expect(h.rpcHandler.getRegisteredMethods().sort()).toEqual(
        [...PluginRpcHandlers.METHODS].sort(),
      );
    });
  });

  // -------------------------------------------------------------------------
  // plugins:list-available
  // -------------------------------------------------------------------------

  describe('plugins:list-available', () => {
    it('returns the plugin list from the loader', async () => {
      const plugins = [makePluginInfo('alpha'), makePluginInfo('beta')];
      const h = makeHarness({ availablePlugins: plugins });
      h.handlers.register();

      const result = await call<{ plugins: PluginInfo[] }>(
        h,
        'plugins:list-available',
      );

      expect(result.plugins).toHaveLength(2);
      expect(result.plugins.map((p) => p.id)).toEqual(['alpha', 'beta']);
    });

    it('captures loader exceptions to Sentry and surfaces an RPC error', async () => {
      const h = makeHarness();
      h.pluginLoader.getAvailablePlugins.mockImplementation(() => {
        throw new Error('loader boom');
      });
      h.handlers.register();

      const response = await h.rpcHandler.handleMessage({
        method: 'plugins:list-available',
        params: {},
        correlationId: 'corr',
      });

      expect(response.success).toBe(false);
      expect(h.sentry.captureException).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // plugins:get-config
  // -------------------------------------------------------------------------

  describe('plugins:get-config', () => {
    it('returns the saved workspace config verbatim', async () => {
      const config: PluginConfigState = {
        enabledPluginIds: ['alpha', 'beta'],
        disabledSkillIds: ['bad-skill'],
        lastUpdated: 123456789,
      } as unknown as PluginConfigState;
      const h = makeHarness({ workspaceConfig: config });
      h.handlers.register();

      const result = await call<PluginConfigState>(h, 'plugins:get-config');

      expect(result.enabledPluginIds).toEqual(['alpha', 'beta']);
      expect(result.disabledSkillIds).toEqual(['bad-skill']);
    });
  });

  // -------------------------------------------------------------------------
  // plugins:save-config
  // -------------------------------------------------------------------------

  describe('plugins:save-config', () => {
    it('drops IDs not present in the known-plugin registry', async () => {
      const h = makeHarness({
        availablePlugins: [makePluginInfo('alpha'), makePluginInfo('beta')],
      });
      h.handlers.register();

      const result = await call<{ success: boolean }>(
        h,
        'plugins:save-config',
        {
          enabledPluginIds: ['alpha', 'unknown-plugin', 'beta'],
          disabledSkillIds: [],
        },
      );

      expect(result.success).toBe(true);
      const [savedConfig] =
        h.pluginLoader.saveWorkspacePluginConfig.mock.calls[0];
      expect(savedConfig.enabledPluginIds).toEqual(['alpha', 'beta']);
    });

    it('deduplicates repeated plugin IDs', async () => {
      const h = makeHarness({
        availablePlugins: [makePluginInfo('alpha')],
      });
      h.handlers.register();

      await call(h, 'plugins:save-config', {
        enabledPluginIds: ['alpha', 'alpha', 'alpha'],
        disabledSkillIds: [],
      });

      const [savedConfig] =
        h.pluginLoader.saveWorkspacePluginConfig.mock.calls[0];
      expect(savedConfig.enabledPluginIds).toEqual(['alpha']);
    });

    it('preserves existing disabledSkillIds when the caller omits them (TUI back-compat)', async () => {
      // TUI clients send { enabledPluginIds } without disabledSkillIds — the
      // handler MUST keep whatever was previously saved so toggling plugins
      // via TUI doesn't silently reset skill disables configured via webview.
      const h = makeHarness({
        availablePlugins: [makePluginInfo('alpha')],
        workspaceConfig: {
          enabledPluginIds: [],
          disabledSkillIds: ['sticky-skill'],
          lastUpdated: 0,
        } as unknown as PluginConfigState,
        resolvedPaths: ['/plugins/alpha'],
        discoveredSkills: [makeSkillEntry('sticky-skill', 'alpha')],
      });
      h.handlers.register();

      await call(h, 'plugins:save-config', {
        enabledPluginIds: ['alpha'],
        // disabledSkillIds omitted on purpose
      });

      const [savedConfig] =
        h.pluginLoader.saveWorkspacePluginConfig.mock.calls[0];
      expect(savedConfig.disabledSkillIds).toEqual(['sticky-skill']);
    });

    it('replaces disabledSkillIds when an explicit array is provided', async () => {
      const h = makeHarness({
        availablePlugins: [makePluginInfo('alpha')],
        resolvedPaths: ['/plugins/alpha'],
        discoveredSkills: [
          makeSkillEntry('skill-a', 'alpha'),
          makeSkillEntry('skill-b', 'alpha'),
        ],
      });
      h.handlers.register();

      await call(h, 'plugins:save-config', {
        enabledPluginIds: ['alpha'],
        disabledSkillIds: ['skill-a'],
      });

      const [savedConfig] =
        h.pluginLoader.saveWorkspacePluginConfig.mock.calls[0];
      expect(savedConfig.disabledSkillIds).toEqual(['skill-a']);
    });

    it('filters disabled skill IDs that are not in the discovered skills set', async () => {
      const h = makeHarness({
        availablePlugins: [makePluginInfo('alpha')],
        resolvedPaths: ['/plugins/alpha'],
        discoveredSkills: [makeSkillEntry('real-skill', 'alpha')],
      });
      h.handlers.register();

      await call(h, 'plugins:save-config', {
        enabledPluginIds: ['alpha'],
        disabledSkillIds: ['real-skill', 'ghost-skill'],
      });

      const [savedConfig] =
        h.pluginLoader.saveWorkspacePluginConfig.mock.calls[0];
      expect(savedConfig.disabledSkillIds).toEqual(['real-skill']);
    });

    it('invalidates command discovery cache AND reconciles the harness after save', async () => {
      const h = makeHarness({
        availablePlugins: [makePluginInfo('alpha')],
        resolvedPaths: ['/plugins/alpha'],
        discoveredSkills: [],
      });
      h.handlers.register();

      await call(h, 'plugins:save-config', {
        enabledPluginIds: ['alpha'],
        disabledSkillIds: [],
      });

      expect(h.commandDiscovery.invalidateCache).toHaveBeenCalledTimes(1);
      expect(h.harnessPropagation.propagate).toHaveBeenCalledWith(
        HARNESS_ROOT,
        'plugins:save-config',
        // Enable/disable changes which sources are FILTERED IN, never what a
        // source contains, so the user-layer refresh is deliberately skipped.
        { skipUserLayerRefresh: true },
      );
    });

    it('hands the reconciler no plugin paths, so it cannot narrow the harness set', async () => {
      // Regression, restated for the copy-based harness (TASK_2026_278): the
      // handler used to compute the plugin path list itself and pass it down,
      // and any list that missed the harness-authored `ptah-harness-*` dirs got
      // them pruned as stale on the next toggle. The reconciler now resolves
      // sources through its own PluginConfigSourceResolver, which always
      // appends those dirs — so the invariant to guard is that the handler
      // stays out of it: one reconcile, workspace root + options, no paths.
      const h = makeHarness({
        availablePlugins: [makePluginInfo('alpha')],
        resolvedPaths: ['/plugins/alpha'],
        currentPluginPaths: [
          '/plugins/alpha',
          '/home/user/.ptah/plugins/ptah-harness-demo-skill',
        ],
        discoveredSkills: [],
      });
      h.handlers.register();

      await call(h, 'plugins:save-config', {
        enabledPluginIds: ['alpha'],
        disabledSkillIds: [],
      });

      expect(h.harnessPropagation.propagate).toHaveBeenCalledTimes(1);
      const [root, reason, options, ...extra] =
        h.harnessPropagation.propagate.mock.calls[0];
      expect(root).toBe(HARNESS_ROOT);
      expect(reason).toBe('plugins:save-config');
      expect(options).toEqual({ skipUserLayerRefresh: true });
      expect(extra).toEqual([]);
    });

    it('reconciles even when the user disables every plugin', async () => {
      // An empty selection is a legitimate desired state, not a reason to skip
      // the pass — the harness-authored plugins are opt-OUT and survive it,
      // and the copies for the plugins just turned off have to be reaped.
      const h = makeHarness({
        availablePlugins: [makePluginInfo('alpha')],
        resolvedPaths: [],
        currentPluginPaths: [
          '/home/user/.ptah/plugins/ptah-harness-demo-skill',
        ],
        discoveredSkills: [],
      });
      h.handlers.register();

      const result = await call(h, 'plugins:save-config', {
        enabledPluginIds: [],
        disabledSkillIds: [],
      });

      expect(result).toEqual({ success: true, kept: [] });
      expect(h.harnessPropagation.propagate).toHaveBeenCalledWith(
        HARNESS_ROOT,
        'plugins:save-config',
        // Enable/disable changes which sources are FILTERED IN, never what a
        // source contains, so the user-layer refresh is deliberately skipped.
        { skipUserLayerRefresh: true },
      );
    });

    it('still reports success when the reconcile throws (the selection IS saved)', async () => {
      const h = makeHarness({
        availablePlugins: [makePluginInfo('alpha')],
      });
      h.harnessPropagation.propagate.mockRejectedValue(new Error('EPERM'));
      h.handlers.register();

      const result = await call<{ success: boolean }>(
        h,
        'plugins:save-config',
        { enabledPluginIds: ['alpha'], disabledSkillIds: [] },
      );

      expect(result.success).toBe(true);
      expect(h.logger.warn).toHaveBeenCalled();
    });

    it('validates disabled skill IDs against the enabled bundled paths when no harness dirs exist', async () => {
      const h = makeHarness({
        availablePlugins: [makePluginInfo('alpha')],
        resolvedPaths: ['/plugins/alpha'],
        currentPluginPaths: ['/plugins/alpha'],
        discoveredSkills: [makeSkillEntry('real-skill', 'alpha')],
      });
      h.handlers.register();

      await call(h, 'plugins:save-config', {
        enabledPluginIds: ['alpha'],
        disabledSkillIds: ['real-skill'],
      });

      expect(h.pluginLoader.discoverSkillsForPlugins).toHaveBeenCalledWith([
        '/plugins/alpha',
      ]);
    });

    it('widens the skill-ID scope to harness dirs so a harness skill can be disabled', async () => {
      // Harness plugins are opt-out, so they are absent from enabledPluginIds
      // and therefore from resolvePluginPaths(). Scoping skill validation to
      // that result alone would drop every harness skill ID as "unknown" and
      // silently break the per-skill toggle for user-authored skills.
      const harnessDir = '/home/user/.ptah/plugins/ptah-harness-demo-skill';
      const h = makeHarness({
        availablePlugins: [
          makePluginInfo('alpha'),
          makeHarnessPluginInfo('ptah-harness-demo-skill'),
        ],
        resolvedPaths: ['/plugins/alpha'],
        harnessPaths: [harnessDir],
        currentPluginPaths: ['/plugins/alpha', harnessDir],
        discoveredSkills: [
          makeSkillEntry('real-skill', 'alpha'),
          makeSkillEntry('demo-skill', 'ptah-harness-demo-skill'),
        ],
      });
      h.handlers.register();

      await call(h, 'plugins:save-config', {
        enabledPluginIds: ['alpha'],
        disabledSkillIds: ['demo-skill'],
      });

      expect(h.pluginLoader.discoverSkillsForPlugins).toHaveBeenCalledWith([
        '/plugins/alpha',
        harnessDir,
      ]);
      const [savedConfig] =
        h.pluginLoader.saveWorkspacePluginConfig.mock.calls[0];
      expect(savedConfig.disabledSkillIds).toEqual(['demo-skill']);
    });

    it('keeps a harness plugin ID in enabledPluginIds instead of dropping it', async () => {
      // Regression: knownPluginIds came from a bundled-only registry, so
      // save-config returned success and persisted nothing for a harness ID.
      const h = makeHarness({
        availablePlugins: [
          makePluginInfo('alpha'),
          makeHarnessPluginInfo('ptah-harness-foo'),
        ],
      });
      h.handlers.register();

      const result = await call<{ success: boolean }>(
        h,
        'plugins:save-config',
        {
          enabledPluginIds: ['alpha', 'ptah-harness-foo'],
          disabledSkillIds: [],
        },
      );

      expect(result.success).toBe(true);
      const [savedConfig] =
        h.pluginLoader.saveWorkspacePluginConfig.mock.calls[0];
      expect(savedConfig.enabledPluginIds).toEqual([
        'alpha',
        'ptah-harness-foo',
      ]);
    });

    it('persists disabledPluginIds for an unchecked harness plugin', async () => {
      const h = makeHarness({
        availablePlugins: [
          makePluginInfo('alpha'),
          makeHarnessPluginInfo('ptah-harness-foo'),
        ],
      });
      h.handlers.register();

      await call(h, 'plugins:save-config', {
        enabledPluginIds: ['alpha'],
        disabledSkillIds: [],
        disabledPluginIds: ['ptah-harness-foo'],
      });

      const [savedConfig] =
        h.pluginLoader.saveWorkspacePluginConfig.mock.calls[0];
      expect(savedConfig.disabledPluginIds).toEqual(['ptah-harness-foo']);
    });

    it('rejects an unknown ID in disabledPluginIds', async () => {
      const h = makeHarness({
        availablePlugins: [makeHarnessPluginInfo('ptah-harness-foo')],
      });
      h.handlers.register();

      await call(h, 'plugins:save-config', {
        enabledPluginIds: [],
        disabledSkillIds: [],
        disabledPluginIds: ['ptah-harness-foo', 'ptah-harness-ghost', 42],
      });

      const [savedConfig] =
        h.pluginLoader.saveWorkspacePluginConfig.mock.calls[0];
      expect(savedConfig.disabledPluginIds).toEqual(['ptah-harness-foo']);
    });

    it('forwards disabledPluginIds as undefined when the caller omits it (TUI/CLI back-compat)', async () => {
      // undefined is the "preserve what is persisted" signal — sending [] here
      // would silently re-enable every plugin the user had turned off.
      const h = makeHarness({
        availablePlugins: [makePluginInfo('alpha')],
      });
      h.handlers.register();

      await call(h, 'plugins:save-config', {
        enabledPluginIds: ['alpha'],
        disabledSkillIds: [],
      });

      const [savedConfig] =
        h.pluginLoader.saveWorkspacePluginConfig.mock.calls[0];
      expect(savedConfig.disabledPluginIds).toBeUndefined();
    });

    it('still drops a genuinely unknown harness-prefixed ID', async () => {
      const h = makeHarness({
        availablePlugins: [
          makePluginInfo('alpha'),
          makeHarnessPluginInfo('ptah-harness-foo'),
        ],
      });
      h.handlers.register();

      await call(h, 'plugins:save-config', {
        enabledPluginIds: ['alpha', 'ptah-harness-ghost', 'totally-unknown'],
        disabledSkillIds: [],
      });

      const [savedConfig] =
        h.pluginLoader.saveWorkspacePluginConfig.mock.calls[0];
      expect(savedConfig.enabledPluginIds).toEqual(['alpha']);
    });

    it('returns a structured error shape (not a throw) when the loader throws', async () => {
      const h = makeHarness({
        availablePlugins: [makePluginInfo('alpha')],
      });
      h.pluginLoader.saveWorkspacePluginConfig.mockRejectedValue(
        new Error('disk full'),
      );
      h.handlers.register();

      // Note: the handler returns `{ success: false, error }` — the RPC
      // response itself is success=true with data={success:false,...}.
      const result = await call<{ success: boolean; error?: string }>(
        h,
        'plugins:save-config',
        { enabledPluginIds: ['alpha'], disabledSkillIds: [] },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('disk full');
      expect(h.sentry.captureException).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // plugins:list-skills
  // -------------------------------------------------------------------------

  describe('plugins:list-skills', () => {
    it('returns discovered skills for the given plugin IDs', async () => {
      const h = makeHarness({
        resolvedPaths: ['/plugins/alpha', '/plugins/beta'],
        discoveredSkills: [
          makeSkillEntry('s1', 'alpha'),
          makeSkillEntry('s2', 'beta'),
        ],
      });
      h.handlers.register();

      const result = await call<{ skills: PluginSkillEntry[] }>(
        h,
        'plugins:list-skills',
        { pluginIds: ['alpha', 'beta'] },
      );

      expect(result.skills).toHaveLength(2);
      expect(result.skills.map((s) => s.skillId)).toEqual(['s1', 's2']);
      expect(h.pluginLoader.resolvePluginPaths).toHaveBeenCalledWith([
        'alpha',
        'beta',
      ]);
    });

    it('filters non-string entries out of pluginIds before resolving', async () => {
      const h = makeHarness({
        resolvedPaths: [],
        discoveredSkills: [],
      });
      h.handlers.register();

      await call(h, 'plugins:list-skills', {
        pluginIds: ['alpha', 42, null, { malicious: true }, 'beta'],
      });

      expect(h.pluginLoader.resolvePluginPaths).toHaveBeenCalledWith([
        'alpha',
        'beta',
      ]);
    });

    it('forwards harness plugin IDs to the resolver so their skills are listed', async () => {
      // The modal calls this with every ID from plugins:list-available, which
      // now includes ptah-harness-*. Those IDs must reach resolvePluginPaths
      // intact or harness skills never render a per-skill checkbox.
      const h = makeHarness({
        resolvedPaths: [
          '/plugins/alpha',
          '/home/user/.ptah/plugins/ptah-harness-foo',
        ],
        discoveredSkills: [
          makeSkillEntry('s1', 'alpha'),
          makeSkillEntry('demo-skill', 'ptah-harness-foo'),
        ],
      });
      h.handlers.register();

      const result = await call<{ skills: PluginSkillEntry[] }>(
        h,
        'plugins:list-skills',
        { pluginIds: ['alpha', 'ptah-harness-foo'] },
      );

      expect(h.pluginLoader.resolvePluginPaths).toHaveBeenCalledWith([
        'alpha',
        'ptah-harness-foo',
      ]);
      expect(result.skills.map((s) => s.pluginId)).toContain(
        'ptah-harness-foo',
      );
    });

    it('returns { skills: [] } when pluginIds is missing entirely', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ skills: PluginSkillEntry[] }>(
        h,
        'plugins:list-skills',
      );

      expect(result.skills).toEqual([]);
      expect(h.pluginLoader.resolvePluginPaths).toHaveBeenCalledWith([]);
    });
  });

  // -------------------------------------------------------------------------
  // External marketplace — the two mutations that change the active plugin set
  //
  // Only the reconcile contract is covered here; consent, token validation and
  // download live in the marketplace lib and have their own suites.
  // -------------------------------------------------------------------------

  describe('external install / uninstall', () => {
    const PLUGIN_ID = 'external:dotnet/skills/dotnet';
    const CONSENT_TOKEN = 'a'.repeat(64);

    function installResult(): {
      pluginId: string;
      displayName: string;
      installedVersion: string;
      filesWritten: number;
      skippedBinaryFiles: string[];
      planLocalItems: ExternalLocalItem[];
    } {
      return {
        pluginId: PLUGIN_ID,
        displayName: 'dotnet',
        installedVersion: '1.2.0',
        filesWritten: 4,
        skippedBinaryFiles: [],
        planLocalItems: [],
      };
    }

    it('reconciles with the install reason once the plugin is on disk', async () => {
      const h = makeHarness();
      h.externalInstaller.confirmInstall.mockResolvedValue(installResult());
      h.handlers.register();

      await call(h, 'plugins:install-external', {
        source: 'dotnet/skills',
        plugin: 'dotnet',
        consentToken: CONSENT_TOKEN,
      });

      expect(h.harnessPropagation.propagate).toHaveBeenCalledWith(
        HARNESS_ROOT,
        'plugins:install-external',
        {},
      );
    });

    it('reports the collisions the reconcile actually recorded for this plugin', async () => {
      // The pre-install prediction compares names; this is the outcome. Only
      // the losers this plugin brought are reported — a collision between two
      // OTHER sources is not this install's news.
      const collisions: HarnessCollision[] = [
        {
          slug: 'run-tests',
          shadowedSource: '/plugins/external-dotnet/skills/run-tests',
          shadowedPluginId: PLUGIN_ID,
          reason: 'duplicate-slug',
        },
        {
          slug: 'unrelated',
          shadowedSource: '/plugins/other/skills/unrelated',
          shadowedPluginId: 'external:someone/else/other',
          reason: 'duplicate-slug',
        },
      ];
      const h = makeHarness({
        currentPluginPaths: ['/plugins/alpha'],
        discoveredSkills: [makeSkillEntry('run-tests', 'alpha')],
      });
      h.externalInstaller.confirmInstall.mockResolvedValue(installResult());
      h.harnessPropagation.propagate.mockResolvedValue(
        makeHealth({ collisions }),
      );
      h.handlers.register();

      const response = await call<{
        status: string;
        result: {
          collisions: Array<{ skillName: string; shadowedBy: string }>;
        };
      }>(h, 'plugins:install-external', {
        source: 'dotnet/skills',
        plugin: 'dotnet',
        consentToken: CONSENT_TOKEN,
      });

      expect(response.status).toBe('installed');
      expect(response.result.collisions).toEqual([
        { skillName: 'run-tests', shadowedBy: 'alpha' },
      ]);
    });

    it('reconciles with the uninstall reason after removing the tree', async () => {
      const h = makeHarness();
      h.externalInstaller.uninstall.mockResolvedValue(true);
      h.handlers.register();

      await call(h, 'plugins:uninstall-external', { pluginId: PLUGIN_ID });

      // No `skipUserLayerRefresh`: uninstall MUST refresh, because the reap
      // half of `reconcileAll` is the only thing that removes the removed
      // plugin's clones from `~/.ptah/user` (defect 7).
      expect(h.harnessPropagation.propagate).toHaveBeenCalledWith(
        HARNESS_ROOT,
        'plugins:uninstall-external',
        {},
      );
    });

    it('does not reconcile when there was nothing to uninstall', async () => {
      const h = makeHarness();
      h.externalInstaller.uninstall.mockResolvedValue(false);
      h.handlers.register();

      await call(h, 'plugins:uninstall-external', { pluginId: PLUGIN_ID });

      expect(h.harnessPropagation.propagate).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // Declared MCP servers (TASK_2026_287)
    //
    // The consent dialog has always promised these would be installed. Nothing
    // installed them: `plugin-marketplace` has no edge to `harness-sync` or to
    // `McpInstallService`, so no intent was ever recorded and the reconciler
    // never saw a single declared server.
    // -----------------------------------------------------------------------

    const DECLARED_SERVER = {
      name: 'binlog',
      command: 'dotnet',
      args: ['dnx', 'Microsoft.AITools.BinlogMcp'],
      commandLine: 'dotnet dnx Microsoft.AITools.BinlogMcp',
    };

    it('installs the MCP servers the consent record lists, BEFORE the reconcile that applies them', async () => {
      const h = makeHarness();
      h.externalInstaller.confirmInstall.mockResolvedValue(installResult());
      h.externalState.findInstalled.mockReturnValue({
        pluginId: PLUGIN_ID,
        mcpServers: [DECLARED_SERVER],
      });
      h.externalMcp.install.mockResolvedValue({
        serverKeys: ['binlog'],
        warnings: [],
      });
      h.handlers.register();

      const response = await call<{
        result: { mcpServersInstalled?: string[] };
      }>(h, 'plugins:install-external', {
        source: 'dotnet/skills',
        plugin: 'dotnet',
        consentToken: CONSENT_TOKEN,
      });

      // No `mcpScope` on the call: the schema default is the workspace.
      expect(h.externalMcp.install).toHaveBeenCalledWith(
        PLUGIN_ID,
        [DECLARED_SERVER],
        WORKSPACE_ROOT,
        'workspace',
      );
      expect(response.result.mcpServersInstalled).toEqual(['binlog']);

      // Ordering is load-bearing: the reconciler's desired MCP state IS
      // `~/.ptah/mcp-installed.json`, so an intent recorded after the pass
      // would sit unapplied until some later trigger.
      const intentOrder = h.externalMcp.install.mock.invocationCallOrder[0];
      const reconcileOrder =
        h.harnessPropagation.propagate.mock.invocationCallOrder[0];
      expect(intentOrder).toBeLessThan(reconcileOrder);
    });

    it('passes the explicit "All workspaces" choice through as the global scope', async () => {
      const h = makeHarness();
      h.externalInstaller.confirmInstall.mockResolvedValue(installResult());
      h.externalState.findInstalled.mockReturnValue({
        pluginId: PLUGIN_ID,
        mcpServers: [DECLARED_SERVER],
      });
      h.handlers.register();

      await call(h, 'plugins:install-external', {
        source: 'dotnet/skills',
        plugin: 'dotnet',
        consentToken: CONSENT_TOKEN,
        mcpScope: 'global',
      });

      expect(h.externalMcp.install).toHaveBeenCalledWith(
        PLUGIN_ID,
        [DECLARED_SERVER],
        WORKSPACE_ROOT,
        'global',
      );
    });

    it('rejects an mcpScope outside the two scopes before anything installs', async () => {
      const h = makeHarness();
      h.handlers.register();

      await expect(
        call(h, 'plugins:install-external', {
          source: 'dotnet/skills',
          plugin: 'dotnet',
          consentToken: CONSENT_TOKEN,
          mcpScope: 'user',
        }),
      ).rejects.toThrow();
      expect(h.externalInstaller.confirmInstall).not.toHaveBeenCalled();
      expect(h.externalMcp.install).not.toHaveBeenCalled();
    });

    it('installs the plugin files with no folder open while the workspace-scope servers are skipped with a warning', async () => {
      // The REAL service over a fake installer: what is proven is the whole
      // path — default scope, no folder, warning on the result, no intent.
      const installs: string[] = [];
      const installer: ExternalMcpInstaller = {
        install: (_name, serverKey) => {
          installs.push(serverKey);
          return Promise.resolve([]);
        },
        uninstall: () => Promise.resolve([]),
        intentScopeOf: () => undefined,
        listInstalled: () => Promise.resolve([]),
      };
      const h = makeHarness({
        workspaceRoot: null,
        externalMcp: new ExternalPluginMcpService(
          createMockLogger() as unknown as Logger,
          installer,
          { isInstalled: () => Promise.resolve(false) },
        ),
      });
      h.externalInstaller.confirmInstall.mockResolvedValue(installResult());
      h.externalState.findInstalled.mockReturnValue({
        pluginId: PLUGIN_ID,
        mcpServers: [DECLARED_SERVER],
      });
      h.handlers.register();

      const response = await call<{
        status: string;
        result: { mcpServersInstalled?: string[]; mcpWarnings?: string[] };
      }>(h, 'plugins:install-external', {
        source: 'dotnet/skills',
        plugin: 'dotnet',
        consentToken: CONSENT_TOKEN,
      });

      expect(h.externalInstaller.confirmInstall).toHaveBeenCalledWith(
        CONSENT_TOKEN,
      );
      expect(response.status).toBe('installed');
      expect(installs).toEqual([]);
      expect(response.result.mcpServersInstalled).toEqual([]);
      expect(response.result.mcpWarnings).toEqual([NO_WORKSPACE_MCP_WARNING]);
    });

    it('installs from the CONSENT RECORD, so nothing outside what the user approved can reach a config file', async () => {
      const h = makeHarness();
      h.externalInstaller.confirmInstall.mockResolvedValue(installResult());
      h.externalState.findInstalled.mockReturnValue(null);
      h.handlers.register();

      await call(h, 'plugins:install-external', {
        source: 'dotnet/skills',
        plugin: 'dotnet',
        consentToken: CONSENT_TOKEN,
      });

      expect(h.externalMcp.install).not.toHaveBeenCalled();
    });

    it('surfaces a colliding key as a warning on the install result while the plugin still installs', async () => {
      const h = makeHarness();
      h.externalInstaller.confirmInstall.mockResolvedValue(installResult());
      h.externalState.findInstalled.mockReturnValue({
        pluginId: PLUGIN_ID,
        mcpServers: [DECLARED_SERVER],
      });
      h.externalMcp.install.mockResolvedValue({
        serverKeys: ['binlog'],
        warnings: ['MCP server "binlog" is already defined by you in x.json.'],
      });
      h.handlers.register();

      const response = await call<{
        status: string;
        result: { mcpWarnings?: string[] };
      }>(h, 'plugins:install-external', {
        source: 'dotnet/skills',
        plugin: 'dotnet',
        consentToken: CONSENT_TOKEN,
      });

      // A key Ptah refuses to overwrite is advisory, not a failed install: the
      // plugin's files landed and its skills work.
      expect(response.status).toBe('installed');
      expect(response.result.mcpWarnings).toEqual([
        'MCP server "binlog" is already defined by you in x.json.',
      ]);
    });

    it('keeps the install successful when the MCP step throws', async () => {
      const h = makeHarness();
      h.externalInstaller.confirmInstall.mockResolvedValue(installResult());
      h.externalState.findInstalled.mockReturnValue({
        pluginId: PLUGIN_ID,
        mcpServers: [DECLARED_SERVER],
      });
      h.externalMcp.install.mockRejectedValue(new Error('intent store locked'));
      h.handlers.register();

      const response = await call<{
        status: string;
        result: { mcpWarnings?: string[] };
      }>(h, 'plugins:install-external', {
        source: 'dotnet/skills',
        plugin: 'dotnet',
        consentToken: CONSENT_TOKEN,
      });

      expect(response.status).toBe('installed');
      expect(response.result.mcpWarnings).toEqual([
        expect.stringContaining('intent store locked'),
      ]);
    });

    it('forgets the declared MCP servers on uninstall, reading the record BEFORE it is deleted', async () => {
      const h = makeHarness();
      h.externalInstaller.uninstall.mockResolvedValue(true);
      h.externalState.findInstalled.mockReturnValue({
        pluginId: PLUGIN_ID,
        mcpServers: [DECLARED_SERVER],
      });
      h.externalMcp.uninstall.mockResolvedValue({
        serverKeys: ['binlog'],
        warnings: [],
      });
      h.handlers.register();

      const result = await call<{ mcpServersRemoved?: string[] }>(
        h,
        'plugins:uninstall-external',
        { pluginId: PLUGIN_ID },
      );

      expect(h.externalMcp.uninstall).toHaveBeenCalledWith(
        PLUGIN_ID,
        [DECLARED_SERVER],
        WORKSPACE_ROOT,
      );
      expect(result.mcpServersRemoved).toEqual(['binlog']);

      // The record is the only thing that says which keys were this plugin's.
      // Reading it after `uninstall()` deleted it would leave the servers in
      // every config file forever.
      const readOrder =
        h.externalState.findInstalled.mock.invocationCallOrder[0];
      const removeOrder =
        h.externalInstaller.uninstall.mock.invocationCallOrder[0];
      expect(readOrder).toBeLessThan(removeOrder);
    });

    it('does not touch MCP intents when there was nothing to uninstall', async () => {
      const h = makeHarness();
      h.externalInstaller.uninstall.mockResolvedValue(false);
      h.externalState.findInstalled.mockReturnValue({
        pluginId: PLUGIN_ID,
        mcpServers: [DECLARED_SERVER],
      });
      h.handlers.register();

      await call(h, 'plugins:uninstall-external', { pluginId: PLUGIN_ID });

      expect(h.externalMcp.uninstall).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// TASK_2026_701 B12 — harness root, config home, local items, kept reports
// ---------------------------------------------------------------------------

describe('PluginRpcHandlers — harness root, config home and local items (TASK_2026_701 B12)', () => {
  const PLUGIN_ID = 'external:dotnet/skills/dotnet';
  const CONSENT_TOKEN = 'b'.repeat(64);
  const FOREIGN_ID = '99999999-9999-4999-8999-999999999999';

  function makePlan(): ExternalInstallPlan {
    return {
      pluginId: PLUGIN_ID,
      source: 'dotnet/skills',
      plugin: 'dotnet',
      displayName: 'dotnet',
      version: '1.2.0',
      skills: ['run-tests'],
      fileCount: 3,
      totalBytes: 10,
      scriptFiles: [],
      skippedBinaryFiles: [],
      mcpServers: [],
      collisions: [],
      consentToken: CONSENT_TOKEN,
    };
  }

  function planItem(
    approvalId: string,
    kind: ExternalLocalItem['kind'],
    relPath: string,
  ): ExternalLocalItem {
    return {
      approvalId,
      ...(kind === 'library-clone' ? {} : { target: 'claude' as const }),
      relPath,
      family: 'external',
      kind,
    };
  }

  const ITEM_EDITED = planItem(
    '11111111-1111-4111-8111-111111111111',
    'owned-edited',
    '.claude/skills/run-tests',
  );
  const ITEM_CLONE = planItem(
    '22222222-2222-4222-8222-222222222222',
    'library-clone',
    'skills/run-tests',
  );
  const ITEM_AGENT = planItem(
    '33333333-3333-4333-8333-333333333333',
    'agent-source',
    '.claude/agents/test-reviewer.md',
  );

  async function rpc(
    h: Harness,
    method: string,
    params: unknown,
  ): Promise<{ success: boolean; data?: unknown; errorCode?: string }> {
    const response = await h.rpcHandler.handleMessage({
      method,
      params: params as Record<string, unknown>,
      correlationId: `corr-${method}`,
    });
    return response as { success: boolean; data?: unknown; errorCode?: string };
  }

  function homeStatus(folders: string[]): PluginConfigHomeStatus {
    return {
      harnessRoot: HARNESS_ROOT,
      state: 'conflict',
      governingFolder: folders[0],
      candidates: folders.map((folder) => ({
        folder,
        enabledCount: 1,
        disabledCount: 0,
        differsFromHome: true,
      })),
    };
  }

  describe('plugins:get-config', () => {
    it('reads the harness-root config and adds the config-home notice', async () => {
      const h = makeHarness();
      const status = homeStatus([path.join(HARNESS_ROOT, 'app')]);
      h.pluginLoader.getConfigHomeStatus.mockReturnValue(status);
      h.handlers.register();

      const result = await call<{ configHome?: PluginConfigHomeStatus }>(
        h,
        'plugins:get-config',
      );

      expect(h.pluginLoader.getWorkspacePluginConfig).toHaveBeenCalledWith(
        HARNESS_ROOT,
      );
      expect(h.pluginLoader.getConfigHomeStatus).toHaveBeenCalledWith(
        HARNESS_ROOT,
      );
      expect(result.configHome).toEqual(status);
    });

    it('omits configHome when there is nothing to show', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<Record<string, unknown>>(
        h,
        'plugins:get-config',
      );

      expect('configHome' in result).toBe(false);
    });

    it('falls back to the open folder when the host keeps no state for the harness root', async () => {
      const h = makeHarness();
      h.pluginLoader.hasWorkspaceState.mockReturnValue(false);
      h.handlers.register();

      await call(h, 'plugins:get-config');

      expect(h.pluginLoader.getWorkspacePluginConfig).toHaveBeenCalledWith(
        undefined,
      );
    });
  });

  describe('sub-folder workspace (8.1)', () => {
    let tmpRoot: string;
    let subFolder: string;

    beforeEach(() => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-b12-'));
      fs.mkdirSync(path.join(tmpRoot, '.git'));
      subFolder = path.join(tmpRoot, 'packages', 'app');
      fs.mkdirSync(subFolder, { recursive: true });
    });

    afterEach(() => {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it('enable and disable write config to the harness-root home and reconcile it', async () => {
      const h = makeHarness({
        workspaceRoot: subFolder,
        availablePlugins: [makePluginInfo('alpha')],
      });
      h.handlers.register();

      await call(h, 'plugins:save-config', { enabledPluginIds: ['alpha'] });
      await call(h, 'plugins:save-config', { enabledPluginIds: [] });

      const harnessRoot = resolveHarnessWorkspaceRoot(subFolder);
      expect(harnessRoot).toBe(path.resolve(tmpRoot));
      for (const [, root] of h.pluginLoader.saveWorkspacePluginConfig.mock
        .calls) {
        expect(root).toBe(harnessRoot);
      }
      for (const [root] of h.harnessPropagation.propagate.mock.calls) {
        expect(root).toBe(harnessRoot);
      }
      expect(
        h.harnessPropagation.refreshUserLayerInBackground,
      ).toHaveBeenCalledWith(harnessRoot, 'plugins:save-config');
    });

    it('install writes config to the harness-root home and plans local items there', async () => {
      const h = makeHarness({ workspaceRoot: subFolder });
      h.externalInstaller.planInstall.mockResolvedValue(makePlan());
      h.externalInstaller.confirmInstall.mockResolvedValue({
        pluginId: PLUGIN_ID,
        displayName: 'dotnet',
        installedVersion: '1.2.0',
        filesWritten: 3,
        skippedBinaryFiles: [],
        collisions: [],
        planLocalItems: [],
      });
      h.handlers.register();

      await call(h, 'plugins:install-external', {
        source: 'dotnet/skills',
        plugin: 'dotnet',
      });
      await call(h, 'plugins:install-external', {
        source: 'dotnet/skills',
        plugin: 'dotnet',
        consentToken: CONSENT_TOKEN,
      });

      const harnessRoot = resolveHarnessWorkspaceRoot(subFolder);
      expect(h.localItems.planLocalItems).toHaveBeenCalledWith(
        expect.objectContaining({ harnessRoot }),
      );
      expect(h.pluginLoader.saveWorkspacePluginConfig).toHaveBeenCalledWith(
        expect.objectContaining({ enabledPluginIds: [PLUGIN_ID] }),
        harnessRoot,
      );
      expect(h.harnessPropagation.propagate).toHaveBeenCalledWith(
        harnessRoot,
        'plugins:install-external',
        {},
      );
    });
  });

  describe('plugins:save-config (plugin enable / plugin-agent families)', () => {
    it('fires a background Library refresh after a successful save (A13)', async () => {
      const h = makeHarness({ availablePlugins: [makePluginInfo('alpha')] });
      h.handlers.register();

      await call(h, 'plugins:save-config', { enabledPluginIds: ['alpha'] });

      expect(
        h.harnessPropagation.refreshUserLayerInBackground,
      ).toHaveBeenCalledWith(HARNESS_ROOT, 'plugins:save-config');
    });

    it('reports the kept items of the plugins this save turned on, and only those', async () => {
      const alpha: PluginInfo = {
        ...makePluginInfo('alpha'),
        skillNames: ['lint'],
        commandNames: ['fix'],
        agentNames: ['release-manager'],
      };
      const health = makeHealth();
      const kept: KeptItem[] = [
        {
          approvalId: '44444444-4444-4444-8444-444444444444',
          family: 'plugin-agent',
          target: 'claude',
          relPath: '.claude/agents/release-manager.md',
          reason: 'shadowed',
        },
      ];
      const h = makeHarness({
        availablePlugins: [alpha, makePluginInfo('beta')],
        workspaceConfig: {
          enabledPluginIds: ['beta'],
          disabledSkillIds: [],
          disabledPluginIds: [],
        },
      });
      h.harnessPropagation.propagate.mockResolvedValue(health);
      h.pluginLoader.getPluginSourceDescriptors.mockReturnValue({
        '/plugins/alpha': { sourceRef: 'ptah:alpha', label: 'Alpha' },
      });
      h.localItems.keptReport.mockResolvedValue(kept);
      h.handlers.register();

      const result = await call<{ success: boolean; kept?: KeptItem[] }>(
        h,
        'plugins:save-config',
        { enabledPluginIds: ['alpha', 'beta'] },
      );

      expect(h.localItems.keptReport).toHaveBeenCalledTimes(1);
      expect(h.localItems.keptReport).toHaveBeenCalledWith({
        harnessRoot: HARNESS_ROOT,
        sourceRef: 'ptah:alpha',
        slugs: {
          skills: ['lint'],
          commands: ['fix'],
          agents: ['release-manager'],
        },
        health,
        fileFamily: 'plugin-enable',
        agentFamily: 'plugin-agent',
      });
      expect(result).toEqual({ success: true, kept });
    });

    it('reports a harness plugin taken off the denylist as turned on', async () => {
      const h = makeHarness({
        availablePlugins: [makeHarnessPluginInfo('ptah-harness-demo')],
        workspaceConfig: {
          enabledPluginIds: [],
          disabledSkillIds: [],
          disabledPluginIds: ['ptah-harness-demo'],
        },
      });
      h.handlers.register();

      await call(h, 'plugins:save-config', {
        enabledPluginIds: [],
        disabledPluginIds: [],
      });

      expect(h.localItems.keptReport).toHaveBeenCalledWith(
        expect.objectContaining({ sourceRef: 'ptah:ptah-harness-demo' }),
      );
    });

    it('a failed config save returns the error with no kept report and no refresh (8.10)', async () => {
      const h = makeHarness({ availablePlugins: [makePluginInfo('alpha')] });
      h.pluginLoader.saveWorkspacePluginConfig.mockRejectedValue(
        new Error('disk full'),
      );
      h.handlers.register();

      const result = await call(h, 'plugins:save-config', {
        enabledPluginIds: ['alpha'],
      });

      expect(result).toEqual({ success: false, error: 'disk full' });
      expect(h.localItems.keptReport).not.toHaveBeenCalled();
      expect(
        h.harnessPropagation.refreshUserLayerInBackground,
      ).not.toHaveBeenCalled();
    });

    it('a failed reconcile after a successful save reports libraryPass failed (8.10a)', async () => {
      const h = makeHarness({ availablePlugins: [makePluginInfo('alpha')] });
      h.harnessPropagation.propagate.mockResolvedValue(null);
      h.handlers.register();

      const result = await call(h, 'plugins:save-config', {
        enabledPluginIds: ['alpha'],
      });

      expect(result).toMatchObject({ success: true, libraryPass: 'failed' });
    });
  });

  describe('plugins:install-external consent plan', () => {
    it('lists the local items, registered for the consent lifetime, and attaches them to the plan', async () => {
      const h = makeHarness();
      const slugs = {
        skills: ['run-tests'],
        commands: [],
        agents: ['test-reviewer'],
      };
      h.externalInstaller.planInstall.mockResolvedValue(makePlan());
      h.externalInstaller.planItemSlugs.mockReturnValue(slugs);
      h.localItems.planLocalItems.mockResolvedValue([ITEM_EDITED, ITEM_AGENT]);
      h.handlers.register();

      const response = await call<{
        status: string;
        plan: ExternalInstallPlan;
      }>(h, 'plugins:install-external', {
        source: 'dotnet/skills',
        plugin: 'dotnet',
      });

      expect(h.localItems.planLocalItems).toHaveBeenCalledWith({
        family: 'external',
        harnessRoot: HARNESS_ROOT,
        sourceRef: PLUGIN_ID,
        slugs,
        ttlMs: expect.any(Number),
      });
      expect(h.externalInstaller.attachLocalItems).toHaveBeenCalledWith(
        CONSENT_TOKEN,
        [ITEM_EDITED, ITEM_AGENT],
      );
      expect(response.status).toBe('consent-required');
      expect(response.plan.localItems).toEqual([ITEM_EDITED, ITEM_AGENT]);
    });

    it('ignores mcpScope on the plan call: nothing is installed or recorded', async () => {
      const h = makeHarness();
      h.externalInstaller.planInstall.mockResolvedValue(makePlan());
      h.handlers.register();

      const response = await call<{ status: string }>(
        h,
        'plugins:install-external',
        { source: 'dotnet/skills', plugin: 'dotnet', mcpScope: 'global' },
      );

      expect(response.status).toBe('consent-required');
      expect(h.externalInstaller.confirmInstall).not.toHaveBeenCalled();
      expect(h.externalMcp.install).not.toHaveBeenCalled();
    });

    it('omits localItems when nothing local is in the way', async () => {
      const h = makeHarness();
      h.externalInstaller.planInstall.mockResolvedValue(makePlan());
      h.handlers.register();

      const response = await call<{ plan: ExternalInstallPlan }>(
        h,
        'plugins:install-external',
        { source: 'dotnet/skills', plugin: 'dotnet' },
      );

      expect('localItems' in response.plan).toBe(false);
    });

    it('still shows the plan when local-item discovery fails', async () => {
      const h = makeHarness();
      h.externalInstaller.planInstall.mockResolvedValue(makePlan());
      h.localItems.planLocalItems.mockRejectedValue(new Error('scan failed'));
      h.handlers.register();

      const response = await call<{ status: string }>(
        h,
        'plugins:install-external',
        { source: 'dotnet/skills', plugin: 'dotnet' },
      );

      expect(response.status).toBe('consent-required');
      expect(h.logger.warn).toHaveBeenCalled();
    });
  });

  describe('plugins:install-external confirm', () => {
    function confirmed(planLocalItems: ExternalLocalItem[]) {
      return {
        pluginId: PLUGIN_ID,
        displayName: 'dotnet',
        installedVersion: '1.2.0',
        filesWritten: 3,
        skippedBinaryFiles: [],
        collisions: [],
        planLocalItems,
      };
    }

    it('applies only the replace decisions for ids its own plan issued, after the install', async () => {
      const h = makeHarness();
      h.externalInstaller.confirmInstall.mockResolvedValue(
        confirmed([ITEM_EDITED, ITEM_CLONE, ITEM_AGENT]),
      );
      h.installLocalItems.apply.mockResolvedValue({
        replaced: [
          {
            approvalId: ITEM_EDITED.approvalId,
            family: 'external',
            target: 'claude',
            relPath: ITEM_EDITED.relPath,
            reason: 'owned-edited',
          },
        ],
        kept: [
          {
            approvalId: ITEM_CLONE.approvalId,
            family: 'external',
            relPath: ITEM_CLONE.relPath,
            reason: 'changed-since-approval',
          },
        ],
        unknown: [],
      });
      h.handlers.register();

      const response = await call<{
        status: string;
        result: {
          kept?: KeptItem[];
          replaced?: ExternalLocalItem[];
          libraryPass?: string;
        } & Record<string, unknown>;
      }>(h, 'plugins:install-external', {
        source: 'dotnet/skills',
        plugin: 'dotnet',
        consentToken: CONSENT_TOKEN,
        localItemDecisions: {
          [ITEM_EDITED.approvalId]: 'replace',
          [ITEM_CLONE.approvalId]: 'replace',
          [ITEM_AGENT.approvalId]: 'keep',
          // Not issued by this plan: never applied.
          [FOREIGN_ID]: 'replace',
        },
      });

      expect(h.installLocalItems.apply).toHaveBeenCalledWith({
        family: 'external',
        harnessRoot: HARNESS_ROOT,
        approvalIds: [ITEM_EDITED.approvalId, ITEM_CLONE.approvalId],
      });
      // Replace runs after the install and its reconcile, never before.
      expect(
        h.externalInstaller.confirmInstall.mock.invocationCallOrder[0],
      ).toBeLessThan(h.installLocalItems.apply.mock.invocationCallOrder[0]);
      expect(
        h.harnessPropagation.propagate.mock.invocationCallOrder[0],
      ).toBeLessThan(h.installLocalItems.apply.mock.invocationCallOrder[0]);
      expect(response.result.replaced).toEqual([ITEM_EDITED]);
      expect(response.result.kept).toEqual([
        {
          approvalId: ITEM_CLONE.approvalId,
          family: 'external',
          relPath: ITEM_CLONE.relPath,
          reason: 'changed-since-approval',
        },
        {
          approvalId: ITEM_AGENT.approvalId,
          family: 'external',
          target: 'claude',
          relPath: ITEM_AGENT.relPath,
          reason: 'shadowed',
        },
      ]);
      expect(response.result.libraryPass).toBe('updated');
      // The plan's item list is server-side only.
      expect('planLocalItems' in response.result).toBe(false);
    });

    /** An apply report that replaced {@link ITEM_EDITED}. */
    function replacedEdited() {
      return {
        replaced: [
          {
            approvalId: ITEM_EDITED.approvalId,
            family: 'external' as const,
            target: 'claude',
            relPath: ITEM_EDITED.relPath,
            reason: 'owned-edited' as const,
          },
        ],
        kept: [],
        unknown: [],
      };
    }

    it('runs a final awaited Library pass after the replacements and reports that pass', async () => {
      const h = makeHarness();
      h.externalInstaller.confirmInstall.mockResolvedValue(
        confirmed([ITEM_EDITED]),
      );
      h.installLocalItems.apply.mockResolvedValue(replacedEdited());
      // The activation pass fails, the final one succeeds: the response must
      // carry the final pass, the one that saw the replaced bytes.
      h.harnessPropagation.propagateWithReport
        .mockResolvedValueOnce({ health: makeHealth(), userLayer: 'failed' })
        .mockResolvedValueOnce({
          health: makeHealth(),
          userLayer: 'refreshed',
        });
      h.handlers.register();

      const response = await call<{
        status: string;
        result: { replaced?: ExternalLocalItem[]; libraryPass?: string };
      }>(h, 'plugins:install-external', {
        source: 'dotnet/skills',
        plugin: 'dotnet',
        consentToken: CONSENT_TOKEN,
        localItemDecisions: { [ITEM_EDITED.approvalId]: 'replace' },
      });

      const passes = h.harnessPropagation.propagateWithReport;
      expect(passes).toHaveBeenCalledTimes(2);
      expect(passes).toHaveBeenLastCalledWith(
        HARNESS_ROOT,
        'plugins:install-external',
        {},
      );
      // install -> activation pass -> replace -> final pass.
      const applyOrder = h.installLocalItems.apply.mock.invocationCallOrder[0];
      expect(
        h.externalInstaller.confirmInstall.mock.invocationCallOrder[0],
      ).toBeLessThan(passes.mock.invocationCallOrder[0]);
      expect(passes.mock.invocationCallOrder[0]).toBeLessThan(applyOrder);
      expect(applyOrder).toBeLessThan(passes.mock.invocationCallOrder[1]);
      expect(response.status).toBe('installed');
      expect(response.result.replaced).toEqual([ITEM_EDITED]);
      expect(response.result.libraryPass).toBe('updated');
    });

    it('a failed final pass after a replacement keeps the install and reports libraryPass failed', async () => {
      const h = makeHarness();
      h.externalInstaller.confirmInstall.mockResolvedValue(
        confirmed([ITEM_EDITED]),
      );
      h.installLocalItems.apply.mockResolvedValue(replacedEdited());
      h.harnessPropagation.propagateWithReport
        .mockResolvedValueOnce({
          health: makeHealth(),
          userLayer: 'refreshed',
        })
        .mockRejectedValueOnce(new Error('mirror failed'));
      h.handlers.register();

      const response = await call<{
        status: string;
        result: { replaced?: ExternalLocalItem[]; libraryPass?: string };
      }>(h, 'plugins:install-external', {
        source: 'dotnet/skills',
        plugin: 'dotnet',
        consentToken: CONSENT_TOKEN,
        localItemDecisions: { [ITEM_EDITED.approvalId]: 'replace' },
      });

      expect(h.harnessPropagation.propagateWithReport).toHaveBeenCalledTimes(2);
      expect(response.status).toBe('installed');
      expect(response.result.replaced).toEqual([ITEM_EDITED]);
      expect(response.result.libraryPass).toBe('failed');
    });

    it('applies nothing when every decision is keep', async () => {
      const h = makeHarness();
      h.externalInstaller.confirmInstall.mockResolvedValue(
        confirmed([ITEM_EDITED]),
      );
      h.handlers.register();

      const response = await call<{ result: { kept?: KeptItem[] } }>(
        h,
        'plugins:install-external',
        {
          source: 'dotnet/skills',
          plugin: 'dotnet',
          consentToken: CONSENT_TOKEN,
        },
      );

      expect(h.installLocalItems.apply).not.toHaveBeenCalled();
      // No replacement: the activation pass is the only one.
      expect(h.harnessPropagation.propagateWithReport).toHaveBeenCalledTimes(1);
      expect(response.result.kept).toEqual([
        {
          approvalId: ITEM_EDITED.approvalId,
          family: 'external',
          target: 'claude',
          relPath: ITEM_EDITED.relPath,
          reason: 'owned-edited',
        },
      ]);
    });

    it('a failed write fails the RPC with no replace step (8.10)', async () => {
      const h = makeHarness();
      h.externalInstaller.confirmInstall.mockRejectedValue(
        new Error('EACCES: write failed'),
      );
      h.handlers.register();

      const response = await rpc(h, 'plugins:install-external', {
        source: 'dotnet/skills',
        plugin: 'dotnet',
        consentToken: CONSENT_TOKEN,
        localItemDecisions: { [ITEM_EDITED.approvalId]: 'replace' },
      });

      expect(response.success).toBe(false);
      expect(h.installLocalItems.apply).not.toHaveBeenCalled();
      expect(h.harnessPropagation.propagate).not.toHaveBeenCalled();
    });

    it('a failed Library refresh after a successful install reports libraryPass failed (8.10a)', async () => {
      const h = makeHarness();
      h.externalInstaller.confirmInstall.mockResolvedValue(confirmed([]));
      h.harnessPropagation.propagateWithReport.mockResolvedValue({
        health: makeHealth(),
        userLayer: 'failed',
      });
      h.handlers.register();

      const response = await call<{
        status: string;
        result: { libraryPass?: string };
      }>(h, 'plugins:install-external', {
        source: 'dotnet/skills',
        plugin: 'dotnet',
        consentToken: CONSENT_TOKEN,
      });

      expect(response.status).toBe('installed');
      expect(response.result.libraryPass).toBe('failed');
    });

    it('a failed removal fails the uninstall with no config write and no reconcile (8.10)', async () => {
      const h = makeHarness();
      h.externalInstaller.uninstall.mockRejectedValue(
        new Error('EBUSY: resource busy'),
      );
      h.handlers.register();

      const response = await rpc(h, 'plugins:uninstall-external', {
        pluginId: PLUGIN_ID,
      });

      expect(response.success).toBe(false);
      expect(h.externalMcp.uninstall).not.toHaveBeenCalled();
      expect(h.pluginLoader.saveWorkspacePluginConfig).not.toHaveBeenCalled();
      expect(h.harnessPropagation.propagate).not.toHaveBeenCalled();
      expect(h.installLocalItems.apply).not.toHaveBeenCalled();
    });

    it('rejects a malformed decision id at the boundary', async () => {
      const h = makeHarness();
      h.handlers.register();

      const response = await rpc(h, 'plugins:install-external', {
        source: 'dotnet/skills',
        plugin: 'dotnet',
        consentToken: CONSENT_TOKEN,
        localItemDecisions: { '../../etc/passwd': 'replace' },
      });

      expect(response.success).toBe(false);
      expect(h.externalInstaller.confirmInstall).not.toHaveBeenCalled();
    });
  });

  describe('plugins:replace-kept-items', () => {
    function register(
      h: Harness,
      family: 'external' | 'skills-sh' | 'plugin-enable' | 'plugin-agent',
      relPath: string,
    ): string {
      return h.approvals.register({
        harnessRoot: HARNESS_ROOT,
        family,
        kind: 'owned-edited',
        target: 'claude',
        relPath,
        sourceRef: 'ptah:alpha',
        digest: 'sha256:abc',
      });
    }

    it('routes each id through its own family', async () => {
      const h = makeHarness();
      const skillsShId = register(h, 'skills-sh', '.claude/skills/a');
      const agentId = register(h, 'plugin-agent', '.claude/agents/b.md');
      const keptId = register(h, 'plugin-enable', '.claude/skills/c');
      h.installLocalItems.apply.mockImplementation(
        async (request: { family: string; approvalIds: string[] }) => ({
          replaced: request.approvalIds.map((approvalId) => ({
            approvalId,
            family: request.family,
            relPath: 'x',
            reason: 'owned-edited',
          })),
          kept: [],
          unknown: [],
        }),
      );
      h.handlers.register();

      const result = await call<{
        replaced: KeptItem[];
        libraryPass: string;
      }>(h, 'plugins:replace-kept-items', {
        decisions: {
          [skillsShId]: 'replace',
          [agentId]: 'replace',
          [keptId]: 'keep',
        },
      });

      expect(h.installLocalItems.apply).toHaveBeenCalledTimes(2);
      expect(h.installLocalItems.apply).toHaveBeenCalledWith({
        family: 'skills-sh',
        harnessRoot: HARNESS_ROOT,
        approvalIds: [skillsShId],
      });
      expect(h.installLocalItems.apply).toHaveBeenCalledWith({
        family: 'plugin-agent',
        harnessRoot: HARNESS_ROOT,
        approvalIds: [agentId],
      });
      expect(result.replaced).toHaveLength(2);
      // A replaced item changed a source: one full pass follows.
      expect(h.harnessPropagation.propagate).toHaveBeenCalledWith(
        HARNESS_ROOT,
        'plugins:replace-kept-items',
        {},
      );
      expect(result.libraryPass).toBe('updated');
    });

    it('rejects an approval id issued to another family, and writes nothing', async () => {
      const h = makeHarness();
      const externalId = register(h, 'external', '.claude/skills/a');
      const skillsShId = register(h, 'skills-sh', '.claude/skills/b');
      h.handlers.register();

      const response = await rpc(h, 'plugins:replace-kept-items', {
        decisions: { [skillsShId]: 'replace', [externalId]: 'replace' },
      });

      expect(response.success).toBe(false);
      expect(response.errorCode).toBe('INVALID_PARAMS');
      expect(h.installLocalItems.apply).not.toHaveBeenCalled();
      // The rejected request consumed nothing: the external dialog can still
      // act on its own id.
      expect(
        h.approvals.peek(externalId, 'external', HARNESS_ROOT),
      ).not.toBeNull();
    });

    it('rejects an unknown id, and one issued for another repository', async () => {
      const h = makeHarness();
      const otherRepoId = h.approvals.register({
        harnessRoot: path.join(HARNESS_ROOT, 'elsewhere'),
        family: 'skills-sh',
        kind: 'unowned',
        target: 'claude',
        relPath: '.claude/skills/a',
        sourceRef: 'skills-sh:x',
        digest: 'sha256:abc',
      });
      h.handlers.register();

      for (const id of [FOREIGN_ID, otherRepoId]) {
        const response = await rpc(h, 'plugins:replace-kept-items', {
          decisions: { [id]: 'replace' },
        });
        expect(response.success).toBe(false);
      }
      expect(h.installLocalItems.apply).not.toHaveBeenCalled();
    });

    it('does nothing when every decision is keep', async () => {
      const h = makeHarness();
      const id = register(h, 'skills-sh', '.claude/skills/a');
      h.handlers.register();

      const result = await call(h, 'plugins:replace-kept-items', {
        decisions: { [id]: 'keep' },
      });

      expect(result).toEqual({
        replaced: [],
        kept: [],
        libraryPass: 'not-applicable',
      });
      expect(h.installLocalItems.apply).not.toHaveBeenCalled();
      expect(h.harnessPropagation.propagate).not.toHaveBeenCalled();
    });

    it('reports an id that lapsed before the apply as changed-since-approval', async () => {
      const h = makeHarness();
      const id = register(h, 'skills-sh', '.claude/skills/a');
      h.installLocalItems.apply.mockResolvedValue({
        replaced: [],
        kept: [],
        unknown: [id],
      });
      h.handlers.register();

      const result = await call<{ kept: KeptItem[] }>(
        h,
        'plugins:replace-kept-items',
        { decisions: { [id]: 'replace' } },
      );

      expect(result.kept).toEqual([
        {
          approvalId: id,
          family: 'skills-sh',
          target: 'claude',
          relPath: '.claude/skills/a',
          reason: 'changed-since-approval',
        },
      ]);
    });

    it('rejects a malformed request at the boundary', async () => {
      const h = makeHarness();
      h.handlers.register();

      const response = await rpc(h, 'plugins:replace-kept-items', {
        decisions: { 'not-an-id': 'replace' },
      });

      expect(response.success).toBe(false);
      expect(response.errorCode).toBe('INVALID_PARAMS');
    });

    it('requires an open folder', async () => {
      const h = makeHarness({ workspaceRoot: null });
      h.handlers.register();

      const response = await rpc(h, 'plugins:replace-kept-items', {
        decisions: { [FOREIGN_ID]: 'replace' },
      });

      expect(response.success).toBe(false);
      expect(response.errorCode).toBe('WORKSPACE_NOT_OPEN');
    });
  });

  describe('plugins:resolve-config-home (D14)', () => {
    const FOLDER = path.join(HARNESS_ROOT, 'packages', 'app');

    it('adopt copies the chosen folder config, reconciles and refreshes in the background', async () => {
      const h = makeHarness();
      const after: PluginConfigHomeStatus = {
        harnessRoot: HARNESS_ROOT,
        state: 'imported',
        candidates: [],
      };
      h.pluginLoader.getConfigHomeStatus
        .mockReturnValueOnce(homeStatus([FOLDER]))
        .mockReturnValueOnce(after);
      h.handlers.register();

      const result = await call(h, 'plugins:resolve-config-home', {
        action: 'adopt',
        folder: FOLDER,
      });

      expect(h.pluginLoader.adoptFolderConfig).toHaveBeenCalledWith(
        HARNESS_ROOT,
        FOLDER,
      );
      expect(h.harnessPropagation.propagate).toHaveBeenCalledWith(
        HARNESS_ROOT,
        'plugins:resolve-config-home',
        { skipUserLayerRefresh: true },
      );
      expect(
        h.harnessPropagation.refreshUserLayerInBackground,
      ).toHaveBeenCalledWith(HARNESS_ROOT, 'plugins:resolve-config-home');
      expect(result).toEqual({ configHome: after });
    });

    it('dismiss hides the folder notice and answers the new status', async () => {
      const h = makeHarness();
      h.pluginLoader.getConfigHomeStatus
        .mockReturnValueOnce(homeStatus([FOLDER]))
        .mockReturnValueOnce(null);
      h.handlers.register();

      const result = await call(h, 'plugins:resolve-config-home', {
        action: 'dismiss',
        folder: FOLDER,
      });

      expect(h.pluginLoader.dismissFolderConfig).toHaveBeenCalledWith(
        HARNESS_ROOT,
        FOLDER,
      );
      expect(h.pluginLoader.adoptFolderConfig).not.toHaveBeenCalled();
      expect(h.harnessPropagation.propagate).not.toHaveBeenCalled();
      expect(result).toEqual({});
    });

    it.each([
      ['an unknown folder', path.join(HARNESS_ROOT, 'other')],
      ['a path outside the candidates', path.join(os.tmpdir(), 'evil')],
      ['a traversal from a candidate', path.join(FOLDER, '..', '..')],
    ])('rejects %s and writes nothing', async (_label, folder) => {
      const h = makeHarness();
      h.pluginLoader.getConfigHomeStatus.mockReturnValue(homeStatus([FOLDER]));
      h.handlers.register();

      const response = await rpc(h, 'plugins:resolve-config-home', {
        action: 'adopt',
        folder,
      });

      expect(response.success).toBe(false);
      expect(response.errorCode).toBe('INVALID_PARAMS');
      expect(h.pluginLoader.adoptFolderConfig).not.toHaveBeenCalled();
      expect(h.pluginLoader.dismissFolderConfig).not.toHaveBeenCalled();
    });

    it('rejects any folder when there is no config-home status', async () => {
      const h = makeHarness();
      h.handlers.register();

      const response = await rpc(h, 'plugins:resolve-config-home', {
        action: 'dismiss',
        folder: FOLDER,
      });

      expect(response.success).toBe(false);
      expect(h.pluginLoader.dismissFolderConfig).not.toHaveBeenCalled();
    });

    it('an adopt persistence failure is an error and runs no reconcile', async () => {
      const h = makeHarness();
      h.pluginLoader.getConfigHomeStatus.mockReturnValue(homeStatus([FOLDER]));
      h.pluginLoader.adoptFolderConfig.mockRejectedValue(new Error('EPERM'));
      h.handlers.register();

      const response = await rpc(h, 'plugins:resolve-config-home', {
        action: 'adopt',
        folder: FOLDER,
      });

      expect(response.success).toBe(false);
      expect(h.harnessPropagation.propagate).not.toHaveBeenCalled();
      expect(
        h.harnessPropagation.refreshUserLayerInBackground,
      ).not.toHaveBeenCalled();
    });

    it('rejects an unknown action at the boundary', async () => {
      const h = makeHarness();
      h.handlers.register();

      const response = await rpc(h, 'plugins:resolve-config-home', {
        action: 'delete',
        folder: FOLDER,
      });

      expect(response.success).toBe(false);
      expect(response.errorCode).toBe('INVALID_PARAMS');
    });
  });
});
