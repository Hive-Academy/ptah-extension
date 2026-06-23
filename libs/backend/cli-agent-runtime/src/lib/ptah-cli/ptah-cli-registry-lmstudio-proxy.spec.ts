/**
 * PtahCliRegistry — LM Studio per-agent translation-proxy lifecycle spec.
 *
 * LM Studio is a local, keyless (authType:'none') provider that speaks the
 * OpenAI protocol and so requires a translation proxy (requiresProxy:true). The
 * old `buildAuthEnv` path pointed the Anthropic-speaking SDK straight at LM
 * Studio's raw OpenAI `/v1` endpoint with NO proxy — the bug fixed here. This
 * spec proves the registry now:
 *   (a) constructs a FRESH per-agent LmStudioTranslationProxy (keyless)
 *   (b) sets ANTHROPIC_BASE_URL to the proxy URL (NOT localhost:1234/v1) +
 *       ANTHROPIC_AUTH_TOKEN to the local-proxy placeholder
 *   (c) stops the proxy when the spawn stream loop resolves
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

const LM_STUDIO_PROXY_URL = 'http://127.0.0.1:9912';

// Per-agent proxy double — start()/stop()/isRunning() tracked for assertions.
const proxyStart = jest.fn(async () => ({
  port: 9912,
  url: LM_STUDIO_PROXY_URL,
}));
const proxyStop = jest.fn(async () => undefined);
let proxyRunning = false;
const lmStudioCtor = jest.fn();

class MockLmStudioTranslationProxy {
  constructor(...args: unknown[]) {
    proxyRunning = false;
    lmStudioCtor(...args);
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
  getUrl = jest.fn(() => (proxyRunning ? LM_STUDIO_PROXY_URL : undefined));
}

jest.mock('@ptah-extension/auth-providers', () => {
  const actual = jest.requireActual('@ptah-extension/auth-providers');
  return {
    ...actual,
    LmStudioTranslationProxy: MockLmStudioTranslationProxy,
  };
});

jest.mock('@ptah-extension/agent-sdk', () => {
  const actual = jest.requireActual('@ptah-extension/agent-sdk');
  return {
    ...actual,
    getAnthropicProvider: jest.fn(() => ({
      id: 'lm-studio',
      name: 'LM Studio',
      baseUrl: 'http://localhost:1234/v1',
      authEnvVar: 'ANTHROPIC_AUTH_TOKEN',
      authType: 'none',
      requiresProxy: true,
      isLocal: true,
      keyPrefix: '',
      helpUrl: '',
      description: '',
      keyPlaceholder: '',
      maskedKeyDisplay: '',
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

  // Local providers never read a stored key — placeholder is used instead.
  const authSecrets = {
    getProviderKey: jest.fn().mockResolvedValue(undefined),
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

  const configManager = {
    get: jest.fn(() => undefined),
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
    configManager,
  );

  return { registry, getCapturedEnv: () => capturedEnv };
}

const LM_STUDIO_CONFIG: PtahCliConfig = {
  id: 'pc-lmstudio-001',
  name: 'LM Studio Agent',
  providerId: 'lm-studio',
  enabled: true,
  tierMappings: undefined,
  updatedAt: 0,
};

describe('PtahCliRegistry.spawnAgent — LM Studio proxy lifecycle', () => {
  beforeEach(() => {
    proxyStart.mockClear();
    proxyStop.mockClear();
    lmStudioCtor.mockClear();
    proxyRunning = false;
  });

  it('constructs a fresh per-agent LM Studio translation proxy', async () => {
    const harness = buildHarness(LM_STUDIO_CONFIG);

    const result = await harness.registry.spawnAgent(
      LM_STUDIO_CONFIG.id,
      'do work',
    );

    expect('status' in result).toBe(false);
    expect(lmStudioCtor).toHaveBeenCalledTimes(1);
    expect(proxyStart).toHaveBeenCalledTimes(1);
  });

  it('points ANTHROPIC_BASE_URL at the proxy URL (NOT localhost:1234) with the local-proxy placeholder', async () => {
    const harness = buildHarness(LM_STUDIO_CONFIG);

    await harness.registry.spawnAgent(LM_STUDIO_CONFIG.id, 'do work');

    const env = harness.getCapturedEnv();
    expect(env?.ANTHROPIC_BASE_URL).toBe(LM_STUDIO_PROXY_URL);
    expect(env?.ANTHROPIC_BASE_URL).not.toContain('localhost:1234');
    expect(env?.ANTHROPIC_AUTH_TOKEN).toBe('local-proxy-managed');
  });

  it('stops the proxy when the spawn stream loop resolves', async () => {
    const harness = buildHarness(LM_STUDIO_CONFIG);

    const result = await harness.registry.spawnAgent(
      LM_STUDIO_CONFIG.id,
      'do work',
    );
    expect('status' in result).toBe(false);

    // streamLoop.run resolves on the microtask queue after spawn returns.
    await new Promise((resolve) => setImmediate(resolve));

    expect(proxyStop).toHaveBeenCalledTimes(1);
  });
});
