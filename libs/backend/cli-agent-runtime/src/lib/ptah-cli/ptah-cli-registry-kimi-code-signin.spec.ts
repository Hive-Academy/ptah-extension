/**
 * PtahCliRegistry — Kimi Code sign-in for key-less Ptah CLI instances.
 *
 * A kimi-code instance WITH its own key keeps the direct base URL. One
 * WITHOUT a key runs through a fresh per-agent KimiCodeTranslationProxy bound
 * to the host's SINGLETON Kimi Code auth service while the CLI sign-in is
 * usable, and otherwise reports `unconfigured` / fails to spawn with fixed,
 * sanitized sign-in copy.
 *
 * Source-under-test:
 *   libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts
 */

import 'reflect-metadata';

import { createMockLogger } from '@ptah-extension/shared/testing';
import type { IAuthSecretsService, Logger } from '@ptah-extension/vscode-core';
import type {
  SdkModuleLoader,
  SdkMessageTransformer,
  SdkPermissionHandler,
  Options,
} from '@ptah-extension/agent-sdk';
import type {
  IKimiCodeAuthService,
  KimiCodeAuthStatus,
  ProviderModelsService,
} from '@ptah-extension/auth-providers';
import {
  KIMI_CODE_PROVIDER_ENTRY,
  type AuthEnv,
  type PtahCliConfig,
} from '@ptah-extension/shared';

const KIMI_PROXY_URL = 'http://127.0.0.1:9931';

const proxyStart = jest.fn(async () => ({ port: 9931, url: KIMI_PROXY_URL }));
const proxyStop = jest.fn(async () => undefined);
let proxyRunning = false;
const kimiProxyCtor = jest.fn();

class MockKimiCodeTranslationProxy {
  constructor(...args: unknown[]) {
    proxyRunning = false;
    kimiProxyCtor(...args);
  }
  start = jest.fn(async () => {
    proxyRunning = true;
    return proxyStart();
  });
  stop = jest.fn(async () => {
    proxyRunning = false;
    return proxyStop();
  });
  isRunning = jest.fn(() => proxyRunning);
  getUrl = jest.fn(() => (proxyRunning ? KIMI_PROXY_URL : undefined));
}

jest.mock('@ptah-extension/auth-providers', () => {
  const actual = jest.requireActual('@ptah-extension/auth-providers');
  return {
    ...actual,
    KimiCodeTranslationProxy: MockKimiCodeTranslationProxy,
  };
});

jest.mock('@ptah-extension/agent-sdk', () => {
  const actual = jest.requireActual('@ptah-extension/agent-sdk');
  const { KIMI_CODE_PROVIDER_ENTRY: entry } = jest.requireActual(
    '@ptah-extension/shared',
  );
  return {
    ...actual,
    getAnthropicProvider: jest.fn(() => entry),
    seedStaticModelPricing: jest.fn(),
    buildSafeEnv: jest.fn((env: unknown) => env),
  };
});

// Imported AFTER the mocks so the registry binds to the mocked modules.
import { PtahCliRegistry, type SpawnAgentFailure } from './ptah-cli-registry';
import { createFakeSdkProcessSpawner } from './testing/fake-sdk-process-spawner';

const SIGN_IN_MESSAGE =
  'Sign in to Kimi Code or add an API key for this instance';

const KIMI_CONFIG: PtahCliConfig = {
  id: 'pc-kimi-001',
  name: 'Kimi Agent',
  providerId: 'kimi-code',
  enabled: true,
  tierMappings: undefined,
  updatedAt: 0,
};

function status(overrides: Partial<KimiCodeAuthStatus>): KimiCodeAuthStatus {
  return {
    cliDetected: true,
    loggedIn: true,
    stale: false,
    hasApiKey: false,
    credentialSource: 'cli-login',
    ...overrides,
  };
}

function createFakeKimiAuth(
  current: KimiCodeAuthStatus | Error,
): jest.Mocked<IKimiCodeAuthService> {
  return {
    getStatus: jest.fn(async () => {
      if (current instanceof Error) throw current;
      return current;
    }),
    resolveRequestCredential: jest.fn(),
    ensureFresh: jest.fn(async () => true),
    forceRefresh: jest.fn(async () => true),
    isAuthenticated: jest.fn(async () => true),
    clearCache: jest.fn(),
    startWatching: jest.fn(),
    stopWatching: jest.fn(),
  };
}

async function* emptyStream(): AsyncGenerator<never, void, unknown> {
  // No messages — the stream loop resolves with exit code 0.
}

interface Harness {
  registry: PtahCliRegistry;
  logger: ReturnType<typeof createMockLogger>;
  configManager: { get: jest.Mock };
  setProviderKey: jest.Mock;
  setStoredKey: (key: string | undefined) => void;
  getCapturedEnv: () => AuthEnv | undefined;
}

