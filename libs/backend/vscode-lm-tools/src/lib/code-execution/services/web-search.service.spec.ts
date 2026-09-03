/**
 * Unit tests for WebSearchService (parallel multi-provider search).
 *
 * Covers:
 *   - Query validation (empty / whitespace / length clamp)
 *   - Timeout clamping (default / user / MAX)
 *   - Provider selection: list config, legacy single-value key, options
 *     override, de-duplication, invalid entries
 *   - Per-provider API key retrieval and missing-key isolation
 *   - Parallel isolation: one provider failing never affects another
 *   - Merge + de-duplication by normalized URL with `sources` attribution
 *   - Summary selection and synthesis
 *   - Total failure throwing once, naming every provider and reason
 *   - Logger emission on failure and on completion
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
  WebSearchProviderType,
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

type MockedProviderClass = jest.MockedClass<
  | typeof TavilySearchProvider
  | typeof SerperSearchProvider
  | typeof ExaSearchProvider
>;

/** A provider stub outcome: a payload, a rejection, or "never resolves". */
type StubOutcome = WebSearchProviderResult | Error | 'never' | 'reject-string';

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
  value:
    | string
    | undefined
    | 'OMIT'
    | Record<string, string | undefined> = 'test-api-key',
): jest.Mocked<ISecretStorage> {
  const get = jest.fn(async (key: string) => {
    if (typeof value === 'object' && value !== null) {
      return value[key];
    }
    return value === 'OMIT' ? undefined : value;
  });
  return {
    get,
    store: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    onDidChange: jest.fn(),
  } as unknown as jest.Mocked<ISecretStorage>;
}

