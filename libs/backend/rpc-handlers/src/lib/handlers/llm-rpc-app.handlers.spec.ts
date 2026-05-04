/**
 * LlmRpcHandlers — unit specs (TASK_2025_294 W2.B2).
 *
 * Surface under test: nine RPC methods that back the LLM provider admin
 * UI (`getProviderStatus`, `setApiKey`, `removeApiKey`,
 * `getDefaultProvider`, `setDefaultProvider`, `setDefaultModel`,
 * `validateApiKeyFormat`, `listVsCodeModels`, `listProviderModels`).
 *
 * Behavioural contracts locked in here:
 *
 *   - Registration: `register()` wires all nine methods into the mock
 *     RpcHandler.
 *
 *   - Lazy DI: the handler resolves `ISecretStorage`, `IModelDiscovery`,
 *     and `ConfigManager` lazily via `container.resolve`. Every test
 *     seeds the mock container so the handler can pick up its
 *     collaborators at call time (the factory pattern the handler
 *     documents in `getSecretStorage()`).
 *
 *   - `llm:getProviderStatus`: returns both configured Anthropic and
 *     OpenRouter slots with `hasApiKey` reflecting secret-storage state
 *     and `isDefault` reflecting config-manager state. On collaborator
 *     failure it returns `{ providers: [] }` rather than throwing.
 *
 *   - `llm:setApiKey` / `llm:removeApiKey`: update SecretStorage AND
 *     mutate `process.env[PROVIDER_ENV_VAR]` so SDK adapters pick up the
 *     new key without a restart. Missing params return a structured
 *     error — never throw.
 *
 *   - `llm:validateApiKeyFormat`: known providers (anthropic, openrouter)
 *     enforce keyPrefix + minLength; unknown providers fall back to
 *     `length > 10`. Missing params return a structured error.
 *
 *   - `llm:listVsCodeModels` / `llm:listProviderModels`: map
 *     `IModelDiscovery` output into the wire shape. `listProviderModels`
 *     routes `copilot` → `getCopilotModels` and everything else →
 *     `getCodexModels`. Errors are captured and returned structurally.
 *
 *   - SECURITY: API keys MUST never appear in logger calls — the handler
 *     logs only `{ provider }`, never the raw `apiKey`.
 *
 * Mocking posture: direct constructor injection, narrow `jest.Mocked<T>`
 * surfaces, no `as any` casts. The tsyringe `DependencyContainer` is
 * replaced by a hand-rolled `Pick<DependencyContainer, 'resolve'>` mock
 * so tests don't pull in the real container.
 *
 * Source-under-test:
 *   `libs/backend/rpc-handlers/src/lib/handlers/llm-rpc-app.handlers.ts`
 */

import 'reflect-metadata';

import type { DependencyContainer } from 'tsyringe';
import type { Logger, SentryService } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import {
  createMockConfigManager,
  createMockRpcHandler,
  createMockSentryService,
  type MockConfigManager,
  type MockRpcHandler,
  type MockSentryService,
} from '@ptah-extension/vscode-core/testing';
import {
  PLATFORM_TOKENS,
  type IModelDiscovery,
} from '@ptah-extension/platform-core';
import {
  createMockSecretStorage,
  type MockSecretStorage,
} from '@ptah-extension/platform-core/testing';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import { LlmRpcHandlers } from './llm-rpc-app.handlers';

// ---------------------------------------------------------------------------
// Narrow mock surfaces
// ---------------------------------------------------------------------------

type MockModelDiscovery = jest.Mocked<IModelDiscovery>;

function createMockModelDiscovery(): MockModelDiscovery {
  return {
    getCopilotModels: jest.fn().mockResolvedValue([]),
    getCodexModels: jest.fn().mockResolvedValue([]),
  };
}

type MockContainer = jest.Mocked<Pick<DependencyContainer, 'resolve'>>;

