/**
 * PtahCliRegistry — `getProfile()` translation-proxy LEASE spec (TASK_2026_323).
 *
 * `getProfile()` is called once per `chat:start`. It used to key the proxy by
 * AGENT id and stop the previous one before starting a fresh one, so opening a
 * THIRD chat session on the same ptah-cli agent tore down the proxy sessions 1
 * and 2 were streaming through: their `ANTHROPIC_BASE_URL` pointed at a closed
 * port and every request they made failed.
 *
 * The proxy is now ref-counted per agent. This spec pins both halves of that:
 * it must survive every additional session, and it must still be stopped —
 * exactly once — when the last session lets go.
 *
 * Source-under-test:
 *   libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts
 */

import 'reflect-metadata';

import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger, IAuthSecretsService } from '@ptah-extension/vscode-core';
import type {
  SdkModuleLoader,
  SdkMessageTransformer,
  SdkPermissionHandler,
} from '@ptah-extension/agent-sdk';
import type { ProviderModelsService } from '@ptah-extension/auth-providers';
import type { PtahCliConfig } from '@ptah-extension/shared';

interface ProxyDouble {
  readonly url: string;
  readonly start: jest.Mock;
  readonly stop: jest.Mock;
  readonly isRunning: jest.Mock;
}

/** Every proxy the registry asked for, in creation order. */
const createdProxies: ProxyDouble[] = [];

const createSakanaProxyForKey = jest.fn((_apiKey: string) => {
  const url = `http://127.0.0.1:${9000 + createdProxies.length}`;
  let running = false;
  const double: ProxyDouble = {
    url,
    start: jest.fn(async () => {
      running = true;
      return { port: 9000 + createdProxies.length, url };
    }),
    stop: jest.fn(async () => {
      running = false;
    }),
    isRunning: jest.fn(() => running),
  };
  createdProxies.push(double);
  return double;
});

