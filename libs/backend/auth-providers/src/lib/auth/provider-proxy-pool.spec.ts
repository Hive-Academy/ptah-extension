/**
 * ProviderProxyPool — unit specs (Phase 3 per-workspace isolated proxies).
 *
 * Verifies the isolation guarantees the pool exists to provide:
 *   (a) two different workspacePaths for the same provider yield two DISTINCT
 *       started proxy instances on distinct ports;
 *   (b) the same workspace+provider reuses a single running instance;
 *   (c) disposeForScope() stops ONLY that workspace's proxies, leaving others
 *       running;
 *   (d) a non-proxy provider (requiresProxy !== true) yields undefined;
 *   (e) a proxy provider with a missing required credential (Sakana key) yields
 *       undefined (workspace falls back to global auth).
 *
 * The LM Studio proxy module is mocked with an in-memory fake so instances and
 * ports are deterministic and no real HTTP servers are bound. LM Studio is the
 * keyless proxy path, ideal for the instance/port/dispose assertions. The other
 * provider modules are left real (no side effects on import).
 *
 * Source-under-test: `libs/backend/auth-providers/src/lib/auth/provider-proxy-pool.ts`
 */

import 'reflect-metadata';

interface FakeProxy {
  label: string;
  running: boolean;
  port: number;
  url: string;
  start(): Promise<{ port: number; url: string }>;
  stop(): Promise<void>;
  isRunning(): boolean;
  getUrl(): string | undefined;
}

// Mock ONLY the LM Studio provider module: swap the real translation proxy for
// an in-memory fake that records every constructed instance and assigns a fresh
// port per instance. The `__instances` export lets the test inspect them.
jest.mock('../providers/local', () => {
  const instances: FakeProxy[] = [];
  let nextPort = 45000;
  class LmStudioTranslationProxy implements FakeProxy {
    label = 'lm-studio';
    running = false;
    port = ++nextPort;
    url = `http://127.0.0.1:${this.port}`;
    constructor() {
      instances.push(this);
    }
    async start(): Promise<{ port: number; url: string }> {
      this.running = true;
      return { port: this.port, url: this.url };
    }
    async stop(): Promise<void> {
      this.running = false;
    }
    isRunning(): boolean {
      return this.running;
    }
    getUrl(): string | undefined {
      return this.running ? this.url : undefined;
    }
  }
  return {
    LmStudioTranslationProxy,
    LOCAL_PROXY_TOKEN_PLACEHOLDER: 'local-proxy-managed',
    __instances: instances,
  };
});

import type { Logger, ConfigManager } from '@ptah-extension/vscode-core';
import type { IAuthSecretsService } from '@ptah-extension/vscode-core';
import type { AnthropicProvider } from '@ptah-extension/shared';
import { getAnthropicProvider } from '@ptah-extension/shared';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import { ProviderProxyPool } from './provider-proxy-pool';
import type { ICopilotAuthService } from '../providers/copilot';
import type { ICodexAuthService } from '../providers/codex';
import type { IOpenRouterAuthService } from '../providers/openrouter';
import * as localModule from '../providers/local';

function fakeInstances(): FakeProxy[] {
  return (localModule as unknown as { __instances: FakeProxy[] }).__instances;
}

function asLogger(mock: MockLogger): Logger {
  return mock as unknown as Logger;
}

interface Harness {
  pool: ProviderProxyPool;
  authSecrets: { getProviderKey: jest.Mock };
  logger: MockLogger;
}

function makePool(): Harness {
  const logger = createMockLogger();
  const configManager = { get: jest.fn() } as unknown as ConfigManager;
  const authSecrets = {
    getProviderKey: jest.fn<Promise<string | undefined>, [string]>(),
  };
  const copilotAuth = {} as unknown as ICopilotAuthService;
  const codexAuth = {} as unknown as ICodexAuthService;
  const openRouterAuth = {} as unknown as IOpenRouterAuthService;

  const pool = new ProviderProxyPool(
    asLogger(logger),
    configManager,
    authSecrets as unknown as IAuthSecretsService,
    copilotAuth,
    codexAuth,
    openRouterAuth,
  );

  return { pool, authSecrets, logger };
}

