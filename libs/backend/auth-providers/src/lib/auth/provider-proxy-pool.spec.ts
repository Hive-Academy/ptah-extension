/**
 * ProviderProxyPool — unit specs (Phase 3 per-workspace isolated proxies).
 *
 * Verifies the isolation guarantees the pool exists to provide:
 *   (a) two workspacePaths on the same provider configuration share ONE
 *       started proxy instance (also when they acquire concurrently);
 *   (b) the same workspace+provider reuses a single running instance;
 *   (c) disposeForScope() unbinds that workspace and stops a proxy only once
 *       no other workspace is bound to it;
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

import * as http from 'http';
import type { Logger, ConfigManager } from '@ptah-extension/vscode-core';
import type { IAuthSecretsService } from '@ptah-extension/vscode-core';
import type {
  AnthropicProvider,
  CustomProviderEntry,
} from '@ptah-extension/shared';
import {
  KIMI_CODE_PROXY_TOKEN_PLACEHOLDER,
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
import type { ICodexOwnerKeySource } from '../providers/codex/codex-provider.types';
import {
  providerQuotaStore,
  type ProviderQuotaObservation,
} from './provider-quota.store';
import type { IOpenRouterAuthService } from '../providers/openrouter';
import type { IKimiCodeAuthService } from '../providers/kimi-code';
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

const CODEX_ACCOUNT_OWNER = 'openai-codex#account:0123456789abcdef';

function makeKimiCodeAuth(): jest.Mocked<
  Pick<IKimiCodeAuthService, 'startWatching' | 'ensureFresh'>
> {
  return {
    startWatching: jest.fn(),
    ensureFresh: jest.fn(async () => true),
  };
}

function makePool(
  codexAuth: ICodexAuthService = {} as unknown as ICodexAuthService,
  kimiCodeAuth: Partial<IKimiCodeAuthService> = makeKimiCodeAuth(),
): Harness {
  const logger = createMockLogger();
  const config = createMockConfigManager();
  const configManager = config as unknown as ConfigManager;
  const authSecrets = {
    getProviderKey: jest.fn<Promise<string | undefined>, [string]>(),
  };
  const copilotAuth = {} as unknown as ICopilotAuthService;
  const openRouterAuth = {} as unknown as IOpenRouterAuthService;
  const codexOwnerKeys: ICodexOwnerKeySource = {
    currentOwnerKey: () => CODEX_ACCOUNT_OWNER,
  };

  const pool = new ProviderProxyPool(
    asLogger(logger),
    configManager,
    authSecrets as unknown as IAuthSecretsService,
    copilotAuth,
    codexAuth,
    openRouterAuth,
    codexOwnerKeys,
    kimiCodeAuth as IKimiCodeAuthService,
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

  it('serves kimi-code through one shared Kimi proxy and readies the CLI login', async () => {
    const kimiCodeAuth = makeKimiCodeAuth();
    const kimiHarness = makePool(undefined, kimiCodeAuth);
    const kimi = getAnthropicProvider('kimi-code');
    if (!kimi) throw new Error('kimi-code provider entry missing');
    try {
      const a = await kimiHarness.pool.acquire('/ws/a', 'kimi-code', kimi);
      const b = await kimiHarness.pool.acquire('/ws/b', 'kimi-code', kimi);
      expect(a?.authToken).toBe(KIMI_CODE_PROXY_TOKEN_PLACEHOLDER);
      expect(a?.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(b).toEqual(a);
      expect(kimiCodeAuth.startWatching).toHaveBeenCalled();
      expect(kimiCodeAuth.ensureFresh).toHaveBeenCalled();
      // The credential is dynamic: no stored key is read to key the pool.
      expect(kimiHarness.authSecrets.getProviderKey).not.toHaveBeenCalled();
    } finally {
      await kimiHarness.pool.disposeAll();
    }
  });

  it('(a) two workspaces on the same provider configuration share one started proxy', async () => {
    const lm = lmStudioProvider();

    const a = await harness.pool.acquire('/ws/a', 'lm-studio', lm);
    const b = await harness.pool.acquire('/ws/b', 'lm-studio', lm);

    expect(a).toBeDefined();
    expect(a?.authToken).toBe('local-proxy-managed');
    expect(b).toEqual(a);

    const instances = fakeInstances();
    expect(instances).toHaveLength(1);
    expect(instances[0].isRunning()).toBe(true);
  });

  it('(a) concurrent acquires for one configuration start a single proxy', async () => {
    const lm = lmStudioProvider();

    const [a, b] = await Promise.all([
      harness.pool.acquire('/ws/a', 'lm-studio', lm),
      harness.pool.acquire('/ws/b', 'lm-studio', lm),
    ]);

    expect(fakeInstances()).toHaveLength(1);
    expect(b).toEqual(a);
  });

  it('(b) same workspace+provider reuses one running instance', async () => {
    const lm = lmStudioProvider();

    const first = await harness.pool.acquire('/ws/a', 'lm-studio', lm);
    const second = await harness.pool.acquire('/ws/a', 'lm-studio', lm);

    expect(fakeInstances()).toHaveLength(1);
    expect(first?.baseUrl).toBe(second?.baseUrl);
  });

  it('(c) disposeForScope keeps a shared proxy while another workspace is bound, stops it with the last', async () => {
    const lm = lmStudioProvider();

    await harness.pool.acquire('/ws/a', 'lm-studio', lm);
    const b = await harness.pool.acquire('/ws/b', 'lm-studio', lm);

    const [shared] = fakeInstances();
    expect(shared.isRunning()).toBe(true);

    await harness.pool.disposeForScope('/ws/a');
    expect(shared.isRunning()).toBe(true);

    // /ws/b still reuses the live proxy (no new instance created).
    const bAgain = await harness.pool.acquire('/ws/b', 'lm-studio', lm);
    expect(fakeInstances()).toHaveLength(1);
    expect(bAgain?.baseUrl).toBe(b?.baseUrl);

    await harness.pool.disposeForScope('/ws/b');
    expect(shared.isRunning()).toBe(false);
  });

  describe('disposal racing an in-flight start', () => {
    type LmStudioProxy = InstanceType<
      typeof localModule.LmStudioTranslationProxy
    >;

    afterEach(() => {
      jest.restoreAllMocks();
    });

    /** Hold the next LM Studio `start()` until the returned release is called. */
    function gateNextStart(): () => void {
      const proto = localModule.LmStudioTranslationProxy.prototype;
      const realStart = proto.start;
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      jest.spyOn(proto, 'start').mockImplementationOnce(async function (
        this: LmStudioProxy,
      ) {
        await gate;
        return realStart.call(this);
      });
      return () => release();
    }

    /** Let the acquire run until it is parked on the gated start. */
    async function untilStartIsPending(): Promise<void> {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(fakeInstances()).toHaveLength(1);
      expect(fakeInstances()[0].isRunning()).toBe(false);
    }

    it('disposeForScope during the start stops the proxy and binds nothing', async () => {
      const release = gateNextStart();
      const pending = harness.pool.acquire(
        '/ws/a',
        'lm-studio',
        lmStudioProvider(),
      );
      await untilStartIsPending();

      await harness.pool.disposeForScope('/ws/a');
      release();

      expect(await pending).toBeUndefined();
      expect(fakeInstances()[0].isRunning()).toBe(false);
    });

    it('disposeAll during the start stops the proxy and binds nothing', async () => {
      const release = gateNextStart();
      const pending = harness.pool.acquire(
        '/ws/a',
        'lm-studio',
        lmStudioProvider(),
      );
      await untilStartIsPending();

      await harness.pool.disposeAll();
      release();

      expect(await pending).toBeUndefined();
      expect(fakeInstances()[0].isRunning()).toBe(false);
    });

    it('a workspace re-acquires normally after a dispose that raced its start', async () => {
      const lm = lmStudioProvider();
      const release = gateNextStart();
      const pending = harness.pool.acquire('/ws/a', 'lm-studio', lm);
      await untilStartIsPending();
      await harness.pool.disposeForScope('/ws/a');
      release();
      await pending;

      const reopened = await harness.pool.acquire('/ws/a', 'lm-studio', lm);

      expect(fakeInstances()).toHaveLength(2);
      expect(reopened?.baseUrl).toBe(fakeInstances()[1].url);
      expect(fakeInstances()[1].isRunning()).toBe(true);
    });

    it('a workspace sharing the start keeps a running proxy when the other is disposed', async () => {
      const lm = lmStudioProvider();
      const release = gateNextStart();
      const pendingA = harness.pool.acquire('/ws/a', 'lm-studio', lm);
      const pendingB = harness.pool.acquire('/ws/b', 'lm-studio', lm);
      await untilStartIsPending();

      await harness.pool.disposeForScope('/ws/a');
      release();
      const [a, b] = await Promise.all([pendingA, pendingB]);

      expect(a).toBeUndefined();
      const servingB = fakeInstances().find((p) => p.url === b?.baseUrl);
      expect(servingB?.isRunning()).toBe(true);
    });

    it('a failed start stops the half-started proxy', async () => {
      const proto = localModule.LmStudioTranslationProxy.prototype;
      jest.spyOn(proto, 'start').mockRejectedValueOnce(new Error('EADDRINUSE'));
      const stop = jest.spyOn(proto, 'stop');

      const result = await harness.pool.acquire(
        '/ws/a',
        'lm-studio',
        lmStudioProvider(),
      );

      expect(result).toBeUndefined();
      expect(stop).toHaveBeenCalledTimes(1);
    });
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

    it('(f) two workspaces on the same entry share one proxy', async () => {
      const provider = customProvider(OPENAI_LANE_ID);

      const a = await harness.pool.acquire('/ws/a', OPENAI_LANE_ID, provider);
      const b = await harness.pool.acquire('/ws/b', OPENAI_LANE_ID, provider);

      expect(createdCustomProxies()).toHaveLength(1);
      expect(b?.baseUrl).toBe(a?.baseUrl);

      // ...and re-acquiring reuses the live instance rather than leaking one.
      const aAgain = await harness.pool.acquire(
        '/ws/a',
        OPENAI_LANE_ID,
        provider,
      );
      expect(createdCustomProxies()).toHaveLength(1);
      expect(aAgain?.baseUrl).toBe(a?.baseUrl);
    });

    it('(h) a re-pointed entry keeps the old proxy until every workspace holding it is disposed', async () => {
      const provider = customProvider(OPENAI_LANE_ID);
      const a = await harness.pool.acquire('/ws/a', OPENAI_LANE_ID, provider);
      await harness.pool.acquire('/ws/b', OPENAI_LANE_ID, provider);
      const oldProxy = createdCustomProxies()[0].proxy;

      harness.config.__seed({
        [`provider.${OPENAI_LANE_ID}.baseUrl`]: 'https://moved.example.com',
      });

      const aMoved = await harness.pool.acquire(
        '/ws/a',
        OPENAI_LANE_ID,
        provider,
      );
      expect(aMoved?.baseUrl).not.toBe(a?.baseUrl);
      // /ws/b is still bound to the old configuration.
      expect(oldProxy.isRunning()).toBe(true);

      const bMoved = await harness.pool.acquire(
        '/ws/b',
        OPENAI_LANE_ID,
        provider,
      );
      expect(bMoved).toEqual(aMoved);
      expect(createdCustomProxies()).toHaveLength(2);
      // Both workspaces moved off it, but each keeps it as its retired
      // generation — a session may still stream through it.
      expect(oldProxy.isRunning()).toBe(true);

      await harness.pool.disposeForScope('/ws/a');
      expect(oldProxy.isRunning()).toBe(true);
      await harness.pool.disposeForScope('/ws/b');
      expect(oldProxy.isRunning()).toBe(false);
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
      // Retired, not stopped: a session may still stream through the old host.
      expect(firstProxy.proxy.isRunning()).toBe(true);
    });

    describe('credential rotation', () => {
      const MOVED_ONCE = 'https://moved-once.example.com';
      const MOVED_TWICE = 'https://moved-twice.example.com';

      /** Re-point the fixture entry, i.e. rotate its credential fingerprint. */
      function repoint(baseUrl: string): void {
        harness.config.__seed({
          [`provider.${OPENAI_LANE_ID}.baseUrl`]: baseUrl,
        });
      }

      function acquireGateway(
        workspacePath: string,
      ): ReturnType<ProviderProxyPool['acquire']> {
        return harness.pool.acquire(
          workspacePath,
          OPENAI_LANE_ID,
          customProvider(OPENAI_LANE_ID),
        );
      }

      it('keeps the superseded proxy running until disposeForScope', async () => {
        await acquireGateway('/ws/a');
        const original = createdCustomProxies()[0].proxy;

        repoint(MOVED_ONCE);
        await acquireGateway('/ws/a');
        const current = createdCustomProxies()[1].proxy;
        expect(original.isRunning()).toBe(true);

        await harness.pool.disposeForScope('/ws/a');
        expect(original.isRunning()).toBe(false);
        expect(current.isRunning()).toBe(false);
      });

      it('a second rotation stops the first retired proxy', async () => {
        await acquireGateway('/ws/a');
        repoint(MOVED_ONCE);
        await acquireGateway('/ws/a');
        repoint(MOVED_TWICE);
        await acquireGateway('/ws/a');

        const [first, second, third] = createdCustomProxies().map(
          (c) => c.proxy,
        );
        expect(first.isRunning()).toBe(false);
        expect(second.isRunning()).toBe(true);
        expect(third.isRunning()).toBe(true);
      });

      it('returns undefined when the workspace is disposed while the oldest retired proxy stops', async () => {
        await acquireGateway('/ws/a');
        repoint(MOVED_ONCE);
        await acquireGateway('/ws/a');
        const first = createdCustomProxies()[0].proxy;
        const realStop = first.stop.bind(first);
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        jest.spyOn(first, 'stop').mockImplementationOnce(async () => {
          await gate;
          return realStop();
        });

        repoint(MOVED_TWICE);
        const pending = acquireGateway('/ws/a');
        await new Promise<void>((resolve) => setImmediate(resolve));
        const disposing = harness.pool.disposeForScope('/ws/a');
        release();
        await disposing;

        expect(await pending).toBeUndefined();
        expect(createdCustomProxies()[2].proxy.isRunning()).toBe(false);
      });

      it('never hands a retired proxy to a new acquire', async () => {
        const original = await acquireGateway('/ws/a');
        repoint(MOVED_ONCE);
        await acquireGateway('/ws/a');

        // Back to the original fingerprint: the retired entry matches it, but
        // a new acquire must get a fresh proxy.
        repoint(OPENAI_LANE_BASE_URL);
        const b = await acquireGateway('/ws/b');

        const created = createdCustomProxies();
        expect(created).toHaveLength(3);
        expect(b?.baseUrl).toBe(created[2].proxy.url);
        expect(b?.baseUrl).not.toBe(original?.baseUrl);

        // Releasing /ws/a stops its bound and retired proxies, not /ws/b's
        // newer one that shares the retired entry's pool key.
        await harness.pool.disposeForScope('/ws/a');
        expect(created[0].proxy.isRunning()).toBe(false);
        expect(created[1].proxy.isRunning()).toBe(false);
        expect(created[2].proxy.isRunning()).toBe(true);
      });
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

describe('ProviderProxyPool OpenCode isolation', () => {
  it('shares a product across workspaces, isolates products, and replaces only rotated credentials', async () => {
    const { pool, authSecrets } = makePool();
    let zenKey = 'zen-first';
    authSecrets.getProviderKey.mockImplementation(async (id: string) =>
      id === 'opencode-zen' ? zenKey : 'go-first',
    );
    const zen = customProvider('opencode-zen');
    const go = customProvider('opencode-go');
    try {
      const a = await pool.acquire('/a', zen.id, zen);
      const b = await pool.acquire('/b', zen.id, zen);
      const g = await pool.acquire('/a', go.id, go);
      expect(a?.authToken).toBe('opencode-proxy-token');
      expect(b).toEqual(a);
      expect(g?.baseUrl).not.toBe(a?.baseUrl);
      expect(await pool.acquire('/a', zen.id, zen)).toEqual(a);
      zenKey = 'zen-rotated';
      const rotated = await pool.acquire('/a', zen.id, zen);
      expect(rotated?.baseUrl).not.toBe(a?.baseUrl);
      expect(await pool.acquire('/a', go.id, go)).toEqual(g);
      expect(authSecrets.getProviderKey).toHaveBeenCalledWith('opencode-zen');
      expect(authSecrets.getProviderKey).toHaveBeenCalledWith('opencode-go');
      await pool.disposeForScope('/a');
      // Scope disposal keeps the other workspace alive. Restore its key so
      // the acquire checks reuse rather than requesting a credential rotation.
      zenKey = 'zen-first';
      expect(await pool.acquire('/b', zen.id, zen)).toEqual(b);
    } finally {
      await pool.disposeAll();
    }
  });

  it.each(['opencode-zen', 'opencode-go'] as const)(
    '%s missing key declines to documented global auth without borrowing the other key',
    async (id) => {
      const { pool, authSecrets } = makePool();
      authSecrets.getProviderKey.mockImplementation(
        async (requested: string) => (requested === id ? '  ' : 'other-key'),
      );
      expect(
        await pool.acquire('/workspace', id, customProvider(id)),
      ).toBeUndefined();
      expect(authSecrets.getProviderKey).toHaveBeenCalledTimes(1);
      expect(authSecrets.getProviderKey).toHaveBeenCalledWith(id);
      await pool.disposeAll();
    },
  );
});

describe('ProviderProxyPool Codex quota owner (TASK_2026_596 Task 7.2)', () => {
  let upstream: http.Server;
  let origin: string;
  let rateLimits: ProviderQuotaObservation[];
  let stopObserving: () => void;

  beforeEach(async () => {
    providerQuotaStore.clear();
    rateLimits = [];
    stopObserving = providerQuotaStore.onRateLimit((o) => rateLimits.push(o));
    upstream = http.createServer((_req, res) => {
      res.writeHead(429);
      res.end('{}');
    });
    await new Promise<void>((resolve) =>
      upstream.listen(0, '127.0.0.1', resolve),
    );
    const address = upstream.address();
    if (!address || typeof address === 'string') throw new Error('no address');
    origin = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    stopObserving();
    providerQuotaStore.clear();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });

  /** The OAuth bearer rotates, so it must never become the owner. */
  function codexAuth(): ICodexAuthService {
    return {
      getAccountUsageEligibility: async () => 'supported',
      getApiEndpoint: () => origin,
      getHeaders: async () => ({
        authorization: 'Bearer rotating-oauth-token',
        'content-type': 'application/json',
      }),
      ensureTokensFresh: async () => false,
      isAuthenticated: async () => true,
      listModels: async () => [],
      clearCache: () => undefined,
      getTokenStatus: async () => ({ authenticated: true, stale: false }),
      startWatchingAuthFile: () => undefined,
      stopWatchingAuthFile: () => undefined,
    };
  }

  function postMessage(baseUrl: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const req = http.request(
        `${baseUrl}/v1/messages?beta=true`,
        { method: 'POST' },
        (res) => {
          res.resume();
          res.on('end', () => resolve());
          res.on('error', reject);
        },
      );
      req.on('error', reject);
      req.end(
        JSON.stringify({
          model: 'gpt-test',
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 50,
          stream: false,
        }),
      );
    });
  }

  it('a pool-built Codex proxy records a 429 against the injected account owner', async () => {
    const codex = getAnthropicProvider('openai-codex');
    if (!codex) throw new Error('openai-codex provider entry missing');
    expect(codex.requiresProxy).toBe(true);

    const { pool } = makePool(codexAuth());
    try {
      const acquired = await pool.acquire('/ws/codex', 'openai-codex', codex);
      if (!acquired) throw new Error('pool declined the Codex proxy');
      await postMessage(acquired.baseUrl);
    } finally {
      await pool.disposeAll();
    }

    expect(rateLimits).toHaveLength(1);
    expect(rateLimits[0]).toMatchObject({
      providerId: 'openai-codex',
      ownerKey: CODEX_ACCOUNT_OWNER,
    });
  });
});
