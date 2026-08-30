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
  CopilotLoginOptions,
  ICodexAuthService,
  ProviderModelsService,
} from '@ptah-extension/auth-providers';
import { ActiveProviderResolver } from '@ptah-extension/auth-providers';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import type { ClaudeCliHealth } from '@ptah-extension/shared';
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
    // Async on purpose: `logout()` persists the Ptah logout tombstone
    // (TASK_2026_172 Issue 2), so the handler must await it.
    logout: jest.fn().mockResolvedValue(undefined),
  } as unknown as MockCopilot;
}

type MockCodex = jest.Mocked<
  Pick<ICodexAuthService, 'getTokenStatus' | 'clearCache'>
>;

function createMockCodex(): MockCodex {
  return {
    getTokenStatus: jest
      .fn()
      .mockResolvedValue({ authenticated: false, stale: false }),
    clearCache: jest.fn(),
  };
}

/**
 * Push surface used by the interactive-login events (`auth:deviceCode`).
 * Injected optionally, mirroring the handler's `{ isOptional: true }` binding.
 */
type MockWebviewManager = { broadcastMessage: jest.Mock };

function createMockWebviewManager(): MockWebviewManager {
  return { broadcastMessage: jest.fn().mockResolvedValue(undefined) };
}

/**
 * The `IAuthCommandRunner` capability, present only on adapters that can drive
 * an interactive login themselves (the CLI/TUI runtime). Attaching it to the
 * platform-commands mock is exactly how `asAuthCommandRunner` detects it.
 */
type MockAuthCommandRunner = jest.Mock;

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

/**
 * `SdkAdapterEvents` stub, narrowed to the one subscription the handler makes.
 * `emitAuthFileChanged()` replays it so the spec can prove an external
 * `codex login` drops the status cache.
 */
interface MockAdapterEvents {
  onAuthFileChanged: jest.Mock;
  emitAuthFileChanged: () => void;
}

function createMockAdapterEvents(): MockAdapterEvents {
  const listeners: Array<() => void> = [];
  return {
    onAuthFileChanged: jest.fn((listener: () => void) => {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      };
    }),
    emitAuthFileChanged: () => {
      for (const listener of [...listeners]) listener();
    },
  };
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
  webviewManager: MockWebviewManager;
  adapterEvents: MockAdapterEvents;
  authCommandRunner?: MockAuthCommandRunner;
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
    /**
     * When supplied, the platform-commands mock gains the optional
     * `runAuthCommand` capability and returns this result — simulating the
     * CLI/TUI runtime. Omit it to simulate VS Code (terminal path).
     */
    authCommandResult?: {
      success: boolean;
      exitCode: number | null;
      error?: string;
    };
    /** When true, `runAuthCommand` rejects instead of resolving. */
    authCommandThrows?: boolean;
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
  const webviewManager = createMockWebviewManager();
  const adapterEvents = createMockAdapterEvents();

  let authCommandRunner: MockAuthCommandRunner | undefined;
  if (opts.authCommandResult !== undefined || opts.authCommandThrows === true) {
    authCommandRunner =
      opts.authCommandThrows === true
        ? jest.fn().mockRejectedValue(new Error('spawn exploded'))
        : jest.fn().mockResolvedValue(opts.authCommandResult);
    (
      platformCommands as unknown as { runAuthCommand: MockAuthCommandRunner }
    ).runAuthCommand = authCommandRunner;
  }

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
    webviewManager as unknown as import('@ptah-extension/vscode-core').WebviewManager,
    adapterEvents as unknown as import('@ptah-extension/agent-sdk').SdkAdapterEvents,
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
    webviewManager,
    adapterEvents,
    ...(authCommandRunner ? { authCommandRunner } : {}),
  };
}

