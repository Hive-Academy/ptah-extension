/**
 * LocalProxyStrategy — unit specs.
 *
 * Handles LM Studio, which speaks OpenAI protocol and requires a translation
 * proxy. Tests cover:
 *   - Happy path: proxy not running → start, set env vars, register dynamic
 *     model fetcher, switch active provider.
 *   - Already-running proxy: reuse existing URL (no second start).
 *   - Missing URL from a running proxy → restart hint.
 *   - Start failure → "LM Studio is not running" hint (the only auth-required
 *     style negative path the source emits — LM Studio itself has no creds).
 *   - Cross-contamination guard: copilot + codex proxies stopped before start.
 *   - teardown() stops the LM Studio proxy if running.
 *
 * No retry / expiry logic exists in source.
 *
 * Source-under-test:
 *   `libs/backend/agent-sdk/src/lib/auth/strategies/local-proxy.strategy.ts`
 */

import 'reflect-metadata';

import type { Logger, SentryService } from '@ptah-extension/vscode-core';
import type { AuthEnv } from '@ptah-extension/shared';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import { createMockSentryService } from '@ptah-extension/vscode-core/testing';

import { LocalProxyStrategy } from './local-proxy.strategy';
import type { AuthConfigureContext } from '../auth-strategy.types';
import type { LocalModelTranslationProxy } from '../../local-provider/local-model-translation-proxy';
import type { ICopilotTranslationProxy } from '../../copilot-provider/copilot-provider.types';
import type { ITranslationProxy } from '../../openai-translation';
import type {
  ProviderModelsService,
  DynamicModelFetcher,
} from '../../provider-models.service';
import type { ProviderModelInfo } from '@ptah-extension/shared';
import { LOCAL_PROXY_TOKEN_PLACEHOLDER } from '../../local-provider';

// ---------------------------------------------------------------------------
// Typed mock helpers
// ---------------------------------------------------------------------------

function asLogger(mock: MockLogger): Logger {
  return mock as unknown as Logger;
}

/**
 * The strategy only uses `isRunning`, `getUrl`, `start`, `stop`, `listModels`
 * on the LM Studio proxy. `LocalModelTranslationProxy` is a class extending
 * `TranslationProxyBase` — matching the full class surface would require a
 * large duck-type. Keep the mock scoped to what the strategy actually calls.
 */
interface LmStudioProxySurface {
  isRunning(): boolean;
  getUrl(): string | undefined;
  start(): Promise<{ port: number; url: string }>;
  stop(): Promise<void>;
  listModels(): Promise<ProviderModelInfo[]>;
}

function createMockLmStudioProxy(): jest.Mocked<LmStudioProxySurface> {
  return {
    isRunning: jest.fn<boolean, []>().mockReturnValue(false),
    getUrl: jest.fn<string | undefined, []>().mockReturnValue(undefined),
    start: jest
      .fn<Promise<{ port: number; url: string }>, []>()
      .mockResolvedValue({ port: 0, url: '' }),
    stop: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    listModels: jest
      .fn<Promise<ProviderModelInfo[]>, []>()
      .mockResolvedValue([]),
  };
}

function createMockCopilotProxy(): jest.Mocked<ICopilotTranslationProxy> {
  return {
    start: jest
      .fn<Promise<{ port: number; url: string }>, []>()
      .mockResolvedValue({ port: 0, url: '' }),
    stop: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    isRunning: jest.fn<boolean, []>().mockReturnValue(false),
    getUrl: jest.fn<string | undefined, []>().mockReturnValue(undefined),
  };
}

