/**
 * LocalNativeStrategy — unit specs.
 *
 * Configures Ollama providers ('ollama' or 'ollama-cloud') which speak the
 * Anthropic Messages API natively (no translation proxy). Key logic under
 * test:
 *   - Version guard: `OllamaModelDiscoveryService.checkVersion()` must return
 *     supported=true for the configure call to succeed. Unsupported version
 *     → configured=false with an upgrade hint (the "auth-required" analogue
 *     in the Ollama world).
 *   - Server unreachable: checkVersion throws → configured=false with a
 *     reachability hint.
 *   - Happy path: env vars set, active provider switched, dynamic model
 *     fetcher registered (local vs cloud variant selected by providerId).
 *   - Ollama Cloud API key branch:
 *       * key present → `cloudMetadata.refresh(key)` is invoked.
 *       * key absent → `cloudMetadata.clearCache()` is invoked.
 *   - Cross-provider guard: copilot / codex / lm-studio proxies stopped
 *     before configuring.
 *   - teardown() clears both caches.
 *
 * No retry / expiry logic exists in source (model listing errors are
 * explicitly non-fatal).
 *
 * Source-under-test:
 *   `libs/backend/agent-sdk/src/lib/auth/strategies/local-native.strategy.ts`
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

import { LocalNativeStrategy } from './local-native.strategy';
import type { AuthConfigureContext } from '../auth-strategy.types';
import type { OllamaModelDiscoveryService } from '../../local-provider/ollama-model-discovery.service';
import type { OllamaCloudMetadataService } from '../../local-provider/ollama-cloud-metadata.service';
import type { ICopilotTranslationProxy } from '../../copilot-provider/copilot-provider.types';
import type { ITranslationProxy } from '../../openai-translation';
import type { LocalModelTranslationProxy } from '../../local-provider/local-model-translation-proxy';
import type {
  ProviderModelsService,
  DynamicModelFetcher,
} from '../../provider-models.service';
import type { ProviderModelInfo } from '@ptah-extension/shared';
import { OLLAMA_AUTH_TOKEN_PLACEHOLDER } from '../../local-provider';

// ---------------------------------------------------------------------------
// Typed mock helpers
// ---------------------------------------------------------------------------

function asLogger(mock: MockLogger): Logger {
  return mock as unknown as Logger;
}
function asConfig(mock: MockConfigManager): ConfigManager {
  return mock as unknown as ConfigManager;
}

type DiscoverySurface = Pick<
  OllamaModelDiscoveryService,
  'checkVersion' | 'listLocalModels' | 'listCloudModels' | 'clearCache'
>;

function createMockDiscovery(): jest.Mocked<DiscoverySurface> {
  return {
    // Signature: (providerId?: string) → default 'ollama'.
    checkVersion: jest
      .fn<Promise<{ version: string; supported: boolean }>, [string?]>()
      .mockResolvedValue({ version: '0.14.0', supported: true }),
    listLocalModels: jest
      .fn<Promise<ProviderModelInfo[]>, []>()
      .mockResolvedValue([]),
    listCloudModels: jest
      .fn<Promise<ProviderModelInfo[]>, []>()
      .mockResolvedValue([]),
    clearCache: jest.fn<void, []>(),
  };
}

type CloudMetadataSurface = Pick<
  OllamaCloudMetadataService,
  'refresh' | 'clearCache'
>;

function createMockCloudMetadata(): jest.Mocked<CloudMetadataSurface> {
  return {
    refresh: jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined),
    clearCache: jest.fn<void, []>(),
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

interface LmStudioProxySurface {
  isRunning(): boolean;
  stop(): Promise<void>;
}
function createMockLmStudioProxy(): jest.Mocked<LmStudioProxySurface> {
  return {
    isRunning: jest.fn<boolean, []>().mockReturnValue(false),
    stop: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
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

function makeContext(providerId: string): AuthConfigureContext {
  const authEnv: AuthEnv = {};
  return { providerId, authEnv };
}

interface Harness {
  strategy: LocalNativeStrategy;
  logger: MockLogger;
  config: MockConfigManager;
  discovery: jest.Mocked<DiscoverySurface>;
  cloudMetadata: jest.Mocked<CloudMetadataSurface>;
  copilotProxy: jest.Mocked<ICopilotTranslationProxy>;
  codexProxy: jest.Mocked<ITranslationProxy>;
  lmStudioProxy: jest.Mocked<LmStudioProxySurface>;
  authSecrets: MockAuthSecretsService;
  providerModels: jest.Mocked<ProviderModelsSurface>;
}

function makeStrategy(
  options: {
    config?: Record<string, unknown>;
    providerKeys?: Record<string, string>;
  } = {},
): Harness {
  const logger = createMockLogger();
  const config = createMockConfigManager({ values: options.config });
  const discovery = createMockDiscovery();
  const cloudMetadata = createMockCloudMetadata();
  const copilotProxy = createMockCopilotProxy();
  const codexProxy = createMockTranslationProxy();
  const lmStudioProxy = createMockLmStudioProxy();
  const authSecrets = createMockAuthSecretsService({
    providerKeys: options.providerKeys,
  });
  const providerModels = createMockProviderModels();
  const sentry = createMockSentryService();

  const strategy = new LocalNativeStrategy(
    asLogger(logger),
    asConfig(config),
    discovery as unknown as OllamaModelDiscoveryService,
    providerModels as unknown as ProviderModelsService,
    copilotProxy,
    codexProxy,
    lmStudioProxy as unknown as LocalModelTranslationProxy,
    cloudMetadata as unknown as OllamaCloudMetadataService,
    authSecrets as unknown as IAuthSecretsService,
    sentry as unknown as SentryService,
  );

  return {
    strategy,
    logger,
    config,
    discovery,
    cloudMetadata,
    copilotProxy,
    codexProxy,
    lmStudioProxy,
    authSecrets,
    providerModels,
  };
}

describe('LocalNativeStrategy', () => {
  afterEach(() => {
    delete process.env['ANTHROPIC_BASE_URL'];
    delete process.env['ANTHROPIC_AUTH_TOKEN'];
    jest.clearAllMocks();
  });

  it('exposes the documented strategy name', () => {
    const { strategy } = makeStrategy();
    expect(strategy.name).toBe('LocalNativeStrategy');
  });

  // -------------------------------------------------------------------------
  // Happy path (local Ollama)
  // -------------------------------------------------------------------------

  describe('configure() — happy path (Ollama)', () => {
    it('sets native Anthropic env vars, switches provider, registers local fetcher', async () => {
      const harness = makeStrategy();
      harness.discovery.checkVersion.mockResolvedValueOnce({
        version: '0.14.5',
        supported: true,
      });

      const ctx = makeContext('ollama');
      const result = await harness.strategy.configure(ctx);

      // Pulls base URL from the registry (no custom override seeded).
      expect(ctx.authEnv.ANTHROPIC_BASE_URL).toBeTruthy();
      expect(ctx.authEnv.ANTHROPIC_AUTH_TOKEN).toBe(
        OLLAMA_AUTH_TOKEN_PLACEHOLDER,
      );
      expect(process.env['ANTHROPIC_AUTH_TOKEN']).toBe(
        OLLAMA_AUTH_TOKEN_PLACEHOLDER,
      );

      expect(harness.providerModels.switchActiveProvider).toHaveBeenCalledWith(
        'ollama',
      );
      const [registeredId, fetcher] =
        harness.providerModels.registerDynamicFetcher.mock.calls[0];
      expect(registeredId).toBe('ollama');
      // During configure() the source also invokes listLocalModels once for
      // the (non-fatal) availability probe. Record the call count there and
      // assert the fetcher adds exactly one additional call to the same spy.
      const preFetchCallCount =
        harness.discovery.listLocalModels.mock.calls.length;
      await fetcher();
      expect(harness.discovery.listLocalModels.mock.calls.length).toBe(
        preFetchCallCount + 1,
      );
      expect(harness.discovery.listCloudModels).not.toHaveBeenCalled();

      expect(result.configured).toBe(true);
      expect(result.details[0]).toContain('Ollama (Anthropic-native at');
    });

    it('uses a custom base URL from settings when provided', async () => {
      const harness = makeStrategy({
        config: { 'provider.ollama.baseUrl': 'http://my-ollama:11434' },
      });

      const ctx = makeContext('ollama');
      await harness.strategy.configure(ctx);

      expect(ctx.authEnv.ANTHROPIC_BASE_URL).toBe('http://my-ollama:11434');
      expect(harness.discovery.checkVersion).toHaveBeenCalledWith('ollama');
    });

    it('stops running copilot / codex / lm-studio proxies before configuring', async () => {
      const harness = makeStrategy();
      harness.copilotProxy.isRunning.mockReturnValue(true);
      harness.codexProxy.isRunning.mockReturnValue(true);
      harness.lmStudioProxy.isRunning.mockReturnValue(true);

      await harness.strategy.configure(makeContext('ollama'));

      expect(harness.copilotProxy.stop).toHaveBeenCalledTimes(1);
      expect(harness.codexProxy.stop).toHaveBeenCalledTimes(1);
      expect(harness.lmStudioProxy.stop).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Ollama Cloud branch
  // -------------------------------------------------------------------------

  describe('configure() — Ollama Cloud branch', () => {
    it('registers cloud fetcher and triggers a metadata refresh when API key exists', async () => {
      const harness = makeStrategy({
        providerKeys: { 'ollama-cloud': 'oc_key_abc' },
      });

      await harness.strategy.configure(makeContext('ollama-cloud'));

      const [registeredId, fetcher] =
        harness.providerModels.registerDynamicFetcher.mock.calls[0];
      expect(registeredId).toBe('ollama-cloud');
      const preFetchCallCount =
        harness.discovery.listCloudModels.mock.calls.length;
      await fetcher();
      expect(harness.discovery.listCloudModels.mock.calls.length).toBe(
        preFetchCallCount + 1,
      );

      // Key-present branch → metadata refresh fires.
      expect(harness.cloudMetadata.refresh).toHaveBeenCalledWith('oc_key_abc');
      expect(harness.cloudMetadata.clearCache).not.toHaveBeenCalled();
    });

    it('clears cloud metadata cache when no API key is stored (key-absent branch)', async () => {
      const harness = makeStrategy({ providerKeys: {} });

      await harness.strategy.configure(makeContext('ollama-cloud'));

      expect(harness.cloudMetadata.refresh).not.toHaveBeenCalled();
      expect(harness.cloudMetadata.clearCache).toHaveBeenCalledTimes(1);
    });

    it('warns (non-fatal) when cloud has zero models but still reports success', async () => {
      const harness = makeStrategy({ providerKeys: {} });
      harness.discovery.listCloudModels.mockResolvedValueOnce([]);

      const result = await harness.strategy.configure(
        makeContext('ollama-cloud'),
      );

      expect(result.configured).toBe(true);
      expect(harness.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('no cloud models found'),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Negative paths (auth-required analogues)
  // -------------------------------------------------------------------------

  describe('configure() — version + reachability negative paths', () => {
    it('unsupported Ollama version → upgrade hint, no env vars set', async () => {
      const harness = makeStrategy();
      harness.discovery.checkVersion.mockResolvedValueOnce({
        version: '0.13.0',
        supported: false,
      });

      const ctx = makeContext('ollama');
      const result = await harness.strategy.configure(ctx);

      expect(result.configured).toBe(false);
      expect(result.errorMessage).toContain('v0.13.0');
      expect(result.errorMessage).toContain('v0.14.0+');

      // No provider switch / fetcher registration / env mutation on failure.
      expect(
        harness.providerModels.switchActiveProvider,
      ).not.toHaveBeenCalled();
      expect(
        harness.providerModels.registerDynamicFetcher,
      ).not.toHaveBeenCalled();
      expect(ctx.authEnv.ANTHROPIC_BASE_URL).toBeUndefined();
    });

    it('checkVersion throws (server unreachable) → reachability hint', async () => {
      const harness = makeStrategy();
      harness.discovery.checkVersion.mockRejectedValueOnce(
        new Error('ECONNREFUSED'),
      );

      const result = await harness.strategy.configure(makeContext('ollama'));

      expect(result.configured).toBe(false);
      expect(result.errorMessage).toContain('is not reachable at');
    });

    it('treats model listing errors as non-fatal — still reports configured=true', async () => {
      const harness = makeStrategy();
      harness.discovery.listLocalModels.mockRejectedValueOnce(
        new Error('tags endpoint flaky'),
      );

      const result = await harness.strategy.configure(makeContext('ollama'));

      expect(result.configured).toBe(true);
      expect(harness.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to list Ollama models'),
      );
    });
  });

  // -------------------------------------------------------------------------
  // teardown()
  // -------------------------------------------------------------------------

  describe('teardown()', () => {
    it('clears both the discovery and cloud metadata caches', async () => {
      const harness = makeStrategy();

      await harness.strategy.teardown();

      expect(harness.discovery.clearCache).toHaveBeenCalledTimes(1);
      expect(harness.cloudMetadata.clearCache).toHaveBeenCalledTimes(1);
    });
  });
});
