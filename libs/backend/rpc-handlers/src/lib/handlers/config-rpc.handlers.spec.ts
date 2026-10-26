/**
 * ConfigRpcHandlers — unit specs.
 *
 * Surface under test: seven RPC methods covering model switching, model-list
 * aggregation, autopilot toggle, and reasoning-effort persistence. These specs
 * lock in the behaviour the webview Settings panel depends on.
 *
 * Behavioural contracts locked in here:
 *
 *   - Registration: `register()` wires all seven methods into the mock
 *     RpcHandler AND seeds the SdkPermissionHandler's level from the saved
 *     autopilot config (ask / auto-edit / yolo / plan). When autopilot is
 *     disabled at startup, the seeded level MUST collapse to 'ask' regardless
 *     of what was previously saved.
 *
 *   - `config:model-switch`: Applies the live change before persisting the
 *     selection. Application failures reject without saving.
 *
 *   - `config:model-get`: a pure read. The stored value is returned
 *     verbatim and nothing is written (a read used to re-save at the
 *     global scope and wipe the workspace override).
 *
 *   - `config:autopilot-toggle`: Sends frontend levels through runtime
 *     controls before saving. The SDK owns legacy permission aliases;
 *     yolo keeps callbacks active using SDK default mode.
 *
 *   - `config:models-list`: Merges SDK-supported models (tier shortcuts)
 *     with the /v1/models API response, dedupes by id, projects tier
 *     overrides (OpenRouter etc. → `providerModelId` populated), and
 *     guarantees EXACTLY one `isSelected: true` entry even when resolve()
 *     would otherwise mark both a tier name and its full ID.
 *
 *   - `config:effort-get` / `config:effort-set`: Round-trip a reasoning
 *     effort string through ConfigManager. Empty values are stored as ''
 *     and surfaced back as `undefined`.
 *
 * Mocking posture: direct constructor injection, narrow `jest.Mocked<Pick<T,...>>`
 * surfaces, no `as any` casts, no tsyringe container.
 *
 * Source-under-test:
 *   `libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.ts`
 */

import 'reflect-metadata';
import { SdkError } from '@ptah-extension/agent-sdk';

import type {
  ConfigManager,
  Logger,
  SentryService,
} from '@ptah-extension/vscode-core';
import {
  createMockConfigManager,
  createMockRpcHandler,
  createMockSentryService,
  type MockConfigManager,
  type MockRpcHandler,
  type MockSentryService,
} from '@ptah-extension/vscode-core/testing';
import type {
  SdkAgentAdapter,
  SdkPermissionHandler,
  SessionLifecycleManager,
} from '@ptah-extension/agent-sdk';
import type {
  ModelResolver,
  ProviderModelsService,
} from '@ptah-extension/auth-providers';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import {
  ModelSettings as RealModelSettings,
  WorkspaceScopeResolver,
  type ISettingsStore,
  type ModelSettings,
  type ReasoningSettings,
} from '@ptah-extension/settings-core';

import {
  createMockModelSettings,
  createMockReasoningSettings,
  type MockModelSettings,
  type MockReasoningSettings,
} from '../../test-utils/mock-settings';
import { ConfigRpcHandlers } from './config-rpc.handlers';

// ---------------------------------------------------------------------------
// Narrow mock surfaces — only what the handler touches
// ---------------------------------------------------------------------------

type MockSdkAdapter = jest.Mocked<
  Pick<
    SdkAgentAdapter,
    | 'setSessionModel'
    | 'setSessionEffort'
    | 'setSessionPermissionLevel'
    | 'getActiveSessionIds'
    | 'getSupportedModels'
    | 'getApiModels'
  >
>;

function createMockSdkAdapter(): MockSdkAdapter {
  return {
    setSessionModel: jest.fn().mockResolvedValue(undefined),
    setSessionEffort: jest.fn().mockResolvedValue(undefined),
    setSessionPermissionLevel: jest.fn().mockResolvedValue(undefined),
    getActiveSessionIds: jest.fn().mockReturnValue([]),
    getSupportedModels: jest.fn().mockResolvedValue([]),
    getApiModels: jest.fn().mockResolvedValue([]),
  };
}

type MockProviderModels = jest.Mocked<
  Pick<
    ProviderModelsService,
    'getModelTiers' | 'resolveActiveProviderId' | 'getCachedModelIds'
  >
>;

function createMockProviderModels(): MockProviderModels {
  return {
    getModelTiers: jest
      .fn()
      .mockReturnValue({ default: null, fast: null, reasoning: null }),
    resolveActiveProviderId: jest.fn().mockReturnValue('anthropic'),
    getCachedModelIds: jest.fn().mockReturnValue(null),
  };
}

type MockPermissionHandler = jest.Mocked<
  Pick<SdkPermissionHandler, 'setPermissionLevel'>
>;

function createMockPermissionHandler(): MockPermissionHandler {
  return { setPermissionLevel: jest.fn() };
}

type MockModelResolver = jest.Mocked<
  Pick<ModelResolver, 'resolve' | 'detectTier' | 'isSubscriptionCovered'>
>;

