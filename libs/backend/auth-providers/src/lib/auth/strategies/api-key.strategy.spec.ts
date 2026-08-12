/**
 * ApiKeyStrategy â€” unit specs.
 *
 * The API-key strategy multiplexes these flows:
 *   1. Direct Anthropic ('anthropic' / legacy 'apiKey'): read key from
 *      SecretStorage (primary) or the pre-wipe env snapshot (fallback).
 *      Also stops the OpenRouter proxy if it was left running.
 *   2. OpenRouter / Sakana: start the DI-singleton translation proxy, point
 *      the SDK at its URL, and leave ANTHROPIC_API_KEY unset.
 *   3. Other Anthropic-compatible providers (Moonshot, Z.AI): read the
 *      per-provider key, set base URL + provider-specific auth env var.
 *   4. User-defined entries, OpenAI lane (requiresProxy: true): build a
 *      CustomOpenAiTranslationProxy for that id at runtime, cache it, and
 *      include it in the mutual-exclusion teardown set.
 *   5. User-defined entries, Anthropic lane (requiresProxy: false): flow 3
 *      unchanged — no proxy, no custom-entry-specific code.
 *
 * Tests cover each path's happy path, each path's "no credentials" negative
 * path, the OpenRouter proxy restart-hint branch, and the OpenRouter proxy
 * start failure. Exactly one apiKey proxy may listen at a time, so every
 * switch-away case asserts the previous proxy was stopped. Teardown stops
 * whichever proxies are running.
 *
 * No retry / expiry logic exists in source (keys are either present or not).
 *
 * Source-under-test:
 *   `libs/backend/auth-providers/src/lib/auth/strategies/api-key.strategy.ts`
 */

import 'reflect-metadata';

import type {
  Logger,
  ConfigManager,
  SentryService,
  IAuthSecretsService,
} from '@ptah-extension/vscode-core';
import type {
  AuthEnv,
  AnthropicProvider,
  CustomProviderEntry,
} from '@ptah-extension/shared';
import {
  setCustomProviderEntries,
  clearCustomProviderEntries,
} from '@ptah-extension/shared';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import {
  createMockConfigManager,
  createMockAuthSecretsService,
  createMockSentryService,
  type MockConfigManager,
  type MockAuthSecretsService,
} from '@ptah-extension/vscode-core/testing';

import { ApiKeyStrategy } from './api-key.strategy';
import type { AuthConfigureContext } from '../auth-strategy.types';
import type { ITranslationProxy } from '../../translation';
import type { ProviderModelsService } from '../../provider-models.service';
import { OPENROUTER_PROXY_TOKEN_PLACEHOLDER } from '../../providers/openrouter';
import { SAKANA_PROXY_TOKEN_PLACEHOLDER } from '../../providers/sakana';
import { CUSTOM_PROXY_TOKEN_PLACEHOLDER } from '../../providers/custom';

// ---------------------------------------------------------------------------
// User-defined provider entries
//
// These go through the REAL registry merge (`setCustomProviderEntries`), not a
// module mock, so these tests exercise the actual lane -> requiresProxy
// projection the strategy branches on rather than a hand-built stand-in.
// ---------------------------------------------------------------------------

/** Entries registered so far in the current test; re-set on every addition. */
const definedCustomEntries: CustomProviderEntry[] = [];

/** Register a user-defined entry for the duration of a test. */
function defineCustomProvider(
  entry: Omit<CustomProviderEntry, 'authEnvVar' | 'keyPrefix' | 'helpUrl'> &
    Partial<Pick<CustomProviderEntry, 'authEnvVar' | 'keyPrefix' | 'helpUrl'>>,
): void {
  definedCustomEntries.push({
    authEnvVar: 'ANTHROPIC_AUTH_TOKEN',
    keyPrefix: '',
    helpUrl: '',
    ...entry,
  });
  const { rejected } = setCustomProviderEntries(definedCustomEntries);
  if (rejected.length > 0) {
    throw new Error(
      `Test fixture rejected by the registry: ${rejected
        .map((r) => `${r.id} (${r.reason})`)
        .join(', ')}`,
    );
  }
}

/**
 * Stand-in for `createCustomOpenAiProxy`. The real factory is covered by
 * custom-openai-translation-proxy.spec.ts; here we only care that the strategy
 * builds ONE proxy per custom id, with the right base URL, and manages its
 * lifecycle — so we hand back a mock proxy instead of binding a real socket.
 */
const mockCreatedCustomProxies: Array<{
  providerId: string;
  baseUrl: string;
  proxy: jest.Mocked<ITranslationProxy>;
}> = [];

const mockCustomProxyFactory = jest.fn<
  jest.Mocked<ITranslationProxy>,
  [{ provider: AnthropicProvider; baseUrl: string }]
>();