function createMockContainer(registry: {
  secretStorage: MockSecretStorage;
  modelDiscovery: MockModelDiscovery;
  configManager: MockConfigManager;
}): MockContainer {
  const mock: MockContainer = {
    resolve: jest.fn((token: unknown) => {
      if (token === PLATFORM_TOKENS.SECRET_STORAGE)
        return registry.secretStorage;
      if (token === TOKENS.MODEL_DISCOVERY) return registry.modelDiscovery;
      if (token === TOKENS.CONFIG_MANAGER) return registry.configManager;
      throw new Error(`MockContainer: unexpected token ${String(token)}`);
    }) as unknown as MockContainer['resolve'],
  };
  return mock;
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Harness {
  handlers: LlmRpcHandlers;
  logger: MockLogger;
  rpcHandler: MockRpcHandler;
  container: MockContainer;
  secretStorage: MockSecretStorage;
  modelDiscovery: MockModelDiscovery;
  configManager: MockConfigManager;
  sentry: MockSentryService;
}

function makeHarness(
  opts: {
    configSeed?: Record<string, unknown>;
    secretSeed?: Record<string, string>;
  } = {},
): Harness {
  const logger = createMockLogger();
  const rpcHandler = createMockRpcHandler();
  const secretStorage = createMockSecretStorage({ seed: opts.secretSeed });
  const modelDiscovery = createMockModelDiscovery();
  const configManager = createMockConfigManager({ values: opts.configSeed });
  const sentry = createMockSentryService();
  const container = createMockContainer({
    secretStorage,
    modelDiscovery,
    configManager,
  });

  const handlers = new LlmRpcHandlers(
    logger as unknown as Logger,
    rpcHandler as unknown as import('@ptah-extension/vscode-core').RpcHandler,
    container as unknown as DependencyContainer,
    sentry as unknown as SentryService,
  );

  return {
    handlers,
    logger,
    rpcHandler,
    container,
    secretStorage,
    modelDiscovery,
    configManager,
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

// Avoid leaking env-var mutations across tests — setApiKey/removeApiKey
// mutate process.env for known providers.
const ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENROUTER_API_KEY',
  'MOONSHOT_API_KEY',
  'Z_AI_API_KEY',
];

let envSnapshot: Record<string, string | undefined>;

beforeEach(() => {
  envSnapshot = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (envSnapshot[k] === undefined) delete process.env[k];
    else process.env[k] = envSnapshot[k];
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LlmRpcHandlers', () => {
  describe('register()', () => {
    it('registers all twelve LLM RPC methods', () => {
      const h = makeHarness();
      h.handlers.register();

      expect(h.rpcHandler.getRegisteredMethods().sort()).toEqual(
        [
          'llm:clearProviderBaseUrl',
          'llm:getDefaultProvider',
          'llm:getProviderBaseUrl',
          'llm:getProviderStatus',
          'llm:listProviderModels',
          'llm:listVsCodeModels',
          'llm:removeApiKey',
          'llm:setApiKey',
          'llm:setDefaultModel',
          'llm:setDefaultProvider',
          'llm:setProviderBaseUrl',
          'llm:validateApiKeyFormat',
        ].sort(),
      );
    });
  });

  // -------------------------------------------------------------------------
  // llm:getProviderStatus
  // -------------------------------------------------------------------------

  describe('llm:getProviderStatus', () => {
    it('reports hasApiKey + isDefault for each status provider', async () => {
      const h = makeHarness({
        configSeed: { 'llm.defaultProvider': 'openrouter' },
        secretSeed: { 'ptah.apiKey.anthropic': 'sk-ant-abc' },
      });
      h.handlers.register();

      const result = await call<{
        providers: Array<{
          name: string;
          displayName: string;
          hasApiKey: boolean;
          isDefault: boolean;
        }>;
        defaultProvider: string;
      }>(h, 'llm:getProviderStatus');

      expect(result.defaultProvider).toBe('openrouter');
      expect(result.providers.map((p) => p.name)).toEqual(
        expect.arrayContaining(['anthropic', 'openrouter']),
      );

      const anthropic = result.providers.find((p) => p.name === 'anthropic');
      expect(anthropic?.hasApiKey).toBe(true);
      expect(anthropic?.isDefault).toBe(false);

      const openrouter = result.providers.find((p) => p.name === 'openrouter');
      expect(openrouter?.hasApiKey).toBe(false);
      expect(openrouter?.isDefault).toBe(true);
    });

    it('defaults to anthropic when config has no defaultProvider set', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ defaultProvider: string }>(
        h,
        'llm:getProviderStatus',
      );
      expect(result.defaultProvider).toBe('anthropic');
    });

    it('returns { providers: [] } on collaborator failure (never throws)', async () => {
      const h = makeHarness();
      // Force secretStorage.get to reject so the inner Promise.all rejects.
      h.secretStorage.get.mockRejectedValue(new Error('keychain locked'));
      h.handlers.register();

      const result = await call<{ providers: unknown[] }>(
        h,
        'llm:getProviderStatus',
      );

      expect(result.providers).toEqual([]);
      expect(h.sentry.captureException).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // llm:setApiKey / llm:removeApiKey
  // -------------------------------------------------------------------------

  describe('llm:setApiKey', () => {
    it('rejects missing params with a structured error', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'llm:setApiKey',
        {},
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/provider and apiKey are required/i);
      expect(h.secretStorage.store).not.toHaveBeenCalled();
    });

    it('stores the key and mutates process.env for known providers', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean }>(h, 'llm:setApiKey', {
        provider: 'anthropic',
        apiKey: 'sk-ant-fresh',
      });

      expect(result.success).toBe(true);
      expect(h.secretStorage.store).toHaveBeenCalledWith(
        'ptah.apiKey.anthropic',
        'sk-ant-fresh',
      );
      expect(process.env['ANTHROPIC_API_KEY']).toBe('sk-ant-fresh');
    });

    it('stores the key without env mutation for unknown providers', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean }>(h, 'llm:setApiKey', {
        provider: 'custom',
        apiKey: 'sk-custom',
      });

      expect(result.success).toBe(true);
      expect(h.secretStorage.store).toHaveBeenCalledWith(
        'ptah.apiKey.custom',
        'sk-custom',
      );
      // Unknown providers have no env var entry → no env mutation.
      expect(process.env['ANTHROPIC_API_KEY']).toBe(
        envSnapshot['ANTHROPIC_API_KEY'],
      );
    });

    it('never logs the raw apiKey (security)', async () => {
      const h = makeHarness();
      h.handlers.register();

      await call(h, 'llm:setApiKey', {
        provider: 'anthropic',
        apiKey: 'sk-ant-SECRET-VALUE',
      });

      const allLogArgs = [
        ...h.logger.debug.mock.calls,
        ...h.logger.info.mock.calls,
      ].flat();
      for (const arg of allLogArgs) {
        expect(JSON.stringify(arg)).not.toContain('SECRET-VALUE');
      }
    });
  });

  describe('llm:removeApiKey', () => {
    it('rejects missing provider with a structured error', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'llm:removeApiKey',
        {},
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/provider is required/i);
    });

    it('deletes from secret storage and clears env for known providers', async () => {
      const h = makeHarness({
        secretSeed: { 'ptah.apiKey.anthropic': 'sk-ant-old' },
      });
      process.env['ANTHROPIC_API_KEY'] = 'sk-ant-old';
      h.handlers.register();

      const result = await call<{ success: boolean }>(h, 'llm:removeApiKey', {
        provider: 'anthropic',
      });

      expect(result.success).toBe(true);
      expect(h.secretStorage.delete).toHaveBeenCalledWith(
        'ptah.apiKey.anthropic',
      );
      expect(process.env['ANTHROPIC_API_KEY']).toBeUndefined();
    });

    it('captures storage failures to Sentry and returns structured error', async () => {
      const h = makeHarness();
      h.secretStorage.delete.mockRejectedValue(new Error('fs read-only'));
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'llm:removeApiKey',
        { provider: 'anthropic' },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('fs read-only');
      expect(h.sentry.captureException).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // llm:getDefaultProvider / llm:setDefaultProvider / llm:setDefaultModel
  // -------------------------------------------------------------------------

  describe('llm:getDefaultProvider', () => {
    it('returns the configured default provider', async () => {
      const h = makeHarness({
        configSeed: { 'llm.defaultProvider': 'moonshot' },
      });
      h.handlers.register();

      const result = await call<{ provider: string }>(
        h,
        'llm:getDefaultProvider',
      );
      expect(result.provider).toBe('moonshot');
    });

    it('falls back to "anthropic" when unset', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ provider: string }>(
        h,
        'llm:getDefaultProvider',
      );
      expect(result.provider).toBe('anthropic');
    });
  });

  describe('llm:setDefaultProvider', () => {
    it('writes the provider through ConfigManager', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean }>(
        h,
        'llm:setDefaultProvider',
        { provider: 'z-ai' },
      );

      expect(result.success).toBe(true);
      expect(h.configManager.set).toHaveBeenCalledWith(
        'llm.defaultProvider',
        'z-ai',
      );
    });

    it('falls back to "anthropic" when params are absent', async () => {
      const h = makeHarness();
      h.handlers.register();

      await call(h, 'llm:setDefaultProvider', {});
      expect(h.configManager.set).toHaveBeenCalledWith(
        'llm.defaultProvider',
        'anthropic',
      );
    });
  });

  describe('llm:setDefaultModel', () => {
    it('writes the model under the provider-scoped config key', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean }>(
        h,
        'llm:setDefaultModel',
        { provider: 'openrouter', model: 'anthropic/claude-3.5-sonnet' },
      );

      expect(result.success).toBe(true);
      expect(h.configManager.set).toHaveBeenCalledWith(
        'llm.openrouter.model',
        'anthropic/claude-3.5-sonnet',
      );
    });
  });

  // -------------------------------------------------------------------------
  // llm:validateApiKeyFormat
  // -------------------------------------------------------------------------

  describe('llm:validateApiKeyFormat', () => {
    it('rejects missing params', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ valid: boolean; error?: string }>(
        h,
        'llm:validateApiKeyFormat',
        {},
      );
      expect(result.valid).toBe(false);
    });

    it('validates Anthropic keys via sk-ant- prefix + minLength', async () => {
      const h = makeHarness();
      h.handlers.register();

      const good = await call<{ valid: boolean }>(
        h,
        'llm:validateApiKeyFormat',
        { provider: 'anthropic', apiKey: `sk-ant-${'a'.repeat(25)}` },
      );
      expect(good.valid).toBe(true);

      const badPrefix = await call<{ valid: boolean; error?: string }>(
        h,
        'llm:validateApiKeyFormat',
        { provider: 'anthropic', apiKey: `sk-or-${'a'.repeat(25)}` },
      );
      expect(badPrefix.valid).toBe(false);
      expect(badPrefix.error).toMatch(/sk-ant-/);
    });

    it('validates OpenRouter keys via sk-or- prefix', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ valid: boolean }>(
        h,
        'llm:validateApiKeyFormat',
        { provider: 'openrouter', apiKey: `sk-or-${'x'.repeat(25)}` },
      );
      expect(result.valid).toBe(true);
    });

    it('falls back to length>10 heuristic for unknown providers', async () => {
      const h = makeHarness();
      h.handlers.register();

      const shortKey = await call<{ valid: boolean }>(
        h,
        'llm:validateApiKeyFormat',
        { provider: 'custom', apiKey: 'abc' },
      );
      expect(shortKey.valid).toBe(false);

      const longKey = await call<{ valid: boolean }>(
        h,
        'llm:validateApiKeyFormat',
        { provider: 'custom', apiKey: 'abcdefghijklmnop' },
      );
      expect(longKey.valid).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // llm:listVsCodeModels
  // -------------------------------------------------------------------------

  describe('llm:listVsCodeModels', () => {
    it('maps IModelDiscovery.getCopilotModels output into the wire shape', async () => {
      const h = makeHarness();
      h.modelDiscovery.getCopilotModels.mockResolvedValue([
        { id: 'gpt-4', name: 'GPT-4', contextLength: 128_000 },
        { id: 'gpt-4o', name: 'GPT-4o', contextLength: 200_000 },
      ]);
      h.handlers.register();

      const result = await call<
        Array<{ id: string; displayName: string; contextLength: number }>
      >(h, 'llm:listVsCodeModels');

      expect(result).toEqual([
        { id: 'gpt-4', displayName: 'GPT-4', contextLength: 128_000 },
        { id: 'gpt-4o', displayName: 'GPT-4o', contextLength: 200_000 },
      ]);
    });

    it('returns [] when the discovery service throws', async () => {
      const h = makeHarness();
      h.modelDiscovery.getCopilotModels.mockRejectedValue(
        new Error('vscode unavailable'),
      );
      h.handlers.register();

      const result = await call<unknown[]>(h, 'llm:listVsCodeModels');
      expect(result).toEqual([]);
      expect(h.sentry.captureException).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // llm:listProviderModels
  // -------------------------------------------------------------------------

  describe('llm:listProviderModels', () => {
    it('rejects missing provider with a structured error', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ models: unknown[]; error?: string }>(
        h,
        'llm:listProviderModels',
        {},
      );

      expect(result.models).toEqual([]);
      expect(result.error).toMatch(/provider is required/i);
    });

    it('routes provider="copilot" to getCopilotModels', async () => {
      const h = makeHarness();
      h.modelDiscovery.getCopilotModels.mockResolvedValue([
        { id: 'gpt-4o', name: 'GPT-4o', contextLength: 200_000 },
      ]);
      h.handlers.register();

      const result = await call<{
        models: Array<{ id: string; displayName: string }>;
      }>(h, 'llm:listProviderModels', { provider: 'copilot' });

      expect(h.modelDiscovery.getCopilotModels).toHaveBeenCalled();
      expect(h.modelDiscovery.getCodexModels).not.toHaveBeenCalled();
      expect(result.models).toEqual([{ id: 'gpt-4o', displayName: 'GPT-4o' }]);
    });

    it('routes non-copilot providers to getCodexModels', async () => {
      const h = makeHarness();
      h.modelDiscovery.getCodexModels.mockResolvedValue([
        { id: 'gpt-5', name: 'GPT-5', contextLength: 400_000 },
      ]);
      h.handlers.register();

      const result = await call<{
        models: Array<{ id: string; displayName: string }>;
      }>(h, 'llm:listProviderModels', { provider: 'openai-codex' });

      expect(h.modelDiscovery.getCodexModels).toHaveBeenCalled();
      expect(h.modelDiscovery.getCopilotModels).not.toHaveBeenCalled();
      expect(result.models).toEqual([{ id: 'gpt-5', displayName: 'GPT-5' }]);
    });

    it('captures discovery errors and returns structured failure', async () => {
      const h = makeHarness();
      h.modelDiscovery.getCopilotModels.mockRejectedValue(
        new Error('rate limited'),
      );
      h.handlers.register();

      const result = await call<{ models: unknown[]; error?: string }>(
        h,
        'llm:listProviderModels',
        { provider: 'copilot' },
      );

      expect(result.models).toEqual([]);
      expect(result.error).toBe('rate limited');
      expect(h.sentry.captureException).toHaveBeenCalled();
    });
  });
});