function lmStudioProvider(): AnthropicProvider {
  const provider = getAnthropicProvider('lm-studio');
  if (!provider) {
    throw new Error('lm-studio provider entry missing from registry');
  }
  return provider;
}

function sakanaProvider(): AnthropicProvider {
  const provider = getAnthropicProvider('sakana');
  if (!provider) {
    throw new Error('sakana provider entry missing from registry');
  }
  return provider;
}

describe('ProviderProxyPool', () => {
  let harness: Harness;

  beforeEach(() => {
    fakeInstances().length = 0;
    harness = makePool();
  });

  afterEach(async () => {
    await harness.pool.disposeAll();
    jest.clearAllMocks();
  });

  it('sanity: LM Studio is a proxy-requiring provider', () => {
    expect(lmStudioProvider().requiresProxy).toBe(true);
  });

  it('(a) two different workspaces → two distinct started proxies on distinct ports', async () => {
    const lm = lmStudioProvider();

    const a = await harness.pool.acquire('/ws/a', 'lm-studio', lm);
    const b = await harness.pool.acquire('/ws/b', 'lm-studio', lm);

    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a?.authToken).toBe('local-proxy-managed');

    const instances = fakeInstances();
    expect(instances).toHaveLength(2);
    expect(instances[0]).not.toBe(instances[1]);
    expect(instances[0].isRunning()).toBe(true);
    expect(instances[1].isRunning()).toBe(true);
    expect(a?.baseUrl).not.toBe(b?.baseUrl);
  });

  it('(b) same workspace+provider reuses one running instance', async () => {
    const lm = lmStudioProvider();

    const first = await harness.pool.acquire('/ws/a', 'lm-studio', lm);
    const second = await harness.pool.acquire('/ws/a', 'lm-studio', lm);

    expect(fakeInstances()).toHaveLength(1);
    expect(first?.baseUrl).toBe(second?.baseUrl);
  });

  it('(c) disposeForScope stops only that workspace, leaving others running', async () => {
    const lm = lmStudioProvider();

    await harness.pool.acquire('/ws/a', 'lm-studio', lm);
    const b = await harness.pool.acquire('/ws/b', 'lm-studio', lm);

    const [proxyA, proxyB] = fakeInstances();
    expect(proxyA.isRunning()).toBe(true);
    expect(proxyB.isRunning()).toBe(true);

    await harness.pool.disposeForScope('/ws/a');

    expect(proxyA.isRunning()).toBe(false);
    expect(proxyB.isRunning()).toBe(true);

    // /ws/b still reuses its live proxy (no new instance created).
    const bAgain = await harness.pool.acquire('/ws/b', 'lm-studio', lm);
    expect(fakeInstances()).toHaveLength(2);
    expect(bAgain?.baseUrl).toBe(b?.baseUrl);
  });

  it('(d) a non-proxy provider (requiresProxy !== true) returns undefined', async () => {
    const lm = lmStudioProvider();
    const nonProxy: AnthropicProvider = { ...lm, requiresProxy: false };

    const result = await harness.pool.acquire('/ws/a', 'lm-studio', nonProxy);

    expect(result).toBeUndefined();
    expect(fakeInstances()).toHaveLength(0);
  });

  it('(e) missing Sakana key returns undefined (global-auth fallback)', async () => {
    harness.authSecrets.getProviderKey.mockResolvedValue(undefined);

    const result = await harness.pool.acquire(
      '/ws/a',
      'sakana',
      sakanaProvider(),
    );

    expect(result).toBeUndefined();
    expect(harness.authSecrets.getProviderKey).toHaveBeenCalledWith('sakana');
  });
});
