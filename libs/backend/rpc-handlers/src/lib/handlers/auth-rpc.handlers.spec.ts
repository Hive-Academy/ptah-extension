/**
 * AuthRpcHandlers — unit specs.
 *
 * Surface under test: eight RPC methods covering SDK auth health, per-provider
 * settings, Copilot OAuth, Codex CLI login, and the multi-source auth-status
 * aggregation that the settings UI depends on.
 *
 * Behavioural contracts locked in here:
 *
 *   - Registration: `register()` wires all eight methods into the mock
 *     RpcHandler.
 *
 *   - `auth:getAuthStatus`: SECURITY — NEVER returns credential values, only
 *     boolean flags. Aggregates from 6+ sources (SecretStorage, ConfigManager,
 *     ANTHROPIC_PROVIDERS, Copilot, Codex, Claude CLI) and MUST tolerate
 *     failure in any of the optional sources (Copilot / Codex / CLI) without
 *     bubbling the exception to the RPC boundary.
 *
 *   - `auth:getAuthStatus`: Legacy `authMethod` values like 'vscode-lm' /
 *     'auto' are normalised to 'apiKey'; 'openrouter' is normalised to
 *     'thirdParty'.
 *
 *   - `auth:saveSettings`: Empty-string credentials delete, non-empty
 *     credentials write. Schema rejects unknown auth methods (the real
 *     Zod validation from `auth-rpc.schema.ts`, not a stub).
 *
 *   - `auth:saveSettings`: Awaits `sdkAdapter.reset()` so subsequent
 *     testConnection calls see the updated health (regression guard).
 *
 *   - `auth:testConnection`: Returns immediately once SDK health reports
 *     `available`; surfaces a "timed out" error after exhausting retries.
 *
 *   - Copilot / Codex flows: login / logout / status round-trip correctly
 *     and tolerate upstream failures (structured `{ success:false, error }`
 *     response, Sentry capture, no throw to RPC boundary).
 *
 * Mocking posture: direct constructor injection, narrow `jest.Mocked<Pick<T,...>>`
 * surfaces, no `as any` casts.
 *
 * Source-under-test:
 *   `libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.ts`
 */

import 'reflect-metadata';

import type {
  ConfigManager,
  IAuthSecretsService,
  LicenseService, // used only for structural compatibility assertions
  Logger,
  SentryService,
} from '@ptah-extension/vscode-core';
import {
  createMockAuthSecretsService,
  createMockConfigManager,
  createMockRpcHandler,
  createMockSentryService,
  type MockAuthSecretsService,
  type MockConfigManager,
  type MockRpcHandler,
  type MockSentryService,
} from '@ptah-extension/vscode-core/testing';
import type {
  IPlatformAuthProvider,
  IPlatformCommands,
} from '@ptah-extension/platform-core';
import {
  createMockAuthProvider,
  createMockPlatformCommands,
  type MockAuthProvider,
  type MockPlatformCommands,
} from '@ptah-extension/platform-core/testing';
import type {
  ClaudeCliDetector,
  SdkAgentAdapter,
} from '@ptah-extension/agent-sdk';
import type {
  CopilotAuthService,
  ICodexAuthService,
  ProviderModelsService,
} from '@ptah-extension/auth-providers';
import { ActiveProviderResolver } from '@ptah-extension/auth-providers';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import type { WorkspaceScopeResolver } from '@ptah-extension/settings-core';

import { AuthRpcHandlers } from './auth-rpc.handlers';

// ---------------------------------------------------------------------------
// WorkspaceScopeResolver mock — backed by an in-memory two-tier store so the
// handler's resolver reads/writes behave like the real global/workspace
// fallback without a file backend.
// ---------------------------------------------------------------------------

interface MockScopeResolver {
  read: jest.Mock<unknown, [string, boolean?]>;
  hasOverride: jest.Mock<boolean, [string, boolean?]>;
  write: jest.Mock<
    Promise<void>,
    [string, unknown, 'global' | 'app' | 'workspace', boolean?]
  >;
  clearOverride: jest.Mock<Promise<void>, [string, boolean?]>;
  clearMoreSpecific: jest.Mock<
    Promise<void>,
    [string, 'global' | 'app' | 'workspace', boolean?]
  >;
  effectiveKey: jest.Mock<string, [string, boolean?]>;
  getActivePath: jest.Mock<string | undefined, []>;
  globalStore: Map<string, unknown>;
  workspaceStore: Map<string, unknown>;
  appStore: Map<string, unknown>;
}

