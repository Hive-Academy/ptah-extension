/**
 * ProviderRpcHandlers — unit specs (TASK_2025_294 W2.B2).
 *
 * Surface under test: four RPC methods backing the provider model selector
 * (`listModels`, `setModelTier`, `getModelTiers`, `clearModelTier`) plus
 * the eager dynamic-fetcher registration that `register()` runs for
 * Copilot, Codex, Anthropic-direct, and Ollama.
 *
 * Behavioural contracts locked in here:
 *
 *   - Registration: `register()` registers the four RPC methods AND
 *     eagerly wires four dynamic fetchers onto `ProviderModelsService`
 *     (github-copilot, openai-codex, anthropic, ollama, ollama-cloud).
 *     These fetchers are registered at startup — not on first provider
 *     selection — so the model dropdown populates independent of the
 *     active provider.
 *
 *   - Schema validation: each method parses its params through the
 *     corresponding schema in `provider-rpc.schema.ts`. Invalid payloads
 *     surface as RPC failures (the handler re-throws the ZodError, which
 *     `MockRpcHandler` maps to `{ success: false, error }`).
 *
 *   - `provider:listModels`: routes `providerId` through
 *     `resolveProviderId()` (param > config > DEFAULT_PROVIDER_ID). For
 *     purely-dynamic providers without an API key it short-circuits to an
 *     empty result (not an error). Auth-failure errors (`401`, `403`,
 *     `Unauthorized`) are mapped to a user-facing "API key invalid" error
 *     message instead of throwing.
 *
 *   - `provider:setModelTier` / `provider:clearModelTier`: on success the
 *     handler MUST call `sdkAdapter.clearModelCache()` so the next
 *     `config:models-list` picks up fresh tier env vars. On failure the
 *     error is captured to Sentry and returned structurally (never throws
 *     to RPC boundary).
 *
 *   - `provider:getModelTiers`: returns the service's tier map verbatim.
 *     A service throw is captured to Sentry and re-thrown to the RPC
 *     boundary (the UI treats this as a generic load failure).
 *
 * Mocking posture: direct constructor injection, narrow `jest.Mocked<T>`
 * surfaces, no `as any` casts. We avoid re-implementing ProviderModels,
 * SdkAdapter, and ModelDiscovery — we only expose the methods this
 * handler touches.
 *
 * Source-under-test:
 *   `libs/backend/rpc-handlers/src/lib/handlers/provider-rpc.handlers.ts`
 */

import 'reflect-metadata';

import type {
  ConfigManager,
  IAuthSecretsService,
  Logger,
  SentryService,
} from '@ptah-extension/vscode-core';
import {
  createMockAuthSecretsService,
  createMockConfigManager,
  createMockRpcHandler,
  createMockSentryService,
  type MockAuthSecretsService,
  type MockConfigManager,
  type MockRpcHandler,
  type MockSentryService,
} from '@ptah-extension/vscode-core/testing';
import type { IModelDiscovery } from '@ptah-extension/platform-core';
import type {
  OllamaModelDiscoveryService,
  ProviderModelsService,
  SdkAgentAdapter,
} from '@ptah-extension/agent-sdk';
import type { CliDetectionService } from '@ptah-extension/llm-abstraction';
import type { AuthEnv } from '@ptah-extension/shared';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import { ProviderRpcHandlers } from './provider-rpc.handlers';

// ---------------------------------------------------------------------------
// Narrow mock surfaces
// ---------------------------------------------------------------------------

type MockProviderModels = jest.Mocked<
  Pick<
    ProviderModelsService,
    | 'registerDynamicFetcher'
    | 'fetchModels'
    | 'setModelTier'
    | 'getModelTiers'
    | 'clearModelTier'
  >
>;

function createMockProviderModels(): MockProviderModels {
  return {
    registerDynamicFetcher: jest.fn(),
    fetchModels: jest.fn(),
    setModelTier: jest.fn().mockResolvedValue(undefined),
    getModelTiers: jest.fn().mockReturnValue({
      sonnet: null,
      opus: null,
      haiku: null,
    }),
    clearModelTier: jest.fn().mockResolvedValue(undefined),
  };
}

type MockSdkAdapter = jest.Mocked<
  Pick<
    SdkAgentAdapter,
    'clearModelCache' | 'getApiModels' | 'getSupportedModels'
  >
>;

function createMockSdkAdapter(): MockSdkAdapter {
  return {
    clearModelCache: jest.fn(),
    getApiModels: jest.fn().mockResolvedValue([]),
    getSupportedModels: jest.fn().mockResolvedValue([]),
  };
}