function createWorkspaceProvider(overrides: {
  providers?: string[];
  provider?: string;
  maxResults?: number;
}): jest.Mocked<IWorkspaceProvider> {
  return {
    getConfiguration: jest.fn(
      (_section: string, key: string, fallback: unknown) => {
        if (key === 'webSearch.providers') {
          return overrides.providers ?? fallback;
        }
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

function stubProvider(
  MockedCls: MockedProviderClass,
  name: WebSearchProviderType,
  outcome: StubOutcome,
): jest.Mock<Promise<WebSearchProviderResult>, [string, number]> {
  const searchFn = jest.fn<
    Promise<WebSearchProviderResult>,
    [string, number]
  >();
  if (outcome === 'never') {
    searchFn.mockImplementation(
      () =>
        new Promise<WebSearchProviderResult>(() => {
          /* pending forever */
        }),
    );
  } else if (outcome === 'reject-string') {
    searchFn.mockRejectedValue('string failure');
  } else if (outcome instanceof Error) {
    searchFn.mockRejectedValue(outcome);
  } else {
    searchFn.mockResolvedValue(outcome);
  }
  (
    MockedCls.mockImplementation as unknown as (
      impl: () => IWebSearchProvider,
    ) => void
  )(
    () =>
      ({
        name,
        search: searchFn,
      }) as unknown as IWebSearchProvider,
  );
  return searchFn;
}

function buildService(deps?: Partial<WebSearchDependencies>): {
  service: WebSearchService;
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
    logger,
    secretStorage,
    workspaceProvider,
  };
}

/** Fake timers freeze the clock, not the microtask queue. */
async function flushMicrotasks(times = 20): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
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
      const searchFn = stubProvider(MockedTavily, 'tavily', {
        results: [],
        summary: 'ok',
      });
      const { service } = buildService();
      await service.search('a'.repeat(2500));
      expect(searchFn).toHaveBeenCalledWith('a'.repeat(2000), 5);
    });

    it('trims surrounding whitespace from query', async () => {
      const searchFn = stubProvider(MockedTavily, 'tavily', {
        results: [],
        summary: 'ok',
      });
      const { service } = buildService();
      await service.search('   hello world   ');
      expect(searchFn).toHaveBeenCalledWith('hello world', expect.any(Number));
    });
  });

  describe('provider selection', () => {
    it('defaults to tavily when nothing is configured', async () => {
      stubProvider(MockedTavily, 'tavily', { results: [], summary: 'ok' });
      const { service } = buildService();
      const result = await service.search('query');
      expect(result.providers).toEqual(['tavily']);
      expect(MockedTavily).toHaveBeenCalledWith('test-api-key');
      expect(MockedSerper).not.toHaveBeenCalled();
      expect(MockedExa).not.toHaveBeenCalled();
    });

    it('reads the configured list and attempts every provider in order', async () => {
      stubProvider(MockedTavily, 'tavily', { results: [], summary: 'ok' });
      stubProvider(MockedSerper, 'serper', { results: [] });
      stubProvider(MockedExa, 'exa', { results: [] });
      const workspaceProvider = createWorkspaceProvider({
        providers: ['serper', 'exa', 'tavily'],
      });
      const { service } = buildService({ workspaceProvider });
      const result = await service.search('query');
      expect(result.providers).toEqual(['serper', 'exa', 'tavily']);
      expect(result.outcomes.map((o) => o.provider)).toEqual([
        'serper',
        'exa',
        'tavily',
      ]);
      expect(MockedSerper).toHaveBeenCalledTimes(1);
      expect(MockedExa).toHaveBeenCalledTimes(1);
      expect(MockedTavily).toHaveBeenCalledTimes(1);
    });

    it('falls back to the legacy single provider key when the list is absent', async () => {
      stubProvider(MockedSerper, 'serper', { results: [] });
      const workspaceProvider = createWorkspaceProvider({ provider: 'serper' });
      const { service } = buildService({ workspaceProvider });
      const result = await service.search('query');
      expect(result.providers).toEqual(['serper']);
      expect(MockedTavily).not.toHaveBeenCalled();
    });

    it('prefers the list over the legacy key when both are present', async () => {
      stubProvider(MockedExa, 'exa', { results: [] });
      const workspaceProvider = createWorkspaceProvider({
        providers: ['exa'],
        provider: 'serper',
      });
      const { service } = buildService({ workspaceProvider });
      const result = await service.search('query');
      expect(result.providers).toEqual(['exa']);
    });

    it('de-duplicates repeated entries and preserves order', async () => {
      stubProvider(MockedTavily, 'tavily', { results: [] });
      stubProvider(MockedSerper, 'serper', { results: [] });
      const workspaceProvider = createWorkspaceProvider({
        providers: ['serper', 'tavily', 'serper'],
      });
      const { service } = buildService({ workspaceProvider });
      const result = await service.search('query');
      expect(result.providers).toEqual(['serper', 'tavily']);
      expect(MockedSerper).toHaveBeenCalledTimes(1);
    });

    it('drops an invalid entry with a warning and keeps the valid ones', async () => {
      stubProvider(MockedTavily, 'tavily', { results: [] });
      const workspaceProvider = createWorkspaceProvider({
        providers: ['bing-dotcom-invalid', 'tavily'],
      });
      const { service, logger } = buildService({ workspaceProvider });
      const result = await service.search('query');
      expect(result.providers).toEqual(['tavily']);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Unknown provider "bing-dotcom-invalid"'),
        'WebSearchService',
      );
    });

    it('falls back to tavily when every configured entry is invalid', async () => {
      stubProvider(MockedTavily, 'tavily', { results: [] });
      const workspaceProvider = createWorkspaceProvider({
        providers: ['nope', 'also-nope'],
      });
      const { service, logger } = buildService({ workspaceProvider });
      const result = await service.search('query');
      expect(result.providers).toEqual(['tavily']);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('falling back to tavily'),
        'WebSearchService',
      );
    });

    it('options.providers overrides the configured list', async () => {
      stubProvider(MockedExa, 'exa', { results: [] });
      const workspaceProvider = createWorkspaceProvider({
        providers: ['tavily', 'serper'],
      });
      const { service } = buildService({ workspaceProvider });
      const result = await service.search('query', { providers: ['exa'] });
      expect(result.providers).toEqual(['exa']);
      expect(MockedTavily).not.toHaveBeenCalled();
      expect(MockedSerper).not.toHaveBeenCalled();
    });

    it('instantiates a fresh provider per search (for hot-swapped keys)', async () => {
      stubProvider(MockedTavily, 'tavily', { results: [], summary: 'ok' });
      const { service } = buildService();
      await service.search('first');
      await service.search('second');
      expect(MockedTavily).toHaveBeenCalledTimes(2);
    });
  });

  describe('API key retrieval', () => {
    it('reads the secret using the provider-scoped key', async () => {
      stubProvider(MockedSerper, 'serper', { results: [] });
      const workspaceProvider = createWorkspaceProvider({
        providers: ['serper'],
      });
      const secretStorage = createSecretStorage('serper-key');
      const { service } = buildService({ secretStorage, workspaceProvider });
      await service.search('q');
      expect(secretStorage.get).toHaveBeenCalledWith(
        'ptah.webSearch.apiKey.serper',
      );
    });

    it('treats a missing key as that provider alone failing', async () => {
      const tavilySearch = stubProvider(MockedTavily, 'tavily', {
        results: [{ title: 'T', url: 'https://t', snippet: 's' }],
      });
      const workspaceProvider = createWorkspaceProvider({
        providers: ['tavily', 'serper'],
      });
      const secretStorage = createSecretStorage({
        'ptah.webSearch.apiKey.tavily': 'tavily-key',
      });
      const { service } = buildService({ secretStorage, workspaceProvider });

      const result = await service.search('q');

      expect(result.status).toBe('partial');
      expect(result.resultCount).toBe(1);
      expect(tavilySearch).toHaveBeenCalledTimes(1);
      expect(MockedSerper).not.toHaveBeenCalled();
      const serper = result.outcomes.find((o) => o.provider === 'serper');
      expect(serper).toMatchObject({
        status: 'failed',
        reason: 'missing-api-key',
      });
      expect(serper?.message).toMatch(/No API key configured for serper/);
    });

    it('classifies an empty-string API key as missing-api-key', async () => {
      stubProvider(MockedTavily, 'tavily', { results: [] });
      const workspaceProvider = createWorkspaceProvider({
        providers: ['tavily', 'serper'],
      });
      const secretStorage = createSecretStorage({
        'ptah.webSearch.apiKey.tavily': 'tavily-key',
        'ptah.webSearch.apiKey.serper': '',
      });
      const { service } = buildService({ secretStorage, workspaceProvider });

      const result = await service.search('q');

      expect(result.status).toBe('partial');
      expect(result.outcomes[1]).toMatchObject({
        provider: 'serper',
        status: 'failed',
        reason: 'missing-api-key',
      });
      expect(result.outcomes[1].message).toMatch(
        /No API key configured for serper/,
      );
      expect(MockedSerper).not.toHaveBeenCalled();
    });
  });

  describe('maxResults resolution', () => {
    it('uses default of 5 when no config or option present', async () => {
      const searchFn = stubProvider(MockedTavily, 'tavily', {
        results: [],
        summary: 'x',
      });
      const { service } = buildService();
      await service.search('q');
      expect(searchFn).toHaveBeenCalledWith(expect.any(String), 5);
    });

    it('uses configured maxResults when provided', async () => {
      const searchFn = stubProvider(MockedTavily, 'tavily', {
        results: [],
        summary: 'x',
      });
      const workspaceProvider = createWorkspaceProvider({ maxResults: 12 });
      const { service } = buildService({ workspaceProvider });
      await service.search('q');
      expect(searchFn).toHaveBeenCalledWith(expect.any(String), 12);
    });

    it('options.maxResults overrides config', async () => {
      const searchFn = stubProvider(MockedTavily, 'tavily', {
        results: [],
        summary: 'x',
      });
      const workspaceProvider = createWorkspaceProvider({ maxResults: 12 });
      const { service } = buildService({ workspaceProvider });
      await service.search('q', { maxResults: 3 });
      expect(searchFn).toHaveBeenCalledWith(expect.any(String), 3);
    });
  });

  describe('merging and de-duplication', () => {
    it('merges results in selection order and tags each with its sources', async () => {
      stubProvider(MockedTavily, 'tavily', {
        results: [{ title: 'A', url: 'https://a', snippet: 'sa' }],
      });
      stubProvider(MockedSerper, 'serper', {
        results: [{ title: 'B', url: 'https://b', snippet: 'sb' }],
      });
      const workspaceProvider = createWorkspaceProvider({
        providers: ['tavily', 'serper'],
      });
      const { service } = buildService({ workspaceProvider });

      const result = await service.search('q');

      expect(result.results.map((r) => r.title)).toEqual(['A', 'B']);
      expect(result.results[0].sources).toEqual(['tavily']);
      expect(result.results[1].sources).toEqual(['serper']);
      expect(result.resultCount).toBe(2);
    });

    it('collapses the same URL across providers, first occurrence winning', async () => {
      stubProvider(MockedTavily, 'tavily', {
        results: [
          {
            title: 'Tavily title',
            url: 'https://Example.com/Doc',
            snippet: 'first',
          },
        ],
      });
      stubProvider(MockedSerper, 'serper', {
        results: [
          {
            title: 'Serper title',
            url: 'https://example.com/Doc/#section',
            snippet: 'second',
          },
          { title: 'Unique', url: 'https://other.com/x', snippet: 'third' },
        ],
      });
      const workspaceProvider = createWorkspaceProvider({
        providers: ['tavily', 'serper'],
      });
      const { service } = buildService({ workspaceProvider });

      const result = await service.search('q');

      expect(result.results).toHaveLength(2);
      expect(result.results[0].title).toBe('Tavily title');
      expect(result.results[0].snippet).toBe('first');
      expect(result.results[0].sources).toEqual(['tavily', 'serper']);
      expect(result.results[1].sources).toEqual(['serper']);
    });

    it('trims the merged list to maxResults', async () => {
      stubProvider(MockedTavily, 'tavily', {
        results: [
          { title: 'A', url: 'https://a', snippet: 's' },
          { title: 'B', url: 'https://b', snippet: 's' },
        ],
      });
      stubProvider(MockedSerper, 'serper', {
        results: [{ title: 'C', url: 'https://c', snippet: 's' }],
      });
      const workspaceProvider = createWorkspaceProvider({
        providers: ['tavily', 'serper'],
      });
      const { service } = buildService({ workspaceProvider });

      const result = await service.search('q', { maxResults: 2 });

      // Round-robin: tavily A, serper C, then tavily B. The cut keeps A and C.
      expect(result.results.map((r) => r.title)).toEqual(['A', 'C']);
      expect(result.resultCount).toBe(2);
    });

    // -------------------------------------------------------------------
    // F7 regression — the trim must not discard every row of a provider
    // that `outcomes` still reports as ok.
    // -------------------------------------------------------------------

    it('interleaves the providers round-robin instead of concatenating them', async () => {
      stubProvider(MockedTavily, 'tavily', {
        results: [
          { title: 'T1', url: 'https://t/1', snippet: 's' },
          { title: 'T2', url: 'https://t/2', snippet: 's' },
          { title: 'T3', url: 'https://t/3', snippet: 's' },
        ],
      });
      stubProvider(MockedSerper, 'serper', {
        results: [
          { title: 'S1', url: 'https://s/1', snippet: 's' },
          { title: 'S2', url: 'https://s/2', snippet: 's' },
          { title: 'S3', url: 'https://s/3', snippet: 's' },
        ],
      });
      const workspaceProvider = createWorkspaceProvider({
        providers: ['tavily', 'serper'],
      });
      const { service } = buildService({ workspaceProvider });

      const result = await service.search('q', { maxResults: 6 });

      expect(result.results.map((r) => r.title)).toEqual([
        'T1',
        'S1',
        'T2',
        'S2',
        'T3',
        'S3',
      ]);
    });

    it('keeps a provider reported ok visible after the maxResults trim', async () => {
      const five = (prefix: string) =>
        Array.from({ length: 5 }, (_, i) => ({
          title: prefix + i,
          url: 'https://' + prefix + '/' + i,
          snippet: 's',
        }));
      stubProvider(MockedTavily, 'tavily', { results: five('tav') });
      stubProvider(MockedSerper, 'serper', { results: five('ser') });
      const workspaceProvider = createWorkspaceProvider({
        providers: ['tavily', 'serper'],
      });
      const { service } = buildService({ workspaceProvider });

      const result = await service.search('q', { maxResults: 5 });

      expect(result.results).toHaveLength(5);
      const visible = new Set(result.results.flatMap((r) => r.sources));
      // Every provider whose outcome says ok contributes at least one row.
      for (const outcome of result.outcomes) {
        expect(outcome.status).toBe('ok');
        expect(visible.has(outcome.provider)).toBe(true);
      }
    });

    it('interleaves the remaining providers when one of them fails', async () => {
      stubProvider(MockedTavily, 'tavily', new Error('boom'));
      stubProvider(MockedSerper, 'serper', {
        results: [
          { title: 'S1', url: 'https://s/1', snippet: 's' },
          { title: 'S2', url: 'https://s/2', snippet: 's' },
        ],
      });
      stubProvider(MockedExa, 'exa', {
        results: [{ title: 'E1', url: 'https://e/1', snippet: 's' }],
      });
      const workspaceProvider = createWorkspaceProvider({
        providers: ['tavily', 'serper', 'exa'],
      });
      const { service } = buildService({ workspaceProvider });

      const result = await service.search('q', { maxResults: 2 });

      expect(result.results.map((r) => r.title)).toEqual(['S1', 'E1']);
    });

    // -------------------------------------------------------------------
    // F8 regression — the trailing-slash strip is path-scoped, and both
    // normalization branches apply the same rule.
    // -------------------------------------------------------------------

    it('does not collapse a trailing slash that belongs to the query string', async () => {
      stubProvider(MockedTavily, 'tavily', {
        results: [
          {
            title: 'With slash',
            url: 'https://example.com/a?b=1/',
            snippet: 's',
          },
        ],
      });
      stubProvider(MockedSerper, 'serper', {
        results: [
          {
            title: 'Without slash',
            url: 'https://example.com/a?b=1',
            snippet: 's',
          },
        ],
      });
      const workspaceProvider = createWorkspaceProvider({
        providers: ['tavily', 'serper'],
      });
      const { service } = buildService({ workspaceProvider });

      const result = await service.search('q');

      expect(result.results).toHaveLength(2);
      expect(result.results.map((r) => r.title)).toEqual([
        'With slash',
        'Without slash',
      ]);
    });

    it('collapses repeated trailing slashes on the path', async () => {
      stubProvider(MockedTavily, 'tavily', {
        results: [
          { title: 'First', url: 'https://example.com/p//', snippet: 's' },
        ],
      });
      stubProvider(MockedSerper, 'serper', {
        results: [
          { title: 'Second', url: 'https://example.com/p', snippet: 's' },
        ],
      });
      const workspaceProvider = createWorkspaceProvider({
        providers: ['tavily', 'serper'],
      });
      const { service } = buildService({ workspaceProvider });

      const result = await service.search('q');

      expect(result.results).toHaveLength(1);
      expect(result.results[0].sources).toEqual(['tavily', 'serper']);
    });

    it('keeps two paths that differ only in case distinct', async () => {
      stubProvider(MockedTavily, 'tavily', {
        results: [
          { title: 'Upper', url: 'https://EXAMPLE.com/Doc', snippet: 's' },
        ],
      });
      stubProvider(MockedSerper, 'serper', {
        results: [
          { title: 'Lower', url: 'https://example.com/doc', snippet: 's' },
        ],
      });
      const workspaceProvider = createWorkspaceProvider({
        providers: ['tavily', 'serper'],
      });
      const { service } = buildService({ workspaceProvider });

      const result = await service.search('q');

      expect(result.results).toHaveLength(2);
    });

    it('applies the same trailing-slash and case rule to an unparseable URL', async () => {
      stubProvider(MockedTavily, 'tavily', {
        results: [
          { title: 'First', url: 'not-a-url//', snippet: 's' },
          { title: 'Cased', url: 'Not-A-Url', snippet: 's' },
        ],
      });
      stubProvider(MockedSerper, 'serper', {
        results: [{ title: 'Second', url: '  not-a-url  ', snippet: 's' }],
      });
      const workspaceProvider = createWorkspaceProvider({
        providers: ['tavily', 'serper'],
      });
      const { service } = buildService({ workspaceProvider });

      const result = await service.search('q');

      expect(result.results.map((r) => r.title)).toEqual(['First', 'Cased']);
      expect(result.results[0].sources).toEqual(['tavily', 'serper']);
    });
  });

  describe('summary', () => {
    it('prefers the first native summary in selection order', async () => {
      stubProvider(MockedSerper, 'serper', { results: [] });
      stubProvider(MockedTavily, 'tavily', {
        results: [],
        summary: 'Native Tavily answer',
      });
      const workspaceProvider = createWorkspaceProvider({
        providers: ['serper', 'tavily'],
      });
      const { service } = buildService({ workspaceProvider });
      const res = await service.search('q');
      expect(res.summary).toBe('Native Tavily answer');
    });

    it('synthesizes a summary from the top 3 merged results', async () => {
      stubProvider(MockedSerper, 'serper', {
        results: [
          { title: 'T1', url: 'https://1', snippet: 's1' },
          { title: 'T2', url: 'https://2', snippet: 's2' },
          { title: 'T3', url: 'https://3', snippet: 's3' },
          { title: 'T4', url: 'https://4', snippet: 's4' },
        ],
      });
      const workspaceProvider = createWorkspaceProvider({
        providers: ['serper'],
        maxResults: 10,
      });
      const { service } = buildService({ workspaceProvider });
      const res = await service.search('q');
      expect(res.summary).toContain('1. T1: s1');
      expect(res.summary).toContain('2. T2: s2');
      expect(res.summary).toContain('3. T3: s3');
      expect(res.summary).not.toContain('T4');
      expect(res.resultCount).toBe(4);
    });

    it('returns "No results found." when every provider returns nothing', async () => {
      stubProvider(MockedExa, 'exa', { results: [] });
      const workspaceProvider = createWorkspaceProvider({ providers: ['exa'] });
      const { service } = buildService({ workspaceProvider });
      const res = await service.search('q');
      expect(res.summary).toBe('No results found.');
      expect(res.resultCount).toBe(0);
      expect(res.status).toBe('ok');
    });

    it('records a non-negative durationMs and the sanitized query', async () => {
      stubProvider(MockedTavily, 'tavily', { results: [], summary: 'x' });
      const { service } = buildService();
      const res = await service.search('   spaced   ');
      expect(res.durationMs).toBeGreaterThanOrEqual(0);
      expect(res.query).toBe('spaced');
    });
  });

  describe('provider isolation', () => {
    it('returns the working provider results when another provider fails', async () => {
      stubProvider(MockedTavily, 'tavily', new Error('HTTP 500'));
      stubProvider(MockedSerper, 'serper', {
        results: [{ title: 'B', url: 'https://b', snippet: 'sb' }],
      });
      const workspaceProvider = createWorkspaceProvider({
        providers: ['tavily', 'serper'],
      });
      const { service } = buildService({ workspaceProvider });

      const result = await service.search('q');

      expect(result.status).toBe('partial');
      expect(result.results.map((r) => r.title)).toEqual(['B']);
      expect(result.outcomes).toEqual([
        expect.objectContaining({
          provider: 'tavily',
          status: 'failed',
          reason: 'provider-error',
          message: 'HTTP 500',
          resultCount: 0,
        }),
        expect.objectContaining({
          provider: 'serper',
          status: 'ok',
          resultCount: 1,
        }),
      ]);
    });

    it('reports status ok only when every provider succeeded', async () => {
      stubProvider(MockedTavily, 'tavily', { results: [] });
      stubProvider(MockedSerper, 'serper', { results: [] });
      const workspaceProvider = createWorkspaceProvider({
        providers: ['tavily', 'serper'],
      });
      const { service } = buildService({ workspaceProvider });
      const result = await service.search('q');
      expect(result.status).toBe('ok');
      expect(result.outcomes.every((o) => o.status === 'ok')).toBe(true);
    });

    it('logs one warning per failed provider', async () => {
      stubProvider(MockedTavily, 'tavily', new Error('HTTP 500'));
      stubProvider(MockedSerper, 'serper', { results: [] });
      const workspaceProvider = createWorkspaceProvider({
        providers: ['tavily', 'serper'],
      });
      const { service, logger } = buildService({ workspaceProvider });

      await service.search('q');

      expect(logger.warn).toHaveBeenCalledWith(
        '[WebSearch] Failed via tavily',
        'WebSearchService',
        expect.objectContaining({
          error: 'HTTP 500',
          reason: 'provider-error',
        }),
      );
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it('handles a non-Error rejection from a provider', async () => {
      stubProvider(MockedExa, 'exa', 'reject-string');
      stubProvider(MockedTavily, 'tavily', { results: [] });
      const workspaceProvider = createWorkspaceProvider({
        providers: ['exa', 'tavily'],
      });
      const { service } = buildService({ workspaceProvider });

      const result = await service.search('q');

      expect(result.outcomes[0]).toMatchObject({
        provider: 'exa',
        status: 'failed',
        message: 'string failure',
      });
    });
  });

  describe('total failure', () => {
    it('throws once, naming every provider and its reason', async () => {
      stubProvider(MockedTavily, 'tavily', new Error('HTTP 500'));
      const workspaceProvider = createWorkspaceProvider({
        providers: ['tavily', 'serper'],
      });
      const secretStorage = createSecretStorage({
        'ptah.webSearch.apiKey.tavily': 'tavily-key',
      });
      const { service } = buildService({ secretStorage, workspaceProvider });

      await expect(service.search('q')).rejects.toThrow(
        /Web search failed on all providers: tavily \(provider-error: HTTP 500\); serper \(missing-api-key: No API key configured for serper/,
      );
    });

    it('throws when the only provider has no API key', async () => {
      const secretStorage = createSecretStorage('OMIT');
      const { service } = buildService({ secretStorage });
      await expect(service.search('q')).rejects.toThrow(
        /No API key configured for tavily/,
      );
      expect(MockedTavily).not.toHaveBeenCalled();
    });
  });

  describe('timeout handling', () => {
    it('clears the timeout after a successful provider search', async () => {
      jest.useFakeTimers();
      stubProvider(MockedTavily, 'tavily', { results: [], summary: 'ok' });
      const { service } = buildService();

      await service.search('q');

      expect(jest.getTimerCount()).toBe(0);
    });

    it('classifies a provider that never resolves as a timeout failure', async () => {
      jest.useFakeTimers();
      stubProvider(MockedTavily, 'tavily', 'never');
      stubProvider(MockedSerper, 'serper', {
        results: [{ title: 'B', url: 'https://b', snippet: 'sb' }],
      });
      const workspaceProvider = createWorkspaceProvider({
        providers: ['tavily', 'serper'],
      });
      const { service } = buildService({ workspaceProvider });

      const promise = service.search('q', { timeout: 1000 });
      await flushMicrotasks();
      jest.advanceTimersByTime(1001);
      const result = await promise;

      expect(result.status).toBe('partial');
      expect(result.results).toHaveLength(1);
      expect(result.outcomes[0]).toMatchObject({
        provider: 'tavily',
        status: 'failed',
        reason: 'timeout',
      });
      expect(result.outcomes[0].message).toMatch(/Search timed out after 1s/);
    });

    it('clamps requested timeouts above MAX to 60s', async () => {
      jest.useFakeTimers();
      stubProvider(MockedTavily, 'tavily', 'never');
      const { service } = buildService();

      const promise = service.search('q', { timeout: 10 * 60 * 1000 });
      await flushMicrotasks();
      jest.advanceTimersByTime(60_000 + 10);

      await expect(promise).rejects.toThrow(/Search timed out after 60s/);
    });
  });

  describe('logging', () => {
    it('logs one completion line with providers, status and result count', async () => {
      stubProvider(MockedTavily, 'tavily', {
        results: [{ title: 't', url: 'https://u', snippet: 's' }],
        summary: 'x',
      });
      stubProvider(MockedSerper, 'serper', { results: [] });
      const workspaceProvider = createWorkspaceProvider({
        providers: ['tavily', 'serper'],
      });
      const { service, logger } = buildService({ workspaceProvider });

      await service.search('q'.repeat(200));

      expect(logger.info).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith(
        '[WebSearch] Completed',
        'WebSearchService',
        expect.objectContaining({
          providers: ['tavily', 'serper'],
          status: 'ok',
          resultCount: 1,
        }),
      );
      const meta = logger.info.mock.calls[0][2] as { query: string };
      expect(meta.query.length).toBeLessThanOrEqual(80);
    });
  });
});
