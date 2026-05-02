/**
 * ApiKeyStrategy — unit specs.
 *
 * The API-key strategy multiplexes three flows:
 *   1. Direct Anthropic ('anthropic' / legacy 'apiKey'): read key from
 *      SecretStorage (primary) or the pre-wipe env snapshot (fallback).
 *      Also stops the OpenRouter proxy if it was left running.
 *   2. OpenRouter: start a local translation proxy, point the SDK at its
 *      URL, and leave ANTHROPIC_API_KEY unset.
 *   3. Other Anthropic-compatible providers (Moonshot, Z.AI): read the
 *      per-provider key, set base URL + provider-specific auth env var.
 *
 * Tests cover each path's happy path, each path's "no credentials" negative
 * path, the OpenRouter proxy restart-hint branch, and the OpenRouter proxy
 * start failure. Teardown always stops the OpenRouter proxy if running.
 *
 * No retry / expiry logic exists in source (keys are either present or not).
 *
 * Source-under-test:
 *   `libs/backend/agent-sdk/src/lib/auth/strategies/api-key.strategy.ts`
 */

import 'reflect-metadata';

import type {
  Logger,
  ConfigManager,
  SentryService,
  IAuthSecretsService,
} from '@ptah-extension/vscode-core';
import type { AuthEnv } from '@ptah-extension/shared';
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
import type { ITranslationProxy } from '../../providers/_shared/translation';
import type { ProviderModelsService } from '../../provider-models.service';
import { OPENROUTER_PROXY_TOKEN_PLACEHOLDER } from '../../providers/openrouter';

// ---------------------------------------------------------------------------
// Typed mock helpers
// ---------------------------------------------------------------------------

function asLogger(mock: MockLogger): Logger {
  return mock as unknown as Logger;
}
function asConfig(mock: MockConfigManager): ConfigManager {
  return mock as unknown as ConfigManager;
}

function createMockOpenRouterProxy(): jest.Mocked<ITranslationProxy> {
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
  const openRouterProxy = createMockOpenRouterProxy();
  const sentry = createMockSentryService();
  const authEnv: AuthEnv = {};

  const strategy = new ApiKeyStrategy(
    asLogger(logger),
    asConfig(config),
    authSecrets as unknown as IAuthSecretsService,
    providerModels as unknown as ProviderModelsService,
    authEnv,
    openRouterProxy,
    sentry as unknown as SentryService,
  );

  return {
    strategy,
    logger,
    config,
    authSecrets,
    providerModels,
    openRouterProxy,
    authEnv,
  };
}

describe('ApiKeyStrategy', () => {
  afterEach(() => {
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_BASE_URL'];
    delete process.env['ANTHROPIC_AUTH_TOKEN'];
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

    it('auth-required: no key anywhere → configured=false, no env mutation', async () => {
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

    it('running proxy with no URL → restart hint', async () => {
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

    it('start failure → "check if a local port is available" hint', async () => {
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

    it('auth-required: no OpenRouter key in SecretStorage → configured=false, proxy not started', async () => {
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

    it('auth-required: no provider key in SecretStorage → configured=false', async () => {
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
