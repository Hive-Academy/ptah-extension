/**
 * Unit tests for WebSearchService (multi-provider router).
 *
 * Covers:
 *   - Query validation (empty / whitespace / length clamp)
 *   - Timeout clamping (default / user / MAX)
 *   - Configuration reading (provider, maxResults) with options override
 *   - API key retrieval via ISecretStorage and error on absence
 *   - Provider factory dispatch (tavily / serper / exa) + unknown fallback
 *   - Summary synthesis when provider returns no summary
 *   - Error wrapping with provider label
 *   - Timeout behaviour via the internal `createTimeoutPromise`
 *   - Logger emission on success and failure
 */

import 'reflect-metadata';

import type {
  ISecretStorage,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import type { Logger } from '@ptah-extension/vscode-core';

import { WebSearchService } from './web-search.service';
import type { WebSearchDependencies } from './web-search.service';
import type {
  IWebSearchProvider,
  WebSearchProviderResult,
} from './web-search-provider.interface';

import { TavilySearchProvider } from './providers/tavily.provider';
import { SerperSearchProvider } from './providers/serper.provider';
import { ExaSearchProvider } from './providers/exa.provider';

// ---------------------------------------------------------------------------
// Mock provider SDKs so `new TavilySearchProvider(apiKey)` etc. do not hit the
// network during construction. We then stub their `search` methods per-test.
// ---------------------------------------------------------------------------

jest.mock('./providers/tavily.provider');
jest.mock('./providers/serper.provider');
jest.mock('./providers/exa.provider');

const MockedTavily = TavilySearchProvider as jest.MockedClass<
  typeof TavilySearchProvider
>;
const MockedSerper = SerperSearchProvider as jest.MockedClass<
  typeof SerperSearchProvider
>;
const MockedExa = ExaSearchProvider as jest.MockedClass<
  typeof ExaSearchProvider
>;

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createLogger(): jest.Mocked<Logger> {
  return {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
}

function createSecretStorage(
  apiKey: string | undefined | 'OMIT' = 'test-api-key',
): jest.Mocked<ISecretStorage> {
  return {
    get: jest.fn().mockResolvedValue(apiKey === 'OMIT' ? undefined : apiKey),
    store: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    onDidChange: jest.fn(),
  } as unknown as jest.Mocked<ISecretStorage>;
}

function createWorkspaceProvider(overrides: {
  provider?: string;
  maxResults?: number;
}): jest.Mocked<IWorkspaceProvider> {
  return {
    getConfiguration: jest.fn(
      (_section: string, key: string, fallback: unknown) => {
        if (key === 'webSearch.provider') {
          return overrides.provider ?? fallback;
        }
        if (key === 'webSearch.maxResults') {
          return overrides.maxResults ?? fallback;
        }
        return fallback;
      },
    ),
  } as unknown as jest.Mocked<IWorkspaceProvider>;
}

function mockProviderResult(
  MockedCls: jest.MockedClass<
    | typeof TavilySearchProvider
    | typeof SerperSearchProvider
    | typeof ExaSearchProvider
  >,
  result: WebSearchProviderResult | Error,
): jest.Mock {
  const searchFn = jest.fn<
    Promise<WebSearchProviderResult>,
    [string, number]
  >();
  if (result instanceof Error) {
    searchFn.mockRejectedValue(result);
  } else {
    searchFn.mockResolvedValue(result);
  }
  // Cast via `unknown` because the mocked class's real constructor type
  // demands private fields we don't stub.
  (
    MockedCls.mockImplementation as unknown as (
      impl: () => IWebSearchProvider,
    ) => void
  )(
    () =>
      ({
        name: 'tavily',
        search: searchFn,
      }) as unknown as IWebSearchProvider,
  );
  return searchFn;
}

function buildService(deps?: Partial<WebSearchDependencies>): {
  service: WebSearchService;
  deps: WebSearchDependencies;
  logger: jest.Mocked<Logger>;
  secretStorage: jest.Mocked<ISecretStorage>;
  workspaceProvider: jest.Mocked<IWorkspaceProvider>;
} {
  const logger = (deps?.logger as jest.Mocked<Logger>) ?? createLogger();
  const secretStorage =
    (deps?.secretStorage as jest.Mocked<ISecretStorage>) ??
    createSecretStorage();
  const workspaceProvider =
    (deps?.workspaceProvider as jest.Mocked<IWorkspaceProvider>) ??
    createWorkspaceProvider({});
  const full: WebSearchDependencies = {
    logger,
    secretStorage,
    workspaceProvider,
  };
  return {
    service: new WebSearchService(full),
    deps: full,
    logger,
    secretStorage,
    workspaceProvider,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebSearchService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  describe('query validation', () => {
    it('rejects empty query', async () => {
      const { service } = buildService();
      await expect(service.search('')).rejects.toThrow(
        'Web search query must not be empty',
      );
    });

    it('rejects whitespace-only query', async () => {
      const { service } = buildService();
      await expect(service.search('   \n\t ')).rejects.toThrow(
        'Web search query must not be empty',
      );
    });

    it('rejects null/undefined query gracefully', async () => {
      const { service } = buildService();
      await expect(
        service.search(undefined as unknown as string),
      ).rejects.toThrow('Web search query must not be empty');
    });

    it('clamps queries over 2000 chars', async () => {
      const searchFn = mockProviderResult(MockedTavily, {
        results: [],
        summary: 'ok',
      });
      const longQuery = 'a'.repeat(2500);
      const { service } = buildService();
      await service.search(longQuery);
      expect(searchFn).toHaveBeenCalledWith('a'.repeat(2000), 5);
    });

    it('trims surrounding whitespace from query', async () => {
      const searchFn = mockProviderResult(MockedTavily, {
        results: [],
        summary: 'ok',
      });
      const { service } = buildService();
      await service.search('   hello world   ');
      expect(searchFn).toHaveBeenCalledWith('hello world', expect.any(Number));
    });
  });

  describe('provider routing', () => {
    it('routes to Tavily by default when no provider configured', async () => {
      mockProviderResult(MockedTavily, { results: [], summary: 'ok' });
      const { service } = buildService();
      const result = await service.search('query');
      expect(result.provider).toBe('tavily');
      expect(MockedTavily).toHaveBeenCalledWith('test-api-key');
      expect(MockedSerper).not.toHaveBeenCalled();
      expect(MockedExa).not.toHaveBeenCalled();
    });

    it('routes to Serper when configured', async () => {
      mockProviderResult(MockedSerper, { results: [], summary: undefined });
      const workspaceProvider = createWorkspaceProvider({ provider: 'serper' });
      const { service } = buildService({ workspaceProvider });
      const result = await service.search('query');
      expect(result.provider).toBe('serper');
      expect(MockedSerper).toHaveBeenCalledTimes(1);
      expect(MockedTavily).not.toHaveBeenCalled();
    });

    it('routes to Exa when configured', async () => {
      mockProviderResult(MockedExa, { results: [], summary: undefined });
      const workspaceProvider = createWorkspaceProvider({ provider: 'exa' });
      const { service } = buildService({ workspaceProvider });
      const result = await service.search('query');
      expect(result.provider).toBe('exa');
      expect(MockedExa).toHaveBeenCalledTimes(1);
    });

    it('falls back to Tavily and warns when provider value is unknown', async () => {
      mockProviderResult(MockedTavily, { results: [], summary: 'ok' });
      const workspaceProvider = createWorkspaceProvider({
        provider: 'bing-dotcom-invalid',
      });
      const { service, logger } = buildService({ workspaceProvider });
      const result = await service.search('query');
      expect(result.provider).toBe('tavily');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Unknown provider "bing-dotcom-invalid"'),
        'WebSearchService',
      );
    });

    it('instantiates a fresh provider per search (for hot-swapped keys)', async () => {
      mockProviderResult(MockedTavily, { results: [], summary: 'ok' });
      const { service } = buildService();
      await service.search('first');
      await service.search('second');
      expect(MockedTavily).toHaveBeenCalledTimes(2);
    });
  });

  describe('API key retrieval', () => {
    it('reads the secret using the provider-scoped key', async () => {
      mockProviderResult(MockedSerper, { results: [], summary: undefined });
      const workspaceProvider = createWorkspaceProvider({ provider: 'serper' });
      const secretStorage = createSecretStorage('serper-key');
      const { service } = buildService({ secretStorage, workspaceProvider });
      await service.search('q');
      expect(secretStorage.get).toHaveBeenCalledWith(
        'ptah.webSearch.apiKey.serper',
      );
    });

    it('throws a configuration-guidance error when API key missing', async () => {
      const secretStorage = createSecretStorage('OMIT');
      const { service } = buildService({ secretStorage });
      await expect(service.search('q')).rejects.toThrow(
        /No API key configured for tavily/,
      );
      expect(MockedTavily).not.toHaveBeenCalled();
    });

    it('allows empty-string API key through to the provider (no "No API key" error)', async () => {
      // Empty-string secrets (e.g. user cleared their key) should NOT raise
      // the configuration-guidance error — they should be passed through to
      // the provider, which will produce a more specific upstream error.
      mockProviderResult(MockedTavily, { results: [], summary: undefined });
      const secretStorage = createSecretStorage('');
      const { service } = buildService({ secretStorage });
      await expect(service.search('q')).resolves.toBeDefined();
      expect(MockedTavily).toHaveBeenCalledWith('');
    });
  });

  describe('maxResults resolution', () => {
    it('uses default of 5 when no config or option present', async () => {
      const searchFn = mockProviderResult(MockedTavily, {
        results: [],
        summary: 'x',
      });
      const { service } = buildService();
      await service.search('q');
      expect(searchFn).toHaveBeenCalledWith(expect.any(String), 5);
    });

    it('uses configured maxResults when provided', async () => {
      const searchFn = mockProviderResult(MockedTavily, {
        results: [],
        summary: 'x',
      });
      const workspaceProvider = createWorkspaceProvider({ maxResults: 12 });
      const { service } = buildService({ workspaceProvider });
      await service.search('q');
      expect(searchFn).toHaveBeenCalledWith(expect.any(String), 12);
    });

    it('options.maxResults overrides config', async () => {
      const searchFn = mockProviderResult(MockedTavily, {
        results: [],
        summary: 'x',
      });
      const workspaceProvider = createWorkspaceProvider({ maxResults: 12 });
      const { service } = buildService({ workspaceProvider });
      await service.search('q', { maxResults: 3 });
      expect(searchFn).toHaveBeenCalledWith(expect.any(String), 3);
    });
  });

  describe('result normalization', () => {
    it('returns provider-supplied summary when present', async () => {
      mockProviderResult(MockedTavily, {
        results: [{ title: 'a', url: 'https://a', snippet: 's' }],
        summary: 'Native Tavily answer',
      });
      const { service } = buildService();
      const res = await service.search('q');
      expect(res.summary).toBe('Native Tavily answer');
      expect(res.resultCount).toBe(1);
      expect(res.results).toHaveLength(1);
    });

    it('synthesizes summary from top 3 results when provider returns no summary', async () => {
      mockProviderResult(MockedSerper, {
        results: [
          { title: 'T1', url: 'https://1', snippet: 's1' },
          { title: 'T2', url: 'https://2', snippet: 's2' },
          { title: 'T3', url: 'https://3', snippet: 's3' },
          { title: 'T4', url: 'https://4', snippet: 's4' },
        ],
        summary: undefined,
      });
      const workspaceProvider = createWorkspaceProvider({ provider: 'serper' });
      const { service } = buildService({ workspaceProvider });
      const res = await service.search('q');
      expect(res.summary).toContain('1. T1: s1');
      expect(res.summary).toContain('2. T2: s2');
      expect(res.summary).toContain('3. T3: s3');
      expect(res.summary).not.toContain('T4');
      expect(res.resultCount).toBe(4);
    });

    it('returns "No results found." when provider returns empty array', async () => {
      mockProviderResult(MockedExa, { results: [], summary: undefined });
      const workspaceProvider = createWorkspaceProvider({ provider: 'exa' });
      const { service } = buildService({ workspaceProvider });
      const res = await service.search('q');
      expect(res.summary).toBe('No results found.');
      expect(res.resultCount).toBe(0);
    });

    it('records a non-negative durationMs', async () => {
      mockProviderResult(MockedTavily, { results: [], summary: 'x' });
      const { service } = buildService();
      const res = await service.search('q');
      expect(res.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('returns the sanitized query on the result', async () => {
      mockProviderResult(MockedTavily, { results: [], summary: 'x' });
      const { service } = buildService();
      const res = await service.search('   spaced   ');
      expect(res.query).toBe('spaced');
    });
  });

  describe('error handling', () => {
    it('wraps provider errors with a provider-scoped message', async () => {
      mockProviderResult(
        MockedTavily,
        new Error('Tavily API error: invalid or expired API key.'),
      );
      const { service } = buildService();
      await expect(service.search('q')).rejects.toThrow(
        /Web search failed \(tavily\):.*invalid or expired/,
      );
    });

    it('logs a warning when provider fails', async () => {
      mockProviderResult(MockedSerper, new Error('HTTP 500'));
      const workspaceProvider = createWorkspaceProvider({ provider: 'serper' });
      const { service, logger } = buildService({ workspaceProvider });
      await expect(service.search('q')).rejects.toThrow();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('[WebSearch] Failed via serper'),
        'WebSearchService',
        expect.objectContaining({ error: 'HTTP 500' }),
      );
    });

    it('handles non-Error rejections from provider', async () => {
      const searchFn = jest.fn<
        Promise<WebSearchProviderResult>,
        [string, number]
      >();
      searchFn.mockRejectedValue('string failure');
      (
        MockedExa.mockImplementation as unknown as (
          impl: () => IWebSearchProvider,
        ) => void
      )(
        () =>
          ({
            name: 'exa',
            search: searchFn,
          }) as unknown as IWebSearchProvider,
      );
      const workspaceProvider = createWorkspaceProvider({ provider: 'exa' });
      const { service } = buildService({ workspaceProvider });
      await expect(service.search('q')).rejects.toThrow(
        /Web search failed \(exa\): string failure/,
      );
    });
  });

  describe('timeout handling', () => {
    it('rejects with timeout error when provider never resolves', async () => {
      jest.useFakeTimers();
      const neverResolving = new Promise<WebSearchProviderResult>(() => {
        /* pending */
      });
      const searchFn = jest.fn<
        Promise<WebSearchProviderResult>,
        [string, number]
      >(() => neverResolving);
      (
        MockedTavily.mockImplementation as unknown as (
          impl: () => IWebSearchProvider,
        ) => void
      )(
        () =>
          ({
            name: 'tavily',
            search: searchFn,
          }) as unknown as IWebSearchProvider,
      );

      const { service } = buildService();
      const promise = service.search('q', { timeout: 1000 });

      // Let the service reach the Promise.race and its setTimeout
      await Promise.resolve();
      await Promise.resolve();
      jest.advanceTimersByTime(1001);

      await expect(promise).rejects.toThrow(/Search timed out after 1s/);
    });

    it('clamps requested timeouts above MAX to 60s', async () => {
      jest.useFakeTimers();
      const neverResolving = new Promise<WebSearchProviderResult>(() => {
        /* pending */
      });
      const searchFn = jest.fn<
        Promise<WebSearchProviderResult>,
        [string, number]
      >(() => neverResolving);
      (
        MockedTavily.mockImplementation as unknown as (
          impl: () => IWebSearchProvider,
        ) => void
      )(
        () =>
          ({
            name: 'tavily',
            search: searchFn,
          }) as unknown as IWebSearchProvider,
      );
      const { service } = buildService();
      const promise = service.search('q', { timeout: 10 * 60 * 1000 });
      await Promise.resolve();
      await Promise.resolve();
      jest.advanceTimersByTime(60_000 + 10);
      await expect(promise).rejects.toThrow(/Search timed out after 60s/);
    });
  });

  describe('logging', () => {
    it('logs info with truncated query on success', async () => {
      mockProviderResult(MockedTavily, {
        results: [{ title: 't', url: 'u', snippet: 's' }],
        summary: 'x',
      });
      const { service, logger } = buildService();
      const longQuery = 'q'.repeat(200);
      await service.search(longQuery);
      expect(logger.info).toHaveBeenCalledWith(
        '[WebSearch] Completed',
        'WebSearchService',
        expect.objectContaining({
          provider: 'tavily',
          resultCount: 1,
        }),
      );
      const logCall = logger.info.mock.calls[0];
      const meta = logCall[2] as { query: string };
      expect(meta.query.length).toBeLessThanOrEqual(80);
    });
  });
});