function buildHarness(
  initialKey: string | undefined,
  kimiAuth: IKimiCodeAuthService | null,
): Harness {
  let storedKey = initialKey;
  const setProviderKey = jest.fn(async () => undefined);
  const logger = createMockLogger();
  let capturedEnv: AuthEnv | undefined;
  const queryFn = jest.fn((args: { options?: Options }) => {
    capturedEnv = args.options?.env as AuthEnv | undefined;
    return emptyStream();
  });

  const moduleLoader = {
    getQueryFunction: jest.fn().mockResolvedValue(queryFn),
    getCliJsPath: jest.fn().mockResolvedValue(undefined),
  } as unknown as SdkModuleLoader;
  const messageTransformer = {
    createIsolated: jest.fn().mockReturnValue({
      transform: jest.fn().mockReturnValue([]),
    }),
  } as unknown as SdkMessageTransformer;
  const permissionHandler = {
    getPermissionLevel: jest.fn().mockReturnValue('yolo'),
    createCallback: jest.fn(),
  } as unknown as SdkPermissionHandler;
  const authSecrets = {
    getProviderKey: jest.fn(async () => storedKey),
    hasProviderKey: jest.fn(async () => storedKey !== undefined),
    setProviderKey,
  } as unknown as IAuthSecretsService;
  const providerModels = {
    getModelTiers: jest
      .fn()
      .mockReturnValue({ sonnet: null, opus: null, haiku: null }),
  } as unknown as ProviderModelsService;
  const configPersistence = {
    ensureMigrated: jest.fn().mockResolvedValue(undefined),
    loadConfigs: jest.fn(() => [{ ...KIMI_CONFIG }]),
    saveConfigs: jest.fn(async () => undefined),
  } as unknown as never;
  const spawnOptionsService = {
    assembleSpawnOptions: jest.fn().mockResolvedValue({
      builtinPolicy: { disallowedTools: [], deniedSkillNames: [] },
      mcpServers: {},
      hooks: undefined,
      autoCompact: {},
      systemPromptMode: 'append',
      systemPromptContent: undefined,
    }),
  } as unknown as never;
  const configManager = { get: jest.fn(() => undefined) };

  const registry = new PtahCliRegistry(
    logger as unknown as Logger,
    authSecrets,
    moduleLoader,
    messageTransformer,
    permissionHandler,
    null as never,
    null as never,
    null as never,
    providerModels,
    configPersistence,
    spawnOptionsService,
    null as never,
    configManager as unknown as never,
    createFakeSdkProcessSpawner(),
    null,
    null,
    kimiAuth,
  );

  return {
    registry,
    logger,
    configManager,
    setProviderKey,
    setStoredKey: (key) => {
      storedKey = key;
    },
    getCapturedEnv: () => capturedEnv,
  };
}

function isFailure(value: object): value is SpawnAgentFailure {
  return 'status' in value;
}

beforeEach(() => {
  proxyStart.mockClear();
  proxyStop.mockClear();
  kimiProxyCtor.mockClear();
  proxyRunning = false;
});