jest.mock('../../providers/custom', () => {
  const actual = jest.requireActual<typeof import('../../providers/custom')>(
    '../../providers/custom',
  );
  return {
    ...actual,
    createCustomOpenAiProxy: (params: {
      provider: AnthropicProvider;
      baseUrl: string;
    }) => mockCustomProxyFactory(params),
  };
});

/** The mock proxy the strategy built for a custom id (fails loudly if none). */
function customProxyFor(providerId: string): jest.Mocked<ITranslationProxy> {
  const created = mockCreatedCustomProxies.filter(
    (p) => p.providerId === providerId,
  );
  if (created.length === 0) {
    throw new Error(`No custom proxy was created for "${providerId}"`);
  }
  return created[created.length - 1].proxy;
}

// ---------------------------------------------------------------------------
// Typed mock helpers
// ---------------------------------------------------------------------------

function asLogger(mock: MockLogger): Logger {
  return mock as unknown as Logger;
}
function asConfig(mock: MockConfigManager): ConfigManager {
  return mock as unknown as ConfigManager;
}

function createMockProxy(): jest.Mocked<ITranslationProxy> {
  return {
    start: jest
      .fn<Promise<{ port: number; url: string }>, []>()
      .mockResolvedValue({ port: 0, url: '' }),
    stop: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    isRunning: jest.fn<boolean, []>().mockReturnValue(false),
    getUrl: jest.fn<string | undefined, []>().mockReturnValue(undefined),
  };
}

type ProviderModelsSurface = Pick<
  ProviderModelsService,
  'switchActiveProvider' | 'clearAllTierEnvVars'
>;

function createMockProviderModels(): jest.Mocked<ProviderModelsSurface> {
  return {
    switchActiveProvider: jest.fn<void, [string]>(),
    clearAllTierEnvVars: jest.fn<void, []>(),
  };
}

function makeContext(
  providerId: string,
  authEnv: AuthEnv = {},
  envSnapshot?: {
    ANTHROPIC_API_KEY?: string;
    ANTHROPIC_AUTH_TOKEN?: string;
    ANTHROPIC_BASE_URL?: string;
  },
): AuthConfigureContext {
  return { providerId, authEnv, envSnapshot };
}

interface Harness {
  strategy: ApiKeyStrategy;
  logger: MockLogger;
  config: MockConfigManager;
  authSecrets: MockAuthSecretsService;
  providerModels: jest.Mocked<ProviderModelsSurface>;
  openRouterProxy: jest.Mocked<ITranslationProxy>;
  sakanaProxy: jest.Mocked<ITranslationProxy>;
  authEnv: AuthEnv;
}

function makeStrategy(
  options: {
    config?: Record<string, unknown>;
    credentials?: { apiKey?: string };
    providerKeys?: Record<string, string>;
  } = {},
): Harness {
  const logger = createMockLogger();
  const config = createMockConfigManager({ values: options.config });
  const authSecrets = createMockAuthSecretsService({
    credentials: options.credentials,
    providerKeys: options.providerKeys,
  });
  const providerModels = createMockProviderModels();
  const openRouterProxy = createMockProxy();
  const sakanaProxy = createMockProxy();
  const sentry = createMockSentryService();
  const authEnv: AuthEnv = {};

  const strategy = new ApiKeyStrategy(
    asLogger(logger),
    asConfig(config),
    authSecrets as unknown as IAuthSecretsService,
    providerModels as unknown as ProviderModelsService,
    authEnv,
    openRouterProxy,
    sakanaProxy,
    sentry as unknown as SentryService,
  );

  return {
    strategy,
    logger,
    config,
    authSecrets,
    providerModels,
    openRouterProxy,
    sakanaProxy,
    authEnv,
  };
}