function createMockTranslationProxy(): jest.Mocked<ITranslationProxy> {
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
  'switchActiveProvider' | 'registerDynamicFetcher'
>;

function createMockProviderModels(): jest.Mocked<ProviderModelsSurface> {
  return {
    switchActiveProvider: jest.fn<void, [string]>(),
    registerDynamicFetcher: jest.fn<void, [string, DynamicModelFetcher]>(),
  };
}

function makeContext(providerId = 'lm-studio'): AuthConfigureContext {
  const authEnv: AuthEnv = {};
  return { providerId, authEnv };
}

interface Harness {
  strategy: LocalProxyStrategy;
  logger: MockLogger;
  lmStudioProxy: jest.Mocked<LmStudioProxySurface>;
  copilotProxy: jest.Mocked<ICopilotTranslationProxy>;
  codexProxy: jest.Mocked<ITranslationProxy>;
  providerModels: jest.Mocked<ProviderModelsSurface>;
}

function makeStrategy(): Harness {
  const logger = createMockLogger();
  const lmStudioProxy = createMockLmStudioProxy();
  const copilotProxy = createMockCopilotProxy();
  const codexProxy = createMockTranslationProxy();
  const providerModels = createMockProviderModels();
  const sentry = createMockSentryService();

  const strategy = new LocalProxyStrategy(
    asLogger(logger),
    lmStudioProxy as unknown as LocalModelTranslationProxy,
    providerModels as unknown as ProviderModelsService,
    copilotProxy,
    codexProxy,
    sentry as unknown as SentryService,
  );

  return {
    strategy,
    logger,
    lmStudioProxy,
    copilotProxy,
    codexProxy,
    providerModels,
  };
}

describe('LocalProxyStrategy', () => {
  afterEach(() => {
    delete process.env['ANTHROPIC_BASE_URL'];
    delete process.env['ANTHROPIC_AUTH_TOKEN'];
    jest.clearAllMocks();
  });

  it('exposes the documented strategy name', () => {
    const { strategy } = makeStrategy();
    expect(strategy.name).toBe('LocalProxyStrategy');
  });

  describe('configure() — happy path', () => {
    it('starts the proxy, sets env vars, registers fetcher, and reports success', async () => {
      const harness = makeStrategy();
      harness.lmStudioProxy.isRunning.mockReturnValue(false);
      harness.lmStudioProxy.start.mockResolvedValueOnce({
        port: 9501,
        url: 'http://127.0.0.1:9501',
      });

      const ctx = makeContext('lm-studio');
      const result = await harness.strategy.configure(ctx);

      expect(harness.lmStudioProxy.start).toHaveBeenCalledTimes(1);
      expect(ctx.authEnv.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:9501');
      expect(ctx.authEnv.ANTHROPIC_AUTH_TOKEN).toBe(
        LOCAL_PROXY_TOKEN_PLACEHOLDER,
      );
      expect(process.env['ANTHROPIC_BASE_URL']).toBe('http://127.0.0.1:9501');

      expect(harness.providerModels.switchActiveProvider).toHaveBeenCalledWith(
        'lm-studio',
      );
      expect(
        harness.providerModels.registerDynamicFetcher,
      ).toHaveBeenCalledTimes(1);
      // The registered fetcher should proxy to listModels.
      const [registeredId, fetcher] =
        harness.providerModels.registerDynamicFetcher.mock.calls[0];
      expect(registeredId).toBe('lm-studio');
      await fetcher();
      expect(harness.lmStudioProxy.listModels).toHaveBeenCalledTimes(1);

      expect(result.configured).toBe(true);
      expect(result.details[0]).toContain('LM Studio');
      expect(result.details[0]).toContain('http://127.0.0.1:9501');
    });

    it('reuses an already-running proxy without calling start() again', async () => {
      const harness = makeStrategy();
      harness.lmStudioProxy.isRunning.mockReturnValue(true);
      harness.lmStudioProxy.getUrl.mockReturnValue('http://127.0.0.1:8080');

      const ctx = makeContext('lm-studio');
      const result = await harness.strategy.configure(ctx);

      expect(harness.lmStudioProxy.start).not.toHaveBeenCalled();
      expect(ctx.authEnv.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:8080');
      expect(result.configured).toBe(true);
    });

    it('stops a running copilot proxy and codex proxy before starting LM Studio', async () => {
      const harness = makeStrategy();
      harness.copilotProxy.isRunning.mockReturnValue(true);
      harness.codexProxy.isRunning.mockReturnValue(true);
      harness.lmStudioProxy.isRunning.mockReturnValue(false);
      harness.lmStudioProxy.start.mockResolvedValueOnce({
        port: 1,
        url: 'http://127.0.0.1:1',
      });

      await harness.strategy.configure(makeContext('lm-studio'));

      expect(harness.copilotProxy.stop).toHaveBeenCalledTimes(1);
      expect(harness.codexProxy.stop).toHaveBeenCalledTimes(1);
    });
  });

  describe('configure() — negative paths', () => {
    it('running proxy with no URL → restart hint', async () => {
      const harness = makeStrategy();
      harness.lmStudioProxy.isRunning.mockReturnValue(true);
      harness.lmStudioProxy.getUrl.mockReturnValue(undefined);

      const result = await harness.strategy.configure(makeContext('lm-studio'));

      expect(result.configured).toBe(false);
      expect(result.errorMessage).toBe(
        'Translation proxy URL unavailable. Try restarting.',
      );
    });

    it('start() throws → "LM Studio is not running" hint', async () => {
      const harness = makeStrategy();
      harness.lmStudioProxy.isRunning.mockReturnValue(false);
      harness.lmStudioProxy.start.mockRejectedValueOnce(
        new Error('ECONNREFUSED'),
      );

      const result = await harness.strategy.configure(makeContext('lm-studio'));

      expect(result.configured).toBe(false);
      expect(result.errorMessage).toBe(
        'LM Studio is not running. Start LM Studio and try again.',
      );
      // No env var mutation on failure.
      expect(process.env['ANTHROPIC_BASE_URL']).toBeUndefined();
    });
  });

  describe('teardown()', () => {
    it('stops the LM Studio proxy when running', async () => {
      const harness = makeStrategy();
      harness.lmStudioProxy.isRunning.mockReturnValue(true);

      await harness.strategy.teardown();

      expect(harness.lmStudioProxy.stop).toHaveBeenCalledTimes(1);
    });

    it('is a no-op when the proxy is not running', async () => {
      const harness = makeStrategy();
      harness.lmStudioProxy.isRunning.mockReturnValue(false);

      await harness.strategy.teardown();

      expect(harness.lmStudioProxy.stop).not.toHaveBeenCalled();
    });
  });
});