describe('PtahCliRegistry.spawnAgent — kimi-code without a stored key', () => {
  it('runs through a per-agent proxy bound to the shared auth service', async () => {
    const kimiAuth = createFakeKimiAuth(status({}));
    const harness = buildHarness(undefined, kimiAuth);

    const result = await harness.registry.spawnAgent(KIMI_CONFIG.id, 'work');

    expect(isFailure(result)).toBe(false);
    expect(kimiProxyCtor).toHaveBeenCalledTimes(1);
    const [, authArg, configArg] = kimiProxyCtor.mock.calls[0];
    expect(authArg).toBe(kimiAuth);
    expect(configArg).toBe(harness.configManager);
    expect(proxyStart).toHaveBeenCalledTimes(1);

    const env = harness.getCapturedEnv();
    expect(env?.ANTHROPIC_BASE_URL).toBe(KIMI_PROXY_URL);
    expect(env?.ANTHROPIC_AUTH_TOKEN).toBe('kimi-code-proxy-managed');
    expect(env?.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env?.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe(
      KIMI_CODE_PROVIDER_ENTRY.defaultTiers?.opus,
    );
  });

  it('stops the proxy when the spawn stream loop resolves', async () => {
    const harness = buildHarness(undefined, createFakeKimiAuth(status({})));

    const result = await harness.registry.spawnAgent(KIMI_CONFIG.id, 'work');
    expect(isFailure(result)).toBe(false);
    await new Promise((resolve) => setImmediate(resolve));

    expect(proxyStop).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['signed out', status({ loggedIn: false, credentialSource: 'none' })],
    ['stale login', status({ stale: true })],
  ])(
    'fails with the sign-in message when the login is %s',
    async (_label, current) => {
      const harness = buildHarness(undefined, createFakeKimiAuth(current));

      const result = await harness.registry.spawnAgent(KIMI_CONFIG.id, 'work');

      expect(result).toEqual({
        status: 'no_api_key',
        message: SIGN_IN_MESSAGE,
      });
      expect(kimiProxyCtor).not.toHaveBeenCalled();
    },
  );

  it('fails with the sign-in message when the host has no Kimi Code auth service', async () => {
    const harness = buildHarness(undefined, null);

    const result = await harness.registry.spawnAgent(KIMI_CONFIG.id, 'work');

    expect(result).toEqual({ status: 'no_api_key', message: SIGN_IN_MESSAGE });
    expect(kimiProxyCtor).not.toHaveBeenCalled();
  });
});

describe('PtahCliRegistry.spawnAgent — kimi-code with a stored key', () => {
  it('keeps the direct base URL with the agent key and starts no proxy', async () => {
    const kimiAuth = createFakeKimiAuth(status({}));
    const harness = buildHarness('fake-kimi-agent-key', kimiAuth);

    const result = await harness.registry.spawnAgent(KIMI_CONFIG.id, 'work');

    expect(isFailure(result)).toBe(false);
    expect(kimiProxyCtor).not.toHaveBeenCalled();
    const env = harness.getCapturedEnv();
    expect(env?.ANTHROPIC_BASE_URL).toBe('https://api.kimi.ai/coding/');
    expect(env?.ANTHROPIC_API_KEY).toBe('fake-kimi-agent-key');
    expect(env?.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(kimiAuth.getStatus).not.toHaveBeenCalled();
  });
});

describe('PtahCliRegistry.listAgents — key-less kimi-code', () => {
  it('reports available with hasApiKey=true, hasStoredKey=false when signed in', async () => {
    const harness = buildHarness(undefined, createFakeKimiAuth(status({})));

    const [summary] = await harness.registry.listAgents();

    expect(summary).toMatchObject({
      status: 'available',
      hasApiKey: true,
      hasStoredKey: false,
    });
  });

  it('reports unconfigured when signed out', async () => {
    const harness = buildHarness(
      undefined,
      createFakeKimiAuth(status({ loggedIn: false, credentialSource: 'none' })),
    );

    const [summary] = await harness.registry.listAgents();

    expect(summary).toMatchObject({
      status: 'unconfigured',
      hasApiKey: false,
      hasStoredKey: false,
    });
  });

  it('reports available when only the provider-level Kimi Code key is stored', async () => {
    const harness = buildHarness(
      undefined,
      createFakeKimiAuth(
        status({
          loggedIn: false,
          hasApiKey: true,
          credentialSource: 'api-key',
        }),
      ),
    );

    const [summary] = await harness.registry.listAgents();

    expect(summary).toMatchObject({
      status: 'available',
      hasApiKey: true,
      hasStoredKey: false,
    });
  });

  it('reports available on a stale login while the provider key is stored', async () => {
    const harness = buildHarness(
      undefined,
      createFakeKimiAuth(status({ stale: true, hasApiKey: true })),
    );

    const [summary] = await harness.registry.listAgents();

    expect(summary).toMatchObject({ status: 'available', hasApiKey: true });
  });

  it('reports unconfigured and logs only the error category when the status cannot be read', async () => {
    const hostPath = 'C:\\Users\\someone\\.kimi-code\\credentials\\kimi.json';
    const failure = Object.assign(
      new Error(`EACCES: permission denied, open '${hostPath}'`),
      { code: 'EACCES' },
    );
    const harness = buildHarness(undefined, createFakeKimiAuth(failure));

    const [summary] = await harness.registry.listAgents();

    expect(summary).toMatchObject({ status: 'unconfigured', hasApiKey: false });
    expect(harness.logger.warn).toHaveBeenCalledWith(
      '[PtahCliRegistry] Kimi Code connection status unavailable (EACCES)',
    );
    const logged = JSON.stringify([
      harness.logger.warn.mock.calls,
      harness.logger.error.mock.calls,
      harness.logger.info.mock.calls,
      harness.logger.debug.mock.calls,
    ]);
    expect(logged).not.toContain('kimi.json');
    expect(logged).not.toContain('permission denied');
  });
});

describe('PtahCliRegistry.spawnAgent — kimi-code on the provider key fallback', () => {
  it('runs a key-less agent through the shared-connection proxy', async () => {
    const kimiAuth = createFakeKimiAuth(
      status({ loggedIn: false, hasApiKey: true, credentialSource: 'api-key' }),
    );
    const harness = buildHarness(undefined, kimiAuth);

    const result = await harness.registry.spawnAgent(KIMI_CONFIG.id, 'work');

    expect(isFailure(result)).toBe(false);
    expect(kimiProxyCtor.mock.calls[0][1]).toBe(kimiAuth);
    expect(harness.getCapturedEnv()?.ANTHROPIC_BASE_URL).toBe(KIMI_PROXY_URL);
  });
});

describe('PtahCliRegistry — reserved placeholder as an instance key', () => {
  it('treats a stored literal placeholder as an instance key, not the sign-in route', async () => {
    const kimiAuth = createFakeKimiAuth(status({}));
    const harness = buildHarness('kimi-code-proxy-managed', kimiAuth);

    const result = await harness.registry.spawnAgent(KIMI_CONFIG.id, 'work');

    expect(isFailure(result)).toBe(false);
    expect(kimiProxyCtor).not.toHaveBeenCalled();
    expect(kimiAuth.getStatus).not.toHaveBeenCalled();
    expect(harness.getCapturedEnv()?.ANTHROPIC_BASE_URL).toBe(
      'https://api.kimi.ai/coding/',
    );
  });

  it('rejects creating an instance with a reserved placeholder key', async () => {
    const harness = buildHarness(undefined, createFakeKimiAuth(status({})));

    await expect(
      harness.registry.createAgent(
        'Kimi',
        'kimi-code',
        'kimi-code-proxy-managed',
      ),
    ).rejects.toThrow('reserved');
    expect(harness.setProviderKey).not.toHaveBeenCalled();
  });

  it('rejects updating an instance key to a reserved placeholder', async () => {
    const harness = buildHarness(undefined, createFakeKimiAuth(status({})));

    await expect(
      harness.registry.updateAgent(
        KIMI_CONFIG.id,
        {},
        '  kimi-code-proxy-managed ',
      ),
    ).rejects.toThrow('reserved');
    expect(harness.setProviderKey).not.toHaveBeenCalled();
  });
});

type CredentialInternals = {
  buildProxyAuthEnv: (
    config: PtahCliConfig,
    provider: typeof KIMI_CODE_PROVIDER_ENTRY,
    credential: { kind: 'kimi-connection' },
  ) => Promise<{ authEnv: AuthEnv; stopProxy: () => Promise<void> }>;
};

describe('PtahCliRegistry — kimi-connection route without an auth service', () => {
  it('fails closed with the sign-in message and never builds a direct env', async () => {
    const harness = buildHarness(undefined, null);
    const internals = harness.registry as unknown as CredentialInternals;

    await expect(
      internals.buildProxyAuthEnv(KIMI_CONFIG, KIMI_CODE_PROVIDER_ENTRY, {
        kind: 'kimi-connection',
      }),
    ).rejects.toThrow(SIGN_IN_MESSAGE);
    expect(kimiProxyCtor).not.toHaveBeenCalled();
  });
});

describe('PtahCliRegistry.getProfile — a held tab moving to an instance key', () => {
  it('stops the old proxy when its only holder switches to a direct key', async () => {
    const harness = buildHarness(undefined, createFakeKimiAuth(status({})));

    const first = await harness.registry.getProfile(KIMI_CONFIG.id, 'tab-1');
    expect(first?.authEnv.ANTHROPIC_BASE_URL).toBe(KIMI_PROXY_URL);
    expect(proxyStart).toHaveBeenCalledTimes(1);

    harness.setStoredKey('fake-kimi-agent-key');
    const second = await harness.registry.getProfile(KIMI_CONFIG.id, 'tab-1');

    expect(second?.authEnv.ANTHROPIC_BASE_URL).toBe(
      'https://api.kimi.ai/coding/',
    );
    expect(proxyStop).toHaveBeenCalledTimes(1);

    // The tab no longer holds anything: a later release is a no-op.
    await harness.registry.releaseProfile('tab-1');
    expect(proxyStop).toHaveBeenCalledTimes(1);
  });

  it('keeps the proxy for the other holder and stops it on their release', async () => {
    const harness = buildHarness(undefined, createFakeKimiAuth(status({})));

    await harness.registry.getProfile(KIMI_CONFIG.id, 'tab-1');
    await harness.registry.getProfile(KIMI_CONFIG.id, 'tab-2');
    expect(kimiProxyCtor).toHaveBeenCalledTimes(1);

    harness.setStoredKey('fake-kimi-agent-key');
    await harness.registry.getProfile(KIMI_CONFIG.id, 'tab-1');
    expect(proxyStop).not.toHaveBeenCalled();

    await harness.registry.releaseProfile('tab-2');
    expect(proxyStop).toHaveBeenCalledTimes(1);
  });
});
