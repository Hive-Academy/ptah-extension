/**
 * WebSearchRpcHandlers — unit specs.
 *
 * Surface under test: six RPC methods covering web-search API-key management
 * (`getApiKeyStatus`, `setApiKey`, `deleteApiKey`), live-test smoke
 * (`test`), and providers/maxResults configuration (`getConfig`, `setConfig`).
 *
 * Behavioural contracts locked in here:
 *
 *   - Registration: `register()` wires all six methods into the mock
 *     RpcHandler.
 *
 *   - Provider validation: every method that accepts a `provider` string
 *     rejects anything outside `VALID_PROVIDERS` (from `web-search-rpc.schema`)
 *     with a throw that surfaces as a structured RPC failure — NOT a silent
 *     pass-through. This is the gate that keeps attackers from exfiltrating
 *     keys to arbitrary SecretStorage slots.
 *
 *   - SecretStorage namespace stability: API keys are stored at
 *     `${SECRET_KEY_PREFIX}.${provider}`. A regression in the prefix would
 *     orphan already-stored keys, so the spec asserts the exact storage key.
 *
 *   - API-key set/delete: `setApiKey` trims whitespace before storing and
 *     rejects empty/whitespace-only inputs; `deleteApiKey` fires even when
 *     nothing is stored (idempotent delete).
 *
 *   - Live test path: every configured provider is tested independently in
 *     parallel. Missing keys and adapter failures remain per-provider results,
 *     while the aggregate succeeds when at least one provider passes.
 *
 *   - Config migration/write: `getConfig` falls back to the legacy single
 *     provider key, while `setConfig` writes the non-empty provider list and
 *     clears that legacy key. `maxResults` remains clamped to [1, 20].
 *
 * Mocking posture:
 *   - Direct constructor injection (no tsyringe container).
 *   - Narrow `jest.Mocked<Pick<T,...>>` surfaces where possible.
 *   - `@ptah-extension/vscode-lm-tools` is `jest.mock()`-replaced with stub
 *     provider classes so the live-test path never hits the network.
 *
 * Source-under-test:
 *   `libs/backend/rpc-handlers/src/lib/handlers/web-search-rpc.handlers.ts`
 */

import 'reflect-metadata';

// ---------------------------------------------------------------------------
// Module mock — replace real search SDKs so `webSearch:test` stays hermetic.
// Declared before the SUT import so Jest hoists it correctly.
// ---------------------------------------------------------------------------

const searchFn = jest.fn();

jest.mock('@ptah-extension/vscode-lm-tools', () => {
  // Each provider class records its constructor args so specs can assert
  // which adapter the handler picked and what apiKey was passed through.
  class StubProvider {
    public readonly name: string;
    public readonly apiKey: string;
    constructor(name: string, apiKey: string) {
      this.name = name;
      this.apiKey = apiKey;
    }
    search(query: string, maxResults: number): Promise<unknown> {
      return searchFn(this.name, query, maxResults);
    }
  }
  return {
    TavilySearchProvider: class extends StubProvider {
      constructor(apiKey: string) {
        super('tavily', apiKey);
      }
    },
    SerperSearchProvider: class extends StubProvider {
      constructor(apiKey: string) {
        super('serper', apiKey);
      }
    },
    ExaSearchProvider: class extends StubProvider {
      constructor(apiKey: string) {
        super('exa', apiKey);
      }
    },
  };
});

import type { Logger, SentryService } from '@ptah-extension/vscode-core';
import {
  createMockRpcHandler,
  createMockSentryService,
  type MockRpcHandler,
  type MockSentryService,
} from '@ptah-extension/vscode-core/testing';
import type {
  ISecretStorage,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  createMockSecretStorage,
  createMockWorkspaceProvider,
  type MockSecretStorage,
  type MockWorkspaceProvider,
} from '@ptah-extension/platform-core/testing';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import { WebSearchRpcHandlers } from './web-search-rpc.handlers';
import { SECRET_KEY_PREFIX } from './web-search-rpc.schema';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Harness {
  handlers: WebSearchRpcHandlers;
  logger: MockLogger;
  rpcHandler: MockRpcHandler;
  secretStorage: MockSecretStorage;
  workspace: MockWorkspaceProvider;
  sentry: MockSentryService;
}