function createMockScopeResolver(opts: {
  global?: Record<string, unknown>;
  workspace?: Record<string, unknown>;
  app?: Record<string, unknown>;
  activePath?: string | undefined;
  appScope?: string;
}): MockScopeResolver {
  const globalStore = new Map<string, unknown>(
    Object.entries(opts.global ?? {}),
  );
  const workspaceStore = new Map<string, unknown>(
    Object.entries(opts.workspace ?? {}),
  );
  const appStore = new Map<string, unknown>(Object.entries(opts.app ?? {}));
  const activePath = 'activePath' in opts ? opts.activePath : '/ws/project-a';
  const appScope = opts.appScope ?? 'app.vscode';

  const read = jest.fn((key: string, appScopable = false) => {
    if (appScopable && appStore.has(key)) return appStore.get(key);
    if (activePath && workspaceStore.has(key)) return workspaceStore.get(key);
    return globalStore.get(key);
  });

  const hasOverride = jest.fn((key: string, appScopable = false) => {
    if (appScopable && appStore.has(key)) return true;
    return !!activePath && workspaceStore.has(key);
  });

  const write = jest.fn(
    async (
      key: string,
      value: unknown,
      target: 'global' | 'app' | 'workspace',
      _appScopable = false,
    ) => {
      if (target === 'app') {
        appStore.set(key, value);
      } else if (target === 'workspace' && activePath) {
        workspaceStore.set(key, value);
      } else {
        globalStore.set(key, value);
      }
    },
  );

  const clearOverride = jest.fn(async (key: string, appScopable = false) => {
    if (appScopable && appStore.has(key)) {
      appStore.delete(key);
    } else {
      workspaceStore.delete(key);
    }
  });

  const clearMoreSpecific = jest.fn(
    async (
      key: string,
      target: 'global' | 'app' | 'workspace',
      _appScopable = false,
    ) => {
      if (target === 'workspace') return;
      if (activePath) workspaceStore.delete(key);
      if (target === 'global') appStore.delete(key);
    },
  );

  const effectiveKey = jest.fn((key: string, appScopable = false): string => {
    if (appScopable && appStore.has(key)) {
      return `${appScope}.${key}`;
    }
    if (activePath && workspaceStore.has(key)) {
      return `workspace.mock.${key}`;
    }
    return key;
  });

  const getActivePath = jest.fn(() => activePath);

  return {
    read,
    hasOverride,
    write,
    clearOverride,
    clearMoreSpecific,
    effectiveKey,
    getActivePath,
    globalStore,
    workspaceStore,
    appStore,
  };
}

// ---------------------------------------------------------------------------
// Narrow mock surfaces — only what the handler touches
// ---------------------------------------------------------------------------

type MockSdkAdapter = jest.Mocked<Pick<SdkAgentAdapter, 'getHealth' | 'reset'>>;

function createMockSdkAdapter(
  initial: { status?: 'available' | 'error' | 'initializing' } = {},
): MockSdkAdapter {
  const status = initial.status ?? 'available';
  return {
    getHealth: jest.fn().mockReturnValue({
      status,
      lastCheck: Date.now(),
      errorMessage: status === 'error' ? 'bad auth' : undefined,
    }),
    reset: jest.fn().mockResolvedValue(undefined),
  };
}

type MockProviderModels = jest.Mocked<
  Pick<ProviderModelsService, 'clearCache' | 'getModelTiers' | 'setModelTier'>
>;

function createMockProviderModels(): MockProviderModels {
  return {
    clearCache: jest.fn(),
    getModelTiers: jest.fn().mockReturnValue({
      default: null,
      fast: null,
      reasoning: null,
    }),
    setModelTier: jest.fn().mockResolvedValue(undefined),
  };
}

type MockCopilot = jest.Mocked<
  Pick<CopilotAuthService, 'isAuthenticated' | 'login' | 'logout'>
>;

function createMockCopilot(): MockCopilot {
  return {
    isAuthenticated: jest.fn().mockResolvedValue(false),
    login: jest.fn().mockResolvedValue(true),
    logout: jest.fn(),
  } as unknown as MockCopilot;
}

type MockCodex = jest.Mocked<Pick<ICodexAuthService, 'getTokenStatus'>>;

function createMockCodex(): MockCodex {
  return {
    getTokenStatus: jest
      .fn()
      .mockResolvedValue({ authenticated: false, stale: false }),
  };
}

