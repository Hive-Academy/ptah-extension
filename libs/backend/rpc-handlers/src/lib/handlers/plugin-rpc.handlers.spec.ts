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

import type { Logger, SentryService } from '@ptah-extension/vscode-core';
import {
  createMockRpcHandler,
  createMockSentryService,
  type MockRpcHandler,
  type MockSentryService,
} from '@ptah-extension/vscode-core/testing';
import type { PluginLoaderService } from '@ptah-extension/agent-sdk';
import type { HarnessPropagationService } from '@ptah-extension/harness-sync';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';
import type { CommandDiscoveryService } from '@ptah-extension/workspace-intelligence';
import type {
  HarnessCollision,
  HarnessHealth,
  PluginInfo,
  PluginConfigState,
  PluginSkillEntry,
} from '@ptah-extension/shared';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import { PluginRpcHandlers } from './plugin-rpc.handlers';

/** The workspace every reconcile in this suite is expected to target. */
const WORKSPACE_ROOT = 'C:\\ws';

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
  };
}

type MockHarnessPropagation = jest.Mocked<
  Pick<HarnessPropagationService, 'propagate'>
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

function createMockHarnessPropagation(): MockHarnessPropagation {
  return {
    propagate: jest.fn().mockResolvedValue(makeHealth()),
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
}

function createMockExternalInstaller(): MockExternalInstaller {
  return {
    planInstall: jest.fn(),
    confirmInstall: jest.fn(),
    uninstall: jest.fn().mockResolvedValue(false),
  };
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
    pluginId,
    displayName: skillId,
    description: `desc ${skillId}`,
  } as unknown as PluginSkillEntry;
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
}

function makeHarness(
  opts: {
    availablePlugins?: PluginInfo[];
    workspaceConfig?: PluginConfigState;
    resolvedPaths?: string[];
    currentPluginPaths?: string[];
    harnessPaths?: string[];
    discoveredSkills?: PluginSkillEntry[];
  } = {},
): Harness {
  const logger = createMockLogger();
  const rpcHandler = createMockRpcHandler();
  const pluginLoader = createMockPluginLoader(opts);
  const harnessPropagation = createMockHarnessPropagation();
  const workspaceProvider = createMockWorkspaceProvider({
    folders: [WORKSPACE_ROOT],
  }) as unknown as IWorkspaceProvider;
  const commandDiscovery = createMockCommandDiscovery();
  const sentry = createMockSentryService();
  const marketplaceRegistry = createMockMarketplaceRegistry();
  const externalInstaller = createMockExternalInstaller();

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
        WORKSPACE_ROOT,
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
      expect(root).toBe(WORKSPACE_ROOT);
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

      expect(result).toEqual({ success: true });
      expect(h.harnessPropagation.propagate).toHaveBeenCalledWith(
        WORKSPACE_ROOT,
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
    } {
      return {
        pluginId: PLUGIN_ID,
        displayName: 'dotnet',
        installedVersion: '1.2.0',
        filesWritten: 4,
        skippedBinaryFiles: [],
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
        WORKSPACE_ROOT,
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
        WORKSPACE_ROOT,
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
  });
});