jest.mock('@ptah-extension/auth-providers', () => {
  const actual = jest.requireActual('@ptah-extension/auth-providers');
  return {
    ...actual,
    createSakanaProxyForKey: (apiKey: string) =>
      createSakanaProxyForKey(apiKey),
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

// Imported AFTER the mocks so the registry binds to the mocked modules.
import { PtahCliRegistry } from './ptah-cli-registry';
import { createFakeSdkProcessSpawner } from './testing/fake-sdk-process-spawner';

const SAKANA_CONFIG: PtahCliConfig = {
  id: 'pc-sakana-001',
  name: 'Sakana Agent',
  providerId: 'sakana',
  enabled: true,
  tierMappings: undefined,
  updatedAt: 0,
};

interface LeaseHarness {
  registry: PtahCliRegistry;
  /** Change the key the secret store answers with (a fingerprint change). */
  setStoredKey: (key: string) => void;
}

function buildHarness(): LeaseHarness {
  const logger = createMockLogger();
  let storedKey = 'sakana-key-one';

  const moduleLoader = {
    getQueryFunction: jest.fn(),
    getCliJsPath: jest.fn().mockResolvedValue(undefined),
  } as unknown as SdkModuleLoader;

  const authSecrets = {
    getProviderKey: jest.fn(async () => storedKey),
  } as unknown as IAuthSecretsService;

  const providerModels = {
    getModelTiers: jest
      .fn()
      .mockReturnValue({ sonnet: null, opus: null, haiku: null }),
  } as unknown as ProviderModelsService;

  const configPersistence = {
    ensureMigrated: jest.fn().mockResolvedValue(undefined),
    loadConfigs: jest.fn().mockReturnValue([SAKANA_CONFIG]),
  } as unknown as never;

  const registry = new PtahCliRegistry(
    logger as unknown as Logger,
    authSecrets,
    moduleLoader,
    {} as unknown as SdkMessageTransformer,
    {} as unknown as SdkPermissionHandler,
    null as never,
    null as never,
    null as never,
    providerModels,
    configPersistence,
    null as never,
    null as never,
    { get: jest.fn(() => undefined) } as unknown as never,
    createFakeSdkProcessSpawner(),
  );

  return {
    registry,
    setStoredKey: (key: string) => {
      storedKey = key;
    },
  };
}

describe('PtahCliRegistry.getProfile — translation-proxy leases', () => {
  beforeEach(() => {
    createdProxies.length = 0;
    createSakanaProxyForKey.mockClear();
  });

  it('shares ONE proxy across three sessions and stops it only on the last release', async () => {
    const { registry } = buildHarness();

    const first = await registry.getProfile(SAKANA_CONFIG.id, 'tab-1');
    const second = await registry.getProfile(SAKANA_CONFIG.id, 'tab-2');
    const third = await registry.getProfile(SAKANA_CONFIG.id, 'tab-3');

    // One proxy, started once. The old code started a fresh one per call and
    // stopped the previous — which is what killed sessions 1 and 2.
    expect(createdProxies).toHaveLength(1);
    expect(createdProxies[0].start).toHaveBeenCalledTimes(1);
    expect(createdProxies[0].stop).not.toHaveBeenCalled();

    // All three sessions must be pointed at the SAME live port.
    const baseUrl = createdProxies[0].url;
    expect(first?.authEnv.ANTHROPIC_BASE_URL).toBe(baseUrl);
    expect(second?.authEnv.ANTHROPIC_BASE_URL).toBe(baseUrl);
    expect(third?.authEnv.ANTHROPIC_BASE_URL).toBe(baseUrl);

    await registry.releaseProfile('tab-1');
    expect(createdProxies[0].stop).not.toHaveBeenCalled();

    await registry.releaseProfile('tab-2');
    expect(createdProxies[0].stop).not.toHaveBeenCalled();

    await registry.releaseProfile('tab-3');
    expect(createdProxies[0].stop).toHaveBeenCalledTimes(1);
  });

  it('ignores a release for an unknown key, and a double release', async () => {
    const { registry } = buildHarness();

    await expect(
      registry.releaseProfile('never-issued'),
    ).resolves.toBeUndefined();

    await registry.getProfile(SAKANA_CONFIG.id, 'tab-1');
    await registry.releaseProfile('tab-1');
    await registry.releaseProfile('tab-1');

    expect(createdProxies[0].stop).toHaveBeenCalledTimes(1);
  });

  it('starts a SECOND proxy when the key changes and leaves the first running for its holder', async () => {
    const harness = buildHarness();

    const first = await harness.registry.getProfile(SAKANA_CONFIG.id, 'tab-1');

    // The user edits the agent's stored key between sessions. The running proxy
    // is bound to the OLD key, so tab-2 cannot share it.
    harness.setStoredKey('sakana-key-two');
    const second = await harness.registry.getProfile(SAKANA_CONFIG.id, 'tab-2');

    expect(createdProxies).toHaveLength(2);
    expect(createdProxies[1].start).toHaveBeenCalledTimes(1);
    expect(first?.authEnv.ANTHROPIC_BASE_URL).not.toBe(
      second?.authEnv.ANTHROPIC_BASE_URL,
    );

    // The superseded proxy is RETIRED, not stopped: tab-1 is still streaming
    // through it.
    expect(createdProxies[0].stop).not.toHaveBeenCalled();

    await harness.registry.releaseProfile('tab-1');
    expect(createdProxies[0].stop).toHaveBeenCalledTimes(1);
    expect(createdProxies[1].stop).not.toHaveBeenCalled();

    await harness.registry.releaseProfile('tab-2');
    expect(createdProxies[1].stop).toHaveBeenCalledTimes(1);
  });

  it('reuses the lease when the same tab restarts on unchanged credentials', async () => {
    const { registry } = buildHarness();

    await registry.getProfile(SAKANA_CONFIG.id, 'tab-1');
    await registry.getProfile(SAKANA_CONFIG.id, 'tab-1');

    // Re-counting the tab's own lease would strand a reference it can never
    // give back; bouncing the proxy would break the session it belongs to.
    expect(createdProxies).toHaveLength(1);
    expect(createdProxies[0].stop).not.toHaveBeenCalled();

    await registry.releaseProfile('tab-1');
    expect(createdProxies[0].stop).toHaveBeenCalledTimes(1);
  });

  it('stops the current lease AND every retired one on disposeAll()', async () => {
    const harness = buildHarness();

    await harness.registry.getProfile(SAKANA_CONFIG.id, 'tab-1');
    harness.setStoredKey('sakana-key-two');
    await harness.registry.getProfile(SAKANA_CONFIG.id, 'tab-2');

    harness.registry.disposeAll();
    await new Promise((resolve) => setImmediate(resolve));

    expect(createdProxies[0].stop).toHaveBeenCalledTimes(1);
    expect(createdProxies[1].stop).toHaveBeenCalledTimes(1);
  });

  it('keeps counting a keyless acquisition so a later session cannot kill the proxy', async () => {
    const { registry } = buildHarness();

    // The pre-existing rpc-handlers call site passes no lease key.
    await registry.getProfile(SAKANA_CONFIG.id);
    await registry.getProfile(SAKANA_CONFIG.id, 'tab-2');

    await registry.releaseProfile('tab-2');

    expect(createdProxies).toHaveLength(1);
    expect(createdProxies[0].stop).not.toHaveBeenCalled();
  });
});