describe('ApiKeyStrategy', () => {
  beforeEach(() => {
    // mockReset (not clear) so a queued mockImplementationOnce can never leak
    // from a test that did not consume it into the next one.
    mockCustomProxyFactory.mockReset();
    mockCustomProxyFactory.mockImplementation(({ provider, baseUrl }) => {
      const proxy = createMockProxy();
      mockCreatedCustomProxies.push({
        providerId: provider.id,
        baseUrl,
        proxy,
      });
      return proxy;
    });
  });

  afterEach(() => {
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_BASE_URL'];
    delete process.env['ANTHROPIC_AUTH_TOKEN'];
    definedCustomEntries.length = 0;
    clearCustomProviderEntries();
    mockCreatedCustomProxies.length = 0;
    jest.clearAllMocks();
  });

  it('exposes the documented strategy name', () => {
    const { strategy } = makeStrategy();
    expect(strategy.name).toBe('ApiKeyStrategy');
  });

  // -------------------------------------------------------------------------
  // Direct Anthropic flow
  // -------------------------------------------------------------------------

  describe('direct Anthropic flow (providerId = "anthropic")', () => {
    it('happy path: reads API key from SecretStorage, sets env, clears tier vars', async () => {
      const harness = makeStrategy({
        credentials: { apiKey: 'sk-ant-api03-valid-key-xyz' },
      });
      const ctx = makeContext('anthropic');

      const result = await harness.strategy.configure(ctx);

      expect(ctx.authEnv.ANTHROPIC_API_KEY).toBe('sk-ant-api03-valid-key-xyz');
      expect(process.env['ANTHROPIC_API_KEY']).toBe(
        'sk-ant-api03-valid-key-xyz',
      );
      expect(ctx.authEnv.ANTHROPIC_BASE_URL).toBeUndefined();
      // Direct Anthropic path clears tier env vars (native SDK tier logic).
      expect(harness.providerModels.clearAllTierEnvVars).toHaveBeenCalledTimes(
        1,
      );
      expect(result.configured).toBe(true);
      expect(result.details[0]).toContain('format valid');
    });

    it('falls back to the env snapshot when SecretStorage is empty', async () => {
      const harness = makeStrategy({ credentials: {} });
      const ctx = makeContext(
        'anthropic',
        {},
        {
          ANTHROPIC_API_KEY: 'sk-ant-api-from-env',
        },
      );

      const result = await harness.strategy.configure(ctx);

      expect(ctx.authEnv.ANTHROPIC_API_KEY).toBe('sk-ant-api-from-env');
      expect(process.env['ANTHROPIC_API_KEY']).toBe('sk-ant-api-from-env');
      expect(result.configured).toBe(true);
      expect(result.details[0]).toContain('API key from environment');
    });

    it('auth-required: no key anywhere â†’ configured=false, no env mutation', async () => {
      const harness = makeStrategy({ credentials: {} });
      const ctx = makeContext('anthropic');

      const result = await harness.strategy.configure(ctx);

      expect(result.configured).toBe(false);
      expect(result.details).toEqual([]);
      expect(ctx.authEnv.ANTHROPIC_API_KEY).toBeUndefined();
      expect(process.env['ANTHROPIC_API_KEY']).toBeUndefined();
      expect(harness.providerModels.clearAllTierEnvVars).not.toHaveBeenCalled();
    });

    it('warns when the API key is present but missing the sk-ant-api prefix', async () => {
      const harness = makeStrategy({
        credentials: { apiKey: 'not-a-valid-prefix-abc' },
      });

      const result = await harness.strategy.configure(makeContext('anthropic'));

      expect(result.configured).toBe(true);
      expect(result.details[0]).toContain('format INVALID');
      expect(harness.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('sk-ant-api'),
      );
    });

    it('stops the OpenRouter proxy when switching to direct Anthropic', async () => {
      const harness = makeStrategy({
        credentials: { apiKey: 'sk-ant-api03-abc' },
      });
      harness.openRouterProxy.isRunning.mockReturnValue(true);

      await harness.strategy.configure(makeContext('anthropic'));

      expect(harness.openRouterProxy.stop).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // OpenRouter flow
  // -------------------------------------------------------------------------

  describe('OpenRouter flow (providerId = "openrouter")', () => {
    it('happy path: starts the proxy, points SDK at proxy URL, leaves API_KEY blank', async () => {
      const harness = makeStrategy({
        providerKeys: { openrouter: 'sk-or-v1-valid' },
      });
      harness.openRouterProxy.isRunning.mockReturnValue(false);
      harness.openRouterProxy.start.mockResolvedValueOnce({
        port: 9400,
        url: 'http://127.0.0.1:9400',
      });

      const ctx = makeContext('openrouter');
      const result = await harness.strategy.configure(ctx);

      expect(harness.openRouterProxy.start).toHaveBeenCalledTimes(1);
      expect(ctx.authEnv.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:9400');
      expect(ctx.authEnv.ANTHROPIC_AUTH_TOKEN).toBe(
        OPENROUTER_PROXY_TOKEN_PLACEHOLDER,
      );
      // Critical: direct API_KEY must be blanked so it doesn't leak past proxy.
      expect(ctx.authEnv.ANTHROPIC_API_KEY).toBe('');
      expect(process.env['ANTHROPIC_API_KEY']).toBeUndefined();

      expect(harness.providerModels.switchActiveProvider).toHaveBeenCalledWith(
        'openrouter',
      );
      expect(result.configured).toBe(true);
      expect(result.details[0]).toContain('OpenRouter API key');
    });

    it('reuses a running proxy without calling start() again', async () => {
      const harness = makeStrategy({
        providerKeys: { openrouter: 'sk-or-v1-running' },
      });
      harness.openRouterProxy.isRunning.mockReturnValue(true);
      harness.openRouterProxy.getUrl.mockReturnValue('http://127.0.0.1:9500');

      const ctx = makeContext('openrouter');
      const result = await harness.strategy.configure(ctx);

      expect(harness.openRouterProxy.start).not.toHaveBeenCalled();
      expect(ctx.authEnv.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:9500');
      expect(result.configured).toBe(true);
    });

    it('running proxy with no URL â†’ restart hint', async () => {
      const harness = makeStrategy({
        providerKeys: { openrouter: 'sk-or-v1-abc' },
      });
      harness.openRouterProxy.isRunning.mockReturnValue(true);
      harness.openRouterProxy.getUrl.mockReturnValue(undefined);

      const result = await harness.strategy.configure(
        makeContext('openrouter'),
      );

      expect(result.configured).toBe(false);
      expect(result.errorMessage).toContain('Try restarting');
    });

    it('start failure â†’ "check if a local port is available" hint', async () => {
      const harness = makeStrategy({
        providerKeys: { openrouter: 'sk-or-v1-abc' },
      });
      harness.openRouterProxy.isRunning.mockReturnValue(false);
      harness.openRouterProxy.start.mockRejectedValueOnce(
        new Error('EADDRINUSE'),
      );

      const result = await harness.strategy.configure(
        makeContext('openrouter'),
      );

      expect(result.configured).toBe(false);
      expect(result.errorMessage).toContain('local port is available');
    });

    it('auth-required: no OpenRouter key in SecretStorage â†’ configured=false, proxy not started', async () => {
      const harness = makeStrategy({ providerKeys: {} });

      const result = await harness.strategy.configure(
        makeContext('openrouter'),
      );

      expect(result.configured).toBe(false);
      expect(result.details).toEqual([]);
      expect(harness.openRouterProxy.start).not.toHaveBeenCalled();
    });

    it('warns when the OpenRouter key lacks the sk-or- prefix', async () => {
      const harness = makeStrategy({
        providerKeys: { openrouter: 'totally-wrong-prefix' },
      });
      harness.openRouterProxy.isRunning.mockReturnValue(false);
      harness.openRouterProxy.start.mockResolvedValueOnce({
        port: 1,
        url: 'http://127.0.0.1:1',
      });

      const result = await harness.strategy.configure(
        makeContext('openrouter'),
      );

      expect(result.configured).toBe(true);
      expect(result.details[0]).toContain('format may be invalid');
      expect(harness.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('sk-or-'),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Sakana flow (apiKey + requiresProxy) — the generalized proxy path
  // -------------------------------------------------------------------------

  describe('Sakana flow (providerId = "sakana", apiKey + requiresProxy)', () => {
    it('happy path: starts the Sakana proxy, points SDK at proxy URL, uses the Sakana placeholder', async () => {
      const harness = makeStrategy({
        providerKeys: { sakana: 'sakana-key-valid' },
      });
      harness.sakanaProxy.isRunning.mockReturnValue(false);
      harness.sakanaProxy.start.mockResolvedValueOnce({
        port: 9600,
        url: 'http://127.0.0.1:9600',
      });

      const ctx = makeContext('sakana');
      const result = await harness.strategy.configure(ctx);

      expect(harness.sakanaProxy.start).toHaveBeenCalledTimes(1);
      // The OpenRouter proxy must NOT be touched for a Sakana configure.
      expect(harness.openRouterProxy.start).not.toHaveBeenCalled();
      expect(ctx.authEnv.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:9600');
      expect(ctx.authEnv.ANTHROPIC_AUTH_TOKEN).toBe(
        SAKANA_PROXY_TOKEN_PLACEHOLDER,
      );
      expect(ctx.authEnv.ANTHROPIC_API_KEY).toBe('');
      expect(process.env['ANTHROPIC_API_KEY']).toBeUndefined();
      expect(harness.providerModels.switchActiveProvider).toHaveBeenCalledWith(
        'sakana',
      );
      expect(result.configured).toBe(true);
      expect(result.details[0]).toContain('Sakana');
    });

    it('auth-required: no Sakana key in SecretStorage → configured=false, proxy not started', async () => {
      const harness = makeStrategy({ providerKeys: {} });

      const result = await harness.strategy.configure(makeContext('sakana'));

      expect(result.configured).toBe(false);
      expect(harness.sakanaProxy.start).not.toHaveBeenCalled();
    });

    it('stops the OpenRouter proxy when switching from OpenRouter to Sakana', async () => {
      const harness = makeStrategy({
        providerKeys: { sakana: 'sakana-key' },
      });
      harness.openRouterProxy.isRunning.mockReturnValue(true);
      harness.sakanaProxy.isRunning.mockReturnValue(false);
      harness.sakanaProxy.start.mockResolvedValueOnce({
        port: 1,
        url: 'http://127.0.0.1:1',
      });

      await harness.strategy.configure(makeContext('sakana'));

      expect(harness.openRouterProxy.stop).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Other Anthropic-compatible provider flow (Moonshot)
  // -------------------------------------------------------------------------

  describe('third-party Anthropic-compatible flow (providerId = "moonshot")', () => {
    it('happy path: sets provider base URL + per-provider auth env var', async () => {
      const harness = makeStrategy({
        providerKeys: { moonshot: 'moonshot-key-xyz' },
      });
      const ctx = makeContext('moonshot');

      const result = await harness.strategy.configure(ctx);

      expect(ctx.authEnv.ANTHROPIC_BASE_URL).toBe(
        'https://api.moonshot.ai/anthropic/',
      );
      // Moonshot's authEnvVar is ANTHROPIC_AUTH_TOKEN per registry.
      expect(ctx.authEnv.ANTHROPIC_AUTH_TOKEN).toBe('moonshot-key-xyz');
      expect(process.env['ANTHROPIC_BASE_URL']).toBe(
        'https://api.moonshot.ai/anthropic/',
      );

      expect(harness.providerModels.switchActiveProvider).toHaveBeenCalledWith(
        'moonshot',
      );
      expect(result.configured).toBe(true);
      expect(result.details[0]).toContain('Moonshot');
    });

    it('auth-required: no provider key in SecretStorage â†’ configured=false', async () => {
      const harness = makeStrategy({ providerKeys: {} });

      const result = await harness.strategy.configure(makeContext('moonshot'));

      expect(result.configured).toBe(false);
      expect(result.details).toEqual([]);
      expect(
        harness.providerModels.switchActiveProvider,
      ).not.toHaveBeenCalled();
    });

    it('stops the OpenRouter proxy when switching to a third-party provider', async () => {
      const harness = makeStrategy({
        providerKeys: { moonshot: 'moonshot-key' },
      });
      harness.openRouterProxy.isRunning.mockReturnValue(true);

      await harness.strategy.configure(makeContext('moonshot'));

      expect(harness.openRouterProxy.stop).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Third-party provider env-var fallback
  //
  // Headless flows (e.g. openclaw bridge) pre-set ANTHROPIC_AUTH_TOKEN +
  // ANTHROPIC_BASE_URL instead of populating SecretStorage. The clean-slate
  // wipe in AuthManager removes these from process.env, but they survive in
  // `envSnapshot`. ApiKeyStrategy must honour the snapshot the same way the
  // direct-Anthropic path does.
  // -------------------------------------------------------------------------

  describe('third-party provider env-var fallback', () => {
    it('falls back to envSnapshot.ANTHROPIC_AUTH_TOKEN when SecretStorage is empty', async () => {
      const harness = makeStrategy({ providerKeys: {} });
      const ctx = makeContext(
        'moonshot',
        {},
        {
          ANTHROPIC_AUTH_TOKEN: 'env-moonshot-token',
        },
      );

      const result = await harness.strategy.configure(ctx);

      expect(result.configured).toBe(true);
      expect(result.details[0]).toContain('API key (from environment)');
      expect(result.details[0]).toContain('Moonshot');
      expect(ctx.authEnv.ANTHROPIC_AUTH_TOKEN).toBe('env-moonshot-token');
      expect(ctx.authEnv.ANTHROPIC_BASE_URL).toBe(
        'https://api.moonshot.ai/anthropic/',
      );
      expect(process.env['ANTHROPIC_AUTH_TOKEN']).toBe('env-moonshot-token');
      expect(process.env['ANTHROPIC_BASE_URL']).toBe(
        'https://api.moonshot.ai/anthropic/',
      );
      expect(harness.providerModels.switchActiveProvider).toHaveBeenCalledWith(
        'moonshot',
      );
    });

    it('falls back to envSnapshot.ANTHROPIC_API_KEY as a last-resort source', async () => {
      // Some headless callers stuff the third-party token into ANTHROPIC_API_KEY
      // even though the provider's authEnvVar is ANTHROPIC_AUTH_TOKEN.
      const harness = makeStrategy({ providerKeys: {} });
      const ctx = makeContext(
        'moonshot',
        {},
        {
          ANTHROPIC_API_KEY: 'misplaced-key',
        },
      );

      const result = await harness.strategy.configure(ctx);

      expect(result.configured).toBe(true);
      // The strategy writes to the provider's canonical authEnvVar
      // (ANTHROPIC_AUTH_TOKEN for Moonshot).
      expect(ctx.authEnv.ANTHROPIC_AUTH_TOKEN).toBe('misplaced-key');
    });

    it('SecretStorage takes precedence over envSnapshot when both present', async () => {
      const harness = makeStrategy({
        providerKeys: { moonshot: 'secret-store-key' },
      });
      const ctx = makeContext(
        'moonshot',
        {},
        {
          ANTHROPIC_AUTH_TOKEN: 'env-token-should-be-ignored',
        },
      );

      const result = await harness.strategy.configure(ctx);

      expect(result.configured).toBe(true);
      expect(ctx.authEnv.ANTHROPIC_AUTH_TOKEN).toBe('secret-store-key');
      expect(result.details[0]).not.toContain('from environment');
    });

    it('still returns configured=false when both SecretStorage AND envSnapshot are empty', async () => {
      const harness = makeStrategy({ providerKeys: {} });
      const ctx = makeContext('moonshot', {}, {});

      const result = await harness.strategy.configure(ctx);

      expect(result.configured).toBe(false);
      expect(result.details).toEqual([]);
      expect(
        harness.providerModels.switchActiveProvider,
      ).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // User-defined entries, OpenAI lane (requiresProxy: true)
  //
  // These get a CustomOpenAiTranslationProxy built per id at runtime, rather
  // than one of the two DI singletons.
  // -------------------------------------------------------------------------

  describe('custom provider, OpenAI lane (requiresProxy: true)', () => {
    const VLLM_ID = 'my-vllm-box';

    function defineVllm(overrides: Partial<CustomProviderEntry> = {}): void {
      defineCustomProvider({
        id: VLLM_ID,
        name: 'My vLLM Box',
        baseUrl: 'http://192.168.1.50:8000',
        lane: 'openai',
        ...overrides,
      });
    }

    it('builds a proxy for the entry id and points the SDK at it', async () => {
      defineVllm();
      const harness = makeStrategy({
        providerKeys: { [VLLM_ID]: 'vllm-key' },
      });

      const ctx = makeContext(VLLM_ID);
      // The proxy is created during configure(); arm start() via the factory.
      mockCustomProxyFactory.mockImplementationOnce(({ provider, baseUrl }) => {
        const proxy = createMockProxy();
        proxy.start.mockResolvedValue({
          port: 9700,
          url: 'http://127.0.0.1:9700',
        });
        mockCreatedCustomProxies.push({
          providerId: provider.id,
          baseUrl,
          proxy,
        });
        return proxy;
      });

      const result = await harness.strategy.configure(ctx);

      expect(mockCustomProxyFactory).toHaveBeenCalledTimes(1);
      expect(mockCustomProxyFactory).toHaveBeenCalledWith(
        expect.objectContaining({ baseUrl: 'http://192.168.1.50:8000' }),
      );
      expect(customProxyFor(VLLM_ID).start).toHaveBeenCalledTimes(1);

      expect(ctx.authEnv.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:9700');
      expect(ctx.authEnv.ANTHROPIC_AUTH_TOKEN).toBe(
        CUSTOM_PROXY_TOKEN_PLACEHOLDER,
      );
      expect(ctx.authEnv.ANTHROPIC_API_KEY).toBe('');
      expect(process.env['ANTHROPIC_API_KEY']).toBeUndefined();

      expect(harness.providerModels.switchActiveProvider).toHaveBeenCalledWith(
        VLLM_ID,
      );
      expect(result.configured).toBe(true);
      expect(result.details[0]).toContain('My vLLM Box');
      // Neither built-in singleton may be touched for a custom provider.
      expect(harness.openRouterProxy.start).not.toHaveBeenCalled();
      expect(harness.sakanaProxy.start).not.toHaveBeenCalled();
    });

    it('reuses the cached instance when the same entry is configured again', async () => {
      defineVllm();
      const harness = makeStrategy({
        providerKeys: { [VLLM_ID]: 'vllm-key' },
      });

      await harness.strategy.configure(makeContext(VLLM_ID));
      customProxyFor(VLLM_ID).isRunning.mockReturnValue(true);
      customProxyFor(VLLM_ID).getUrl.mockReturnValue('http://127.0.0.1:9700');

      const result = await harness.strategy.configure(makeContext(VLLM_ID));

      // One instance per id for the lifetime of the strategy — no leak.
      expect(mockCustomProxyFactory).toHaveBeenCalledTimes(1);
      expect(customProxyFor(VLLM_ID).start).toHaveBeenCalledTimes(1);
      expect(result.configured).toBe(true);
    });

    it('prefers a provider.<id>.baseUrl override over the entry base URL', async () => {
      defineVllm();
      const harness = makeStrategy({
        providerKeys: { [VLLM_ID]: 'vllm-key' },
        config: { [`provider.${VLLM_ID}.baseUrl`]: 'http://10.0.0.9:1234' },
      });

      await harness.strategy.configure(makeContext(VLLM_ID));

      expect(mockCustomProxyFactory).toHaveBeenCalledWith(
        expect.objectContaining({ baseUrl: 'http://10.0.0.9:1234' }),
      );
    });

    it('rebuilds the proxy when the resolved base URL changes', async () => {
      defineVllm();
      const harness = makeStrategy({
        providerKeys: { [VLLM_ID]: 'vllm-key' },
      });

      await harness.strategy.configure(makeContext(VLLM_ID));
      const first = customProxyFor(VLLM_ID);
      first.isRunning.mockReturnValue(true);

      // The user edits the entry (or sets a base-URL override).
      harness.config.__seed({
        [`provider.${VLLM_ID}.baseUrl`]: 'http://10.0.0.9:1234',
      });
      await harness.strategy.configure(makeContext(VLLM_ID));

      expect(mockCustomProxyFactory).toHaveBeenCalledTimes(2);
      // The stale instance must be stopped, never left listening on the old URL.
      expect(first.stop).toHaveBeenCalledTimes(1);
      expect(customProxyFor(VLLM_ID)).not.toBe(first);
      expect(customProxyFor(VLLM_ID).start).toHaveBeenCalledTimes(1);
    });

    it('tears the custom proxy down when switching to another provider', async () => {
      defineVllm();
      const harness = makeStrategy({
        providerKeys: { [VLLM_ID]: 'vllm-key', moonshot: 'moonshot-key' },
      });

      await harness.strategy.configure(makeContext(VLLM_ID));
      const customProxy = customProxyFor(VLLM_ID);
      customProxy.isRunning.mockReturnValue(true);

      await harness.strategy.configure(makeContext('moonshot'));

      expect(customProxy.stop).toHaveBeenCalledTimes(1);
    });

    it('tears the custom proxy down when switching to a built-in proxy provider', async () => {
      defineVllm();
      const harness = makeStrategy({
        providerKeys: { [VLLM_ID]: 'vllm-key', openrouter: 'sk-or-v1-abc' },
      });

      await harness.strategy.configure(makeContext(VLLM_ID));
      const customProxy = customProxyFor(VLLM_ID);
      customProxy.isRunning.mockReturnValue(true);
      harness.openRouterProxy.start.mockResolvedValueOnce({
        port: 9800,
        url: 'http://127.0.0.1:9800',
      });

      await harness.strategy.configure(makeContext('openrouter'));

      expect(customProxy.stop).toHaveBeenCalledTimes(1);
      expect(harness.openRouterProxy.start).toHaveBeenCalledTimes(1);
    });

    it('tears down one custom proxy when switching to a different custom provider', async () => {
      defineVllm();
      defineCustomProvider({
        id: 'my-litellm',
        name: 'My LiteLLM',
        baseUrl: 'https://litellm.example.com',
        lane: 'openai',
      });
      const harness = makeStrategy({
        providerKeys: { [VLLM_ID]: 'vllm-key', 'my-litellm': 'litellm-key' },
      });

      await harness.strategy.configure(makeContext(VLLM_ID));
      const vllmProxy = customProxyFor(VLLM_ID);
      vllmProxy.isRunning.mockReturnValue(true);

      await harness.strategy.configure(makeContext('my-litellm'));

      expect(vllmProxy.stop).toHaveBeenCalledTimes(1);
      expect(customProxyFor('my-litellm').start).toHaveBeenCalledTimes(1);
    });

    it('teardown() stops a running custom proxy', async () => {
      defineVllm();
      const harness = makeStrategy({
        providerKeys: { [VLLM_ID]: 'vllm-key' },
      });

      await harness.strategy.configure(makeContext(VLLM_ID));
      const customProxy = customProxyFor(VLLM_ID);
      customProxy.isRunning.mockReturnValue(true);

      await harness.strategy.teardown();

      expect(customProxy.stop).toHaveBeenCalledTimes(1);
    });

    it('auth-required: no key for the entry → configured=false, proxy not started', async () => {
      defineVllm();
      const harness = makeStrategy({ providerKeys: {} });

      const result = await harness.strategy.configure(makeContext(VLLM_ID));

      expect(result.configured).toBe(false);
      expect(customProxyFor(VLLM_ID).start).not.toHaveBeenCalled();
    });

    it('fails loudly when the proxy cannot be built, never silently downgrading to passthrough', async () => {
      // The entry schema rejects a malformed baseUrl at the registry boundary,
      // so the surviving way to reach an unbuildable proxy is a hand-edited
      // `provider.<id>.baseUrl` override, which bypasses that schema.
      defineVllm();
      const harness = makeStrategy({
        providerKeys: { [VLLM_ID]: 'vllm-key' },
        config: { [`provider.${VLLM_ID}.baseUrl`]: 'not-a-url' },
      });
      mockCustomProxyFactory.mockImplementationOnce(() => {
        throw new Error('Custom provider base URL is not a valid URL');
      });

      const ctx = makeContext(VLLM_ID);
      const result = await harness.strategy.configure(ctx);

      expect(result.configured).toBe(false);
      expect(result.errorMessage).toContain('My vLLM Box');
      // The OpenAI-lane entry must NOT be handed to the Anthropic passthrough.
      expect(ctx.authEnv.ANTHROPIC_BASE_URL).toBeUndefined();
      expect(
        harness.providerModels.switchActiveProvider,
      ).not.toHaveBeenCalled();
    });

    it('does not hijack a built-in proxy provider owned by another strategy', async () => {
      // github-copilot is requiresProxy: true but is configured by
      // OAuthProxyStrategy. ApiKeyStrategy must not build a custom proxy for it.
      const harness = makeStrategy({ providerKeys: {} });

      await harness.strategy.configure(makeContext('github-copilot'));

      expect(mockCustomProxyFactory).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // User-defined entries, Anthropic lane (requiresProxy: false)
  //
  // These need no proxy at all — they ride the same direct-passthrough path as
  // Moonshot/Z.AI, with no code specific to custom entries involved.
  // -------------------------------------------------------------------------

  describe('custom provider, Anthropic lane (requiresProxy: false)', () => {
    const REQUESTY_ID = 'custom-requesty-eu';

    it('takes the passthrough path: entry base URL + entry auth env var, no proxy', async () => {
      defineCustomProvider({
        id: REQUESTY_ID,
        name: 'Requesty (EU)',
        baseUrl: 'https://router.eu.requesty.ai',
        lane: 'anthropic',
      });
      const harness = makeStrategy({
        providerKeys: { [REQUESTY_ID]: 'requesty-key' },
      });

      const ctx = makeContext(REQUESTY_ID);
      const result = await harness.strategy.configure(ctx);

      expect(mockCustomProxyFactory).not.toHaveBeenCalled();
      expect(ctx.authEnv.ANTHROPIC_BASE_URL).toBe(
        'https://router.eu.requesty.ai',
      );
      expect(ctx.authEnv.ANTHROPIC_AUTH_TOKEN).toBe('requesty-key');
      expect(process.env['ANTHROPIC_BASE_URL']).toBe(
        'https://router.eu.requesty.ai',
      );
      expect(harness.providerModels.switchActiveProvider).toHaveBeenCalledWith(
        REQUESTY_ID,
      );
      expect(result.configured).toBe(true);
      expect(result.details[0]).toContain('Requesty (EU)');
    });

    it('honours ANTHROPIC_API_KEY as the entry auth env var', async () => {
      defineCustomProvider({
        id: 'x-api-key-gateway',
        name: 'Header Gateway',
        baseUrl: 'https://gw.example.com',
        lane: 'anthropic',
        authEnvVar: 'ANTHROPIC_API_KEY',
      });
      const harness = makeStrategy({
        providerKeys: { 'x-api-key-gateway': 'gw-key' },
      });

      const ctx = makeContext('x-api-key-gateway');
      await harness.strategy.configure(ctx);

      expect(ctx.authEnv.ANTHROPIC_API_KEY).toBe('gw-key');
      expect(process.env['ANTHROPIC_API_KEY']).toBe('gw-key');
    });

    it('prefers a provider.<id>.baseUrl override over the entry base URL', async () => {
      defineCustomProvider({
        id: REQUESTY_ID,
        name: 'Requesty (EU)',
        baseUrl: 'https://router.eu.requesty.ai',
        lane: 'anthropic',
      });
      const harness = makeStrategy({
        providerKeys: { [REQUESTY_ID]: 'requesty-key' },
        config: {
          [`provider.${REQUESTY_ID}.baseUrl`]: 'https://router.requesty.ai',
        },
      });

      const ctx = makeContext(REQUESTY_ID);
      await harness.strategy.configure(ctx);

      expect(ctx.authEnv.ANTHROPIC_BASE_URL).toBe('https://router.requesty.ai');
    });

    it('stops a running built-in proxy when switching to a custom passthrough entry', async () => {
      defineCustomProvider({
        id: REQUESTY_ID,
        name: 'Requesty (EU)',
        baseUrl: 'https://router.eu.requesty.ai',
        lane: 'anthropic',
      });
      const harness = makeStrategy({
        providerKeys: { [REQUESTY_ID]: 'requesty-key' },
      });
      harness.openRouterProxy.isRunning.mockReturnValue(true);

      await harness.strategy.configure(makeContext(REQUESTY_ID));

      expect(harness.openRouterProxy.stop).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // teardown()
  // -------------------------------------------------------------------------

  describe('teardown()', () => {
    it('stops the OpenRouter proxy when it was left running', async () => {
      const harness = makeStrategy();
      harness.openRouterProxy.isRunning.mockReturnValue(true);

      await harness.strategy.teardown();

      expect(harness.openRouterProxy.stop).toHaveBeenCalledTimes(1);
    });

    it('is a no-op when the OpenRouter proxy is not running', async () => {
      const harness = makeStrategy();
      harness.openRouterProxy.isRunning.mockReturnValue(false);

      await harness.strategy.teardown();

      expect(harness.openRouterProxy.stop).not.toHaveBeenCalled();
    });

    it('swallows stop() errors (best-effort) and logs a warning', async () => {
      const harness = makeStrategy();
      harness.openRouterProxy.isRunning.mockReturnValue(true);
      harness.openRouterProxy.stop.mockRejectedValueOnce(
        new Error('shutdown flaky'),
      );

      await expect(harness.strategy.teardown()).resolves.toBeUndefined();
      expect(harness.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to stop OpenRouter proxy'),
      );
    });
  });
});
