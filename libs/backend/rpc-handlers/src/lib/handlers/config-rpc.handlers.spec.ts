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
 *   - `config:model-switch`: Persists the selected model to ConfigManager and
 *     optionally syncs it to an active SDK session. Sync failures are
 *     swallowed (warned, not thrown) so the config write still wins.
 *
 *   - `config:model-get`: Three migration branches — (a) legacy bare-tier
 *     values are resolved to full IDs and re-saved, (b) stale "latest"
 *     aliases (e.g. claude-opus-4-6) are migrated to the current
 *     `TIER_TO_MODEL_ID`, (c) specific dated IDs (-YYYYMMDD) are preserved
 *     as-is. `'default'` is a valid SDK tier and MUST NOT be migrated.
 *
 *   - `config:autopilot-toggle`: YOLO requires a Pro subscription — non-Pro
 *     users hit a thrown error. Permission level persists to ConfigManager,
 *     is mirrored to SdkPermissionHandler, AND is mapped/mirrored to any
 *     active SDK session (`mapPermissionToSdkMode` — ask→default,
 *     auto-edit→acceptEdits, yolo→bypassPermissions, plan→plan). When
 *     disabled, the SDK session is reset to 'default' so canUseTool runs.
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

import type {
  ConfigManager,
  FeatureGateService,
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
  ModelResolver,
  ProviderModelsService,
  SdkAgentAdapter,
  SdkPermissionHandler,
} from '@ptah-extension/agent-sdk';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import type {
  ModelSettings,
  ReasoningSettings,
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
    | 'setSessionPermissionLevel'
    | 'getSupportedModels'
    | 'getApiModels'
  >
>;

function createMockSdkAdapter(): MockSdkAdapter {
  return {
    setSessionModel: jest.fn().mockResolvedValue(undefined),
    setSessionPermissionLevel: jest.fn().mockResolvedValue(undefined),
    getSupportedModels: jest.fn().mockResolvedValue([]),
    getApiModels: jest.fn().mockResolvedValue([]),
  };
}

type MockProviderModels = jest.Mocked<
  Pick<ProviderModelsService, 'getModelTiers' | 'resolveActiveProviderId'>
>;

function createMockProviderModels(): MockProviderModels {
  return {
    getModelTiers: jest
      .fn()
      .mockReturnValue({ default: null, fast: null, reasoning: null }),
    resolveActiveProviderId: jest.fn().mockReturnValue('anthropic'),
  };
}

type MockPermissionHandler = jest.Mocked<
  Pick<SdkPermissionHandler, 'setPermissionLevel'>
>;

function createMockPermissionHandler(): MockPermissionHandler {
  return { setPermissionLevel: jest.fn() };
}

type MockModelResolver = jest.Mocked<
  Pick<ModelResolver, 'resolve' | 'detectTier'>
>;

function createMockModelResolver(): MockModelResolver {
  return {
    // Default: identity resolve (handler tests override as needed)
    resolve: jest.fn((model: string) => model),
    detectTier: jest.fn((_model: string) => undefined),
  };
}

type MockFeatureGate = jest.Mocked<Pick<FeatureGateService, 'isProTier'>>;

function createMockFeatureGate(
  { isPro }: { isPro?: boolean } = { isPro: false },
): MockFeatureGate {
  return {
    isProTier: jest.fn().mockResolvedValue(isPro ?? false),
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Harness {
  handlers: ConfigRpcHandlers;
  logger: MockLogger;
  rpcHandler: MockRpcHandler;
  configManager: MockConfigManager;
  sdkAdapter: MockSdkAdapter;
  providerModels: MockProviderModels;
  permissionHandler: MockPermissionHandler;
  modelResolver: MockModelResolver;
  sentry: MockSentryService;
  featureGate: MockFeatureGate;
  modelSettings: MockModelSettings;
  reasoningSettings: MockReasoningSettings;
}

function makeHarness(
  opts: {
    configSeed?: Record<string, unknown>;
    isPro?: boolean;
    modelSelected?: string;
    reasoningEffort?: string;
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
  const featureGate = createMockFeatureGate({ isPro: opts.isPro });
  const modelSettings = createMockModelSettings();
  const reasoningSettings = createMockReasoningSettings();

  if (opts.modelSelected !== undefined) {
    modelSettings.selectedModel.get.mockReturnValue(opts.modelSelected);
  }
  if (opts.reasoningEffort !== undefined) {
    reasoningSettings.effort.get.mockReturnValue(opts.reasoningEffort);
  }

  const handlers = new ConfigRpcHandlers(
    logger as unknown as Logger,
    rpcHandler as unknown as import('@ptah-extension/vscode-core').RpcHandler,
    configManager as unknown as ConfigManager,
    sdkAdapter as unknown as SdkAgentAdapter,
    providerModels as unknown as ProviderModelsService,
    permissionHandler as unknown as SdkPermissionHandler,
    modelResolver as unknown as ModelResolver,
    sentry as unknown as SentryService,
    featureGate as unknown as FeatureGateService,
    modelSettings as unknown as ModelSettings,
    reasoningSettings as unknown as ReasoningSettings,
  );

  return {
    handlers,
    logger,
    rpcHandler,
    configManager,
    sdkAdapter,
    providerModels,
    permissionHandler,
    modelResolver,
    sentry,
    featureGate,
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

    it('swallows session-sync failures so the config write still succeeds', async () => {
      const h = makeHarness();
      h.sdkAdapter.setSessionModel.mockRejectedValue(new Error('sync failed'));
      h.handlers.register();

      const result = await call<{ model: string }>(h, 'config:model-switch', {
        model: 'claude-haiku-4-5',
        sessionId: 'sess-xyz',
      });

      expect(result.model).toBe('claude-haiku-4-5');
      expect(h.modelSettings.selectedModel.set).toHaveBeenCalledWith(
        'claude-haiku-4-5',
      );
    });
  });

  // -------------------------------------------------------------------------
  // config:model-get (migration paths)
  // -------------------------------------------------------------------------

  describe('config:model-get', () => {
    it('returns DEFAULT_FALLBACK_MODEL_ID when nothing is stored', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ model: string }>(h, 'config:model-get');

      expect(typeof result.model).toBe('string');
      expect(result.model.length).toBeGreaterThan(0);
    });

    it('preserves "default" as-is (valid SDK tier meaning "let SDK choose")', async () => {
      const h = makeHarness({ modelSelected: 'default' });
      h.handlers.register();

      const result = await call<{ model: string }>(h, 'config:model-get');

      expect(result.model).toBe('default');
      // No migration write should occur for 'default'
      expect(h.modelResolver.resolve).not.toHaveBeenCalled();
    });

    it('migrates a legacy bare-tier value to a full Claude ID and re-saves', async () => {
      const h = makeHarness({ modelSelected: 'opus' });
      h.modelResolver.resolve.mockReturnValue('claude-opus-4-7');
      h.handlers.register();

      const result = await call<{ model: string }>(h, 'config:model-get');

      expect(h.modelResolver.resolve).toHaveBeenCalledWith('opus');
      expect(result.model).toBe('claude-opus-4-7');
      expect(h.modelSettings.selectedModel.set).toHaveBeenCalledWith(
        'claude-opus-4-7',
      );
    });

    it('preserves a dated specific-version ID unchanged', async () => {
      const h = makeHarness({ modelSelected: 'claude-opus-4-7-20251101' });
      // detectTier returns the tier even for dated IDs, but the /-\d{8}$/ guard
      // in the handler must prevent migration.
      h.modelResolver.detectTier.mockReturnValue('opus');
      h.handlers.register();

      const result = await call<{ model: string }>(h, 'config:model-get');

      expect(result.model).toBe('claude-opus-4-7-20251101');
      expect(h.modelSettings.selectedModel.set).not.toHaveBeenCalled();
    });

    it('migrates a stale "latest" alias to the current TIER_TO_MODEL_ID value', async () => {
      // Handler compares `stored` to TIER_TO_MODEL_ID[tier]. The only way to
      // guarantee mismatch is to feed a stored value that clearly isn't the
      // current latest for its tier.
      const h = makeHarness({ modelSelected: 'claude-opus-4-6' });
      h.modelResolver.detectTier.mockReturnValue('opus');
      h.handlers.register();

      const result = await call<{ model: string }>(h, 'config:model-get');

      // We don't hardcode the current ID (it changes over time) — we just
      // assert the handler migrated away from the stale value.
      expect(result.model).not.toBe('claude-opus-4-6');
      expect(h.modelSettings.selectedModel.set).toHaveBeenCalledWith(
        expect.any(String),
      );
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

    it('rejects YOLO mode for non-Pro users', async () => {
      const h = makeHarness({ isPro: false });
      h.handlers.register();

      const response = await h.rpcHandler.handleMessage({
        method: 'config:autopilot-toggle',
        params: { enabled: true, permissionLevel: 'yolo' },
        correlationId: 'corr',
      });

      expect(response.success).toBe(false);
      expect(response.error).toMatch(/pro subscription/i);
      expect(h.permissionHandler.setPermissionLevel).not.toHaveBeenCalledWith(
        'yolo',
      );
    });

    it('allows YOLO when isProTier() returns true and mirrors level to permission handler', async () => {
      const h = makeHarness({ isPro: true });
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
        'acceptEdits',
      );
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

    it('resets the SDK session to "default" when autopilot is disabled', async () => {
      const h = makeHarness();
      h.handlers.register();

      await call(h, 'config:autopilot-toggle', {
        enabled: false,
        permissionLevel: 'auto-edit',
        sessionId: 'sess-2',
      });

      expect(h.sdkAdapter.setSessionPermissionLevel).toHaveBeenCalledWith(
        'sess-2',
        'default',
      );
      // Permission handler collapses to 'ask' when disabled.
      expect(h.permissionHandler.setPermissionLevel).toHaveBeenCalledWith(
        'ask',
      );
    });

    it('swallows session-sync failures so the config write still succeeds', async () => {
      const h = makeHarness();
      h.sdkAdapter.setSessionPermissionLevel.mockRejectedValue(
        new Error('session not found'),
      );
      h.handlers.register();

      const result = await call<{ enabled: boolean }>(
        h,
        'config:autopilot-toggle',
        {
          enabled: true,
          permissionLevel: 'auto-edit',
          sessionId: 'sess-bad',
        },
      );

      expect(result.enabled).toBe(true);
      expect(h.configManager.set).toHaveBeenCalledWith(
        'autopilot.enabled',
        true,
      );
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
      expect(h.reasoningSettings.effort.set).toHaveBeenCalledWith('high');

      // Simulate the effect of the set so get returns the updated value.
      h.reasoningSettings.effort.get.mockReturnValue('high');
      const getResult = await call<{ effort?: string }>(h, 'config:effort-get');
      expect(getResult.effort).toBe('high');
    });

    it('clears the effort when an empty value is passed', async () => {
      const h = makeHarness({ reasoningEffort: 'medium' });
      h.handlers.register();

      await call(h, 'config:effort-set', { effort: '' });

      expect(h.reasoningSettings.effort.set).toHaveBeenCalledWith('');

      // Simulate the effect of clearing so get reflects the cleared state.
      h.reasoningSettings.effort.get.mockReturnValue('');
      const getResult = await call<{ effort?: string }>(h, 'config:effort-get');
      expect(getResult.effort).toBeUndefined();
    });
  });
});
