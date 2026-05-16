/**
 * PluginRpcHandlers — unit specs.
 *
 * Surface under test: four RPC methods (`plugins:list-available`,
 * `plugins:get-config`, `plugins:save-config`, `plugins:list-skills`). These
 * specs lock in the sanitisation + junction-refresh behaviour the Plugin
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
 *       - Validates `enabledPluginIds` against the known-plugin registry —
 *         unknown IDs are silently dropped, not errored.
 *       - Deduplicates IDs via `new Set(...)` so round-tripped payloads don't
 *         bloat the saved config.
 *       - Back-compat: when `disabledSkillIds` is undefined (TUI clients),
 *         preserves the existing disabled-skills array from saved config;
 *         when an array is provided, it replaces the saved value entirely.
 *       - Validates disabled skill IDs against the set actually discovered
 *         for the enabled plugins — skill IDs not in that set are dropped.
 *       - Invalidates the command-discovery cache AND recreates skill
 *         junctions after saving, so the change takes effect without a
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
import type {
  PluginLoaderService,
  SkillJunctionService,
} from '@ptah-extension/agent-sdk';
import type { CommandDiscoveryService } from '@ptah-extension/workspace-intelligence';
import type {
  PluginInfo,
  PluginConfigState,
  PluginSkillEntry,
} from '@ptah-extension/shared';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import { PluginRpcHandlers } from './plugin-rpc.handlers';

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
    | 'discoverSkillsForPlugins'
  >
>;

function createMockPluginLoader(
  overrides: {
    availablePlugins?: PluginInfo[];
    workspaceConfig?: PluginConfigState;
    resolvedPaths?: string[];
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
        lastUpdated: 0,
      },
    ),
    saveWorkspacePluginConfig: jest.fn().mockResolvedValue(undefined),
    resolvePluginPaths: jest
      .fn()
      .mockReturnValue(overrides.resolvedPaths ?? []),
    discoverSkillsForPlugins: jest
      .fn()
      .mockReturnValue(overrides.discoveredSkills ?? []),
  };
}

type MockSkillJunction = jest.Mocked<
  Pick<SkillJunctionService, 'createJunctions'>
>;

function createMockSkillJunction(): MockSkillJunction {
  return {
    createJunctions: jest.fn(),
  } as unknown as MockSkillJunction;
}

type MockCommandDiscovery = jest.Mocked<
  Pick<CommandDiscoveryService, 'invalidateCache'>
>;

function createMockCommandDiscovery(): MockCommandDiscovery {
  return { invalidateCache: jest.fn() };
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
  skillJunction: MockSkillJunction;
  commandDiscovery: MockCommandDiscovery;
  sentry: MockSentryService;
}

function makeHarness(
  opts: {
    availablePlugins?: PluginInfo[];
    workspaceConfig?: PluginConfigState;
    resolvedPaths?: string[];
    discoveredSkills?: PluginSkillEntry[];
  } = {},
): Harness {
  const logger = createMockLogger();
  const rpcHandler = createMockRpcHandler();
  const pluginLoader = createMockPluginLoader(opts);
  const skillJunction = createMockSkillJunction();
  const commandDiscovery = createMockCommandDiscovery();
  const sentry = createMockSentryService();

  const handlers = new PluginRpcHandlers(
    logger as unknown as Logger,
    rpcHandler as unknown as import('@ptah-extension/vscode-core').RpcHandler,
    pluginLoader as unknown as PluginLoaderService,
    skillJunction as unknown as SkillJunctionService,
    commandDiscovery as unknown as CommandDiscoveryService,
    sentry as unknown as SentryService,
  );

  return {
    handlers,
    logger,
    rpcHandler,
    pluginLoader,
    skillJunction,
    commandDiscovery,
    sentry,
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
    it('registers all four plugin RPC methods', () => {
      const h = makeHarness();
      h.handlers.register();

      expect(h.rpcHandler.getRegisteredMethods().sort()).toEqual(
        [
          'plugins:get-config',
          'plugins:list-available',
          'plugins:list-skills',
          'plugins:save-config',
        ].sort(),
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

    it('invalidates command discovery cache AND recreates junctions after save', async () => {
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
      expect(h.skillJunction.createJunctions).toHaveBeenCalledWith(
        ['/plugins/alpha'],
        [],
      );
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
});