type MockCliDetection = jest.Mocked<Pick<CliDetectionService, 'getAdapter'>>;

function createMockCliDetection(): MockCliDetection {
  return { getAdapter: jest.fn().mockReturnValue(undefined) };
}

type MockModelDiscovery = jest.Mocked<IModelDiscovery>;

function createMockModelDiscovery(): MockModelDiscovery {
  return {
    getCopilotModels: jest.fn().mockResolvedValue([]),
    getCodexModels: jest.fn().mockResolvedValue([]),
  };
}

type MockOllamaDiscovery = jest.Mocked<
  Pick<OllamaModelDiscoveryService, 'listLocalModels' | 'listCloudModels'>
>;

function createMockOllamaDiscovery(): MockOllamaDiscovery {
  return {
    listLocalModels: jest.fn().mockResolvedValue([]),
    listCloudModels: jest.fn().mockResolvedValue([]),
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Harness {
  handlers: ProviderRpcHandlers;
  logger: MockLogger;
  rpcHandler: MockRpcHandler;
  configManager: MockConfigManager;
  authSecrets: MockAuthSecretsService;
  providerModels: MockProviderModels;
  cliDetection: MockCliDetection;
  modelDiscovery: MockModelDiscovery;
  sdkAdapter: MockSdkAdapter;
  authEnv: AuthEnv;
  ollamaDiscovery: MockOllamaDiscovery;
  sentry: MockSentryService;
}

function makeHarness(
  opts: {
    configSeed?: Record<string, unknown>;
    providerKeysSeed?: Record<string, string>;
    authEnv?: Partial<AuthEnv>;
  } = {},
): Harness {
  const logger = createMockLogger();
  const rpcHandler = createMockRpcHandler();
  const configManager = createMockConfigManager({ values: opts.configSeed });
  const authSecrets = createMockAuthSecretsService({
    providerKeys: opts.providerKeysSeed,
  });
  const providerModels = createMockProviderModels();
  const cliDetection = createMockCliDetection();
  const modelDiscovery = createMockModelDiscovery();
  const sdkAdapter = createMockSdkAdapter();
  const authEnv: AuthEnv = { ...(opts.authEnv ?? {}) };
  const ollamaDiscovery = createMockOllamaDiscovery();
  const sentry = createMockSentryService();

  const handlers = new ProviderRpcHandlers(
    logger as unknown as Logger,
    rpcHandler as unknown as import('@ptah-extension/vscode-core').RpcHandler,
    configManager as unknown as ConfigManager,
    authSecrets as unknown as IAuthSecretsService,
    providerModels as unknown as ProviderModelsService,
    cliDetection as unknown as CliDetectionService,
    modelDiscovery as unknown as IModelDiscovery,
    sdkAdapter as unknown as SdkAgentAdapter,
    authEnv,
    ollamaDiscovery as unknown as OllamaModelDiscoveryService,
    sentry as unknown as SentryService,
  );

  return {
    handlers,
    logger,
    rpcHandler,
    configManager,
    authSecrets,
    providerModels,
    cliDetection,
    modelDiscovery,
    sdkAdapter,
    authEnv,
    ollamaDiscovery,
    sentry,
  };
}

async function call<TResult>(
  h: Harness,
  method: string,
  params: unknown = {},
): Promise<TResult> {
  const response = await h.rpcHandler.handleMessage({
    method,
    params: params as Record<string, unknown>,
    correlationId: `corr-${method}`,
  });
  if (!response.success) {
    throw new Error(`RPC ${method} failed: ${response.error}`);
  }
  return response.data as TResult;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProviderRpcHandlers', () => {
  describe('register()', () => {
    it('registers the four provider RPC methods', () => {
      const h = makeHarness();
      h.handlers.register();

      expect(h.rpcHandler.getRegisteredMethods().sort()).toEqual(
        [
          'provider:clearModelTier',
          'provider:getModelTiers',
          'provider:listModels',
          'provider:setModelTier',
        ].sort(),
      );
    });

    it('eagerly registers dynamic fetchers for copilot / codex / anthropic / ollama / ollama-cloud', () => {
      const h = makeHarness();
      h.handlers.register();

      const registeredProviders =
        h.providerModels.registerDynamicFetcher.mock.calls.map((c) => c[0]);
      expect(registeredProviders).toEqual(
        expect.arrayContaining([
          'github-copilot',
          'openai-codex',
          'anthropic',
          'ollama',
          'ollama-cloud',
        ]),
      );
    });
  });

  // -------------------------------------------------------------------------
  // provider:listModels
  // -------------------------------------------------------------------------

  describe('provider:listModels', () => {
    it('resolves providerId from params override', async () => {
      const h = makeHarness({ providerKeysSeed: { moonshot: 'key-m' } });
      h.providerModels.fetchModels.mockResolvedValue({
        models: [],
        totalCount: 0,
        isStatic: true,
      });
      h.handlers.register();

      await call(h, 'provider:listModels', { providerId: 'moonshot' });

      expect(h.providerModels.fetchModels).toHaveBeenCalledWith(
        'moonshot',
        'key-m',
        false,
      );
    });

    it('falls back to configManager.anthropicProviderId when providerId is absent', async () => {
      const h = makeHarness({
        configSeed: { anthropicProviderId: 'z-ai' },
        providerKeysSeed: { 'z-ai': 'key-z' },
      });
      h.providerModels.fetchModels.mockResolvedValue({
        models: [],
        totalCount: 0,
        isStatic: true,
      });
      h.handlers.register();

      await call(h, 'provider:listModels', {});

      expect(h.providerModels.fetchModels).toHaveBeenCalledWith(
        'z-ai',
        'key-z',
        false,
      );
    });

    it('forwards toolUseOnly flag to the service', async () => {
      // Seed a key for openrouter — it is a purely dynamic provider
      // (modelsEndpoint set, no static fallback), so absent a key the handler
      // short-circuits to an empty result without ever invoking the service.
      const h = makeHarness({
        providerKeysSeed: { openrouter: 'sk-or-test' },
      });
      h.providerModels.fetchModels.mockResolvedValue({
        models: [],
        totalCount: 0,
        isStatic: true,
      });
      h.handlers.register();

      await call(h, 'provider:listModels', {
        providerId: 'openrouter',
        toolUseOnly: true,
      });

      expect(h.providerModels.fetchModels).toHaveBeenCalledWith(
        'openrouter',
        'sk-or-test',
        true,
      );
    });

    it('short-circuits to empty result for purely-dynamic providers without an API key', async () => {
      // OpenRouter has `modelsEndpoint` set and no static fallback beyond
      // what a key would unlock — the handler must not call fetchModels.
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{
        models: unknown[];
        totalCount: number;
        isStatic: boolean;
      }>(h, 'provider:listModels', { providerId: 'openrouter' });

      expect(result).toEqual({ models: [], totalCount: 0, isStatic: false });
      expect(h.providerModels.fetchModels).not.toHaveBeenCalled();
    });

    it('maps 401-ish errors to a friendly "invalid key" response (no throw)', async () => {
      const h = makeHarness({
        providerKeysSeed: { openrouter: 'stale-key' },
      });
      h.providerModels.fetchModels.mockRejectedValue(
        new Error('HTTP 401 Unauthorized'),
      );
      h.handlers.register();

      const result = await call<{
        models: unknown[];
        error?: string;
      }>(h, 'provider:listModels', { providerId: 'openrouter' });

      expect(result.models).toEqual([]);
      expect(result.error).toMatch(/invalid or expired/i);
      // Auth errors are NOT captured to Sentry (expected negative path).
      expect(h.sentry.captureException).not.toHaveBeenCalled();
    });

    it('captures non-auth errors to Sentry and re-throws to the RPC boundary', async () => {
      const h = makeHarness({
        providerKeysSeed: { openrouter: 'key' },
      });
      h.providerModels.fetchModels.mockRejectedValue(
        new Error('ECONNRESET on provider API'),
      );
      h.handlers.register();

      const response = await h.rpcHandler.handleMessage({
        method: 'provider:listModels',
        params: { providerId: 'openrouter' },
        correlationId: 'corr',
      });

      expect(response.success).toBe(false);
      expect(response.error).toMatch(/ECONNRESET/);
      expect(h.sentry.captureException).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // provider:setModelTier
  // -------------------------------------------------------------------------

  describe('provider:setModelTier', () => {
    it('rejects unknown tier values via the schema', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'provider:setModelTier',
        { tier: 'default', modelId: 'x' },
      );

      // The handler catches the ZodError and returns structured failure.
      expect(result.success).toBe(false);
      expect(h.providerModels.setModelTier).not.toHaveBeenCalled();
      expect(h.sdkAdapter.clearModelCache).not.toHaveBeenCalled();
      expect(h.sentry.captureException).toHaveBeenCalled();
    });

    it('rejects empty modelId via the schema', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean }>(
        h,
        'provider:setModelTier',
        { tier: 'sonnet', modelId: '' },
      );

      expect(result.success).toBe(false);
      expect(h.providerModels.setModelTier).not.toHaveBeenCalled();
    });

    it('writes the tier and clears the SDK model cache on success', async () => {
      const h = makeHarness({
        configSeed: { anthropicProviderId: 'openrouter' },
      });
      h.handlers.register();

      const result = await call<{ success: boolean }>(
        h,
        'provider:setModelTier',
        { tier: 'sonnet', modelId: 'anthropic/claude-3.5-sonnet' },
      );

      expect(result.success).toBe(true);
      expect(h.providerModels.setModelTier).toHaveBeenCalledWith(
        'openrouter',
        'sonnet',
        'anthropic/claude-3.5-sonnet',
      );
      // TASK_2025_132 contract: clear the SDK cache so the next models-list
      // call re-fetches with fresh tier env vars.
      expect(h.sdkAdapter.clearModelCache).toHaveBeenCalledTimes(1);
    });

    it('captures service failures to Sentry and returns structured error', async () => {
      const h = makeHarness();
      h.providerModels.setModelTier.mockRejectedValue(new Error('disk full'));
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'provider:setModelTier',
        { tier: 'opus', modelId: 'm', providerId: 'openrouter' },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('disk full');
      // On failure the cache is NOT cleared — a retried write must see
      // fresh context, not a stale cleared cache.
      expect(h.sdkAdapter.clearModelCache).not.toHaveBeenCalled();
      expect(h.sentry.captureException).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // provider:getModelTiers
  // -------------------------------------------------------------------------

  describe('provider:getModelTiers', () => {
    it('returns the service tier map verbatim', async () => {
      const h = makeHarness({
        configSeed: { anthropicProviderId: 'openrouter' },
      });
      h.providerModels.getModelTiers.mockReturnValue({
        sonnet: 'anthropic/claude-3.5-sonnet',
        opus: null,
        haiku: 'anthropic/claude-haiku',
      });
      h.handlers.register();

      const result = await call<{
        sonnet: string | null;
        opus: string | null;
        haiku: string | null;
      }>(h, 'provider:getModelTiers');

      expect(result).toEqual({
        sonnet: 'anthropic/claude-3.5-sonnet',
        opus: null,
        haiku: 'anthropic/claude-haiku',
      });
      expect(h.providerModels.getModelTiers).toHaveBeenCalledWith('openrouter');
    });

    it('accepts no params at all (empty object) — the schema defaults providerId to undefined', async () => {
      const h = makeHarness({
        configSeed: { anthropicProviderId: 'moonshot' },
      });
      h.handlers.register();

      await call(h, 'provider:getModelTiers');
      expect(h.providerModels.getModelTiers).toHaveBeenCalledWith('moonshot');
    });

    it('captures service throws to Sentry and re-throws to RPC boundary', async () => {
      const h = makeHarness();
      h.providerModels.getModelTiers.mockImplementation(() => {
        throw new Error('tier read failed');
      });
      h.handlers.register();

      const response = await h.rpcHandler.handleMessage({
        method: 'provider:getModelTiers',
        params: {},
        correlationId: 'corr',
      });

      expect(response.success).toBe(false);
      expect(response.error).toBe('tier read failed');
      expect(h.sentry.captureException).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // provider:clearModelTier
  // -------------------------------------------------------------------------

  describe('provider:clearModelTier', () => {
    it('rejects unknown tier values via the schema', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean }>(
        h,
        'provider:clearModelTier',
        { tier: 'fast' },
      );

      expect(result.success).toBe(false);
      expect(h.providerModels.clearModelTier).not.toHaveBeenCalled();
    });

    it('clears the tier and the SDK model cache on success', async () => {
      const h = makeHarness({
        configSeed: { anthropicProviderId: 'openrouter' },
      });
      h.handlers.register();

      const result = await call<{ success: boolean }>(
        h,
        'provider:clearModelTier',
        { tier: 'opus' },
      );

      expect(result.success).toBe(true);
      expect(h.providerModels.clearModelTier).toHaveBeenCalledWith(
        'openrouter',
        'opus',
      );
      expect(h.sdkAdapter.clearModelCache).toHaveBeenCalledTimes(1);
    });

    it('captures service failures to Sentry and returns structured error', async () => {
      const h = makeHarness();
      h.providerModels.clearModelTier.mockRejectedValue(
        new Error('write blocked'),
      );
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'provider:clearModelTier',
        { tier: 'haiku', providerId: 'openrouter' },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('write blocked');
      expect(h.sdkAdapter.clearModelCache).not.toHaveBeenCalled();
      expect(h.sentry.captureException).toHaveBeenCalled();
    });
  });
});