function makeHarness(
  opts: {
    secrets?: Record<string, string>;
    config?: Record<string, unknown>;
  } = {},
): Harness {
  const logger = createMockLogger();
  const rpcHandler = createMockRpcHandler();
  const secretStorage = createMockSecretStorage({ seed: opts.secrets });
  const workspace = createMockWorkspaceProvider({ config: opts.config });
  const sentry = createMockSentryService();

  const handlers = new WebSearchRpcHandlers(
    logger as unknown as Logger,
    rpcHandler as unknown as import('@ptah-extension/vscode-core').RpcHandler,
    secretStorage as unknown as ISecretStorage,
    workspace as unknown as IWorkspaceProvider,
    sentry as unknown as SentryService,
  );

  return { handlers, logger, rpcHandler, secretStorage, workspace, sentry };
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

beforeEach(() => {
  searchFn.mockReset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebSearchRpcHandlers', () => {
  describe('register()', () => {
    it('registers all six web-search RPC methods', () => {
      const h = makeHarness();
      h.handlers.register();

      expect(h.rpcHandler.getRegisteredMethods().sort()).toEqual(
        [
          'webSearch:deleteApiKey',
          'webSearch:getApiKeyStatus',
          'webSearch:getConfig',
          'webSearch:setApiKey',
          'webSearch:setConfig',
          'webSearch:test',
        ].sort(),
      );
    });
  });

  // -------------------------------------------------------------------------
  // webSearch:getApiKeyStatus
  // -------------------------------------------------------------------------

  describe('webSearch:getApiKeyStatus', () => {
    it('returns configured=true when a key is stored at the namespaced slot', async () => {
      const h = makeHarness({
        secrets: { [`${SECRET_KEY_PREFIX}.tavily`]: 'secret-tavily' },
      });
      h.handlers.register();

      const result = await call<{ configured: boolean }>(
        h,
        'webSearch:getApiKeyStatus',
        { provider: 'tavily' },
      );

      expect(result.configured).toBe(true);
      expect(h.secretStorage.get).toHaveBeenCalledWith(
        `${SECRET_KEY_PREFIX}.tavily`,
      );
    });

    it('returns configured=false when no key is stored', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ configured: boolean }>(
        h,
        'webSearch:getApiKeyStatus',
        { provider: 'serper' },
      );

      expect(result.configured).toBe(false);
    });

    it('treats an empty-string stored value as not configured', async () => {
      const h = makeHarness({
        secrets: { [`${SECRET_KEY_PREFIX}.exa`]: '' },
      });
      h.handlers.register();

      const result = await call<{ configured: boolean }>(
        h,
        'webSearch:getApiKeyStatus',
        { provider: 'exa' },
      );

      expect(result.configured).toBe(false);
    });

    it('rejects an unsupported provider with a structured RPC failure', async () => {
      const h = makeHarness();
      h.handlers.register();

      const response = await h.rpcHandler.handleMessage({
        method: 'webSearch:getApiKeyStatus',
        params: { provider: 'google' },
        correlationId: 'corr',
      });

      expect(response.success).toBe(false);
      expect(response.error).toMatch(/invalid web search provider/i);
      expect(h.sentry.captureException).toHaveBeenCalled();
      expect(h.secretStorage.get).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // webSearch:setApiKey
  // -------------------------------------------------------------------------

  describe('webSearch:setApiKey', () => {
    it('stores the trimmed API key at the namespaced SecretStorage slot', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean }>(
        h,
        'webSearch:setApiKey',
        {
          provider: 'tavily',
          apiKey: '  tavily-key  ',
        },
      );

      expect(result.success).toBe(true);
      expect(h.secretStorage.store).toHaveBeenCalledWith(
        `${SECRET_KEY_PREFIX}.tavily`,
        'tavily-key',
      );
    });

    it('rejects an empty apiKey without touching SecretStorage', async () => {
      const h = makeHarness();
      h.handlers.register();

      const response = await h.rpcHandler.handleMessage({
        method: 'webSearch:setApiKey',
        params: { provider: 'tavily', apiKey: '' },
        correlationId: 'corr',
      });

      expect(response.success).toBe(false);
      expect(response.error).toMatch(/cannot be empty/i);
      expect(h.secretStorage.store).not.toHaveBeenCalled();
    });

    it('rejects a whitespace-only apiKey', async () => {
      const h = makeHarness();
      h.handlers.register();

      const response = await h.rpcHandler.handleMessage({
        method: 'webSearch:setApiKey',
        params: { provider: 'serper', apiKey: '   \t  ' },
        correlationId: 'corr',
      });

      expect(response.success).toBe(false);
      expect(response.error).toMatch(/cannot be empty/i);
      expect(h.secretStorage.store).not.toHaveBeenCalled();
    });

    it('rejects an unsupported provider before validating the apiKey', async () => {
      const h = makeHarness();
      h.handlers.register();

      const response = await h.rpcHandler.handleMessage({
        method: 'webSearch:setApiKey',
        params: { provider: 'bing', apiKey: 'valid-key' },
        correlationId: 'corr',
      });

      expect(response.success).toBe(false);
      expect(response.error).toMatch(/invalid web search provider/i);
      expect(h.secretStorage.store).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // webSearch:deleteApiKey
  // -------------------------------------------------------------------------

  describe('webSearch:deleteApiKey', () => {
    it('deletes the namespaced key and returns success=true', async () => {
      const h = makeHarness({
        secrets: { [`${SECRET_KEY_PREFIX}.tavily`]: 'old-key' },
      });
      h.handlers.register();

      const result = await call<{ success: boolean }>(
        h,
        'webSearch:deleteApiKey',
        { provider: 'tavily' },
      );

      expect(result.success).toBe(true);
      expect(h.secretStorage.delete).toHaveBeenCalledWith(
        `${SECRET_KEY_PREFIX}.tavily`,
      );
      // Seed map no longer has the entry after delete.
      expect(
        h.secretStorage.__state.entries.has(`${SECRET_KEY_PREFIX}.tavily`),
      ).toBe(false);
    });

    it('is idempotent — delete with no stored key still succeeds', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean }>(
        h,
        'webSearch:deleteApiKey',
        { provider: 'exa' },
      );

      expect(result.success).toBe(true);
    });

    it('rejects an unsupported provider before calling SecretStorage.delete()', async () => {
      const h = makeHarness();
      h.handlers.register();

      const response = await h.rpcHandler.handleMessage({
        method: 'webSearch:deleteApiKey',
        params: { provider: 'anthropic' },
        correlationId: 'corr',
      });

      expect(response.success).toBe(false);
      expect(response.error).toMatch(/invalid web search provider/i);
      expect(h.secretStorage.delete).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // webSearch:test
  // -------------------------------------------------------------------------

  describe('webSearch:test', () => {
    it('returns one failed result per configured provider when API keys are missing', async () => {
      const h = makeHarness({
        config: {
          'ptah.webSearch.providers': ['tavily', 'serper'],
        },
      });
      h.handlers.register();

      const result = await call<{
        success: boolean;
        results: Array<{ provider: string; success: boolean; error?: string }>;
      }>(h, 'webSearch:test');

      expect(result.success).toBe(false);
      expect(result.results).toEqual([
        expect.objectContaining({
          provider: 'tavily',
          success: false,
          error: expect.stringMatching(/no api key configured/i),
        }),
        expect.objectContaining({
          provider: 'serper',
          success: false,
          error: expect.stringMatching(/no api key configured/i),
        }),
      ]);
      // No search attempted without a key.
      expect(searchFn).not.toHaveBeenCalled();
    });

    it('constructs the matching adapter and reports success when the search resolves', async () => {
      const h = makeHarness({
        secrets: { [`${SECRET_KEY_PREFIX}.serper`]: 'serper-key' },
        config: { 'ptah.webSearch.providers': ['serper'] },
      });
      searchFn.mockResolvedValue({ results: [] });
      h.handlers.register();

      const result = await call<{
        success: boolean;
        results: Array<{ provider: string; success: boolean }>;
      }>(h, 'webSearch:test');

      expect(result.success).toBe(true);
      expect(result.results).toEqual([{ provider: 'serper', success: true }]);
      // Adapter picked the serper class path, not tavily / exa.
      expect(searchFn).toHaveBeenCalledWith('serper', 'test', 1);
    });

    it('surfaces an adapter failure as a structured response (not a throw)', async () => {
      const h = makeHarness({
        secrets: { [`${SECRET_KEY_PREFIX}.exa`]: 'exa-key' },
        config: { 'ptah.webSearch.providers': ['exa'] },
      });
      searchFn.mockRejectedValue(new Error('401 unauthorized'));
      h.handlers.register();

      const result = await call<{
        success: boolean;
        results: Array<{ provider: string; success: boolean; error?: string }>;
      }>(h, 'webSearch:test');

      expect(result.success).toBe(false);
      expect(result.results).toEqual([
        {
          provider: 'exa',
          success: false,
          error: '401 unauthorized',
        },
      ]);
    });

    it('reports partial provider success without failing the aggregate test', async () => {
      const h = makeHarness({
        secrets: {
          [`${SECRET_KEY_PREFIX}.tavily`]: 'tavily-key',
          [`${SECRET_KEY_PREFIX}.serper`]: 'serper-key',
        },
        config: { 'ptah.webSearch.providers': ['tavily', 'serper'] },
      });
      searchFn.mockImplementation((provider: string) => {
        if (provider === 'tavily') {
          return Promise.reject(new Error('tavily unavailable'));
        }
        return Promise.resolve({ results: [] });
      });
      h.handlers.register();

      const result = await call<{
        success: boolean;
        results: Array<{ provider: string; success: boolean; error?: string }>;
      }>(h, 'webSearch:test');

      expect(result.success).toBe(true);
      expect(result.results).toEqual([
        {
          provider: 'tavily',
          success: false,
          error: 'tavily unavailable',
        },
        { provider: 'serper', success: true },
      ]);
      expect(searchFn).toHaveBeenCalledTimes(2);
    });

    it('falls back to the "tavily" default when no provider is configured', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{
        success: boolean;
        results: Array<{ provider: string; success: boolean }>;
      }>(h, 'webSearch:test');

      // Without a stored API key the handler early-returns, but we still
      // expect the default provider label in the response so the UI can say
      // "No API key configured for tavily" instead of "<undefined>".
      expect(result.success).toBe(false);
      expect(result.results[0]).toEqual(
        expect.objectContaining({ provider: 'tavily', success: false }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // webSearch:getConfig
  // -------------------------------------------------------------------------

  describe('webSearch:getConfig', () => {
    it('returns the stored providers + maxResults from the workspace provider', async () => {
      const h = makeHarness({
        config: {
          'ptah.webSearch.providers': ['exa', 'serper'],
          'ptah.webSearch.maxResults': 12,
        },
      });
      h.handlers.register();

      const result = await call<{ providers: string[]; maxResults: number }>(
        h,
        'webSearch:getConfig',
      );

      expect(result.providers).toEqual(['exa', 'serper']);
      expect(result.maxResults).toBe(12);
    });

    it('falls back to the legacy single-provider key', async () => {
      const h = makeHarness({
        config: { 'ptah.webSearch.provider': 'serper' },
      });
      h.handlers.register();

      const result = await call<{ providers: string[]; maxResults: number }>(
        h,
        'webSearch:getConfig',
      );

      expect(result.providers).toEqual(['serper']);
    });

    it('uses the legacy key when the configured provider list is empty', async () => {
      const h = makeHarness({
        config: {
          'ptah.webSearch.providers': [],
          'ptah.webSearch.provider': 'exa',
        },
      });
      h.handlers.register();

      const result = await call<{ providers: string[] }>(
        h,
        'webSearch:getConfig',
      );

      expect(result.providers).toEqual(['exa']);
    });

    it('filters invalid providers and logs a warning naming each one', async () => {
      const h = makeHarness({
        config: {
          'ptah.webSearch.providers': ['tavily', 'google', 'serper'],
        },
      });
      h.handlers.register();

      const result = await call<{ providers: string[] }>(
        h,
        'webSearch:getConfig',
      );

      expect(result.providers).toEqual(['tavily', 'serper']);
      expect(h.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('google'),
        { provider: 'google' },
      );
    });

    it('returns sensible defaults when nothing is configured', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ providers: string[]; maxResults: number }>(
        h,
        'webSearch:getConfig',
      );

      // Defaults live in the handler: [tavily] / 5.
      expect(result.providers).toEqual(['tavily']);
      expect(result.maxResults).toBe(5);
    });
  });

  // -------------------------------------------------------------------------
  // webSearch:setConfig
  // -------------------------------------------------------------------------

  describe('webSearch:setConfig', () => {
    it('writes a non-empty provider list and clears the legacy key', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean }>(
        h,
        'webSearch:setConfig',
        {
          providers: ['serper', 'exa'],
        },
      );

      expect(result.success).toBe(true);
      expect(h.workspace.setConfiguration).toHaveBeenCalledWith(
        'ptah',
        'webSearch.providers',
        ['serper', 'exa'],
      );
      expect(h.workspace.setConfiguration).toHaveBeenCalledWith(
        'ptah',
        'webSearch.provider',
        undefined,
      );
    });

    it.each([[[]], [['tavily', 'google']]])(
      'rejects invalid provider list %p before writing config',
      async (providers) => {
        const h = makeHarness();
        h.handlers.register();

        const response = await h.rpcHandler.handleMessage({
          method: 'webSearch:setConfig',
          params: { providers },
          correlationId: 'corr',
        });

        expect(response.success).toBe(false);
        expect(h.workspace.setConfiguration).not.toHaveBeenCalled();
      },
    );

    it.each([
      [0, 1], // clamp up
      [1, 1],
      [5, 5],
      [20, 20],
      [500, 20], // clamp down
      [-10, 1], // clamp up from negative
    ])('clamps maxResults %p to %p', async (input, expected) => {
      const h = makeHarness();
      h.handlers.register();

      await call(h, 'webSearch:setConfig', { maxResults: input });

      expect(h.workspace.setConfiguration).toHaveBeenCalledWith(
        'ptah',
        'webSearch.maxResults',
        expected,
      );
    });

    it('writes both providers and maxResults when both are supplied', async () => {
      const h = makeHarness();
      h.handlers.register();

      await call(h, 'webSearch:setConfig', {
        providers: ['tavily', 'exa'],
        maxResults: 7,
      });

      expect(h.workspace.setConfiguration).toHaveBeenCalledWith(
        'ptah',
        'webSearch.providers',
        ['tavily', 'exa'],
      );
      expect(h.workspace.setConfiguration).toHaveBeenCalledWith(
        'ptah',
        'webSearch.maxResults',
        7,
      );
    });

    it('no-ops when neither field is supplied', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean }>(
        h,
        'webSearch:setConfig',
        {},
      );

      expect(result.success).toBe(true);
      expect(h.workspace.setConfiguration).not.toHaveBeenCalled();
    });

    it('degrades gracefully when the workspace provider lacks setConfiguration', async () => {
      // A hypothetical platform impl without setConfiguration — handler
      // should log and return success rather than throw. Use a crafted mock
      // that omits setConfiguration from the jest.Mocked surface.
      const loggerLocal = createMockLogger();
      const rpc = createMockRpcHandler();
      const secrets = createMockSecretStorage();
      const sentryLocal = createMockSentryService();

      const workspace = {
        getWorkspaceFolders: jest.fn(() => []),
        getWorkspaceRoot: jest.fn(() => undefined),
        getConfiguration: jest.fn(),
        onDidChangeConfiguration:
          jest.fn() as unknown as IWorkspaceProvider['onDidChangeConfiguration'],
        onDidChangeWorkspaceFolders:
          jest.fn() as unknown as IWorkspaceProvider['onDidChangeWorkspaceFolders'],
        // Intentionally NO setConfiguration
      } satisfies Partial<IWorkspaceProvider>;

      const handlers = new WebSearchRpcHandlers(
        loggerLocal as unknown as Logger,
        rpc as unknown as import('@ptah-extension/vscode-core').RpcHandler,
        secrets as unknown as ISecretStorage,
        workspace as unknown as IWorkspaceProvider,
        sentryLocal as unknown as SentryService,
      );
      handlers.register();

      const response = await rpc.handleMessage({
        method: 'webSearch:setConfig',
        params: { providers: ['tavily'] },
        correlationId: 'corr',
      });

      expect(response.success).toBe(true);
      // Handler falls through to the safety-fallback debug log.
      expect(loggerLocal.debug).toHaveBeenCalled();
    });
  });
});
