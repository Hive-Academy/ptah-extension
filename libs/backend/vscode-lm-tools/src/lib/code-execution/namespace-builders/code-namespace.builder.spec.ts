// The workspace-intelligence barrel (the language registry) loads tsyringe.
import 'reflect-metadata';
import type {
  CodeIndexFreshness,
  ICodeSymbolReader,
  IMemoryReader,
  CodeSymbolHit,
  MemoryHit,
} from '@ptah-extension/memory-contracts';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  withCoverageVerdict,
  type CoverageFields,
  type LanguageCoverage,
} from '@ptah-extension/platform-core';
import {
  hasCapability,
  type CodeSymbolIndexer,
} from '@ptah-extension/workspace-intelligence';
import {
  applyToolResultBudget,
  getToolResultBudget,
} from '../mcp-core/tool-result-budget';
import {
  buildCodeNamespace,
  CODE_INDEX_STALE_MS,
  startIndexFreshnessCheck,
  type CodeNamespaceDependencies,
  type ReindexResult,
  type ReindexStarted,
  type SymbolSearchResult,
} from './code-namespace.builder';

function makeCodeHit(over: Partial<CodeSymbolHit> = {}): CodeSymbolHit {
  return {
    id: '01',
    workspaceRoot: '/ws',
    filePath: '/ws/src/auth.ts',
    kind: 'function',
    symbolName: 'login',
    subject: 'code:/ws/src/auth.ts#login',
    text: 'function login() {}',
    tokenCount: 5,
    score: 0.04,
    ...over,
  };
}

function makeMemoryHit(over: Partial<MemoryHit> = {}): MemoryHit {
  return {
    memoryId: 'm1',
    subject: 'code:/ws/src/auth.ts#login',
    content: '',
    chunkText: 'function login() {}',
    score: 0.03,
    tier: 'archival',
    ...over,
  };
}

function makeDeps(
  over: Partial<CodeNamespaceDependencies> = {},
): CodeNamespaceDependencies {
  return {
    getCodeSymbolSearch: () => undefined,
    getMemorySearch: () => undefined,
    getSymbolIndexer: () => undefined,
    getWorkspaceRoot: () => '/ws',
    getHostWorkspaceRoots: () => ['/ws'],
    logger: { warn: jest.fn() },
    ...over,
  };
}