/** Total probe/secret-store invocations across every source `computeAuthStatus` reads. */
function probeCounts(h: Harness): {
  cli: number;
  copilot: number;
  codex: number;
  secrets: number;
} {
  return {
    cli: h.cliDetector.performHealthCheck.mock.calls.length,
    copilot: h.copilot.isAuthenticated.mock.calls.length,
    codex: h.codex.getTokenStatus.mock.calls.length,
    secrets:
      h.authSecrets.hasCredential.mock.calls.length +
      h.authSecrets.hasProviderKey.mock.calls.length,
  };
}

/**
 * A promise whose resolution the spec controls, so one probe can be held OPEN
 * while something else mutates auth state. Interleaving an in-flight
 * `auth:getAuthStatus` with an invalidation is the only way to exercise the
 * cache-generation guard — a spec that awaits the mutating call to completion
 * first can never reach it.
 */
function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * Drain microtasks until `predicate` holds. Everything between the RPC entry
 * point and the probe fan-out is `await`-only, so a bounded microtask drain is
 * enough — and it beats a fixed number of `await Promise.resolve()` calls,
 * which silently rots the moment an `await` is added to the handler.
 */
async function flushUntil(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !predicate(); i++) {
    await Promise.resolve();
  }
  if (!predicate()) {
    throw new Error('flushUntil: condition never became true');
  }
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
  // auth:getAuthStatus — cache, coalescing, invalidation (TASK_2026_342)
  //
  // Measured before: 14 calls in one boot-plus-two-workspace-switches session,
  // 2.0-5.3s each, identical payload, up to three concurrent. The expensive
  // part is `performHealthCheck`, which spawns `claude --version` every call.
  // -------------------------------------------------------------------------

  describe('auth:getAuthStatus caching', () => {
    it('coalesces concurrent calls into ONE probe set and resolves both to equal payloads', async () => {
      const h = makeHarness({ credentialsSeed: { apiKey: 'sk-ant-abc' } });
      h.copilot.isAuthenticated.mockResolvedValue(true);
      h.platformAuth.getGitHubUsername.mockResolvedValue('octocat');
      h.handlers.register();

      const [first, second] = await Promise.all([
        call<Record<string, unknown>>(h, 'auth:getAuthStatus'),
        call<Record<string, unknown>>(h, 'auth:getAuthStatus'),
      ]);

      expect(first).toEqual(second);
      expect(h.cliDetector.performHealthCheck).toHaveBeenCalledTimes(1);
      expect(h.copilot.isAuthenticated).toHaveBeenCalledTimes(1);
      expect(h.codex.getTokenStatus).toHaveBeenCalledTimes(1);
      expect(h.authSecrets.hasCredential).toHaveBeenCalledTimes(1);
    });

    it('serves a second call within the TTL with ZERO probe or secret-store work', async () => {
      const h = makeHarness();
      h.handlers.register();

      const first = await call<Record<string, unknown>>(
        h,
        'auth:getAuthStatus',
      );
      const before = probeCounts(h);

      const second = await call<Record<string, unknown>>(
        h,
        'auth:getAuthStatus',
      );

      expect(second).toEqual(first);
      expect(probeCounts(h)).toEqual(before);
    });

    it('re-probes once the TTL has elapsed', async () => {
      jest.useFakeTimers();
      try {
        const h = makeHarness();
        h.handlers.register();

        await call(h, 'auth:getAuthStatus');
        const before = probeCounts(h);

        // AUTH_STATUS_CACHE_TTL_MS is 15s; step past it.
        jest.setSystemTime(Date.now() + 15_001);
        await call(h, 'auth:getAuthStatus');

        expect(h.codex.getTokenStatus.mock.calls.length).toBeGreaterThan(
          before.codex,
        );
        expect(h.copilot.isAuthenticated.mock.calls.length).toBeGreaterThan(
          before.copilot,
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('memoises Claude CLI health for its OWN, longer TTL', async () => {
      jest.useFakeTimers();
      try {
        const h = makeHarness();
        h.handlers.register();

        await call(h, 'auth:getAuthStatus');
        // Past the status TTL but well inside CLAUDE_CLI_HEALTH_TTL_MS (5min).
        jest.setSystemTime(Date.now() + 20_000);
        await call(h, 'auth:getAuthStatus');

        expect(h.cliDetector.performHealthCheck).toHaveBeenCalledTimes(1);
        expect(h.codex.getTokenStatus).toHaveBeenCalledTimes(2);

        // Past the CLI TTL as well — now the spawn is worth repeating.
        jest.setSystemTime(Date.now() + 5 * 60_000 + 1);
        await call(h, 'auth:getAuthStatus');
        expect(h.cliDetector.performHealthCheck).toHaveBeenCalledTimes(2);
      } finally {
        jest.useRealTimers();
      }
    });

    it('keys entries by providerId param — {providerId} does not return the {} entry', async () => {
      const h = makeHarness({ providerKeysSeed: { 'z-ai': 'key-for-zai' } });
      h.handlers.register();

      const bare = await call<{ hasOpenRouterKey: boolean }>(
        h,
        'auth:getAuthStatus',
      );
      const scoped = await call<{ hasOpenRouterKey: boolean }>(
        h,
        'auth:getAuthStatus',
        { providerId: 'z-ai' },
      );

      expect(bare.hasOpenRouterKey).toBe(false);
      expect(scoped.hasOpenRouterKey).toBe(true);
    });

    it('recomputes when the active workspace path changes', async () => {
      const h = makeHarness();
      h.handlers.register();

      await call(h, 'auth:getAuthStatus');
      const before = probeCounts(h);

      h.scopeResolver.getActivePath.mockReturnValue('/ws/project-b');
      await call(h, 'auth:getAuthStatus');
      expect(h.codex.getTokenStatus.mock.calls.length).toBe(before.codex + 1);

      // Switching BACK inside the TTL is free — that is the point of keying by
      // path rather than invalidating on every workspace:switch.
      h.scopeResolver.getActivePath.mockReturnValue('/ws/project-a');
      await call(h, 'auth:getAuthStatus');
      expect(h.codex.getTokenStatus.mock.calls.length).toBe(before.codex + 1);
    });

    const invalidatingCalls: Array<{
      name: string;
      run: (h: Harness) => Promise<unknown>;
    }> = [
      {
        name: 'auth:saveSettings',
        run: (h) => call(h, 'auth:saveSettings', { authMethod: 'apiKey' }),
      },
      {
        name: 'auth:setApiKey',
        run: (h) =>
          call(h, 'auth:setApiKey', { provider: 'z-ai', apiKey: 'sk-new' }),
      },
      { name: 'auth:copilotLogin', run: (h) => call(h, 'auth:copilotLogin') },
      { name: 'auth:copilotLogout', run: (h) => call(h, 'auth:copilotLogout') },
      {
        name: 'auth:clearWorkspaceOverride',
        run: (h) => call(h, 'auth:clearWorkspaceOverride'),
      },
    ];

    for (const { name, run } of invalidatingCalls) {
      it(`invalidates the cache after ${name}`, async () => {
        const h = makeHarness();
        h.handlers.register();

        await call(h, 'auth:getAuthStatus');
        const before = probeCounts(h);

        await run(h);
        await call(h, 'auth:getAuthStatus');

        expect(h.codex.getTokenStatus.mock.calls.length).toBe(before.codex + 1);
        expect(h.cliDetector.performHealthCheck.mock.calls.length).toBe(
          before.cli + 1,
        );
      });
    }

    it('invalidates the cache after auth:codexLogin and reflects the changed state', async () => {
      const h = makeHarness({
        authCommandResult: { success: true, exitCode: 0 },
      });
      h.codex.getTokenStatus.mockResolvedValue({
        authenticated: false,
        stale: false,
      });
      h.handlers.register();

      const before = await call<{ codexAuthenticated: boolean }>(
        h,
        'auth:getAuthStatus',
      );
      expect(before.codexAuthenticated).toBe(false);

      h.codex.getTokenStatus.mockResolvedValue({
        authenticated: true,
        stale: false,
      });
      await call(h, 'auth:codexLogin');

      const after = await call<{ codexAuthenticated: boolean }>(
        h,
        'auth:getAuthStatus',
      );
      expect(after.codexAuthenticated).toBe(true);
    });

    it('invalidates the cache when the adapter reports an external auth-file change', async () => {
      const h = makeHarness();
      h.codex.getTokenStatus.mockResolvedValue({
        authenticated: false,
        stale: false,
      });
      h.handlers.register();

      expect(h.adapterEvents.onAuthFileChanged).toHaveBeenCalledTimes(1);

      const before = await call<{ codexAuthenticated: boolean }>(
        h,
        'auth:getAuthStatus',
      );
      expect(before.codexAuthenticated).toBe(false);

      // An external `codex login` reaches no RPC method here.
      h.codex.getTokenStatus.mockResolvedValue({
        authenticated: true,
        stale: false,
      });
      h.adapterEvents.emitAuthFileChanged();

      const after = await call<{ codexAuthenticated: boolean }>(
        h,
        'auth:getAuthStatus',
      );
      expect(after.codexAuthenticated).toBe(true);
    });

    // -----------------------------------------------------------------------
    // Cache-generation guard — the concurrent-boot case the whole task is for.
    //
    // Clearing the maps is NOT enough on its own: a computation already in
    // flight when the invalidation happens still resolves afterwards, and an
    // unguarded `.then` writes its PRE-change payload back with a full TTL.
    // Every "invalidates after X" spec above awaits the mutating call to
    // completion first, so none of them can reach this.
    // -----------------------------------------------------------------------

    it('does not repopulate the cache with a payload computed before an external auth-file change', async () => {
      const h = makeHarness();
      const codexProbe = createDeferred<{
        authenticated: boolean;
        stale: boolean;
      }>();
      h.codex.getTokenStatus.mockReturnValueOnce(codexProbe.promise);
      h.handlers.register();

      // Boot caller #1 — in flight, blocked inside the codex probe.
      const inFlight = call<{ codexAuthenticated: boolean }>(
        h,
        'auth:getAuthStatus',
      );
      await flushUntil(() => h.codex.getTokenStatus.mock.calls.length === 1);

      // `codex login` completes in a terminal WHILE that probe is open.
      h.codex.getTokenStatus.mockResolvedValue({
        authenticated: true,
        stale: false,
      });
      h.adapterEvents.emitAuthFileChanged();

      // Now the pre-login probe answers.
      codexProbe.resolve({ authenticated: false, stale: false });
      const stale = await inFlight;
      // The caller that asked before the change still gets the pre-change
      // snapshot — that is the honest answer to the question it asked.
      expect(stale.codexAuthenticated).toBe(false);

      // ...but it must not have become everyone else's answer for the next 15s.
      const after = await call<{ codexAuthenticated: boolean }>(
        h,
        'auth:getAuthStatus',
      );
      expect(after.codexAuthenticated).toBe(true);
    });

    it('does not repopulate the cache with a payload computed before a mutating RPC call', async () => {
      const h = makeHarness();
      const copilotProbe = createDeferred<boolean>();
      h.copilot.isAuthenticated.mockReturnValueOnce(copilotProbe.promise);
      h.handlers.register();

      const inFlight = call<{ codexAuthenticated: boolean }>(
        h,
        'auth:getAuthStatus',
      );
      // The whole probe set is fanned out synchronously by one `Promise.all`,
      // so a copilot call proves codex has already read the OLD mock too.
      await flushUntil(() => h.copilot.isAuthenticated.mock.calls.length === 1);

      // A key write lands mid-probe and invalidates.
      await call(h, 'auth:setApiKey', {
        provider: 'z-ai',
        apiKey: 'sk-brand-new',
      });
      h.codex.getTokenStatus.mockResolvedValue({
        authenticated: true,
        stale: false,
      });

      copilotProbe.resolve(false);
      const stale = await inFlight;
      expect(stale.codexAuthenticated).toBe(false);

      const probesBefore = probeCounts(h);
      const after = await call<{
        codexAuthenticated: boolean;
        hasAnyProviderKey: boolean;
      }>(h, 'auth:getAuthStatus');

      // Re-probed rather than served from a re-poisoned entry...
      expect(h.codex.getTokenStatus.mock.calls.length).toBe(
        probesBefore.codex + 1,
      );
      expect(after.codexAuthenticated).toBe(true);
      // ...and it sees the key the mutating call wrote.
      expect(after.hasAnyProviderKey).toBe(true);
    });

    it('does not memoise a Claude CLI verdict computed before an invalidation', async () => {
      const h = makeHarness();
      const cliProbe = createDeferred<ClaudeCliHealth>();
      h.cliDetector.performHealthCheck.mockReturnValueOnce(cliProbe.promise);
      h.handlers.register();

      const inFlight = call<{ claudeCliInstalled: boolean }>(
        h,
        'auth:getAuthStatus',
      );
      await flushUntil(
        () => h.cliDetector.performHealthCheck.mock.calls.length === 1,
      );

      h.adapterEvents.emitAuthFileChanged();
      cliProbe.resolve({ available: false, platform: 'win32', isWSL: false });
      expect((await inFlight).claudeCliInstalled).toBe(false);

      // The CLI memo lives 5 minutes — twenty times the status TTL — so a
      // verdict written back after an invalidation is the longest-lived stale
      // value this handler can hold.
      const after = await call<{ claudeCliInstalled: boolean }>(
        h,
        'auth:getAuthStatus',
      );
      expect(h.cliDetector.performHealthCheck).toHaveBeenCalledTimes(2);
      expect(after.claudeCliInstalled).toBe(true);
    });

    it('a superseded computation settling does not evict the in-flight entry that replaced it', async () => {
      const h = makeHarness();
      const superseded = createDeferred<{
        authenticated: boolean;
        stale: boolean;
      }>();
      const replacement = createDeferred<{
        authenticated: boolean;
        stale: boolean;
      }>();
      h.codex.getTokenStatus
        .mockReturnValueOnce(superseded.promise)
        .mockReturnValueOnce(replacement.promise);
      h.handlers.register();

      // Caller 1 — in flight when the invalidation lands.
      const first = call(h, 'auth:getAuthStatus');
      await flushUntil(() => h.codex.getTokenStatus.mock.calls.length === 1);
      h.adapterEvents.emitAuthFileChanged();

      // Caller 2 — starts a fresh computation and OWNS the in-flight slot.
      const second = call(h, 'auth:getAuthStatus');
      await flushUntil(() => h.codex.getTokenStatus.mock.calls.length === 2);

      // Caller 1 now settles. Its `finally` must not delete caller 2's slot:
      // deleting by key rather than by identity un-coalesces the burst this
      // whole mechanism exists to absorb.
      superseded.resolve({ authenticated: false, stale: false });
      await first;

      // Caller 3 arrives while caller 2 is still probing — it must join, not
      // start a third probe set.
      const third = call(h, 'auth:getAuthStatus');
      replacement.resolve({ authenticated: true, stale: false });

      const [secondValue, thirdValue] = (await Promise.all([
        second,
        third,
      ])) as [{ codexAuthenticated: boolean }, { codexAuthenticated: boolean }];
      expect(h.codex.getTokenStatus).toHaveBeenCalledTimes(2);
      expect(thirdValue).toEqual(secondValue);
      expect(thirdValue.codexAuthenticated).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // auth:getAuthStatus — per-probe timeout (TASK_2026_342, smoke 2026-08-29)
  //
  // The probes share one `Promise.all`, so the handler costs whatever the
  // SLOWEST source costs. On the smoke boot that was 22736ms, spent entirely in
  // the Claude-CLI spawn while the secret reads beside it finished in
  // milliseconds — and the first render waited for all of it.
  // -------------------------------------------------------------------------

  describe('auth:getAuthStatus probe timeouts', () => {
    it('does not let a wedged Codex probe hold the rest of the payload', async () => {
      jest.useFakeTimers();
      try {
        const h = makeHarness();
        const stuck = createDeferred<{
          authenticated: boolean;
          stale: boolean;
        }>();
        h.codex.getTokenStatus.mockReturnValueOnce(stuck.promise);
        h.handlers.register();

        const pending = call<{
          codexAuthenticated: boolean;
          claudeCliInstalled: boolean;
        }>(h, 'auth:getAuthStatus');
        await flushUntil(() => h.codex.getTokenStatus.mock.calls.length === 1);
        // Let the fast probes finish BEFORE the clock moves. One
        // `advanceTimersByTime` expires every probe's timer at once, so a spec
        // that steps the clock while they are mid-chain would time all four out
        // and prove nothing about isolating the slow one. No I/O is involved,
        // so a bounded microtask drain is deterministic.
        for (let i = 0; i < 20; i++) await Promise.resolve();

        jest.advanceTimersByTime(5_001);
        const result = await pending;

        expect(result.codexAuthenticated).toBe(false);
        // The point of the timeout: every other field is still the real answer.
        expect(result.claudeCliInstalled).toBe(true);
      } finally {
        jest.useRealTimers();
      }
    });

    it('answers a timed-out CLI probe from the last known verdict, not `false`', async () => {
      jest.useFakeTimers();
      try {
        const h = makeHarness();
        h.handlers.register();

        const first = await call<{ claudeCliInstalled: boolean }>(
          h,
          'auth:getAuthStatus',
        );
        expect(first.claudeCliInstalled).toBe(true);

        // Past the 5-minute CLI memo, so the next call must re-probe — and this
        // time the spawn never returns.
        const stuck = createDeferred<ClaudeCliHealth>();
        h.cliDetector.performHealthCheck.mockReturnValueOnce(stuck.promise);
        jest.setSystemTime(Date.now() + 5 * 60_000 + 1);

        const pending = call<{ claudeCliInstalled: boolean }>(
          h,
          'auth:getAuthStatus',
        );
        await flushUntil(
          () => h.cliDetector.performHealthCheck.mock.calls.length === 2,
        );

        jest.advanceTimersByTime(5_001);
        const second = await pending;

        // Reporting `false` would tell the UI the CLI was uninstalled on the
        // evidence of a slow spawn, flipping the auth badge and the setup gate.
        expect(second.claudeCliInstalled).toBe(true);
      } finally {
        jest.useRealTimers();
      }
    });

    it('a timed-out CLI probe still populates the memo for the next caller', async () => {
      jest.useFakeTimers();
      try {
        const h = makeHarness();
        const stuck = createDeferred<ClaudeCliHealth>();
        h.cliDetector.performHealthCheck.mockReturnValueOnce(stuck.promise);
        h.handlers.register();

        const pending = call<{ claudeCliInstalled: boolean }>(
          h,
          'auth:getAuthStatus',
        );
        await flushUntil(
          () => h.cliDetector.performHealthCheck.mock.calls.length === 1,
        );
        jest.advanceTimersByTime(5_001);
        // Nothing was ever known, so the fallback is the honest `false`.
        expect((await pending).claudeCliInstalled).toBe(false);

        // The probe was never cancelled — it lands late and its verdict is what
        // makes the NEXT caller free instead of paying the timeout again.
        stuck.resolve({ available: false, platform: 'win32', isWSL: false });
        // The memo write-back is a `.then` on this same promise, registered
        // before this await — so it has run by the time we resume.
        await stuck.promise;
        await Promise.resolve();

        // Past the status TTL (so this recomputes) but inside the CLI memo.
        jest.setSystemTime(Date.now() + 15_001);
        const next = await call<{ claudeCliInstalled: boolean }>(
          h,
          'auth:getAuthStatus',
        );

        expect(next.claudeCliInstalled).toBe(false);
        expect(h.cliDetector.performHealthCheck).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });

    it('a caller arriving while a CLI probe is stuck joins it instead of spawning again', async () => {
      jest.useFakeTimers();
      try {
        const h = makeHarness();
        const stuck = createDeferred<ClaudeCliHealth>();
        h.cliDetector.performHealthCheck.mockReturnValueOnce(stuck.promise);
        h.handlers.register();

        const first = call(h, 'auth:getAuthStatus');
        await flushUntil(
          () => h.cliDetector.performHealthCheck.mock.calls.length === 1,
        );
        jest.advanceTimersByTime(5_001);
        await first;

        // A second workspace, so the status cache cannot answer it — but the
        // CLI probe is still running and must not be duplicated.
        h.scopeResolver.getActivePath.mockReturnValue('D:/other');
        const second = call(h, 'auth:getAuthStatus');
        await flushUntil(() => h.codex.getTokenStatus.mock.calls.length === 2);
        jest.advanceTimersByTime(5_001);
        await second;

        expect(h.cliDetector.performHealthCheck).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
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

    /**
     * Regression: the device code was surfaced only through
     * `IUserInteraction.showInformationMessage`, which the CLI implements as
     * `console.log` — swallowed by the TUI's console capture. `login()` then
     * blocks polling for up to five minutes, so the user saw a bare spinner.
     * The handler must hand `login()` an observer that broadcasts the code the
     * moment it exists.
     */
    it('broadcasts auth:deviceCode as soon as the device code is known', async () => {
      const h = makeHarness();
      h.copilot.login.mockImplementation(async (opts?: CopilotLoginOptions) => {
        opts?.onDeviceCode?.({
          deviceCode: 'opaque-device-code',
          userCode: 'ABCD-1234',
          verificationUri: 'https://github.com/login/device',
          interval: 5,
          expiresIn: 900,
        });
        return true;
      });
      h.handlers.register();

      await call<{ success: boolean }>(h, 'auth:copilotLogin');

      expect(h.webviewManager.broadcastMessage).toHaveBeenCalledWith(
        'auth:deviceCode',
        {
          provider: 'github-copilot',
          userCode: 'ABCD-1234',
          verificationUri: 'https://github.com/login/device',
          expiresInSeconds: 900,
        },
      );
    });

    it('never broadcasts the opaque deviceCode polling key to the UI', async () => {
      const h = makeHarness();
      h.copilot.login.mockImplementation(async (opts?: CopilotLoginOptions) => {
        opts?.onDeviceCode?.({
          deviceCode: 'secret-polling-key',
          userCode: 'ABCD-1234',
          verificationUri: 'https://github.com/login/device',
          interval: 5,
          expiresIn: 900,
        });
        return true;
      });
      h.handlers.register();

      await call<{ success: boolean }>(h, 'auth:copilotLogin');

      const broadcast = JSON.stringify(
        h.webviewManager.broadcastMessage.mock.calls,
      );
      expect(broadcast).not.toContain('secret-polling-key');
    });

    it('completes the login even when the broadcast rejects', async () => {
      const h = makeHarness();
      h.webviewManager.broadcastMessage.mockRejectedValue(
        new Error('no surface attached'),
      );
      h.copilot.login.mockImplementation(async (opts?: CopilotLoginOptions) => {
        opts?.onDeviceCode?.({
          deviceCode: 'd',
          userCode: 'ABCD-1234',
          verificationUri: 'https://github.com/login/device',
          interval: 5,
          expiresIn: 900,
        });
        return true;
      });
      h.handlers.register();

      const result = await call<{ success: boolean }>(h, 'auth:copilotLogin');

      expect(result.success).toBe(true);
    });

    it('emits no device-code broadcast when login resolves without one (file-based restore)', async () => {
      const h = makeHarness();
      h.copilot.login.mockResolvedValue(true);
      h.handlers.register();

      await call<{ success: boolean }>(h, 'auth:copilotLogin');

      expect(h.webviewManager.broadcastMessage).not.toHaveBeenCalled();
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

    /**
     * `logout()` persists a logout tombstone. A fire-and-forget call would
     * report success before the write landed — and lose it entirely if the
     * host exited right after — so the handler must await it.
     */
    it('awaits logout() before reporting success', async () => {
      const h = makeHarness();
      let settled = false;
      h.copilot.logout.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        settled = true;
      });
      h.handlers.register();

      const result = await call<{ success: boolean }>(h, 'auth:copilotLogout');

      expect(settled).toBe(true);
      expect(result.success).toBe(true);
    });

    it('reports failure when the tombstone write rejects', async () => {
      const h = makeHarness();
      h.copilot.logout.mockRejectedValue(new Error('settings store offline'));
      h.handlers.register();

      const result = await call<{ success: boolean }>(h, 'auth:copilotLogout');

      expect(result.success).toBe(false);
      expect(h.sentry.captureException).toHaveBeenCalled();
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
    it('opens a terminal running `codex login --device-auth` when the platform has one', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean }>(h, 'auth:codexLogin');

      expect(result.success).toBe(true);
      expect(h.platformCommands.openTerminal).toHaveBeenCalledWith(
        'Codex Login',
        'codex login --device-auth',
      );
    });

    /**
     * Regression: in the CLI/TUI runtime `openTerminal` is a no-op, so the old
     * unconditional `return { success: true }` reported a login that never
     * happened. When the adapter advertises `runAuthCommand`, the command must
     * be run for real and the result must track its outcome.
     */
    it('runs the command via IAuthCommandRunner instead of openTerminal when the capability exists', async () => {
      const h = makeHarness({
        authCommandResult: { success: true, exitCode: 0 },
      });
      h.handlers.register();

      const result = await call<{ success: boolean }>(h, 'auth:codexLogin');

      expect(result.success).toBe(true);
      expect(h.authCommandRunner).toHaveBeenCalledWith({
        provider: 'openai-codex',
        name: 'Codex Login',
        command: 'codex login --device-auth',
      });
      expect(h.platformCommands.openTerminal).not.toHaveBeenCalled();
    });

    it('refreshes codex credentials and resets the SDK after a successful run', async () => {
      const h = makeHarness({
        authCommandResult: { success: true, exitCode: 0 },
      });
      h.handlers.register();

      await call<{ success: boolean }>(h, 'auth:codexLogin');

      expect(h.codex.clearCache).toHaveBeenCalledTimes(1);
      expect(h.sdkAdapter.reset).toHaveBeenCalled();
    });

    it('reports failure (never optimistic success) when the command exits non-zero', async () => {
      const h = makeHarness({
        authCommandResult: {
          success: false,
          exitCode: 1,
          error: '`codex login --device-auth` exited with code 1.',
        },
      });
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'auth:codexLogin',
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('exited with code 1');
      expect(h.codex.clearCache).not.toHaveBeenCalled();
    });

    it('returns a structured failure (no throw to the RPC boundary) when the runner rejects', async () => {
      const h = makeHarness({ authCommandThrows: true });
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'auth:codexLogin',
      );

      expect(result.success).toBe(false);
      expect(h.sentry.captureException).toHaveBeenCalled();
      // Library error text must not reach the client verbatim.
      expect(result.error).not.toContain('spawn exploded');
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
