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
 * Plus, for user-defined entries (`provider.custom.entries`):
 *   (f) an `openai`-lane entry gets its own isolated proxy, built through the
 *       shared `createCustomOpenAiProxy` factory against the entry's base URL;
 *   (g) an `anthropic`-lane entry takes the NO-PROXY path — declined silently
 *       (it speaks Anthropic directly) rather than warned about as unsupported;
 *   (h) two entries sharing an API key but pointing at different hosts never
 *       share a pool slot, and re-pointing ONE entry rebuilds its proxy instead
 *       of serving the workspace from the host it used to point at;
 *   (i) built-in ids behave exactly as they did before custom entries existed,
 *       even while custom entries are registered;
 *   (j) a custom entry never resolves to the DEFAULT provider's base URL — the
 *       failure mode `getProviderBaseUrl()` would introduce (it returns
 *       OpenRouter's URL for an id it cannot resolve, which would ship the
 *       user's key to a vendor they never chose).
 *
 * The LM Studio proxy module is mocked with an in-memory fake so instances and
 * ports are deterministic and no real HTTP servers are bound. LM Studio is the
 * keyless proxy path, ideal for the instance/port/dispose assertions. The
 * custom-provider FACTORY is mocked the same way (the real proxy is covered by
 * custom-openai-translation-proxy.spec.ts; here we only care which base URL the
 * pool hands it and how the instance is pooled). Custom entries themselves go
 * through the REAL registry merge, so the lane -> requiresProxy projection under
 * test is the shipped one. The other provider modules are left real (no side
 * effects on import).
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

/** One `createCustomOpenAiProxy` call the pool made, with what it asked for. */
interface CreatedCustomProxy {
  providerId: string;
  baseUrl: string;
  proxy: FakeProxy;
}

// Mock ONLY the custom-provider FACTORY (everything else in the module — the
// placeholder token, the real proxy class — stays real via requireActual), so
// the assertions below are about which base URL the pool binds an instance to,
// not about HTTP.
jest.mock('../providers/custom', () => {
  const actual = jest.requireActual<typeof import('../providers/custom')>(
    '../providers/custom',
  );
  const created: CreatedCustomProxy[] = [];
  let nextPort = 46000;
  class FakeCustomProxy implements FakeProxy {
    label: string;
    running = false;
    port = ++nextPort;
    url = `http://127.0.0.1:${this.port}`;
    constructor(providerId: string) {
      this.label = providerId;
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
    ...actual,
    createCustomOpenAiProxy: (params: {
      provider: { id: string };
      baseUrl: string;
    }) => {
      const proxy = new FakeCustomProxy(params.provider.id);
      created.push({
        providerId: params.provider.id,
        baseUrl: params.baseUrl,
        proxy,
      });
      return proxy;
    },
    __created: created,
  };
});

import type { Logger, ConfigManager } from '@ptah-extension/vscode-core';
import type { IAuthSecretsService } from '@ptah-extension/vscode-core';
import type {
  AnthropicProvider,
  CustomProviderEntry,
} from '@ptah-extension/shared';
import {
  getAnthropicProvider,
  getProviderBaseUrl,
  setCustomProviderEntries,
  clearCustomProviderEntries,
} from '@ptah-extension/shared';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import {
  createMockConfigManager,
  type MockConfigManager,
} from '@ptah-extension/vscode-core/testing';

import { ProviderProxyPool } from './provider-proxy-pool';
import type { ICopilotAuthService } from '../providers/copilot';
import type { ICodexAuthService } from '../providers/codex';
import type { IOpenRouterAuthService } from '../providers/openrouter';
import * as localModule from '../providers/local';
import * as customModule from '../providers/custom';
import { CUSTOM_PROXY_TOKEN_PLACEHOLDER } from '../providers/custom';

function fakeInstances(): FakeProxy[] {
  return (localModule as unknown as { __instances: FakeProxy[] }).__instances;
}

/** Every custom proxy the pool asked the factory to build, in order. */
function createdCustomProxies(): CreatedCustomProxy[] {
  return (customModule as unknown as { __created: CreatedCustomProxy[] })
    .__created;
}

// ---------------------------------------------------------------------------
// User-defined provider fixtures
//
// Registered through the REAL registry merge so `isCustomProviderId` and the
// lane -> requiresProxy projection under test are the shipped ones.
// ---------------------------------------------------------------------------

const OPENAI_LANE_ID = 'my-gateway';
const OPENAI_LANE_BASE_URL = 'http://192.168.1.50:8000';
const OPENAI_LANE_ALT_ID = 'my-other-gateway';
const OPENAI_LANE_ALT_BASE_URL = 'https://gateway.example.com/v1';
const ANTHROPIC_LANE_ID = 'my-passthrough';

/** Replace the registry's custom entries with `entries`, failing on rejection. */
function defineCustomProviders(
  entries: ReadonlyArray<
    Omit<CustomProviderEntry, 'authEnvVar' | 'keyPrefix' | 'helpUrl'>
  >,
): void {
  const { rejected } = setCustomProviderEntries(
    entries.map((entry) => ({
      authEnvVar: 'ANTHROPIC_AUTH_TOKEN' as const,
      keyPrefix: '',
      helpUrl: '',
      ...entry,
    })),
  );
  if (rejected.length > 0) {
    throw new Error(
      `Test fixture rejected by the registry: ${rejected
        .map((r) => `${r.id} (${r.reason})`)
        .join(', ')}`,
    );
  }
}

/** Register the three fixture entries used by the custom-provider specs. */
function defineFixtureCustomProviders(): void {
  defineCustomProviders([
    {
      id: OPENAI_LANE_ID,
      name: 'My Gateway',
      baseUrl: OPENAI_LANE_BASE_URL,
      lane: 'openai',
    },
    {
      id: OPENAI_LANE_ALT_ID,
      name: 'My Other Gateway',
      baseUrl: OPENAI_LANE_ALT_BASE_URL,
      lane: 'openai',
    },
    {
      id: ANTHROPIC_LANE_ID,
      name: 'My Passthrough',
      baseUrl: 'https://passthrough.example.com',
      lane: 'anthropic',
    },
  ]);
}

/** The registry projection for a registered custom id (fails loudly if absent). */
function customProvider(id: string): AnthropicProvider {
  const provider = getAnthropicProvider(id);
  if (!provider) {
    throw new Error(`custom provider "${id}" was not merged into the registry`);
  }
  return provider;
}

function asLogger(mock: MockLogger): Logger {
  return mock as unknown as Logger;
}

interface Harness {
  pool: ProviderProxyPool;
  authSecrets: { getProviderKey: jest.Mock };
  logger: MockLogger;
  config: MockConfigManager;
}

function makePool(): Harness {
  const logger = createMockLogger();
  const config = createMockConfigManager();
  const configManager = config as unknown as ConfigManager;
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

  return { pool, authSecrets, logger, config };
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
    createdCustomProxies().length = 0;
    clearCustomProviderEntries();
    harness = makePool();
  });

  afterEach(async () => {
    await harness.pool.disposeAll();
    clearCustomProviderEntries();
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

  describe('user-defined provider entries', () => {
    beforeEach(() => {
      defineFixtureCustomProviders();
    });

    it('sanity: the lane -> requiresProxy projection is what the pool branches on', () => {
      expect(customProvider(OPENAI_LANE_ID).requiresProxy).toBe(true);
      expect(customProvider(ANTHROPIC_LANE_ID).requiresProxy).toBe(false);
    });

    it('(f) an openai-lane entry gets an isolated proxy bound to its own base URL', async () => {
      const acquired = await harness.pool.acquire(
        '/ws/a',
        OPENAI_LANE_ID,
        customProvider(OPENAI_LANE_ID),
      );

      expect(acquired?.authToken).toBe(CUSTOM_PROXY_TOKEN_PLACEHOLDER);
      expect(acquired?.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

      const created = createdCustomProxies();
      expect(created).toHaveLength(1);
      expect(created[0].providerId).toBe(OPENAI_LANE_ID);
      expect(created[0].baseUrl).toBe(OPENAI_LANE_BASE_URL);
      expect(created[0].proxy.isRunning()).toBe(true);
    });

    it('(f) two workspaces on the same entry get two distinct isolated proxies', async () => {
      const provider = customProvider(OPENAI_LANE_ID);

      const a = await harness.pool.acquire('/ws/a', OPENAI_LANE_ID, provider);
      const b = await harness.pool.acquire('/ws/b', OPENAI_LANE_ID, provider);

      expect(createdCustomProxies()).toHaveLength(2);
      expect(a?.baseUrl).not.toBe(b?.baseUrl);

      // ...and re-acquiring reuses the live instance rather than leaking one.
      const aAgain = await harness.pool.acquire(
        '/ws/a',
        OPENAI_LANE_ID,
        provider,
      );
      expect(createdCustomProxies()).toHaveLength(2);
      expect(aAgain?.baseUrl).toBe(a?.baseUrl);
    });

    it('(f) a `provider.<id>.baseUrl` override wins over the entry own base URL', async () => {
      harness.config.__seed({
        [`provider.${OPENAI_LANE_ID}.baseUrl`]: 'https://override.example.com',
      });

      await harness.pool.acquire(
        '/ws/a',
        OPENAI_LANE_ID,
        customProvider(OPENAI_LANE_ID),
      );

      expect(createdCustomProxies()[0].baseUrl).toBe(
        'https://override.example.com',
      );
    });

    it('(g) an anthropic-lane entry takes the no-proxy path — declined, not warned about', async () => {
      const result = await harness.pool.acquire(
        '/ws/a',
        ANTHROPIC_LANE_ID,
        customProvider(ANTHROPIC_LANE_ID),
      );

      // Undefined here means "nothing to isolate, use the direct snapshot",
      // NOT "unsupported provider" — so nothing is built and nothing is warned.
      expect(result).toBeUndefined();
      expect(createdCustomProxies()).toHaveLength(0);
      expect(harness.logger.warn).not.toHaveBeenCalled();
    });

    it('(h) two entries sharing an API key but pointing at different hosts never share a slot', async () => {
      harness.authSecrets.getProviderKey.mockResolvedValue('sk-shared-key');

      const a = await harness.pool.acquire(
        '/ws/a',
        OPENAI_LANE_ID,
        customProvider(OPENAI_LANE_ID),
      );
      const b = await harness.pool.acquire(
        '/ws/a',
        OPENAI_LANE_ALT_ID,
        customProvider(OPENAI_LANE_ALT_ID),
      );

      expect(a?.baseUrl).not.toBe(b?.baseUrl);
      expect(createdCustomProxies().map((c) => c.baseUrl)).toEqual([
        OPENAI_LANE_BASE_URL,
        OPENAI_LANE_ALT_BASE_URL,
      ]);
    });

    it('(h) re-pointing an entry rebuilds its proxy instead of reusing the old host', async () => {
      const provider = customProvider(OPENAI_LANE_ID);
      const first = await harness.pool.acquire(
        '/ws/a',
        OPENAI_LANE_ID,
        provider,
      );
      const firstProxy = createdCustomProxies()[0];
      expect(firstProxy.proxy.isRunning()).toBe(true);

      // Same workspace, same id, new upstream host: the pool key is unchanged,
      // so ONLY the base URL in the credential fingerprint can invalidate the
      // cached entry. Without it this workspace would keep talking to
      // OPENAI_LANE_BASE_URL after the user re-pointed the entry.
      harness.config.__seed({
        [`provider.${OPENAI_LANE_ID}.baseUrl`]: 'https://moved.example.com',
      });

      const second = await harness.pool.acquire(
        '/ws/a',
        OPENAI_LANE_ID,
        provider,
      );

      const created = createdCustomProxies();
      expect(created).toHaveLength(2);
      expect(created[1].baseUrl).toBe('https://moved.example.com');
      expect(second?.baseUrl).not.toBe(first?.baseUrl);
      expect(firstProxy.proxy.isRunning()).toBe(false);
    });

    it('(i) a built-in id behaves exactly as before while custom entries are registered', async () => {
      const acquired = await harness.pool.acquire(
        '/ws/a',
        'lm-studio',
        lmStudioProvider(),
      );

      expect(acquired?.authToken).toBe('local-proxy-managed');
      expect(fakeInstances()).toHaveLength(1);
      expect(createdCustomProxies()).toHaveLength(0);
    });

    it('(j) a custom entry never resolves to the DEFAULT provider base URL', async () => {
      await harness.pool.acquire(
        '/ws/a',
        OPENAI_LANE_ID,
        customProvider(OPENAI_LANE_ID),
      );

      // `getProviderBaseUrl` answers with the default provider's URL for any id
      // it cannot resolve — the exact trap this path must not fall into.
      const defaultProviderBaseUrl = getProviderBaseUrl('not-a-real-provider');
      expect(createdCustomProxies()[0].baseUrl).toBe(OPENAI_LANE_BASE_URL);
      expect(createdCustomProxies()[0].baseUrl).not.toBe(
        defaultProviderBaseUrl,
      );
    });

    it('(j) an unregistered id is declined, never built against the default provider', async () => {
      // A registry race (entry removed between resolve and acquire): the
      // provider object still says requiresProxy, but the id is no longer a
      // known custom entry. Decline — do not fabricate an upstream.
      const ghost: AnthropicProvider = {
        ...customProvider(OPENAI_LANE_ID),
        id: 'ghost-entry',
      };

      const result = await harness.pool.acquire('/ws/a', 'ghost-entry', ghost);

      expect(result).toBeUndefined();
      expect(createdCustomProxies()).toHaveLength(0);
      expect(harness.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No proxy factory'),
        expect.objectContaining({ providerId: 'ghost-entry' }),
      );
    });
  });
});