describe('buildCodeNamespace.searchSymbols', () => {
  it('uses the dedicated code-symbol reader when available', async () => {
    const reader: ICodeSymbolReader = {
      searchSymbols: jest
        .fn()
        .mockResolvedValue({ hits: [makeCodeHit()], bm25Only: false }),
    };
    const ns = buildCodeNamespace(
      makeDeps({ getCodeSymbolSearch: () => reader }),
    );

    const result = (await ns.searchSymbols('validate token', {
      maxResults: 5,
    })) as SymbolSearchResult;

    expect(reader.searchSymbols).toHaveBeenCalledWith(
      'validate token',
      5,
      '/ws',
    );
    expect(result.bm25Only).toBe(false);
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]).toMatchObject({
      symbolName: 'login',
      filePath: '/ws/src/auth.ts',
      kind: 'function',
      text: 'function login() {}',
    });
  });

  it('filters dedicated reader hits by the filePath option', async () => {
    const reader: ICodeSymbolReader = {
      searchSymbols: jest.fn().mockResolvedValue({
        hits: [
          makeCodeHit({ filePath: '/ws/src/auth.ts' }),
          makeCodeHit({
            filePath: '/ws/src/math.ts',
            symbolName: 'add',
            subject: 'code:/ws/src/math.ts#add',
          }),
        ],
        bm25Only: false,
      }),
    };
    const ns = buildCodeNamespace(
      makeDeps({ getCodeSymbolSearch: () => reader }),
    );

    const result = (await ns.searchSymbols('x', {
      filePath: 'auth.ts',
    })) as SymbolSearchResult;

    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].filePath).toBe('/ws/src/auth.ts');
  });

  it('falls back to the memory reader, filtered to code subjects', async () => {
    const memory: IMemoryReader = {
      search: jest.fn().mockResolvedValue({
        hits: [
          makeMemoryHit(),
          makeMemoryHit({
            memoryId: 'm2',
            subject: 'note:not-code',
            tier: 'archival',
          }),
          makeMemoryHit({
            memoryId: 'm3',
            subject: 'code:/ws/src/x.ts#y',
            tier: 'recall',
          }),
        ],
        bm25Only: true,
      }),
    };
    const ns = buildCodeNamespace(makeDeps({ getMemorySearch: () => memory }));

    const result = (await ns.searchSymbols('login', {})) as SymbolSearchResult;

    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]).toMatchObject({
      filePath: '/ws/src/auth.ts',
      symbolName: 'login',
    });
  });

  it('returns an error when neither search service is available', async () => {
    const ns = buildCodeNamespace(makeDeps());
    const result = await ns.searchSymbols('login');
    expect('error' in result).toBe(true);
    expect(result).toMatchObject({ hits: [] });
  });

  it('returns an error result when the dedicated reader throws', async () => {
    const reader: ICodeSymbolReader = {
      searchSymbols: jest.fn().mockRejectedValue(new Error('db gone')),
    };
    const ns = buildCodeNamespace(
      makeDeps({ getCodeSymbolSearch: () => reader }),
    );
    const result = await ns.searchSymbols('login');
    expect('error' in result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Index freshness (TASK_2026_559 Batch 6, User Decision 1)
// ---------------------------------------------------------------------------

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;

interface Deferred {
  promise: Promise<never>;
  resolve: () => void;
  reject: (error: unknown) => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<never>((res, rej) => {
    resolve = () => res(undefined as never);
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets settled background chains (`then` → `finally` → `catch`) run. */
async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

interface IndexerDouble {
  indexer: CodeSymbolIndexer;
  indexWorkspace: jest.Mock;
  reindexFile: jest.Mock;
  runs: Deferred[];
  /** Roots whose full run the double has not settled. */
  activeRoots: Set<string>;
}

/**
 * An indexer whose every full run stays pending until the spec settles it.
 * `isIndexing` is true for a root from the synchronous `indexWorkspace`
 * call until that run's promise settles — the real indexer's contract.
 */
function makeIndexer(): IndexerDouble {
  const runs: Deferred[] = [];
  const activeRoots = new Set<string>();
  const indexWorkspace = jest.fn((root: string) => {
    const run = deferred();
    runs.push(run);
    activeRoots.add(root);
    void run.promise.then(
      () => {
        activeRoots.delete(root);
      },
      () => {
        activeRoots.delete(root);
      },
    );
    return run.promise;
  });
  const reindexFile = jest
    .fn()
    .mockResolvedValue({ symbolsIndexed: 4, errors: 0, durationMs: 12 });
  const isIndexing = jest.fn((root: string) => activeRoots.has(root));
  return {
    indexer: {
      indexWorkspace,
      reindexFile,
      isIndexing,
    } as unknown as CodeSymbolIndexer,
    indexWorkspace,
    reindexFile,
    runs,
    activeRoots,
  };
}

function makeReader(freshness: CodeIndexFreshness | Error): ICodeSymbolReader {
  return {
    searchSymbols: jest
      .fn()
      .mockResolvedValue({ hits: [makeCodeHit()], bm25Only: false }),
    getIndexFreshness: jest.fn(() =>
      freshness instanceof Error
        ? Promise.reject(freshness)
        : Promise.resolve(freshness),
    ),
  };
}

function freshnessDeps(
  reader: ICodeSymbolReader | undefined,
  double: IndexerDouble | undefined,
  over: Partial<CodeNamespaceDependencies> = {},
): CodeNamespaceDependencies {
  return makeDeps({
    getCodeSymbolSearch: () => reader,
    getSymbolIndexer: () => double?.indexer,
    now: () => NOW,
    ...over,
  });
}

const EMPTY: CodeIndexFreshness = { symbolCount: 0, newestUpdatedAt: null };

describe('buildCodeNamespace.ensureIndexFresh', () => {
  it('starts exactly one governed background run across 3 concurrent calls on a stale index', async () => {
    const double = makeIndexer();
    const ns = buildCodeNamespace(freshnessDeps(makeReader(EMPTY), double));

    const statuses = await Promise.all([
      ns.ensureIndexFresh(),
      ns.ensureIndexFresh(),
      ns.ensureIndexFresh(),
    ]);
    await flush();

    expect(double.indexWorkspace).toHaveBeenCalledTimes(1);
    expect(double.indexWorkspace).toHaveBeenCalledWith('/ws', {
      userInitiated: false,
    });
    expect(statuses.filter((s) => s.reindexStarted)).toHaveLength(1);
    for (const status of statuses) {
      expect(status).toMatchObject({
        symbolCount: 0,
        indexAgeMs: null,
        reindexInFlight: true,
      });
    }
  });

  it('never starts a second run while one is still in flight, even past the 24h gap', async () => {
    let clock = NOW;
    const double = makeIndexer();
    const ns = buildCodeNamespace(
      freshnessDeps(makeReader(EMPTY), double, { now: () => clock }),
    );

    await ns.ensureIndexFresh();
    clock += CODE_INDEX_STALE_MS + 1;
    const later = await ns.ensureIndexFresh();
    await flush();

    expect(later).toMatchObject({
      reindexStarted: false,
      reindexInFlight: true,
    });
    expect(double.indexWorkspace).toHaveBeenCalledTimes(1);
  });

  it('returns before the background run settles (never awaits the indexer)', async () => {
    const double = makeIndexer();
    const ns = buildCodeNamespace(freshnessDeps(makeReader(EMPTY), double));

    const status = await ns.ensureIndexFresh();
    await flush();

    expect(status.reindexStarted).toBe(true);
    // The run is still pending: the call above resolved without it.
    expect(double.runs).toHaveLength(1);
  });

  it('treats an index older than 24h as stale', async () => {
    const double = makeIndexer();
    const ns = buildCodeNamespace(
      freshnessDeps(
        makeReader({
          symbolCount: 50,
          newestUpdatedAt: NOW - CODE_INDEX_STALE_MS - 1,
        }),
        double,
      ),
    );

    const status = await ns.ensureIndexFresh();
    await flush();

    expect(status).toEqual({
      symbolCount: 50,
      indexAgeMs: CODE_INDEX_STALE_MS + 1,
      reindexStarted: true,
      reindexInFlight: true,
    });
    expect(double.indexWorkspace).toHaveBeenCalledTimes(1);
  });

  it('never triggers on a fresh index', async () => {
    const double = makeIndexer();
    const ns = buildCodeNamespace(
      freshnessDeps(
        makeReader({ symbolCount: 50, newestUpdatedAt: NOW - HOUR }),
        double,
      ),
    );

    const status = await ns.ensureIndexFresh();
    await ns.ensureIndexFresh();
    await flush();

    expect(double.indexWorkspace).not.toHaveBeenCalled();
    expect(status).toEqual({
      symbolCount: 50,
      indexAgeMs: HOUR,
      reindexStarted: false,
      reindexInFlight: false,
    });
  });

  it('never computes an age from a null newestUpdatedAt, and does not trigger on it', async () => {
    const double = makeIndexer();
    const ns = buildCodeNamespace(
      freshnessDeps(
        makeReader({ symbolCount: 5, newestUpdatedAt: null }),
        double,
      ),
    );

    const status = await ns.ensureIndexFresh();

    expect(status.indexAgeMs).toBeNull();
    expect(double.indexWorkspace).not.toHaveBeenCalled();
  });

  it('reports unknown freshness and never triggers when the reader has no getIndexFreshness', async () => {
    const double = makeIndexer();
    const reader: ICodeSymbolReader = {
      searchSymbols: jest.fn().mockResolvedValue({ hits: [], bm25Only: false }),
    };
    const ns = buildCodeNamespace(freshnessDeps(reader, double));

    const status = await ns.ensureIndexFresh();

    expect(status).toEqual({
      symbolCount: null,
      indexAgeMs: null,
      reindexStarted: false,
      reindexInFlight: false,
    });
    expect(double.indexWorkspace).not.toHaveBeenCalled();
  });

  it('reports freshness but never triggers when there is no indexer (VS Code)', async () => {
    const ns = buildCodeNamespace(freshnessDeps(makeReader(EMPTY), undefined));

    const status = await ns.ensureIndexFresh();

    expect(status).toMatchObject({ symbolCount: 0, reindexStarted: false });
  });

  it('never reindexes a caller-declared root the host did not record', async () => {
    const double = makeIndexer();
    const reader = makeReader(EMPTY);
    const ns = buildCodeNamespace(
      freshnessDeps(reader, double, {
        getWorkspaceRoot: () => '/declared/elsewhere',
        getHostWorkspaceRoots: () => ['/ws'],
      }),
    );

    const status = await ns.ensureIndexFresh();

    expect(reader.getIndexFreshness).toHaveBeenCalledWith(
      '/declared/elsewhere',
    );
    expect(status.reindexStarted).toBe(false);
    expect(double.indexWorkspace).not.toHaveBeenCalled();
  });

  it('logs a rejected run with fixed text, clears the latch, and waits 24h before the next lazy run', async () => {
    let clock = NOW;
    const warn = jest.fn();
    const double = makeIndexer();
    const ns = buildCodeNamespace(
      freshnessDeps(makeReader(EMPTY), double, {
        now: () => clock,
        logger: { warn },
      }),
    );

    await ns.ensureIndexFresh();
    double.runs[0].reject(new Error('EACCES: /secret/path/file.ts'));
    await flush();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('/secret/path');
    const afterFailure = await ns.ensureIndexFresh();
    expect(afterFailure).toMatchObject({
      reindexStarted: false,
      reindexInFlight: false,
    });
    expect(double.indexWorkspace).toHaveBeenCalledTimes(1);

    clock += CODE_INDEX_STALE_MS;
    const nextDay = await ns.ensureIndexFresh();
    expect(nextDay.reindexStarted).toBe(true);
    expect(double.indexWorkspace).toHaveBeenCalledTimes(2);
  });

  it('does not log a governor abort (a clean stop)', async () => {
    const warn = jest.fn();
    const double = makeIndexer();
    const ns = buildCodeNamespace(
      freshnessDeps(makeReader(EMPTY), double, { logger: { warn } }),
    );

    await ns.ensureIndexFresh();
    double.runs[0].reject(new DOMException('Aborted', 'AbortError'));
    await flush();

    expect(warn).not.toHaveBeenCalled();
    expect((await ns.ensureIndexFresh()).reindexInFlight).toBe(false);
  });

  it('resolves to unknown freshness when the freshness read rejects', async () => {
    const warn = jest.fn();
    const double = makeIndexer();
    const ns = buildCodeNamespace(
      freshnessDeps(makeReader(new Error('db at /secret gone')), double, {
        logger: { warn },
      }),
    );

    await expect(ns.ensureIndexFresh()).resolves.toEqual({
      symbolCount: null,
      indexAgeMs: null,
      reindexStarted: false,
      reindexInFlight: false,
    });
    expect(double.indexWorkspace).not.toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain('/secret');
  });

  it('does not start a second indexWorkspace when the indexer already has a run for the root', async () => {
    let active = true;
    const double = makeIndexer();
    (double.indexer.isIndexing as unknown as jest.Mock).mockImplementation(
      () => active,
    );
    // The lifecycle already owns the one full run.
    const lifecycle = deferred();
    double.runs.push(lifecycle);
    double.indexWorkspace.mockImplementation(() => lifecycle.promise);
    void double.indexer.indexWorkspace('/ws');
    double.indexWorkspace.mockClear();

    const ns = buildCodeNamespace(freshnessDeps(makeReader(EMPTY), double));
    const result = (await ns.searchSymbols('login')) as SymbolSearchResult;
    await flush();

    expect(double.indexWorkspace).not.toHaveBeenCalled();
    expect(result.index).toMatchObject({
      reindexStarted: false,
      reindexInFlight: true,
    });

    active = false;
    lifecycle.resolve();
    await flush();
    const later = (await ns.searchSymbols('login')) as SymbolSearchResult;
    await flush();

    expect(later.index.reindexStarted).toBe(true);
    expect(double.indexWorkspace).toHaveBeenCalledTimes(1);
    expect(double.indexWorkspace).toHaveBeenCalledWith('/ws', {
      userInitiated: false,
    });
  });

  it('still reports a pending run as in flight when the freshness read rejects', async () => {
    const warn = jest.fn();
    const double = makeIndexer();
    const reader = makeReader(EMPTY);
    const ns = buildCodeNamespace(
      freshnessDeps(reader, double, { logger: { warn } }),
    );

    await ns.reindex();
    (reader.getIndexFreshness as jest.Mock).mockRejectedValue(
      new Error('db at /secret gone'),
    );
    const status = await ns.ensureIndexFresh();
    await flush();

    expect(status).toEqual({
      symbolCount: null,
      indexAgeMs: null,
      reindexStarted: false,
      reindexInFlight: true,
    });
    expect(double.indexWorkspace).toHaveBeenCalledTimes(1);
    expect(double.runs).toHaveLength(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('/secret');
  });
});

describe('buildCodeNamespace.searchSymbols — index freshness', () => {
  it('reports a pending run as in flight when the freshness read rejects', async () => {
    const warn = jest.fn();
    const double = makeIndexer();
    const reader = makeReader(EMPTY);
    const ns = buildCodeNamespace(
      freshnessDeps(reader, double, { logger: { warn } }),
    );

    await ns.reindex();
    (reader.getIndexFreshness as jest.Mock).mockRejectedValue(
      new Error('db at /secret gone'),
    );
    const result = (await ns.searchSymbols('login')) as SymbolSearchResult;
    await flush();

    expect(result.hits).toHaveLength(1);
    expect(result.index).toEqual({
      symbolCount: null,
      indexAgeMs: null,
      reindexStarted: false,
      reindexInFlight: true,
    });
    expect(double.indexWorkspace).toHaveBeenCalledTimes(1);
    expect(double.runs).toHaveLength(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('/secret');
  });

  it('returns the freshness block with the hits', async () => {
    const double = makeIndexer();
    const ns = buildCodeNamespace(freshnessDeps(makeReader(EMPTY), double));

    const result = (await ns.searchSymbols('login')) as SymbolSearchResult;

    expect(result.hits).toHaveLength(1);
    expect(result.index).toEqual({
      symbolCount: 0,
      indexAgeMs: null,
      reindexStarted: true,
      reindexInFlight: true,
    });
  });

  it('does not surface an indexer rejection as a search error', async () => {
    const double = makeIndexer();
    const ns = buildCodeNamespace(freshnessDeps(makeReader(EMPTY), double));

    const result = await ns.searchSymbols('login');
    double.runs[0].reject(new Error('indexer exploded'));
    await flush();
    const again = await ns.searchSymbols('login');

    expect('error' in result).toBe(false);
    expect('error' in again).toBe(false);
    expect((again as SymbolSearchResult).hits).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Live coverage and unsupported answers (TASK_2026_559 Batch 24b)
// ---------------------------------------------------------------------------

const CODE_INDEX_LANGUAGES = [
  'typescript',
  'javascript',
  'tsx',
  'python',
  'go',
  'csharp',
  'java',
  'kotlin',
  'rust',
  'php',
  'ruby',
  'cpp',
];

function coverageOf(over: Partial<CoverageFields> = {}): LanguageCoverage {
  return withCoverageVerdict({
    supportedLanguages:
      CODE_INDEX_LANGUAGES as LanguageCoverage['supportedLanguages'],
    census: 'complete',
    state: 'current',
    analyzed: 12,
    unchecked: 0,
    failed: 0,
    unsupported: 3,
    unrecognised: null,
    nonSource: null,
    excluded: null,
    omittedByCap: 0,
    unsupportedByLanguage: { swift: 3 },
    ...over,
  });
}

/**
 * An indexer double with the live-state contract: a run begins when
 * `indexWorkspace` is called (synchronously), and `getCoverage` reports it.
 */
function makeLiveIndexer(): IndexerDouble & { getCoverage: jest.Mock } {
  const double = makeIndexer();
  let running = false;
  double.indexWorkspace.mockImplementation((root: string) => {
    running = true;
    double.activeRoots.add(root);
    const run = deferred();
    double.runs.push(run);
    void run.promise.then(
      () => {
        running = false;
        double.activeRoots.delete(root);
      },
      () => {
        running = false;
        double.activeRoots.delete(root);
      },
    );
    return run.promise;
  });
  const getCoverage = jest.fn(() =>
    running
      ? coverageOf({
          census: 'unknown',
          state: 'updating',
          analyzed: null,
          unchecked: null,
          failed: null,
          unsupported: null,
          omittedByCap: null,
          unsupportedByLanguage: undefined,
        })
      : coverageOf(),
  );
  Object.assign(double.indexer, { getCoverage });
  return { ...double, getCoverage };
}

describe('buildCodeNamespace — live coverage (Batch 24b)', () => {
  it('search answers { index, coverage, bm25Only, hits }, coverage before hits', async () => {
    const double = makeLiveIndexer();
    const fresh: CodeIndexFreshness = {
      symbolCount: 40,
      newestUpdatedAt: NOW - HOUR,
    };
    const ns = buildCodeNamespace(freshnessDeps(makeReader(fresh), double));

    const result = (await ns.searchSymbols('login')) as SymbolSearchResult;

    expect(Object.keys(result)).toEqual([
      'index',
      'coverage',
      'bm25Only',
      'hits',
    ]);
    expect(result.coverage).toEqual(coverageOf());
    expect(double.getCoverage).toHaveBeenCalledWith('/ws');
  });

  it('a search that starts the lazy run reports updating: the run begins before the start returns', async () => {
    const double = makeLiveIndexer();
    const ns = buildCodeNamespace(freshnessDeps(makeReader(EMPTY), double));

    const result = (await ns.searchSymbols('login')) as SymbolSearchResult;

    expect(result.index.reindexStarted).toBe(true);
    expect(result.coverage).toMatchObject({
      census: 'unknown',
      state: 'updating',
    });
  });

  it('r1 S1: a write pending when the search began keeps the answer updating even if it lands during the read', async () => {
    const live = makeLiveIndexer();
    const updating = coverageOf({ state: 'updating' });
    live.getCoverage
      .mockReturnValueOnce(updating)
      .mockReturnValueOnce(coverageOf());
    const fresh: CodeIndexFreshness = {
      symbolCount: 40,
      newestUpdatedAt: NOW - HOUR,
    };
    const ns = buildCodeNamespace(freshnessDeps(makeReader(fresh), live));

    const result = (await ns.searchSymbols('login')) as SymbolSearchResult;

    expect(live.getCoverage).toHaveBeenCalledTimes(2);
    expect(result.coverage).toMatchObject({
      clean: false,
      state: 'updating',
      analyzed: 12,
    });
  });

  it('r1 S1: a write that starts during the read is reported by the later read', async () => {
    const live = makeLiveIndexer();
    live.getCoverage
      .mockReturnValueOnce(coverageOf())
      .mockReturnValueOnce(coverageOf({ state: 'updating' }));
    const fresh: CodeIndexFreshness = {
      symbolCount: 40,
      newestUpdatedAt: NOW - HOUR,
    };
    const ns = buildCodeNamespace(freshnessDeps(makeReader(fresh), live));

    const result = (await ns.searchSymbols('login')) as SymbolSearchResult;

    expect(result.coverage.state).toBe('updating');
  });

  it('r2 B1: a single-file reindex returns the file coverage first, so a recovered parse is never a bare success', async () => {
    const live = makeLiveIndexer();
    const recovered = withCoverageVerdict({
      supportedLanguages: [
        'typescript',
      ] as LanguageCoverage['supportedLanguages'],
      census: 'complete',
      analyzed: 0,
      unchecked: 0,
      failed: 1,
      unsupported: 0,
      unrecognised: 0,
      nonSource: 0,
      excluded: 0,
      omittedByCap: 0,
      failedByReason: { parse: 1 },
    });
    live.reindexFile.mockResolvedValue({
      coverage: recovered,
      symbolsIndexed: 0,
      errors: 1,
      durationMs: 3,
    });
    const ns = buildCodeNamespace(freshnessDeps(makeReader(EMPTY), live));

    const result = (await ns.reindex({
      filePath: '/ws/src/broken.ts',
    })) as ReindexResult;

    expect(Object.keys(result)[0]).toBe('coverage');
    expect(result.coverage).toMatchObject({
      clean: false,
      reasons: ['failed'],
      failedByReason: { parse: 1 },
    });
    expect(result.errors).toBe(1);
  });

  it('the error result carries coverage too', async () => {
    const double = makeLiveIndexer();
    const reader: ICodeSymbolReader = {
      searchSymbols: jest.fn().mockRejectedValue(new Error('db locked')),
    };
    const ns = buildCodeNamespace(freshnessDeps(reader, double));

    const result = await ns.searchSymbols('login');

    expect(Object.keys(result)).toEqual([
      'index',
      'coverage',
      'bm25Only',
      'error',
      'hits',
    ]);
  });

  it('with no indexer the coverage is unknown, never clean', async () => {
    const ns = buildCodeNamespace(freshnessDeps(makeReader(EMPTY), undefined));

    const result = (await ns.searchSymbols('login')) as SymbolSearchResult;

    expect(result.coverage).toEqual({
      clean: false,
      reasons: ['census?', 'unchecked?', 'failed?'],
      supportedLanguages: CODE_INDEX_LANGUAGES,
      census: 'unknown',
      analyzed: null,
      unchecked: null,
      failed: null,
      unsupported: null,
      unrecognised: null,
      nonSource: null,
      excluded: null,
      omittedByCap: null,
    });
  });

  it('a coverage read failure degrades to unknown with a fixed-text warning, and keeps the hits', async () => {
    const double = makeIndexer(); // no getCoverage: a defective indexer
    const warn = jest.fn();
    const fresh: CodeIndexFreshness = {
      symbolCount: 40,
      newestUpdatedAt: NOW - HOUR,
    };
    const ns = buildCodeNamespace(
      freshnessDeps(makeReader(fresh), double, { logger: { warn } }),
    );

    const result = (await ns.searchSymbols('login')) as SymbolSearchResult;

    expect(result.hits).toHaveLength(1);
    expect(result.coverage.census).toBe('unknown');
    expect(warn).toHaveBeenCalledWith(
      '[ptah.code] code index coverage read failed; coverage reported as unknown',
    );
  });

  it('search with a filePath in an unsupported language answers unsupported-language and reads nothing', async () => {
    const double = makeLiveIndexer();
    const reader = makeReader(EMPTY);
    const ns = buildCodeNamespace(freshnessDeps(reader, double));

    const result = await ns.searchSymbols('login', {
      filePath: 'src/Main.swift',
    });

    expect(result).toEqual({
      status: 'unsupported-language',
      language: 'swift',
      supportedLanguages: CODE_INDEX_LANGUAGES,
      message: expect.stringContaining('swift'),
    });
    expect(reader.searchSymbols).not.toHaveBeenCalled();
    expect(reader.getIndexFreshness).not.toHaveBeenCalled();
    expect(double.indexWorkspace).not.toHaveBeenCalled();
  });

  // Python has public symbols since Batch 33 and C# since Batch 34; Java's
  // (Task 34.2) are deferred (User Decision 27).
  it('Java stays searchable while Java queryExports errors', async () => {
    expect(hasCapability('java', 'codeIndex')).toBe(true);
    expect(hasCapability('java', 'publicSymbols')).toBe(false);
    const reader = makeReader(EMPTY);
    (reader.searchSymbols as jest.Mock).mockResolvedValue({
      hits: [makeCodeHit({ filePath: '/ws/app/Auth.java' })],
      bm25Only: false,
    });
    const ns = buildCodeNamespace(freshnessDeps(reader, makeLiveIndexer()));

    const result = (await ns.searchSymbols('login', {
      filePath: 'app/Auth.java',
    })) as SymbolSearchResult;

    expect(result.hits).toHaveLength(1);
    expect(result.coverage).toBeDefined();
  });

  it('swift reindex is not filesScanned 1: unsupported-language, no delete, no count', async () => {
    const double = makeLiveIndexer();
    const ns = buildCodeNamespace(freshnessDeps(makeReader(EMPTY), double));

    const result = await ns.reindex({ filePath: '/ws/src/Main.swift' });

    expect(result).toMatchObject({
      status: 'unsupported-language',
      language: 'swift',
      supportedLanguages: CODE_INDEX_LANGUAGES,
    });
    expect(result).not.toHaveProperty('filesScanned');
    expect(double.reindexFile).not.toHaveBeenCalled();
  });

  it('a reindex of a file no language claims is unsupported too', async () => {
    const double = makeLiveIndexer();
    const ns = buildCodeNamespace(freshnessDeps(makeReader(EMPTY), double));

    const result = await ns.reindex({ filePath: '/ws/build.zig' });

    expect(result).toMatchObject({
      status: 'unsupported-language',
      language: '.zig',
    });
    expect(double.reindexFile).not.toHaveBeenCalled();
  });

  it('a budget cut of an oversized search never removes the coverage (measured in tokens)', async () => {
    const hits = Array.from({ length: 300 }, (_, i) =>
      makeCodeHit({
        id: String(i),
        filePath: `/ws/src/very/long/directory/name/for/budget/module${i}/handlers.ts`,
        symbolName: `handleRequestNumber${i}`,
        text: `function handleRequestNumber${i}(request: Request): Response { /* ${'x'.repeat(80)} */ }`,
      }),
    );
    const reader = makeReader({ symbolCount: 300, newestUpdatedAt: NOW });
    (reader.searchSymbols as jest.Mock).mockResolvedValue({
      hits,
      bm25Only: false,
    });
    // The r1 B1 case: complete, current, every known qualifier 0, and only
    // `unrecognised: null` keeps the answer from being clean.
    const cleanLooking = coverageOf({
      unsupported: 0,
      unsupportedByLanguage: undefined,
    });
    const live = makeLiveIndexer();
    live.getCoverage.mockReturnValue(cleanLooking);
    const ns = buildCodeNamespace(freshnessDeps(reader, live));
    const result = await ns.searchSymbols('handler', { maxResults: 300 });
    const spoolRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-24b-'));
    try {
      const outcome = await applyToolResultBudget({
        text: JSON.stringify(result),
        toolName: 'ptah_code_search_symbols',
        requestId: 'b24',
        spoolRoot,
      });

      const budget = getToolResultBudget('ptah_code_search_symbols');
      expect(outcome.truncated || outcome.reduced).toBe(true);
      expect(outcome.returnedTokens).toBeLessThanOrEqual(budget.tokens);
      // The body the model gets is one JSON line; the budget trailer follows.
      const body = JSON.parse(outcome.text.split('\n')[0]) as {
        coverage?: LanguageCoverage;
      };
      expect(body.coverage).toEqual(JSON.parse(JSON.stringify(cleanLooking)));
      expect(body.coverage).toMatchObject({
        clean: false,
        reasons: ['unrecognised?'],
        unrecognised: null,
        nonSource: null,
        excluded: null,
      });
      const hitsAt = outcome.text.indexOf('"hits"');
      if (hitsAt >= 0) {
        expect(outcome.text.indexOf('"coverage"')).toBeLessThan(hitsAt);
      }
    } finally {
      fs.rmSync(spoolRoot, { recursive: true, force: true });
    }
  });
});

describe('buildCodeNamespace.reindex', () => {
  it('starts a full run in the background (user-initiated) and returns at once', async () => {
    const double = makeIndexer();
    const ns = buildCodeNamespace(
      freshnessDeps(
        makeReader({ symbolCount: 7, newestUpdatedAt: NOW - HOUR }),
        double,
      ),
    );

    const result = (await ns.reindex()) as ReindexStarted;
    await flush();

    expect(double.indexWorkspace).toHaveBeenCalledWith('/ws', {
      userInitiated: true,
    });
    expect(double.runs).toHaveLength(1);
    expect(result).toEqual({
      started: true,
      symbolCount: 7,
      indexAgeMs: HOUR,
      reindexInFlight: true,
    });
  });

  it('does not start a second full run while one is in flight', async () => {
    const double = makeIndexer();
    const ns = buildCodeNamespace(freshnessDeps(makeReader(EMPTY), double));

    await ns.ensureIndexFresh();
    const result = (await ns.reindex()) as ReindexStarted;

    expect(result.started).toBe(false);
    expect(result.reindexInFlight).toBe(true);
    expect(double.indexWorkspace).toHaveBeenCalledTimes(1);
  });

  it('keeps the start acknowledgment of a newly admitted run when the freshness read rejects', async () => {
    const warn = jest.fn();
    const double = makeIndexer();
    const ns = buildCodeNamespace(
      freshnessDeps(makeReader(new Error('db at /secret gone')), double, {
        logger: { warn },
      }),
    );

    const result = await ns.reindex();
    await flush();

    expect(result).toEqual({
      started: true,
      symbolCount: null,
      indexAgeMs: null,
      reindexInFlight: true,
    });
    expect(double.indexWorkspace).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('/secret');
  });

  it('reports an already-in-flight run when the freshness read rejects', async () => {
    const warn = jest.fn();
    const double = makeIndexer();
    const ns = buildCodeNamespace(
      freshnessDeps(makeReader(new Error('db at /secret gone')), double, {
        logger: { warn },
      }),
    );

    await ns.reindex();
    const second = await ns.reindex();
    await flush();

    expect(second).toEqual({
      started: false,
      symbolCount: null,
      indexAgeMs: null,
      reindexInFlight: true,
    });
    expect(double.indexWorkspace).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('/secret');
  });

  it('awaits a single-file reindex and returns its stats', async () => {
    const double = makeIndexer();
    const ns = buildCodeNamespace(freshnessDeps(makeReader(EMPTY), double));

    const result = (await ns.reindex({
      filePath: '/ws/src/auth.ts',
    })) as ReindexResult;

    expect(double.reindexFile).toHaveBeenCalledWith('/ws/src/auth.ts', '/ws');
    expect(result).toEqual({
      filesScanned: 1,
      symbolsIndexed: 4,
      errors: 0,
      durationMs: 12,
    });
  });

  it('returns an error when there is no indexer', async () => {
    const ns = buildCodeNamespace(freshnessDeps(makeReader(EMPTY), undefined));
    const result = await ns.reindex();
    expect('error' in result).toBe(true);
  });

  it('refuses a root the host did not record', async () => {
    const double = makeIndexer();
    const ns = buildCodeNamespace(
      freshnessDeps(makeReader(EMPTY), double, {
        getWorkspaceRoot: () => '/declared/elsewhere',
      }),
    );

    const full = await ns.reindex();
    const file = await ns.reindex({ filePath: '/declared/elsewhere/a.ts' });

    expect('error' in full).toBe(true);
    expect('error' in file).toBe(true);
    expect(double.indexWorkspace).not.toHaveBeenCalled();
    expect(double.reindexFile).not.toHaveBeenCalled();
  });
});

describe('startIndexFreshnessCheck', () => {
  it('starts ensureIndexFresh without waiting on it', async () => {
    const ensureIndexFresh = jest.fn(() => new Promise<never>(() => undefined));
    const debug = jest.fn();

    startIndexFreshnessCheck({ ensureIndexFresh }, { debug });
    await flush();

    expect(ensureIndexFresh).toHaveBeenCalledTimes(1);
    expect(debug).not.toHaveBeenCalled();
  });

  it('never throws when the namespace is a failed-build proxy, and logs fixed text', async () => {
    const ensureIndexFresh = jest.fn(() => {
      throw new Error('namespace failed at /secret/path');
    });
    const debug = jest.fn();

    expect(() =>
      startIndexFreshnessCheck({ ensureIndexFresh }, { debug }),
    ).not.toThrow();
    await flush();

    expect(ensureIndexFresh).toHaveBeenCalled();
    expect(debug).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(debug.mock.calls)).not.toContain('/secret/path');
  });
});
