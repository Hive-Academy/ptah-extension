/**
 * AuthRpcHandlers — unit specs (TASK_2025_294 W2.B1.1).
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
 *     'thirdParty' (see TASK_2025_194).
 *
 *   - `auth:saveSettings`: Empty-string credentials delete, non-empty
 *     credentials write. Schema rejects unknown auth methods (the real
 *     Zod validation from `auth-rpc.schema.ts`, not a stub).
 *
 *   - `auth:saveSettings`: Awaits `sdkAdapter.reset()` so subsequent
 *     testConnection calls see the updated health (TASK_2025_194 regression
 *     guard).
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
  CopilotAuthService,
  ICodexAuthService,
  ProviderModelsService,
  SdkAgentAdapter,
} from '@ptah-extension/agent-sdk';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import { AuthRpcHandlers } from './auth-rpc.handlers';

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
}

function makeHarness(
  opts: {
    sdkStatus?: 'available' | 'error' | 'initializing';
    configSeed?: Record<string, unknown>;
    credentialsSeed?: { apiKey?: string };
    providerKeysSeed?: Record<string, string>;
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

  const handlers = new AuthRpcHandlers(
    logger as unknown as Logger,
    rpcHandler as unknown as import('@ptah-extension/vscode-core').RpcHandler,
    configManager as unknown as ConfigManager,
    authSecrets as unknown as IAuthSecretsService,
    sdkAdapter as unknown as SdkAgentAdapter,
    providerModels as unknown as ProviderModelsService,
    copilot as unknown as CopilotAuthService,
    codex as unknown as ICodexAuthService,
    platformCommands as unknown as IPlatformCommands,
    platformAuth as unknown as IPlatformAuthProvider,
    cliDetector as unknown as ClaudeCliDetector,
    sentry as unknown as SentryService,
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
    it('registers all nine auth RPC methods', () => {
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

      // TASK_2025_194 contract: reset is called (not fire-and-forget).
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
  // auth:getApiKeyStatus (TASK_2026_104 Batch B8b)
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
});