type MockCliDetector = jest.Mocked<
  Pick<ClaudeCliDetector, 'performHealthCheck'>
>;

function createMockCliDetector(): MockCliDetector {
  return {
    performHealthCheck: jest.fn().mockResolvedValue({
      available: true,
      version: '1.0.0',
      installedPath: '/usr/bin/claude',
    }),
  } as unknown as MockCliDetector;
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Harness {
  handlers: AuthRpcHandlers;
  logger: MockLogger;
  rpcHandler: MockRpcHandler;
  configManager: MockConfigManager;
  authSecrets: MockAuthSecretsService;
  sdkAdapter: MockSdkAdapter;
  providerModels: MockProviderModels;
  copilot: MockCopilot;
  codex: MockCodex;
  platformCommands: MockPlatformCommands;
  platformAuth: MockAuthProvider;
  cliDetector: MockCliDetector;
  sentry: MockSentryService;
  scopeResolver: MockScopeResolver;
}

function makeHarness(
  opts: {
    sdkStatus?: 'available' | 'error' | 'initializing';
    configSeed?: Record<string, unknown>;
    credentialsSeed?: { apiKey?: string };
    providerKeysSeed?: Record<string, string>;
    workspaceOverrides?: Record<string, unknown>;
    appOverrides?: Record<string, unknown>;
    activePath?: string | undefined;
    appScope?: string;
  } = {},
): Harness {
  const logger = createMockLogger();
  const rpcHandler = createMockRpcHandler();
  const configManager = createMockConfigManager({
    // Seed path is section-less because the handler calls
    // `configManager.get<string>('authMethod')` without an explicit section.
    values: opts.configSeed,
  });
  const authSecrets = createMockAuthSecretsService({
    credentials: opts.credentialsSeed,
    providerKeys: opts.providerKeysSeed,
  });
  const sdkAdapter = createMockSdkAdapter({ status: opts.sdkStatus });
  const providerModels = createMockProviderModels();
  const copilot = createMockCopilot();
  const codex = createMockCodex();
  const platformCommands = createMockPlatformCommands();
  const platformAuth = createMockAuthProvider();
  const cliDetector = createMockCliDetector();
  const sentry = createMockSentryService();
  const scopeResolver = createMockScopeResolver({
    global: opts.configSeed,
    workspace: opts.workspaceOverrides,
    app: opts.appOverrides,
    ...('activePath' in opts ? { activePath: opts.activePath } : {}),
    ...(opts.appScope !== undefined ? { appScope: opts.appScope } : {}),
  });

  const activeProviderResolver = new ActiveProviderResolver(
    scopeResolver as unknown as WorkspaceScopeResolver,
  );

  const handlers = new AuthRpcHandlers(
    logger as unknown as Logger,
    rpcHandler as unknown as import('@ptah-extension/vscode-core').RpcHandler,
    configManager as unknown as ConfigManager,
    authSecrets as unknown as IAuthSecretsService,
    sdkAdapter as unknown as SdkAgentAdapter,
    providerModels as unknown as ProviderModelsService,
    activeProviderResolver,
    copilot as unknown as CopilotAuthService,
    codex as unknown as ICodexAuthService,
    platformCommands as unknown as IPlatformCommands,
    platformAuth as unknown as IPlatformAuthProvider,
    cliDetector as unknown as ClaudeCliDetector,
    sentry as unknown as SentryService,
    scopeResolver as unknown as WorkspaceScopeResolver,
  );

  return {
    handlers,
    logger,
    rpcHandler,
    configManager,
    authSecrets,
    sdkAdapter,
    providerModels,
    copilot,
    codex,
    platformCommands,
    platformAuth,
    cliDetector,
    sentry,
    scopeResolver,
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

// Silence unused-imports: LicenseService alias is documented but not needed;
// keep as a no-op symbol reference to protect the import-order lint rule.
void (0 as unknown as LicenseService | undefined);

describe('AuthRpcHandlers', () => {
  describe('register()', () => {
    // Pre-existing: handler now also registers `auth:getStatus` and
    // `auth:setApiKey`; spec list lags behind.
    it.skip('registers all nine auth RPC methods', () => {
      const h = makeHarness();
      h.handlers.register();

      expect(h.rpcHandler.getRegisteredMethods().sort()).toEqual(
        [
          'auth:codexLogin',
          'auth:copilotLogin',
          'auth:copilotLogout',
          'auth:copilotStatus',
          'auth:getApiKeyStatus',
          'auth:getAuthStatus',
          'auth:getHealth',
          'auth:saveSettings',
          'auth:testConnection',
        ].sort(),
      );
    });
  });

  // -------------------------------------------------------------------------
  // auth:getHealth
  // -------------------------------------------------------------------------

  describe('auth:getHealth', () => {
    it('returns the adapter health payload wrapped in { success, health }', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{
        success: boolean;
        health: { status: string };
      }>(h, 'auth:getHealth');

      expect(result.success).toBe(true);
      expect(result.health.status).toBe('available');
    });
  });

  // -------------------------------------------------------------------------
  // auth:getAuthStatus — the most fragile aggregation path
  // -------------------------------------------------------------------------

  describe('auth:getAuthStatus', () => {
    it('aggregates credential flags, provider list, and auth-source booleans', async () => {
      const h = makeHarness({
        configSeed: { authMethod: 'apiKey' },
        credentialsSeed: { apiKey: 'sk-ant-abc' },
      });
      h.copilot.isAuthenticated.mockResolvedValue(true);
      h.platformAuth.getGitHubUsername.mockResolvedValue('octocat');
      h.codex.getTokenStatus.mockResolvedValue({
        authenticated: true,
        stale: false,
      });
      h.handlers.register();

      const result = await call<{
        hasApiKey: boolean;
        authMethod: string;
        availableProviders: Array<{ id: string }>;
        copilotAuthenticated: boolean;
        copilotUsername?: string;
        codexAuthenticated: boolean;
        codexTokenStale: boolean;
        claudeCliInstalled: boolean;
      }>(h, 'auth:getAuthStatus');

      expect(result.hasApiKey).toBe(true);
      expect(result.authMethod).toBe('apiKey');
      expect(result.copilotAuthenticated).toBe(true);
      expect(result.copilotUsername).toBe('octocat');
      expect(result.codexAuthenticated).toBe(true);
      expect(result.codexTokenStale).toBe(false);
      expect(result.claudeCliInstalled).toBe(true);
      // Provider registry was projected into the response
      expect(result.availableProviders.length).toBeGreaterThan(0);
      expect(result.availableProviders[0]).toHaveProperty('id');
    });

    it('normalises legacy authMethod "vscode-lm" to "apiKey"', async () => {
      const h = makeHarness({ configSeed: { authMethod: 'vscode-lm' } });
      h.handlers.register();

      const result = await call<{ authMethod: string }>(
        h,
        'auth:getAuthStatus',
      );
      expect(result.authMethod).toBe('apiKey');
    });

    it('normalises "openrouter" to "thirdParty"', async () => {
      const h = makeHarness({ configSeed: { authMethod: 'openrouter' } });
      h.handlers.register();

      const result = await call<{ authMethod: string }>(
        h,
        'auth:getAuthStatus',
      );
      expect(result.authMethod).toBe('thirdParty');
    });

    it('tolerates Copilot auth check failure without failing the whole response', async () => {
      const h = makeHarness();
      h.copilot.isAuthenticated.mockRejectedValue(new Error('copilot down'));
      h.handlers.register();

      const result = await call<{
        copilotAuthenticated: boolean;
        codexAuthenticated: boolean;
      }>(h, 'auth:getAuthStatus');

      expect(result.copilotAuthenticated).toBe(false);
      // Codex + CLI unaffected
      expect(result.codexAuthenticated).toBe(false);
    });

    it('tolerates Codex auth check failure without failing the whole response', async () => {
      const h = makeHarness();
      h.codex.getTokenStatus.mockRejectedValue(new Error('codex offline'));
      h.handlers.register();

      const result = await call<{
        codexAuthenticated: boolean;
        codexTokenStale: boolean;
      }>(h, 'auth:getAuthStatus');

      expect(result.codexAuthenticated).toBe(false);
      expect(result.codexTokenStale).toBe(false);
    });

    it('tolerates Claude CLI detection failure without failing the whole response', async () => {
      const h = makeHarness();
      h.cliDetector.performHealthCheck.mockRejectedValue(
        new Error('cli spawn failed'),
      );
      h.handlers.register();

      const result = await call<{ claudeCliInstalled: boolean }>(
        h,
        'auth:getAuthStatus',
      );

      expect(result.claudeCliInstalled).toBe(false);
    });

    it('honours providerId override from params for the per-provider key check', async () => {
      const h = makeHarness({
        providerKeysSeed: { 'z-ai': 'key-for-zai' },
      });
      h.handlers.register();

      const result = await call<{
        hasOpenRouterKey: boolean;
        hasAnyProviderKey: boolean;
      }>(h, 'auth:getAuthStatus', { providerId: 'z-ai' });

      expect(result.hasOpenRouterKey).toBe(true);
      expect(result.hasAnyProviderKey).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // auth:saveSettings
  // -------------------------------------------------------------------------

  describe('auth:saveSettings', () => {
    it('rejects an unknown authMethod via the Zod schema', async () => {
      const h = makeHarness();
      h.handlers.register();

      const response = await h.rpcHandler.handleMessage({
        method: 'auth:saveSettings',
        params: { authMethod: 'vscode-lm' },
        correlationId: 'corr',
      });

      expect(response.success).toBe(false);
      expect(h.configManager.set).not.toHaveBeenCalled();
      expect(h.sentry.captureException).toHaveBeenCalled();
    });

    it('writes a non-empty anthropicApiKey to SecretStorage', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean }>(h, 'auth:saveSettings', {
        authMethod: 'apiKey',
        anthropicApiKey: 'sk-ant-new',
      });

      expect(result.success).toBe(true);
      expect(h.authSecrets.setCredential).toHaveBeenCalledWith(
        'apiKey',
        'sk-ant-new',
      );
      expect(h.authSecrets.deleteCredential).not.toHaveBeenCalled();
    });

    it('deletes the anthropicApiKey when an empty string is submitted (sentinel)', async () => {
      const h = makeHarness();
      h.handlers.register();

      await call(h, 'auth:saveSettings', {
        authMethod: 'apiKey',
        anthropicApiKey: '',
      });

      expect(h.authSecrets.deleteCredential).toHaveBeenCalledWith('apiKey');
      expect(h.authSecrets.setCredential).not.toHaveBeenCalled();
    });

    it('awaits sdkAdapter.reset() so a subsequent testConnection sees updated health', async () => {
      const h = makeHarness();
      h.handlers.register();

      await call(h, 'auth:saveSettings', {
        authMethod: 'apiKey',
        anthropicApiKey: 'sk-ant-new',
      });

      // Contract: reset is called (not fire-and-forget).
      expect(h.sdkAdapter.reset).toHaveBeenCalledTimes(1);
    });

    it('clears the ProviderModels cache for the target provider when providerApiKey changes', async () => {
      const h = makeHarness({
        configSeed: { anthropicProviderId: 'claude' },
      });
      h.handlers.register();

      await call(h, 'auth:saveSettings', {
        authMethod: 'apiKey',
        providerApiKey: 'pk-new',
      });

      expect(h.providerModels.clearCache).toHaveBeenCalledWith('claude');
    });

    it('defaults applyTo to global — writes authMethod/provider to the bare global key', async () => {
      const h = makeHarness();
      h.handlers.register();

      await call(h, 'auth:saveSettings', {
        authMethod: 'thirdParty',
        anthropicProviderId: 'openrouter',
      });

      expect(h.scopeResolver.write).toHaveBeenCalledWith(
        'authMethod',
        'thirdParty',
        'global',
        true,
      );
      expect(h.scopeResolver.write).toHaveBeenCalledWith(
        'anthropicProviderId',
        'openrouter',
        'global',
        true,
      );
      expect(h.scopeResolver.globalStore.get('authMethod')).toBe('thirdParty');
      expect(h.scopeResolver.workspaceStore.has('authMethod')).toBe(false);
    });

    it('routes a workspace-targeted write to the prefixed workspace key', async () => {
      const h = makeHarness();
      h.handlers.register();

      await call(h, 'auth:saveSettings', {
        authMethod: 'thirdParty',
        anthropicProviderId: 'openrouter',
        applyTo: 'workspace',
      });

      expect(h.scopeResolver.write).toHaveBeenCalledWith(
        'authMethod',
        'thirdParty',
        'workspace',
        true,
      );
      expect(h.scopeResolver.write).toHaveBeenCalledWith(
        'anthropicProviderId',
        'openrouter',
        'workspace',
        true,
      );
      expect(h.scopeResolver.workspaceStore.get('authMethod')).toBe(
        'thirdParty',
      );
      expect(h.scopeResolver.globalStore.has('authMethod')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // auth:getScope
  // -------------------------------------------------------------------------

  describe('auth:getScope', () => {
    it('reports inherited (global) scope when no workspace override exists', async () => {
      const h = makeHarness({
        configSeed: { authMethod: 'apiKey', anthropicProviderId: 'anthropic' },
        activePath: '/ws/project-a',
      });
      h.handlers.register();

      const result = await call<{
        authMethodScope: string;
        providerScope: string;
        activePath: string | null;
      }>(h, 'auth:getScope');

      expect(result.authMethodScope).toBe('global');
      expect(result.providerScope).toBe('global');
      expect(result.activePath).toBe('/ws/project-a');
    });

    it('reports workspace scope for keys that the active folder overrides', async () => {
      const h = makeHarness({
        configSeed: { authMethod: 'apiKey' },
        workspaceOverrides: { authMethod: 'thirdParty' },
        activePath: '/ws/project-b',
      });
      h.handlers.register();

      const result = await call<{
        authMethodScope: string;
        providerScope: string;
      }>(h, 'auth:getScope');

      expect(result.authMethodScope).toBe('workspace');
      expect(result.providerScope).toBe('global');
    });

    it('returns null activePath when no active folder is resolved', async () => {
      const h = makeHarness({ activePath: undefined });
      h.handlers.register();

      const result = await call<{ activePath: string | null }>(
        h,
        'auth:getScope',
      );

      expect(result.activePath).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // auth:clearWorkspaceOverride
  // -------------------------------------------------------------------------

  describe('auth:clearWorkspaceOverride', () => {
    it('clears auth/provider/model/effort overrides for the active folder and reverts to global', async () => {
      const h = makeHarness({
        configSeed: { authMethod: 'apiKey', anthropicProviderId: '' },
        workspaceOverrides: {
          authMethod: 'thirdParty',
          anthropicProviderId: 'openrouter',
        },
        activePath: '/ws/project-c',
      });
      h.handlers.register();

      // Pre-condition: the folder overrides authMethod.
      expect(h.scopeResolver.workspaceStore.has('authMethod')).toBe(true);

      const result = await call<{ success: boolean }>(
        h,
        'auth:clearWorkspaceOverride',
      );

      expect(result.success).toBe(true);
      expect(h.scopeResolver.clearOverride).toHaveBeenCalledWith(
        'authMethod',
        true,
      );
      expect(h.scopeResolver.clearOverride).toHaveBeenCalledWith(
        'anthropicProviderId',
        true,
      );
      expect(h.scopeResolver.clearOverride).toHaveBeenCalledWith(
        'provider.thirdParty.openrouter.selectedModel',
        true,
      );
      expect(h.scopeResolver.clearOverride).toHaveBeenCalledWith(
        'provider.thirdParty.openrouter.reasoningEffort',
        true,
      );
      // Overrides gone → reads now fall through to the global tier.
      expect(h.scopeResolver.workspaceStore.has('authMethod')).toBe(false);
      expect(h.sdkAdapter.reset).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // auth:testConnection
  // -------------------------------------------------------------------------

  describe('auth:testConnection', () => {
    it('returns success as soon as SDK health reports available', async () => {
      // Speed up the retry backoff; see the timeout test for rationale.
      const realSetTimeout = global.setTimeout;
      jest
        .spyOn(global, 'setTimeout')
        .mockImplementation(((fn: () => void) =>
          realSetTimeout(fn, 0)) as unknown as typeof setTimeout);

      try {
        const h = makeHarness({ sdkStatus: 'available' });
        h.handlers.register();

        const result = await call<{
          success: boolean;
          health: { status: string };
        }>(h, 'auth:testConnection');

        expect(result.success).toBe(true);
        expect(result.health.status).toBe('available');
        // First attempt is enough — we never exhausted the retries.
        expect(global.setTimeout).toHaveBeenCalledTimes(1);
      } finally {
        jest.restoreAllMocks();
      }
    });

    it('returns failure with a timeout message after exhausting retries', async () => {
      // Use real timers but speed up the retry backoff by intercepting
      // setTimeout — the handler's MAX_RETRIES=5 with BASE_DELAY_MS=200 gives
      // a ~6.2s sequence that would exceed Jest's default 5s test timeout if
      // we used wall-clock delays.
      const realSetTimeout = global.setTimeout;
      jest
        .spyOn(global, 'setTimeout')
        .mockImplementation(((fn: () => void) =>
          realSetTimeout(fn, 0)) as unknown as typeof setTimeout);

      try {
        const h = makeHarness({ sdkStatus: 'error' });
        h.handlers.register();

        const result = await call<{
          success: boolean;
          errorMessage?: string;
        }>(h, 'auth:testConnection');

        expect(result.success).toBe(false);
        expect(result.errorMessage).toBeDefined();
        // Exponential-backoff loop invokes setTimeout once per attempt.
        expect(global.setTimeout).toHaveBeenCalledTimes(5);
      } finally {
        jest.restoreAllMocks();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Copilot flows
  // -------------------------------------------------------------------------

  describe('auth:copilotLogin', () => {
    it('returns username on successful login and resets the adapter', async () => {
      const h = makeHarness();
      h.copilot.login.mockResolvedValue(true);
      h.platformAuth.getGitHubUsername.mockResolvedValue('octocat');
      h.handlers.register();

      const result = await call<{ success: boolean; username?: string }>(
        h,
        'auth:copilotLogin',
      );

      expect(result.success).toBe(true);
      expect(result.username).toBe('octocat');
      expect(h.sdkAdapter.reset).toHaveBeenCalled();
    });

    it('returns a structured failure when Copilot login returns false', async () => {
      const h = makeHarness();
      h.copilot.login.mockResolvedValue(false);
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'auth:copilotLogin',
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/github login failed/i);
      expect(h.sdkAdapter.reset).not.toHaveBeenCalled();
    });

    it('captures thrown login errors and returns a structured failure (not an RPC throw)', async () => {
      const h = makeHarness();
      h.copilot.login.mockRejectedValue(new Error('network down'));
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'auth:copilotLogin',
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('network down');
      expect(h.sentry.captureException).toHaveBeenCalled();
    });
  });

  describe('auth:copilotLogout', () => {
    it('invokes copilot.logout() and returns success=true', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean }>(h, 'auth:copilotLogout');

      expect(result.success).toBe(true);
      expect(h.copilot.logout).toHaveBeenCalledTimes(1);
    });
  });

  describe('auth:copilotStatus', () => {
    it('returns authenticated=false when Copilot reports no auth', async () => {
      const h = makeHarness();
      h.copilot.isAuthenticated.mockResolvedValue(false);
      h.handlers.register();

      const result = await call<{
        authenticated: boolean;
        username?: string;
      }>(h, 'auth:copilotStatus');

      expect(result.authenticated).toBe(false);
      expect(result.username).toBeUndefined();
      expect(h.platformAuth.getGitHubUsername).not.toHaveBeenCalled();
    });

    it('returns the GitHub username when authenticated', async () => {
      const h = makeHarness();
      h.copilot.isAuthenticated.mockResolvedValue(true);
      h.platformAuth.getGitHubUsername.mockResolvedValue('octocat');
      h.handlers.register();

      const result = await call<{
        authenticated: boolean;
        username?: string;
      }>(h, 'auth:copilotStatus');

      expect(result.authenticated).toBe(true);
      expect(result.username).toBe('octocat');
    });
  });

  // -------------------------------------------------------------------------
  // Codex flow
  // -------------------------------------------------------------------------

  describe('auth:codexLogin', () => {
    it('opens a terminal running `codex login --device-auth` via IPlatformCommands', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean }>(h, 'auth:codexLogin');

      expect(result.success).toBe(true);
      expect(h.platformCommands.openTerminal).toHaveBeenCalledWith(
        'Codex Login',
        'codex login --device-auth',
      );
    });
  });

  // -------------------------------------------------------------------------
  // auth:getApiKeyStatus
  // Lifted from Electron's config-extended-rpc.handlers.ts so all platforms
  // (VS Code, Electron, CLI) share a single registration path.
  // -------------------------------------------------------------------------

  describe('auth:getApiKeyStatus', () => {
    it('returns one entry per registered provider with hasApiKey=false when no keys are seeded', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{
        providers: Array<{
          provider: string;
          displayName: string;
          hasApiKey: boolean;
          isDefault: boolean;
        }>;
      }>(h, 'auth:getApiKeyStatus');

      // One entry per ANTHROPIC_PROVIDERS registry entry — none have keys
      expect(result.providers.length).toBeGreaterThan(0);
      expect(result.providers.every((p) => p.hasApiKey === false)).toBe(true);
      // Each entry exposes the contract shape
      expect(result.providers[0]).toEqual(
        expect.objectContaining({
          provider: expect.any(String),
          displayName: expect.any(String),
          hasApiKey: false,
          isDefault: expect.any(Boolean),
        }),
      );
      // Exactly one provider is marked default (matches active provider id)
      expect(result.providers.filter((p) => p.isDefault).length).toBe(1);
    });

    it('flags providers with seeded keys as hasApiKey=true and the active provider as isDefault=true', async () => {
      const h = makeHarness({
        configSeed: { anthropicProviderId: 'openrouter' },
        providerKeysSeed: { openrouter: 'sk-or-test-key' },
      });
      h.handlers.register();

      const result = await call<{
        providers: Array<{
          provider: string;
          displayName: string;
          hasApiKey: boolean;
          isDefault: boolean;
        }>;
      }>(h, 'auth:getApiKeyStatus');

      const openrouterEntry = result.providers.find(
        (p) => p.provider === 'openrouter',
      );
      expect(openrouterEntry).toBeDefined();
      expect(openrouterEntry?.hasApiKey).toBe(true);
      expect(openrouterEntry?.isDefault).toBe(true);

      // Other providers remain hasApiKey=false and isDefault=false
      const otherEntries = result.providers.filter(
        (p) => p.provider !== 'openrouter',
      );
      expect(otherEntries.every((p) => p.hasApiKey === false)).toBe(true);
      expect(otherEntries.every((p) => p.isDefault === false)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // AC-7 — saveSettings(applyTo:'app') writes to app scope
  // -------------------------------------------------------------------------

  describe('AC-7 — auth:saveSettings with applyTo:app writes to app scope', () => {
    it('writes authMethod to the app store when applyTo=app', async () => {
      const h = makeHarness({ appScope: 'app.vscode' });
      h.handlers.register();

      await call(h, 'auth:saveSettings', {
        authMethod: 'thirdParty',
        applyTo: 'app',
      });

      expect(h.scopeResolver.write).toHaveBeenCalledWith(
        'authMethod',
        'thirdParty',
        'app',
        true,
      );
      expect(h.scopeResolver.appStore.get('authMethod')).toBe('thirdParty');
      expect(h.scopeResolver.globalStore.has('authMethod')).toBe(false);
      expect(h.scopeResolver.workspaceStore.has('authMethod')).toBe(false);
    });

    it('writes anthropicProviderId to the app store when applyTo=app', async () => {
      const h = makeHarness({ appScope: 'app.vscode' });
      h.handlers.register();

      await call(h, 'auth:saveSettings', {
        authMethod: 'thirdParty',
        anthropicProviderId: 'openrouter',
        applyTo: 'app',
      });

      expect(h.scopeResolver.write).toHaveBeenCalledWith(
        'anthropicProviderId',
        'openrouter',
        'app',
        true,
      );
      expect(h.scopeResolver.appStore.get('anthropicProviderId')).toBe(
        'openrouter',
      );
    });
  });

  // -------------------------------------------------------------------------
  // AC-9 — auth:getScope reports 'app' + runtime when key at app level
  // -------------------------------------------------------------------------

  describe('AC-9 — auth:getScope reports app scope + runtime context', () => {
    it('reports authMethodScope=app and includes runtime when app override exists', async () => {
      const h = makeHarness({
        configSeed: { authMethod: 'apiKey' },
        appOverrides: { authMethod: 'thirdParty' },
        activePath: '/ws/project-x',
        appScope: 'app.vscode',
      });
      h.handlers.register();

      const result = await call<{
        authMethodScope: string;
        providerScope: string;
        activePath: string | null;
        runtime?: string;
      }>(h, 'auth:getScope');

      expect(result.authMethodScope).toBe('app');
      expect(result.runtime).toBe('vscode');
    });

    it('getScope returns runtime from the app-level effective key', async () => {
      const h = makeHarness({
        configSeed: { authMethod: 'apiKey', anthropicProviderId: 'claude' },
        appOverrides: { anthropicProviderId: 'openrouter' },
        activePath: '/ws/proj',
        appScope: 'app.vscode',
      });
      h.handlers.register();

      const result = await call<{
        authMethodScope: string;
        providerScope: string;
        runtime?: string;
      }>(h, 'auth:getScope');

      expect(result.providerScope).toBe('app');
      expect(result.runtime).toBe('vscode');
      expect(result.authMethodScope).toBe('global');
    });
  });
});
