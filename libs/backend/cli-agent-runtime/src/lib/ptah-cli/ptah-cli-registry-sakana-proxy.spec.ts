/**
 * PtahCliRegistry — Sakana per-agent translation-proxy lifecycle spec.
 *
 * Sakana is the first apiKey + requiresProxy provider reachable via ptah-cli.
 * `buildAuthEnv` (direct base URL) is NOT correct for it — the Anthropic-speaking
 * SDK must talk to a LOCAL proxy that translates to Sakana's OpenAI endpoint.
 * This spec proves the registry:
 *   (a) starts a FRESH per-agent SakanaTranslationProxy bound to the stored key
 *   (b) sets ANTHROPIC_BASE_URL to the proxy URL (NOT api.sakana.ai) +
 *       ANTHROPIC_AUTH_TOKEN to the proxy placeholder
 *   (c) stops the proxy when the spawn stream loop resolves
 *
 * Drives the REAL spawnAgent() up to the SDK queryFn() call, capturing the
 * `options.env` production code hands to the SDK.
 *
 * Source-under-test:
 *   libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts
 */

import 'reflect-metadata';

import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IAuthSecretsService } from '@ptah-extension/vscode-core';
import type {
  SdkModuleLoader,
  SdkMessageTransformer,
  SdkPermissionHandler,
  Options,
} from '@ptah-extension/agent-sdk';
import type { ProviderModelsService } from '@ptah-extension/auth-providers';
import type { PtahCliConfig, AuthEnv } from '@ptah-extension/shared';

const SAKANA_PROXY_URL = 'http://127.0.0.1:9876';

// Per-agent proxy double — start()/stop()/isRunning() tracked for assertions.
const proxyStart = jest.fn(async () => ({ port: 9876, url: SAKANA_PROXY_URL }));
const proxyStop = jest.fn(async () => undefined);
let proxyRunning = false;
const createSakanaProxyForKey = jest.fn((_apiKey: string, _logger: Logger) => {
  proxyRunning = false;
  return {
    start: jest.fn(async () => {
      proxyRunning = true;
      return proxyStart();
    }),
    stop: jest.fn(async () => {
      proxyRunning = false;
      return proxyStop();
    }),
    isRunning: jest.fn(() => proxyRunning),
    getUrl: jest.fn(() => (proxyRunning ? SAKANA_PROXY_URL : undefined)),
  };
});

jest.mock('@ptah-extension/auth-providers', () => {
  const actual = jest.requireActual('@ptah-extension/auth-providers');
  return {
    ...actual,
    createSakanaProxyForKey: (apiKey: string, logger: Logger) =>
      createSakanaProxyForKey(apiKey, logger),
  };
});

jest.mock('@ptah-extension/agent-sdk', () => {
  const actual = jest.requireActual('@ptah-extension/agent-sdk');
  return {
    ...actual,
    getAnthropicProvider: jest.fn(() => ({
      id: 'sakana',
      name: 'Sakana (Fugu)',
      baseUrl: 'https://api.sakana.ai/v1',
      authEnvVar: 'ANTHROPIC_AUTH_TOKEN',
      authType: 'apiKey',
      requiresProxy: true,
      isLocal: false,
      keyPrefix: '',
      helpUrl: '',
      description: '',
      keyPlaceholder: '',
      maskedKeyDisplay: '',
      staticModels: [{ id: 'fugu', name: 'Fugu' }],
      defaultTiers: { sonnet: 'fugu', opus: 'fugu-ultra', haiku: 'fugu' },
    })),
    getProviderAuthEnvVar: jest.fn(() => 'ANTHROPIC_AUTH_TOKEN'),
    seedStaticModelPricing: jest.fn(),
    buildSafeEnv: jest.fn((env: unknown) => env),
  };
});

// Imported AFTER the mocks so the registry binds to the mocked module.
import { PtahCliRegistry } from './ptah-cli-registry';

async function* emptyStream(): AsyncGenerator<never, void, unknown> {
  // No messages — streamLoop.run resolves with exit code 0.
}

interface SpawnHarness {
  registry: PtahCliRegistry;
  getCapturedEnv: () => AuthEnv | undefined;
}

function buildHarness(config: PtahCliConfig): SpawnHarness {
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
    getProviderKey: jest.fn().mockResolvedValue('sakana-stored-key'),
  } as unknown as IAuthSecretsService;

  const providerModels = {
    getModelTiers: jest.fn().mockReturnValue({
      sonnet: null,
      opus: null,
      haiku: null,
    }),
  } as unknown as ProviderModelsService;

  const configPersistence = {
    loadConfigs: jest.fn().mockReturnValue([config]),
  } as unknown as never;

  const spawnOptionsService = {
    assembleSpawnOptions: jest.fn().mockResolvedValue({
      mcpServers: {},
      hooks: undefined,
      plugins: undefined,
      compactionControl: undefined,
      systemPromptMode: 'append',
      systemPromptContent: undefined,
      isPremium: false,
    }),
  } as unknown as never;

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
  );

  return { registry, getCapturedEnv: () => capturedEnv };
}

const SAKANA_CONFIG: PtahCliConfig = {
  id: 'pc-sakana-001',
  name: 'Sakana Agent',
  providerId: 'sakana',
  enabled: true,
  tierMappings: undefined,
  updatedAt: 0,
};

describe('PtahCliRegistry.spawnAgent — Sakana proxy lifecycle', () => {
  beforeEach(() => {
    proxyStart.mockClear();
    proxyStop.mockClear();
    createSakanaProxyForKey.mockClear();
    proxyRunning = false;
  });

  it('starts a fresh per-agent Sakana proxy bound to the stored key', async () => {
    const harness = buildHarness(SAKANA_CONFIG);

    const result = await harness.registry.spawnAgent(
      SAKANA_CONFIG.id,
      'do work',
    );

    expect('status' in result).toBe(false);
    expect(createSakanaProxyForKey).toHaveBeenCalledTimes(1);
    expect(createSakanaProxyForKey.mock.calls[0][0]).toBe('sakana-stored-key');
    expect(proxyStart).toHaveBeenCalledTimes(1);
  });

  it('points ANTHROPIC_BASE_URL at the proxy URL (NOT api.sakana.ai) with the placeholder token', async () => {
    const harness = buildHarness(SAKANA_CONFIG);

    await harness.registry.spawnAgent(SAKANA_CONFIG.id, 'do work');

    const env = harness.getCapturedEnv();
    expect(env?.ANTHROPIC_BASE_URL).toBe(SAKANA_PROXY_URL);
    expect(env?.ANTHROPIC_BASE_URL).not.toContain('api.sakana.ai');
    expect(env?.ANTHROPIC_AUTH_TOKEN).toBe('sakana-proxy-token');
  });

  it('stops the proxy when the spawn stream loop resolves', async () => {
    const harness = buildHarness(SAKANA_CONFIG);

    const result = await harness.registry.spawnAgent(
      SAKANA_CONFIG.id,
      'do work',
    );
    expect('status' in result).toBe(false);

    // streamLoop.run resolves on the microtask queue after spawn returns.
    await new Promise((resolve) => setImmediate(resolve));

    expect(proxyStop).toHaveBeenCalledTimes(1);
  });
});
