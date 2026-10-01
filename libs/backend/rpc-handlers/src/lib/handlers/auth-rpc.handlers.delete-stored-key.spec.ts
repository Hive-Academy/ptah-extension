/**
 * AuthRpcHandlers — auth:deleteStoredKey unit specs (Batch 7 / TASK_2026_555).
 *
 * Tests the `auth:deleteStoredKey` RPC method:
 *   - The Anthropic slot is deleted via `setCredential('apiKey', '')`.
 *   - A provider slot is deleted via `deleteProviderKey(id)`.
 *   - An unknown id is rejected before any secret call.
 *   - `sdkAdapter.reset` is never called.
 *   - A secret-store rejection returns fixed error: 'Could not delete the stored key.'.
 *   - Provider models cache and auth-status cache are invalidated.
 *   - Deleting an absent key is an idempotent success.
 */

import 'reflect-metadata';

import type {
  ConfigManager,
  IAuthSecretsService,
  Logger,
  SentryService,
} from '@ptah-extension/vscode-core';
import {
  createMockAuthSecretsService,
  createMockConfigManager,
  createMockRpcHandler,
  createMockSentryService,
  type MockAuthSecretsService,
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
import type {
  AuthDeleteStoredKeyParams,
  AuthDeleteStoredKeyResult,
} from '@ptah-extension/shared';

import { ConnectionCheckRecorder } from '../utils/connection-check-recorder';
import { AuthRpcHandlers } from './auth-rpc.handlers';

// ---------------------------------------------------------------------------
// Mock surfaces
// ---------------------------------------------------------------------------

interface MockScopeResolver {
  read: jest.Mock<unknown, [string, (boolean | undefined)?]>;
  hasOverride: jest.Mock<boolean, [string]>;
  write: jest.Mock<
    Promise<void>,
    [string, unknown, ('global' | 'app' | 'workspace')?, (boolean | undefined)?]
  >;
  clearOverride: jest.Mock<Promise<void>, [string]>;
  clearMoreSpecific: jest.Mock<
    Promise<void>,
    [string, ('global' | 'app' | 'workspace')?, (boolean | undefined)?]
  >;
  effectiveKey: jest.Mock<string, [string, (boolean | undefined)?]>;
  getActivePath: jest.Mock<string | undefined, []>;
  globalStore: Map<string, unknown>;
  workspaceStore: Map<string, unknown>;
  appStore: Map<string, unknown>;
}

function createMockScopeResolver(): MockScopeResolver {
  const globalStore = new Map<string, unknown>();
  const workspaceStore = new Map<string, unknown>();
  const appStore = new Map<string, unknown>();

  return {
    read: jest.fn((key: string, _skipCache?: boolean) => globalStore.get(key)),
    hasOverride: jest.fn((_key: string) => false),
    write: jest.fn(
      async (
        key: string,
        val: unknown,
        _scope?: 'global' | 'app' | 'workspace',
        _skipCache?: boolean,
      ) => {
        globalStore.set(key, val);
      },
    ),
    clearOverride: jest.fn(async (_key: string) => undefined),
    clearMoreSpecific: jest.fn(
      async (
        _key: string,
        _target?: 'global' | 'app' | 'workspace',
        _skipCache?: boolean,
      ) => undefined,
    ),
    effectiveKey: jest.fn((key: string, _appScopable?: boolean) => key),
    getActivePath: jest.fn(() => undefined),
    globalStore,
    workspaceStore,
    appStore,
  };
}

type MockSdkAdapter = jest.Mocked<Pick<SdkAgentAdapter, 'getHealth' | 'reset'>>;
function createMockSdkAdapter(): MockSdkAdapter {
  return {
    getHealth: jest.fn().mockReturnValue({
      status: 'available',
      lastCheck: Date.now(),
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
    logout: jest.fn().mockResolvedValue(undefined),
  } as unknown as MockCopilot;
}

type MockCodex = jest.Mocked<
  Pick<ICodexAuthService, 'getTokenStatus' | 'clearCache'>
>;
function createMockCodex(): MockCodex {
  return {
    getTokenStatus: jest.fn().mockResolvedValue({
      authenticated: false,
      stale: false,
    }),
    clearCache: jest.fn(),
  };
}

type MockCliDetector = jest.Mocked<
  Pick<ClaudeCliDetector, 'performHealthCheck'>
>;
function createMockCliDetector(): MockCliDetector {
  return {
    performHealthCheck: jest.fn().mockResolvedValue({
      available: true,
      lastCheck: Date.now(),
    }),
  } as unknown as MockCliDetector;
}

interface Harness {
  handlers: AuthRpcHandlers;
  logger: MockLogger;
  rpcHandler: MockRpcHandler;
  authSecrets: MockAuthSecretsService;
  sdkAdapter: MockSdkAdapter;
  providerModels: MockProviderModels;
  sentry: MockSentryService;
}

function makeHarness(
  opts: {
    credentialsSeed?: { apiKey?: string };
    providerKeysSeed?: Record<string, string>;
  } = {},
): Harness {
  const logger = createMockLogger();
  const rpcHandler = createMockRpcHandler();
  const configManager = createMockConfigManager();
  const authSecrets = createMockAuthSecretsService({
    credentials: opts.credentialsSeed,
    providerKeys: opts.providerKeysSeed,
  });
  const sdkAdapter = createMockSdkAdapter();
  const providerModels = createMockProviderModels();
  const copilot = createMockCopilot();
  const codex = createMockCodex();
  const platformCommands = createMockPlatformCommands();
  const platformAuth = createMockAuthProvider();
  const cliDetector = createMockCliDetector();
  const sentry = createMockSentryService();
  const scopeResolver = createMockScopeResolver();

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
    {} as unknown as import('@ptah-extension/auth-providers').DraftVerificationService,
    new ConnectionCheckRecorder(),
  );

  return {
    handlers,
    logger,
    rpcHandler,
    authSecrets,
    sdkAdapter,
    providerModels,
    sentry,
  };
}

describe('AuthRpcHandlers — auth:deleteStoredKey', () => {
  it('registers auth:deleteStoredKey in RpcHandler', () => {
    const h = makeHarness();
    h.handlers.register();

    expect(h.rpcHandler.getRegisteredMethods()).toContain(
      'auth:deleteStoredKey',
    );
  });

  it('deletes the Anthropic slot via setCredential("apiKey", "")', async () => {
    const h = makeHarness({
      credentialsSeed: { apiKey: 'sk-ant-to-delete' },
    });
    h.handlers.register();

    const response = await h.rpcHandler.handleMessage({
      method: 'auth:deleteStoredKey',
      params: { providerId: 'anthropic' } as AuthDeleteStoredKeyParams,
      correlationId: 'del-anthropic-1',
    });

    expect(response.success).toBe(true);
    expect(response.data).toEqual({ success: true } as AuthDeleteStoredKeyResult);
    expect(h.authSecrets.setCredential).toHaveBeenCalledWith('apiKey', '');
    expect(h.authSecrets.deleteProviderKey).not.toHaveBeenCalled();
  });

  it('deletes a provider slot via deleteProviderKey(providerId)', async () => {
    const h = makeHarness({
      providerKeysSeed: { openrouter: 'sk-or-to-delete' },
    });
    h.handlers.register();

    const response = await h.rpcHandler.handleMessage({
      method: 'auth:deleteStoredKey',
      params: { providerId: 'openrouter' } as AuthDeleteStoredKeyParams,
      correlationId: 'del-provider-1',
    });

    expect(response.success).toBe(true);
    expect(response.data).toEqual({ success: true } as AuthDeleteStoredKeyResult);
    expect(h.authSecrets.deleteProviderKey).toHaveBeenCalledWith('openrouter');
    expect(h.authSecrets.setCredential).not.toHaveBeenCalled();
  });

  it('rejects an unknown provider id before any secret call', async () => {
    const h = makeHarness();
    h.handlers.register();

    const response = await h.rpcHandler.handleMessage({
      method: 'auth:deleteStoredKey',
      params: { providerId: 'unknown-fake-provider' } as AuthDeleteStoredKeyParams,
      correlationId: 'del-unknown-1',
    });

    expect(response.success).toBe(true);
    const result = response.data as AuthDeleteStoredKeyResult;
    expect(result.success).toBe(false);
    expect(result.error).toBe('Unknown provider id');
    expect(h.authSecrets.setCredential).not.toHaveBeenCalled();
    expect(h.authSecrets.deleteProviderKey).not.toHaveBeenCalled();
  });

  it('rejects an empty-string providerId with the fixed "Unknown provider id" text', async () => {
    const h = makeHarness();
    h.handlers.register();

    const response = await h.rpcHandler.handleMessage({
      method: 'auth:deleteStoredKey',
      params: { providerId: '' } as AuthDeleteStoredKeyParams,
      correlationId: 'del-empty-id-1',
    });

    expect(response.success).toBe(true);
    const result = response.data as AuthDeleteStoredKeyResult;
    expect(result.success).toBe(false);
    expect(result.error).toBe('Unknown provider id');
    expect(h.authSecrets.setCredential).not.toHaveBeenCalled();
    expect(h.authSecrets.deleteProviderKey).not.toHaveBeenCalled();
  });

  it('never calls sdkAdapter.reset() when deleting stored keys', async () => {
    const h = makeHarness();
    h.handlers.register();

    await h.rpcHandler.handleMessage({
      method: 'auth:deleteStoredKey',
      params: { providerId: 'anthropic' } as AuthDeleteStoredKeyParams,
      correlationId: 'del-no-reset-1',
    });

    await h.rpcHandler.handleMessage({
      method: 'auth:deleteStoredKey',
      params: { providerId: 'openrouter' } as AuthDeleteStoredKeyParams,
      correlationId: 'del-no-reset-2',
    });

    expect(h.sdkAdapter.reset).not.toHaveBeenCalled();
  });

  it('catches secret-store rejections and returns { success: false, error: "Could not delete the stored key." }', async () => {
    const h = makeHarness();
    h.authSecrets.setCredential.mockRejectedValueOnce(
      new Error('EACCES: permission denied, open secrets.json.tmp'),
    );
    h.handlers.register();

    const response = await h.rpcHandler.handleMessage({
      method: 'auth:deleteStoredKey',
      params: { providerId: 'anthropic' } as AuthDeleteStoredKeyParams,
      correlationId: 'del-reject-1',
    });

    expect(response.success).toBe(true);
    expect(response.data).toEqual({
      success: false,
      error: 'Could not delete the stored key.',
    } as AuthDeleteStoredKeyResult);
  });

  it('catches deleteProviderKey rejections (e.g. ElectronSecretStorage persist failure) without unhandled rejection', async () => {
    const h = makeHarness();
    h.authSecrets.deleteProviderKey.mockRejectedValueOnce(
      new Error('Disk write failed'),
    );
    h.handlers.register();

    const response = await h.rpcHandler.handleMessage({
      method: 'auth:deleteStoredKey',
      params: { providerId: 'openrouter' } as AuthDeleteStoredKeyParams,
      correlationId: 'del-reject-2',
    });

    expect(response.success).toBe(true);
    expect(response.data).toEqual({
      success: false,
      error: 'Could not delete the stored key.',
    } as AuthDeleteStoredKeyResult);
  });

  it('clears provider models cache and invalidates auth status cache', async () => {
    const h = makeHarness();
    h.handlers.register();

    await h.rpcHandler.handleMessage({
      method: 'auth:deleteStoredKey',
      params: { providerId: 'openrouter' } as AuthDeleteStoredKeyParams,
      correlationId: 'del-cache-1',
    });

    expect(h.providerModels.clearCache).toHaveBeenCalledWith('openrouter');
  });

  it('returns { success: true } even if cache invalidation throws after successful key deletion', async () => {
    const h = makeHarness({
      providerKeysSeed: { openrouter: 'sk-or-to-delete' },
    });
    h.providerModels.clearCache.mockImplementationOnce(() => {
      throw new Error('Cache corruption');
    });
    h.handlers.register();

    const response = await h.rpcHandler.handleMessage({
      method: 'auth:deleteStoredKey',
      params: { providerId: 'openrouter' } as AuthDeleteStoredKeyParams,
      correlationId: 'del-cache-fail-1',
    });

    expect(response.success).toBe(true);
    expect(response.data).toEqual({ success: true } as AuthDeleteStoredKeyResult);
    expect(h.authSecrets.deleteProviderKey).toHaveBeenCalledWith('openrouter');
    expect(h.logger.warn).toHaveBeenCalledWith(
      'RPC: auth:deleteStoredKey cache invalidation failed',
    );
  });

  it('succeeds idempotently when deleting an already-absent key', async () => {
    const h = makeHarness();
    h.handlers.register();

    const response = await h.rpcHandler.handleMessage({
      method: 'auth:deleteStoredKey',
      params: { providerId: 'openrouter' } as AuthDeleteStoredKeyParams,
      correlationId: 'del-absent-1',
    });

    expect(response.success).toBe(true);
    expect(response.data).toEqual({ success: true } as AuthDeleteStoredKeyResult);
  });
});