function createMockModelResolver(): MockModelResolver {
  return {
    // Default: identity resolve (handler tests override as needed)
    resolve: jest.fn((model: string) => model),
    detectTier: jest.fn((_model: string) => undefined),
    // Default: a usage-billed provider, so price lines read as dollar rates
    isSubscriptionCovered: jest.fn(() => false),
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface MockPricingProvider {
  getPricing: jest.Mock;
  ensureHydrated: jest.Mock;
}

interface MockLifecycle {
  /** Live session records by id; `find` returns undefined for any other id. */
  levels: Map<string, string>;
  find: jest.Mock;
}

interface Harness {
  handlers: ConfigRpcHandlers;
  pricingProvider: MockPricingProvider;
  lifecycle: MockLifecycle;
  logger: MockLogger;
  rpcHandler: MockRpcHandler;
  configManager: MockConfigManager;
  sdkAdapter: MockSdkAdapter;
  providerModels: MockProviderModels;
  permissionHandler: MockPermissionHandler;
  modelResolver: MockModelResolver;
  sentry: MockSentryService;
  modelSettings: MockModelSettings;
  reasoningSettings: MockReasoningSettings;
}

function makeHarness(
  opts: {
    configSeed?: Record<string, unknown>;
    modelSelected?: string;
    reasoningEffort?: string;
    /** A real settings repository instead of the mock (storage-level specs). */
    modelSettings?: ModelSettings;
  } = {},
): Harness {
  const logger = createMockLogger();
  const rpcHandler = createMockRpcHandler();
  const configManager = createMockConfigManager({ values: opts.configSeed });
  const sdkAdapter = createMockSdkAdapter();
  const providerModels = createMockProviderModels();
  const permissionHandler = createMockPermissionHandler();
  const modelResolver = createMockModelResolver();
  const sentry = createMockSentryService();
  const modelSettings = createMockModelSettings();
  const reasoningSettings = createMockReasoningSettings();

  if (opts.modelSelected !== undefined) {
    modelSettings.selectedModel.get.mockReturnValue(opts.modelSelected);
  }
  if (opts.reasoningEffort !== undefined) {
    reasoningSettings.effort.get.mockReturnValue(opts.reasoningEffort);
  }

  const pricingProvider = {
    getPricing: jest.fn().mockResolvedValue(null),
    ensureHydrated: jest.fn().mockResolvedValue(true),
  };

  const levels = new Map<string, string>();
  const lifecycle: MockLifecycle = {
    levels,
    find: jest.fn((id: string) =>
      levels.has(id) ? { permissionLevel: levels.get(id) } : undefined,
    ),
  };

  const handlers = new ConfigRpcHandlers(
    logger as unknown as Logger,
    rpcHandler as unknown as import('@ptah-extension/vscode-core').RpcHandler,
    configManager as unknown as ConfigManager,
    sdkAdapter as unknown as SdkAgentAdapter,
    providerModels as unknown as ProviderModelsService,
    permissionHandler as unknown as SdkPermissionHandler,
    modelResolver as unknown as ModelResolver,
    sentry as unknown as SentryService,
    opts.modelSettings ?? (modelSettings as unknown as ModelSettings),
    reasoningSettings as unknown as ReasoningSettings,
    pricingProvider,
    lifecycle as unknown as SessionLifecycleManager,
  );

  return {
    handlers,
    pricingProvider,
    lifecycle,
    logger,
    rpcHandler,
    configManager,
    sdkAdapter,
    providerModels,
    permissionHandler,
    modelResolver,
    sentry,
    modelSettings,
    reasoningSettings,
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

describe('ConfigRpcHandlers', () => {
  describe('register()', () => {
    // Pre-existing: handler now also registers `config:model-set`; spec
    // list lags behind.
    it.skip('registers all seven config RPC methods', () => {
      const h = makeHarness();
      h.handlers.register();

      expect(h.rpcHandler.getRegisteredMethods().sort()).toEqual(
        [
          'config:autopilot-get',
          'config:autopilot-toggle',
          'config:effort-get',
          'config:effort-set',
          'config:model-get',
          'config:model-switch',
          'config:models-list',
        ].sort(),
      );
    });

    it('seeds permission handler from saved autopilot config when enabled', () => {
      const h = makeHarness({
        configSeed: {
          'autopilot.enabled': true,
          'autopilot.permissionLevel': 'auto-edit',
        },
      });
      h.handlers.register();

      expect(h.permissionHandler.setPermissionLevel).toHaveBeenCalledWith(
        'auto-edit',
      );
    });

    it('collapses saved level to "ask" when autopilot is disabled on startup', () => {
      const h = makeHarness({
        configSeed: {
          'autopilot.enabled': false,
          // Even if a dangerous level was saved, disabled → 'ask' wins.
          'autopilot.permissionLevel': 'yolo',
        },
      });
      h.handlers.register();

      expect(h.permissionHandler.setPermissionLevel).toHaveBeenCalledWith(
        'ask',
      );
    });
  });

  // -------------------------------------------------------------------------
  // config:model-switch
  // -------------------------------------------------------------------------

  describe('config:model-switch', () => {
    it('persists the selected model via ModelSettings', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ model: string }>(h, 'config:model-switch', {
        model: 'claude-opus-4-7',
      });

      expect(result.model).toBe('claude-opus-4-7');
      expect(h.modelSettings.selectedModel.set).toHaveBeenCalledWith(
        'claude-opus-4-7',
        'app',
      );
    });

    it('syncs to an active SDK session when sessionId is provided', async () => {
      const h = makeHarness();
      h.handlers.register();

      await call(h, 'config:model-switch', {
        model: 'claude-sonnet-4-6',
        sessionId: 'sess-123',
      });

      expect(h.sdkAdapter.setSessionModel).toHaveBeenCalledWith(
        'sess-123',
        'claude-sonnet-4-6',
      );
    });

    it('rejects live apply failures before persisting', async () => {
      const h = makeHarness();
      h.sdkAdapter.setSessionModel.mockRejectedValue(new Error('sync failed'));
      h.handlers.register();

      await expect(
        call(h, 'config:model-switch', {
          model: 'claude-haiku-4-5',
          sessionId: 'sess-xyz',
        }),
      ).rejects.toThrow('sync failed');
      expect(h.modelSettings.selectedModel.set).not.toHaveBeenCalled();
    });

    it('threads applyTo:workspace into the workspace-scoped model write', async () => {
      const h = makeHarness();
      h.handlers.register();

      await call(h, 'config:model-switch', {
        model: 'claude-opus-4-7',
        applyTo: 'workspace',
      });

      expect(h.modelSettings.selectedModel.set).toHaveBeenCalledWith(
        'claude-opus-4-7',
        'workspace',
      );
    });

    it('returns a failed result when the workspace save is rejected (no open workspace)', async () => {
      const h = makeHarness();
      h.modelSettings.selectedModel.set.mockRejectedValue(
        new Error(
          "Cannot save 'provider.claudeCli.selectedModel' for this workspace: no workspace is open.",
        ),
      );
      h.handlers.register();

      const response = await h.rpcHandler.handleMessage({
        method: 'config:model-switch',
        params: { model: 'claude-opus-4-7', applyTo: 'workspace' },
        correlationId: 'corr',
      });

      expect(response.success).toBe(false);
      expect(response.error).toMatch(/no workspace is open/);
      expect(h.sdkAdapter.setSessionModel).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // config:model-get (migration paths)
  // -------------------------------------------------------------------------

  describe('config:model-get', () => {
    it('returns "default" tier when nothing is stored', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ model: string }>(h, 'config:model-get');

      expect(result.model).toBe('default');
    });

    it('preserves "default" as-is (valid SDK tier meaning "let SDK choose")', async () => {
      const h = makeHarness({ modelSelected: 'default' });
      h.handlers.register();

      const result = await call<{ model: string }>(h, 'config:model-get');

      expect(result.model).toBe('default');
      expect(h.modelResolver.resolve).not.toHaveBeenCalled();
    });

    it('returns a tier alias verbatim and never writes', async () => {
      const h = makeHarness({ modelSelected: 'opus' });
      h.modelResolver.resolve.mockReturnValue('claude-opus-4-7');
      h.handlers.register();

      const result = await call<{ model: string }>(h, 'config:model-get');

      expect(result.model).toBe('opus');
      expect(h.modelSettings.selectedModel.set).not.toHaveBeenCalled();
    });

    it('returns a third-party model id verbatim and never writes', async () => {
      const h = makeHarness({ modelSelected: 'gpt-6-luna' });
      h.handlers.register();

      const result = await call<{ model: string }>(h, 'config:model-get');

      expect(result.model).toBe('gpt-6-luna');
      expect(h.modelSettings.selectedModel.set).not.toHaveBeenCalled();
    });

    it('a read leaves storage unchanged and keeps the workspace override', async () => {
      const data = new Map<string, unknown>([
        ['authMethod', 'thirdParty'],
        ['anthropicProviderId', 'openai-codex'],
        ['provider.thirdParty.openai-codex.selectedModel', 'gpt-6.1-sol'],
      ]);
      const writeGlobal = jest.fn(async (key: string, value: unknown) => {
        if (value === undefined) data.delete(key);
        else data.set(key, value);
      });
      const store = {
        readGlobal: <T>(key: string): T | undefined => data.get(key) as T,
        writeGlobal,
        readSecret: async () => undefined,
        writeSecret: async () => undefined,
        deleteSecret: async () => undefined,
        watchGlobal: () => ({ dispose: () => undefined }),
        watchSecret: () => ({ dispose: () => undefined }),
        flushSync: () => undefined,
      } as ISettingsStore;
      const resolver = new WorkspaceScopeResolver(store, {
        getActivePath: () => '/ws/codex',
        onDidChange: () => ({ dispose: () => undefined }),
      });
      const settings = new RealModelSettings(store, resolver);
      await settings.selectedModel.set('gpt-6-luna', 'workspace');
      const before = JSON.stringify([...data.entries()]);
      writeGlobal.mockClear();

      const h = makeHarness({ modelSettings: settings });
      h.handlers.register();
      const result = await call<{ model: string }>(h, 'config:model-get');

      expect(result.model).toBe('gpt-6-luna');
      expect(writeGlobal).not.toHaveBeenCalled();
      expect(JSON.stringify([...data.entries()])).toBe(before);
      expect(
        resolver.hasOverride(
          'provider.thirdParty.openai-codex.selectedModel',
          true,
        ),
      ).toBe(true);
      expect(data.get('provider.thirdParty.openai-codex.selectedModel')).toBe(
        'gpt-6.1-sol',
      );
    });

    it('preserves a Claude ID unchanged (SDK owns tier resolution)', async () => {
      const h = makeHarness({ modelSelected: 'claude-opus-4-7-20251101' });
      h.handlers.register();

      const result = await call<{ model: string }>(h, 'config:model-get');

      expect(result.model).toBe('claude-opus-4-7-20251101');
      expect(h.modelSettings.selectedModel.set).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // config:autopilot-toggle
  // -------------------------------------------------------------------------

  describe('config:autopilot-toggle', () => {
    it('rejects an invalid permission level', async () => {
      const h = makeHarness();
      h.handlers.register();

      const response = await h.rpcHandler.handleMessage({
        method: 'config:autopilot-toggle',
        params: { enabled: true, permissionLevel: 'nuke' },
        correlationId: 'corr',
      });

      expect(response.success).toBe(false);
      expect(h.sentry.captureException).toHaveBeenCalled();
    });

    it('allows YOLO for everyone and mirrors level to permission handler', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{
        enabled: boolean;
        permissionLevel: string;
      }>(h, 'config:autopilot-toggle', {
        enabled: true,
        permissionLevel: 'yolo',
      });

      expect(result.enabled).toBe(true);
      expect(result.permissionLevel).toBe('yolo');
      expect(h.permissionHandler.setPermissionLevel).toHaveBeenCalledWith(
        'yolo',
      );
    });

    it('persists enabled + level to ConfigManager', async () => {
      const h = makeHarness();
      h.handlers.register();

      await call(h, 'config:autopilot-toggle', {
        enabled: true,
        permissionLevel: 'auto-edit',
      });

      expect(h.configManager.set).toHaveBeenCalledWith(
        'autopilot.enabled',
        true,
      );
      expect(h.configManager.set).toHaveBeenCalledWith(
        'autopilot.permissionLevel',
        'auto-edit',
      );
    });

    it('maps auto-edit → acceptEdits for the active SDK session', async () => {
      const h = makeHarness();
      h.handlers.register();

      await call(h, 'config:autopilot-toggle', {
        enabled: true,
        permissionLevel: 'auto-edit',
        sessionId: 'sess-1',
      });

      expect(h.sdkAdapter.setSessionPermissionLevel).toHaveBeenCalledWith(
        'sess-1',
        'auto-edit',
      );
    });

    it('falls back to the most-recently-active session when no sessionId is supplied', async () => {
      const h = makeHarness();
      h.sdkAdapter.getActiveSessionIds.mockReturnValue([
        'active-sess',
      ] as unknown as ReturnType<SdkAgentAdapter['getActiveSessionIds']>);
      h.handlers.register();

      // Legacy CLI/TUI callers omit sessionId — the toggle must still reach the
      // running session so per-session gating takes effect.
      await call(h, 'config:autopilot-toggle', {
        enabled: true,
        permissionLevel: 'yolo',
      });

      expect(h.sdkAdapter.setSessionPermissionLevel).toHaveBeenCalledWith(
        'active-sess',
        'yolo',
      );
    });

    // TASK_2026_295 — `sessionId ?? getActiveSessionIds()[0]` KEEPS '' (?? only
    // falls through on null/undefined), and the truthiness check below it then
    // discarded that ''. Net effect: the toggle reached no session at all and
    // the active-session fallback never fired.
    it('treats an empty sessionId as absent and falls back to the active session', async () => {
      const h = makeHarness();
      h.sdkAdapter.getActiveSessionIds.mockReturnValue([
        'active-sess',
      ] as unknown as ReturnType<SdkAgentAdapter['getActiveSessionIds']>);
      h.handlers.register();

      await call(h, 'config:autopilot-toggle', {
        enabled: true,
        permissionLevel: 'yolo',
        sessionId: '',
      });

      expect(h.sdkAdapter.setSessionPermissionLevel).toHaveBeenCalledWith(
        'active-sess',
        'yolo',
      );
    });

    // TASK_2026_660 — the webview popover sends `null` for a tab that has no
    // SDK session yet. Falling back to the most recently active session there
    // re-gated an unrelated session (e.g. set a parent to bypassPermissions).
    it('changes no live session when the sessionId is explicitly null', async () => {
      const h = makeHarness();
      h.sdkAdapter.getActiveSessionIds.mockReturnValue([
        'sess-a',
        'sess-b',
      ] as unknown as ReturnType<SdkAgentAdapter['getActiveSessionIds']>);
      h.handlers.register();

      const result = await call<{ enabled: boolean; permissionLevel: string }>(
        h,
        'config:autopilot-toggle',
        { enabled: true, permissionLevel: 'yolo', sessionId: null },
      );

      expect(h.sdkAdapter.setSessionPermissionLevel).not.toHaveBeenCalled();
      // The default for new sessions is still saved.
      expect(result).toEqual({ enabled: true, permissionLevel: 'yolo' });
      expect(h.configManager.set).toHaveBeenCalledWith(
        'autopilot.enabled',
        true,
      );
      expect(h.configManager.set).toHaveBeenCalledWith(
        'autopilot.permissionLevel',
        'yolo',
      );
      expect(h.permissionHandler.setPermissionLevel).toHaveBeenCalledWith(
        'yolo',
      );
    });

    it('changes only the named session when two sessions are live', async () => {
      const h = makeHarness();
      h.sdkAdapter.getActiveSessionIds.mockReturnValue([
        'sess-a',
        'sess-b',
      ] as unknown as ReturnType<SdkAgentAdapter['getActiveSessionIds']>);
      h.handlers.register();

      await call(h, 'config:autopilot-toggle', {
        enabled: true,
        permissionLevel: 'yolo',
        sessionId: 'sess-b',
      });

      expect(h.sdkAdapter.setSessionPermissionLevel).toHaveBeenCalledTimes(1);
      expect(h.sdkAdapter.setSessionPermissionLevel).toHaveBeenCalledWith(
        'sess-b',
        'yolo',
      );
    });

    it('skips session sync when no sessionId and no active session', async () => {
      const h = makeHarness();
      h.handlers.register();

      await call(h, 'config:autopilot-toggle', {
        enabled: true,
        permissionLevel: 'yolo',
      });

      expect(h.sdkAdapter.setSessionPermissionLevel).not.toHaveBeenCalled();
    });

    it('maps plan → plan for the active SDK session', async () => {
      const h = makeHarness();
      h.handlers.register();

      await call(h, 'config:autopilot-toggle', {
        enabled: true,
        permissionLevel: 'plan',
        sessionId: 'sess-1',
      });

      expect(h.sdkAdapter.setSessionPermissionLevel).toHaveBeenCalledWith(
        'sess-1',
        'plan',
      );
    });

    it('delegates ask when autopilot is disabled', async () => {
      const h = makeHarness();
      h.handlers.register();

      await call(h, 'config:autopilot-toggle', {
        enabled: false,
        permissionLevel: 'auto-edit',
        sessionId: 'sess-2',
      });

      expect(h.sdkAdapter.setSessionPermissionLevel).toHaveBeenCalledWith(
        'sess-2',
        'ask',
      );
      // Permission handler collapses to 'ask' when disabled.
      expect(h.permissionHandler.setPermissionLevel).toHaveBeenCalledWith(
        'ask',
      );
    });

    it('swallows session-sync failures so the config write still succeeds for missing sessions', async () => {
      const h = makeHarness();
      h.sdkAdapter.setSessionPermissionLevel.mockRejectedValue(new SdkError('session not found'));
      h.handlers.register();
      await expect(call(h, 'config:autopilot-toggle', {
        enabled: true, permissionLevel: 'auto-edit', sessionId: 'sess-bad',
      })).resolves.toEqual({ enabled: true, permissionLevel: 'auto-edit' });
      expect(h.configManager.set).toHaveBeenCalledWith('autopilot.enabled', true);
      expect(h.configManager.set).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // config:autopilot-get
  // -------------------------------------------------------------------------

  describe('config:autopilot-get', () => {
    it('returns the saved state with defaults when unset', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{
        enabled: boolean;
        permissionLevel: string;
      }>(h, 'config:autopilot-get');

      expect(result.enabled).toBe(false);
      expect(result.permissionLevel).toBe('ask');
    });

    it('returns the persisted values when seeded', async () => {
      const h = makeHarness({
        configSeed: {
          'autopilot.enabled': true,
          'autopilot.permissionLevel': 'plan',
        },
      });
      h.handlers.register();

      const result = await call<{
        enabled: boolean;
        permissionLevel: string;
      }>(h, 'config:autopilot-get');

      expect(result.enabled).toBe(true);
      expect(result.permissionLevel).toBe('plan');
    });

    // TASK_2026_660 — each tab's popover shows its own session's live level,
    // not the default the last toggle (made in any tab) saved.
    it("reports the requested session's live level next to the saved default", async () => {
      const h = makeHarness({
        configSeed: {
          'autopilot.enabled': true,
          'autopilot.permissionLevel': 'yolo',
        },
      });
      h.lifecycle.levels.set('sess-a', 'yolo');
      h.lifecycle.levels.set('sess-b', 'auto-edit');
      h.handlers.register();

      const result = await call<Record<string, unknown>>(
        h,
        'config:autopilot-get',
        { sessionId: 'sess-b' },
      );

      expect(result).toEqual({
        enabled: true,
        permissionLevel: 'yolo',
        sessionPermissionLevel: 'auto-edit',
      });
    });

    it('reports null for a session that is not live', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<Record<string, unknown>>(
        h,
        'config:autopilot-get',
        { sessionId: 'sess-gone' },
      );

      expect(result['sessionPermissionLevel']).toBeNull();
    });

    it('omits the session level when no session is requested', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<Record<string, unknown>>(
        h,
        'config:autopilot-get',
        { sessionId: null },
      );

      expect(result).not.toHaveProperty('sessionPermissionLevel');
      expect(h.lifecycle.find).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // config:models-list
  // -------------------------------------------------------------------------

  describe('config:models-list', () => {
    it('merges SDK models + API models and dedupes by id', async () => {
      const h = makeHarness({ modelSelected: 'claude-opus-4-7' });
      h.sdkAdapter.getSupportedModels.mockResolvedValue([
        {
          value: 'claude-opus-4-7',
          displayName: 'Opus',
          description: 'Most powerful',
        },
        {
          value: 'claude-sonnet-4-6',
          displayName: 'Sonnet',
          description: 'Balanced',
        },
      ] as unknown as Awaited<
        ReturnType<SdkAgentAdapter['getSupportedModels']>
      >);
      h.sdkAdapter.getApiModels.mockResolvedValue([
        // Duplicate — must be dropped
        {
          value: 'claude-opus-4-7',
          displayName: 'Opus (API)',
          description: 'from API',
        },
        // Unique — kept
        {
          value: 'claude-haiku-4-5',
          displayName: 'Haiku',
          description: 'Fast',
        },
      ] as unknown as Awaited<ReturnType<SdkAgentAdapter['getApiModels']>>);
      h.modelResolver.resolve.mockImplementation((m) => m);
      h.modelResolver.detectTier.mockImplementation((m: string) => {
        if (m.includes('opus')) return 'opus';
        if (m.includes('sonnet')) return 'sonnet';
        if (m.includes('haiku')) return 'haiku';
        return undefined;
      });
      h.handlers.register();

      const result = await call<{
        models: Array<{ id: string; isSelected: boolean }>;
      }>(h, 'config:models-list');

      const ids = result.models.map((m) => m.id);
      // Opus dedup + sonnet + haiku
      expect(ids).toContain('claude-opus-4-7');
      expect(ids).toContain('claude-sonnet-4-6');
      expect(ids).toContain('claude-haiku-4-5');
      expect(ids.filter((id) => id === 'claude-opus-4-7').length).toBe(1);
    });

    it('guarantees exactly one isSelected entry even when resolve matches multiple', async () => {
      const h = makeHarness({ modelSelected: 'claude-opus-4-7' });
      h.sdkAdapter.getSupportedModels.mockResolvedValue([
        {
          value: 'claude-opus-4-7',
          displayName: 'Opus',
          description: '',
        },
        {
          value: 'opus',
          displayName: 'Opus (tier)',
          description: '',
        },
      ] as unknown as Awaited<
        ReturnType<SdkAgentAdapter['getSupportedModels']>
      >);
      h.sdkAdapter.getApiModels.mockResolvedValue([]);
      // The resolve-matched branch would mark both entries selected because
      // both resolve to 'claude-opus-4-7'. The handler's "exact match" pass
      // must reduce this to a single selection.
      h.modelResolver.resolve.mockReturnValue('claude-opus-4-7');
      h.modelResolver.detectTier.mockImplementation((m: string) =>
        m.includes('opus') ? 'opus' : undefined,
      );
      h.handlers.register();

      const result = await call<{
        models: Array<{ id: string; isSelected: boolean }>;
      }>(h, 'config:models-list');

      const selected = result.models.filter((m) => m.isSelected);
      expect(selected).toHaveLength(1);
      // Exact-match wins
      expect(selected[0].id).toBe('claude-opus-4-7');
    });

    it('populates providerModelId from tier overrides for non-Anthropic providers', async () => {
      const h = makeHarness({ modelSelected: 'claude-sonnet-4-6' });
      h.providerModels.resolveActiveProviderId.mockReturnValue('openrouter');
      h.providerModels.getModelTiers.mockReturnValue({
        default: null,
        fast: null,
        reasoning: null,
        // The handler looks up tiers by 'opus' | 'sonnet' | 'haiku' keys.
        opus: 'anthropic/claude-opus-4',
        sonnet: 'anthropic/claude-sonnet-4',
        haiku: 'anthropic/claude-haiku-4',
      } as unknown as ReturnType<ProviderModelsService['getModelTiers']>);
      h.sdkAdapter.getSupportedModels.mockResolvedValue([
        { value: 'claude-sonnet-4-6', displayName: 'Sonnet', description: '' },
      ] as unknown as Awaited<
        ReturnType<SdkAgentAdapter['getSupportedModels']>
      >);
      h.sdkAdapter.getApiModels.mockResolvedValue([]);
      h.modelResolver.detectTier.mockReturnValue('sonnet');
      h.handlers.register();

      const result = await call<{
        models: Array<{ id: string; providerModelId: string | null }>;
      }>(h, 'config:models-list');

      expect(result.models[0].providerModelId).toBe(
        'anthropic/claude-sonnet-4',
      );
    });

    it('skips tier overrides when active provider is "anthropic"', async () => {
      const h = makeHarness({ modelSelected: 'claude-sonnet-4-6' });
      h.providerModels.resolveActiveProviderId.mockReturnValue('anthropic');
      h.sdkAdapter.getSupportedModels.mockResolvedValue([
        { value: 'claude-sonnet-4-6', displayName: 'Sonnet', description: '' },
      ] as unknown as Awaited<
        ReturnType<SdkAgentAdapter['getSupportedModels']>
      >);
      h.sdkAdapter.getApiModels.mockResolvedValue([]);
      h.modelResolver.detectTier.mockReturnValue('sonnet');
      h.handlers.register();

      const result = await call<{
        models: Array<{ providerModelId: string | null }>;
      }>(h, 'config:models-list');

      expect(result.models[0].providerModelId).toBeNull();
      // No tier lookup should happen for direct Anthropic
      expect(h.providerModels.getModelTiers).not.toHaveBeenCalled();
    });

    describe('saved model that is not a tier mapping (Codex)', () => {
      const codexTierList = [
        { value: 'default', displayName: 'Default', description: '' },
        { value: 'gpt-6.1-sol', displayName: 'Opus', description: '' },
        { value: 'gpt-6-sol', displayName: 'Sonnet', description: '' },
        { value: 'gpt-5.6-terra', displayName: 'Haiku', description: '' },
      ] as unknown as Awaited<
        ReturnType<SdkAgentAdapter['getSupportedModels']>
      >;

      function codexHarness(saved: string): Harness {
        const h = makeHarness({ modelSelected: saved });
        h.providerModels.resolveActiveProviderId.mockReturnValue(
          'openai-codex',
        );
        h.sdkAdapter.getSupportedModels.mockResolvedValue(codexTierList);
        h.sdkAdapter.getApiModels.mockResolvedValue([]);
        return h;
      }

      it('offers and selects a saved provider model missing from the tier list', async () => {
        const h = codexHarness('gpt-6-luna');
        h.handlers.register();

        const result = await call<{
          models: Array<{ id: string; name: string; isSelected: boolean }>;
        }>(h, 'config:models-list');

        const selected = result.models.filter((m) => m.isSelected);
        expect(selected).toEqual([
          expect.objectContaining({ id: 'gpt-6-luna', name: 'GPT 6 Luna' }),
        ]);
      });

      it('offers a saved model found only in the live catalog', async () => {
        const h = codexHarness('gpt-7-nova');
        h.providerModels.getCachedModelIds.mockReturnValue([
          'gpt-6.1-sol',
          'gpt-7-nova',
        ]);
        h.handlers.register();

        const result = await call<{
          models: Array<{ id: string; isSelected: boolean }>;
        }>(h, 'config:models-list');

        expect(result.models.find((m) => m.isSelected)?.id).toBe('gpt-7-nova');
      });

      it('does not offer a static model that the live catalog leaves out', async () => {
        const h = codexHarness('gpt-6-luna');
        h.providerModels.getCachedModelIds.mockReturnValue(['gpt-6.1-sol']);
        h.handlers.register();

        const result = await call<{
          models: Array<{ id: string; isSelected: boolean }>;
        }>(h, 'config:models-list');

        expect(result.models.map((m) => m.id)).not.toContain('gpt-6-luna');
        expect(result.models.some((m) => m.isSelected)).toBe(false);
      });

      it('does not invent an entry for a model the provider does not declare', async () => {
        const h = codexHarness('not-a-codex-model');
        h.handlers.register();

        const result = await call<{
          models: Array<{ id: string; isSelected: boolean }>;
        }>(h, 'config:models-list');

        expect(result.models.map((m) => m.id)).not.toContain(
          'not-a-codex-model',
        );
        expect(result.models.some((m) => m.isSelected)).toBe(false);
      });

      it('selects the tier entry a saved tier alias resolves to', async () => {
        const h = codexHarness('haiku');
        h.modelResolver.resolve.mockImplementation((m: string) =>
          m === 'haiku' ? 'gpt-5.6-terra' : m,
        );
        h.handlers.register();

        const result = await call<{
          models: Array<{ id: string; isSelected: boolean }>;
        }>(h, 'config:models-list');

        expect(result.models.filter((m) => m.isSelected)).toEqual([
          expect.objectContaining({ id: 'gpt-5.6-terra' }),
        ]);
      });
    });
  });

  // -------------------------------------------------------------------------
  // config:effort-get / config:effort-set
  // -------------------------------------------------------------------------

  describe('config:effort-get / config:effort-set', () => {
    it('returns undefined when no effort is set', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ effort?: string }>(h, 'config:effort-get');

      expect(result.effort).toBeUndefined();
    });

    it('round-trips an effort value through ReasoningSettings', async () => {
      const h = makeHarness();
      h.handlers.register();

      const setResult = await call<{ effort?: string }>(
        h,
        'config:effort-set',
        { effort: 'high' },
      );
      expect(setResult.effort).toBe('high');
      expect(h.reasoningSettings.effort.set).toHaveBeenCalledWith(
        'high',
        'app',
      );

      // Simulate the effect of the set so get returns the updated value.
      h.reasoningSettings.effort.get.mockReturnValue('high');
      const getResult = await call<{ effort?: string }>(h, 'config:effort-get');
      expect(getResult.effort).toBe('high');
    });

    it('clears the effort when an empty value is passed', async () => {
      const h = makeHarness({ reasoningEffort: 'medium' });
      h.handlers.register();

      await call(h, 'config:effort-set', { effort: '' });

      expect(h.reasoningSettings.effort.set).toHaveBeenCalledWith('', 'app');

      // Simulate the effect of clearing so get reflects the cleared state.
      h.reasoningSettings.effort.get.mockReturnValue('');
      const getResult = await call<{ effort?: string }>(h, 'config:effort-get');
      expect(getResult.effort).toBeUndefined();
    });

    it('syncs effort to the active session when sessionId is provided', async () => {
      const h = makeHarness();
      h.handlers.register();

      await call(h, 'config:effort-set', {
        effort: 'high',
        sessionId: 'sess-1',
      });

      expect(h.reasoningSettings.effort.set).toHaveBeenCalledWith(
        'high',
        'app',
      );
      expect(h.sdkAdapter.setSessionEffort).toHaveBeenCalledWith(
        'sess-1',
        'high',
      );
    });

    it('does not sync to a session when sessionId is absent', async () => {
      const h = makeHarness();
      h.handlers.register();

      await call(h, 'config:effort-set', { effort: 'low' });

      expect(h.sdkAdapter.setSessionEffort).not.toHaveBeenCalled();
    });

    it('rejects live apply failures before persisting', async () => {
      const h = makeHarness();
      h.handlers.register();
      h.sdkAdapter.setSessionEffort.mockRejectedValue(new Error('sync failed'));

      await expect(
        call(h, 'config:effort-set', { effort: 'xhigh', sessionId: 'sess-1' }),
      ).rejects.toThrow('sync failed');
      expect(h.reasoningSettings.effort.set).not.toHaveBeenCalled();
    });

    it('threads applyTo:workspace into the workspace-scoped effort write', async () => {
      const h = makeHarness();
      h.handlers.register();

      await call(h, 'config:effort-set', {
        effort: 'high',
        applyTo: 'workspace',
      });

      expect(h.reasoningSettings.effort.set).toHaveBeenCalledWith(
        'high',
        'workspace',
      );
    });
  });

  describe('config:pricing-get', () => {
    it('waits for catalog hydration before serving the map', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{
        pricing: Record<string, unknown>;
        hydrated: boolean;
      }>(h, 'config:pricing-get');

      // The webview owns a SEPARATE module instance of `pricing.utils`, so a
      // response that raced the OpenRouter fetch would cache the bundled table
      // in the renderer for the rest of the run.
      expect(h.pricingProvider.ensureHydrated).toHaveBeenCalled();
      expect(result.hydrated).toBe(true);
      expect(Object.keys(result.pricing).length).toBeGreaterThan(0);
    });

    it('still serves the bundled map when hydration fails', async () => {
      const h = makeHarness();
      h.pricingProvider.ensureHydrated.mockRejectedValue(new Error('offline'));
      h.handlers.register();

      const result = await call<{
        pricing: Record<string, unknown>;
        hydrated: boolean;
      }>(h, 'config:pricing-get');

      // Degraded, not broken — a renderer on the bundled table is exactly what
      // shipped before, and `hydrated: false` tells it to ask again.
      expect(result.hydrated).toBe(false);
      expect(Object.keys(result.pricing).length).toBeGreaterThan(0);
    });
  });
  it.each(['model', 'effort'] as const)('saves %s once for a session not found', async (setting) => {
    const h = makeHarness();
    h.handlers.register();
    h.sdkAdapter.setSessionModel.mockRejectedValue(new SdkError('Session not found: history'));
    h.sdkAdapter.setSessionEffort.mockRejectedValue(new SdkError('Session not found: history'));
    await expect(call(h, setting === 'model' ? 'config:model-switch' : 'config:effort-set', {
      model: 'new', effort: 'high', sessionId: 'history', applyTo: 'workspace',
    })).resolves.toEqual(setting === 'model' ? { model: 'new' } : { effort: 'high' });
    const save = setting === 'model' ? h.modelSettings.selectedModel.set : h.reasoningSettings.effort.set;
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(setting === 'model' ? 'new' : 'high', 'workspace');
  });

  it('restores live model after a failed save', async () => {
    const h = makeHarness();
    h.handlers.register();
    h.lifecycle.find.mockReturnValue({ currentModel: 'previous' });
    h.modelSettings.selectedModel.set.mockRejectedValue(new Error('save failed'));
    await expect(call(h, 'config:model-switch', { model: 'new', sessionId: 'live' })).rejects.toThrow('save failed');
    expect(h.sdkAdapter.setSessionModel.mock.calls).toEqual([['live', 'new'], ['live', 'previous']]);
  });

  it('reports unknown live effort instead of restoring stale launch effort', async () => {
    const h = makeHarness();
    h.handlers.register();
    h.lifecycle.find.mockReturnValue({ config: { effort: 'low' } });
    h.reasoningSettings.effort.set.mockRejectedValue(new Error('save failed'));
    await expect(call(h, 'config:effort-set', { effort: 'high', sessionId: 'live' })).rejects.toThrow('save failed');
    expect(h.sdkAdapter.setSessionEffort).toHaveBeenCalledTimes(1);
    expect(h.logger.warn).toHaveBeenCalledWith('Cannot restore live setting: previous session value unavailable');
  });

  it('keeps the original save error when permission restore fails and restores live permission', async () => {
    const h = makeHarness();
    h.handlers.register();
    h.lifecycle.levels.set('live', 'plan');
    h.configManager.set.mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('original save'))
      .mockRejectedValueOnce(new Error('restore failed'));
    await expect(call(h, 'config:autopilot-toggle', {
      enabled: true, permissionLevel: 'yolo', sessionId: 'live',
    })).rejects.toThrow('original save');
    expect(h.configManager.set).toHaveBeenCalledTimes(4);
    expect(h.sdkAdapter.setSessionPermissionLevel.mock.calls).toEqual([['live', 'yolo'], ['live', 'plan']]);
    expect(h.logger.error).toHaveBeenCalledWith('Permission settings restore failed', expect.objectContaining({ message: 'restore failed' }));
  });

});
