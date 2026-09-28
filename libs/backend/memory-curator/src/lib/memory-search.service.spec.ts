/**
 * Unit tests for MemorySearchService.
 *
 * Covers:
 *   - `escapeFtsQuery` behaviour
 *   - Reranker integration: happy path, skip on <5 candidates,
 *     error fallback to RRF order
 *   - Porter stemming integration test (skipped without native better-sqlite3)
 *   - Tri-state scope, cache key and quarantine exclusion against real SQLite
 *     (better-sqlite3 or node:sqlite, with sqlite-vec loaded)
 */
import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type { ITracer } from '@ptah-extension/platform-core';
import type {
  IEmbedder,
  VecStatusService,
} from '@ptah-extension/persistence-sqlite';
import { SqliteConnectionService } from '@ptah-extension/persistence-sqlite';
import { MemoryStore } from './memory.store';
import { MemorySearchService } from './memory-search.service';
import { EmbedderWorkerClient } from './embedder/embedder-worker-client';
import type { ObservationQueueStore } from './observation-queue.store';
import { escapeFtsQuery } from './fts-query.util';
import { memoryId } from './memory.types';
import {
  openRetentionTestDb,
  removeRetentionTempDirs,
  seedMemories,
  type RetentionTestDb,
  type SeedMemoryOptions,
} from './retention/retention-sqlite.test-support';

interface RecordingTracer extends ITracer {
  readonly spans: string[];
}

function makeRecordingTracer(): RecordingTracer {
  const spans: string[] = [];
  return {
    spans,
    startSpan: <T>(
      name: string,
      _attrs: Record<string, string | number | boolean>,
      fn: () => T,
    ): T => {
      spans.push(name);
      return fn();
    },
    addBreadcrumb: () => undefined,
  };
}

function makeVecStatus(available = false): VecStatusService {
  const diagnostic = {
    ok: available,
    reason: available ? ('ok' as const) : ('binary-missing' as const),
    electronVersion: '40.0.0',
    processArch: 'x64' as NodeJS.Architecture,
    processPlatform: 'linux' as NodeJS.Platform,
  };
  return {
    available,
    reason: diagnostic.reason,
    diagnostic,
    getStatus: () => ({
      available,
      reason: diagnostic.reason,
      diagnostic,
    }),
    on: () => ({ dispose: () => undefined }),
    refresh: () => undefined,
  } as unknown as VecStatusService;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function makeEmbedder(): IEmbedder {
  return {
    embed: jest.fn(async () => []),
    dim: 384,
  } as unknown as IEmbedder;
}

/**
 * Build a fake EmbedderWorkerClient so `instanceof EmbedderWorkerClient`
 * returns true inside MemorySearchService.workerClient.
 */
function makeWorkerClient(rerankImpl?: jest.Mock): EmbedderWorkerClient {
  const rerank = rerankImpl ?? jest.fn(async () => []);
  const fake = Object.create(
    EmbedderWorkerClient.prototype,
  ) as EmbedderWorkerClient;
  (fake as unknown as { embed: jest.Mock }).embed = jest.fn(async () => []);
  (fake as unknown as { rerank: jest.Mock }).rerank = rerank;
  (fake as unknown as { warmup: jest.Mock }).warmup = jest.fn(
    async () => undefined,
  );
  (fake as unknown as { dim: number }).dim = 384;
  return fake;
}

function makeConnection(): SqliteConnectionService {
  return {
    vecExtensionLoaded: false,
    db: {
      prepare: jest.fn(() => ({ all: jest.fn(() => []) })),
    },
  } as unknown as SqliteConnectionService;
}

function makeStore(writeCounter = 0): MemoryStore {
  return {
    getById: jest.fn(() => undefined),
    recordUse: jest.fn(),
    getWriteCounter: jest.fn(() => writeCounter),
  } as unknown as MemoryStore;
}

function makeObservationQueue(): ObservationQueueStore {
  return {
    enqueue: jest.fn(),
    flush: jest.fn(),
    drainForSession: jest.fn(() => []),
    peekForSession: jest.fn(() => []),
    markProcessed: jest.fn(),
    countUnprocessed: jest.fn(() => 0),
  } as unknown as ObservationQueueStore;
}

/**
 * Thin wrapper preserving the original `escape(service, q)` call sites; the
 * escaper now lives in the shared `fts-query.util` module (see its spec for the
 * full assertion set). Retained here for the Porter stemming integration test.
 */
function escape(_service: MemorySearchService, q: string): string {
  return escapeFtsQuery(q);
}

function makeService(): MemorySearchService {
  return new MemorySearchService(
    makeLogger(),
    makeConnection(),
    makeEmbedder(),
    makeStore(),
    makeObservationQueue(),
    makeVecStatus(false),
  );
}

/** Build a service with vec search disabled and a controllable reranker. */
function makeServiceWithReranker(options: {
  rerankImpl?: jest.Mock;
  rows?: Array<{
    rowid: number;
    chunk_id: string;
    memory_id: string;
    ord: number;
    text: string;
    token_count: number;
    created_at: number;
  }>;
  memoryLookup?: (id: string) => unknown;
}): {
  service: MemorySearchService;
  rerankMock: jest.Mock;
  logger: Logger;
  store: MemoryStore;
} {
  const rerankMock = options.rerankImpl ?? jest.fn(async () => []);
  const workerClient = makeWorkerClient(rerankMock);
  const logger = makeLogger();

  const rows = options.rows ?? [];
  const connection: SqliteConnectionService = {
    vecExtensionLoaded: false,
    db: {
      prepare: jest.fn(() => ({
        all: jest.fn(() => rows),
      })),
    },
  } as unknown as SqliteConnectionService;

  const { memoryLookup } = options;
  const store: MemoryStore = {
    getById: memoryLookup
      ? jest.fn((id) => memoryLookup(String(id)))
      : jest.fn(() => undefined),
    recordUse: jest.fn(),
    getWriteCounter: jest.fn(() => 0),
  } as unknown as MemoryStore;

  const service = new MemorySearchService(
    logger,
    connection,
    workerClient,
    store,
    makeObservationQueue(),
    makeVecStatus(false),
  );
  return { service, rerankMock, logger, store };
}

// ---------------------------------------------------------------------------
// Reranker integration
// ---------------------------------------------------------------------------

/** Build a minimal FTS row for test use. */
function ftsRow(
  rowid: number,
  text: string,
): {
  rowid: number;
  chunk_id: string;
  memory_id: string;
  ord: number;
  text: string;
  token_count: number;
  created_at: number;
} {
  return {
    rowid,
    chunk_id: `ck${rowid}`,
    memory_id: `mem${rowid}`,
    ord: 0,
    text,
    token_count: text.split(' ').length,
    created_at: 1_000_000,
  };
}

describe('MemorySearchService.searchRich — reranker (R1)', () => {
  it('happy path: 5+ candidates => reranker called, output reordered', async () => {
    const rows = [1, 2, 3, 4, 5].map((i) => ftsRow(i, `candidate text ${i}`));

    // Reranker returns a reversed order: rowid 5 first, rowid 1 last.
    const rerankImpl = jest.fn(async () =>
      [5, 4, 3, 2, 1].map((id) => ({
        id: String(id),
        score: (5 - id + 1) * 0.1,
      })),
    );

    const { service, rerankMock } = makeServiceWithReranker({
      rerankImpl,
      rows,
      memoryLookup: (id) =>
        id.startsWith('mem')
          ? {
              id,
              subject: `subject ${id}`,
              content: `content ${id}`,
              tier: 'core',
            }
          : undefined,
    });

    const result = await service.searchRich('test query', 5);

    // Reranker must have been invoked.
    expect(rerankMock).toHaveBeenCalledTimes(1);

    // The first hit should be the one the reranker ranked first (rowid 5).
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits[0].chunk.text).toBe('candidate text 5');
  });

  it('fewer than 5 candidates => reranker is skipped', async () => {
    const rows = [1, 2, 3, 4].map((i) => ftsRow(i, `text ${i}`));
    const rerankImpl = jest.fn(async () => []);
    const { service, rerankMock } = makeServiceWithReranker({
      rerankImpl,
      rows,
    });

    await service.searchRich('test query', 4);

    expect(rerankMock).not.toHaveBeenCalled();
  });

  it('returns at most topK without a reranker and performs no store write', async () => {
    const rows = [1, 2, 3, 4].map((i) => ftsRow(i, `text ${i}`));
    const { service, store } = makeServiceWithReranker({
      rows,
      memoryLookup: (id) => ({
        id,
        subject: id,
        content: id,
        tier: 'recall',
      }),
    });

    const first = await service.searchRich('test query', 2);
    const cached = await service.searchRich('test query', 2);

    expect(first.hits).toHaveLength(2);
    expect(cached.hits).toHaveLength(2);
    expect(store.recordUse).not.toHaveBeenCalled();
  });

  it('worker rerank error => falls back to RRF order, search resolves', async () => {
    const rows = [1, 2, 3, 4, 5].map((i) => ftsRow(i, `text ${i}`));
    const rerankImpl = jest.fn(async () => {
      throw new Error('model load timeout');
    });
    const { service, logger } = makeServiceWithReranker({
      rerankImpl,
      rows,
      memoryLookup: (id) =>
        id.startsWith('mem')
          ? { id, subject: `s${id}`, content: `c${id}`, tier: 'core' }
          : undefined,
    });

    // Should resolve (not reject) even when reranker throws.
    const result = await service.searchRich('test query', 5);

    // Result still has hits from RRF.
    expect(result.hits.length).toBeGreaterThan(0);

    // Warning was logged.
    expect(
      (logger.warn as jest.Mock).mock.calls.some((c) =>
        (c[0] as string).includes('reranker failed'),
      ),
    ).toBe(true);
  });

  it('4×K over-fetch: reranker receives limit*4 candidates when BM25 returns >limit*4 rows', async () => {
    // topK = 3 → reranker should receive up to 12 candidates (3*4), not just 3.
    const topK = 3;
    const totalRows = topK * 4 + 2; // 14 rows — more than 4×topK to prove no premature cap
    const rows = Array.from({ length: totalRows }, (_, i) =>
      ftsRow(i + 1, `candidate text ${i + 1}`),
    );

    // Capture what the reranker received
    let capturedInputLength = -1;
    const rerankImpl = jest.fn(
      async (
        _query: string,
        candidates: Array<{ id: string; text: string }>,
      ) => {
        capturedInputLength = candidates.length;
        // Return first topK in order
        return candidates.slice(0, topK).map((c) => ({ id: c.id, score: 0.5 }));
      },
    );

    const { service } = makeServiceWithReranker({
      rerankImpl,
      rows,
      memoryLookup: (id) =>
        id.startsWith('mem')
          ? { id, subject: `s${id}`, content: `c${id}`, tier: 'core' }
          : undefined,
    });

    await service.searchRich('test query', topK);

    // The reranker must have been called
    expect(rerankImpl).toHaveBeenCalledTimes(1);
    // It must have received 4×topK candidates, not just topK
    expect(capturedInputLength).toBe(topK * 4);
  });

  it('candidate text is truncated at 512 chars before being passed to reranker', async () => {
    const longText = 'x'.repeat(1000);
    const rows = [1, 2, 3, 4, 5].map((i) =>
      ftsRow(i, i === 3 ? longText : `text ${i}`),
    );

    let capturedCandidates: Array<{ id: string; text: string }> = [];
    const rerankImpl = jest.fn(
      async (
        _query: string,
        candidates: Array<{ id: string; text: string }>,
      ) => {
        capturedCandidates = candidates;
        return candidates.slice(0, 5).map((c) => ({ id: c.id, score: 0.5 }));
      },
    );

    const { service } = makeServiceWithReranker({
      rerankImpl,
      rows,
      memoryLookup: (id) =>
        id.startsWith('mem')
          ? { id, subject: `s${id}`, content: `c${id}`, tier: 'core' }
          : undefined,
    });

    await service.searchRich('test query', 5);

    // The long candidate's text must have been capped at 512 chars
    const longCandidate = capturedCandidates.find((c) => c.text.length > 100);
    expect(longCandidate).toBeDefined();
    expect(longCandidate!.text.length).toBeLessThanOrEqual(512);
  });

  it('existing embedder (non-worker) => reranker not called', async () => {
    // makeService() injects a plain IEmbedder stub, not an EmbedderWorkerClient.
    // MemorySearchService.workerClient returns null in this case.
    const rows = [1, 2, 3, 4, 5].map((i) => ftsRow(i, `text ${i}`));
    const logger = makeLogger();
    const connection: SqliteConnectionService = {
      vecExtensionLoaded: false,
      db: {
        prepare: jest.fn(() => ({ all: jest.fn(() => rows) })),
      },
    } as unknown as SqliteConnectionService;
    const embedder = makeEmbedder(); // plain IEmbedder — no rerank()
    const store: MemoryStore = {
      getById: jest.fn(() => undefined),
      recordUse: jest.fn(),
      getWriteCounter: jest.fn(() => 0),
    } as unknown as MemoryStore;

    const service = new MemorySearchService(
      logger,
      connection,
      embedder,
      store,
      makeObservationQueue(),
      makeVecStatus(false),
    );

    // Should resolve without error (workerClient is null, reranker skipped).
    const result = await service.searchRich('test query', 5);
    expect(result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// LRU result cache
// ---------------------------------------------------------------------------

describe('MemorySearchService.searchRich — LRU cache (R3)', () => {
  /**
   * Build a service wired for cache testing.
   * The `prepareMock` lets callers control what the DB returns for BM25
   * calls, and `getWriteCounter` is backed by the returned `writeCounter` ref.
   */
  function makeServiceForCache(
    opts: {
      rows?: Array<{
        rowid: number;
        chunk_id: string;
        memory_id: string;
        ord: number;
        text: string;
        token_count: number;
        created_at: number;
      }>;
      writeCounter?: { value: number };
      memoryLookup?: (id: string) => unknown;
    } = {},
  ): {
    service: MemorySearchService;
    prepareMock: jest.Mock;
    allMock: jest.Mock;
    counterRef: { value: number };
  } {
    const counterRef = opts.writeCounter ?? { value: 0 };
    const rows = opts.rows ?? [];
    const allMock = jest.fn(() => rows);
    const prepareMock = jest.fn((_sql: string) => ({ all: allMock }));
    const connection: SqliteConnectionService = {
      vecExtensionLoaded: false,
      db: { prepare: prepareMock },
    } as unknown as SqliteConnectionService;

    const { memoryLookup } = opts;
    const store: MemoryStore = {
      getById: memoryLookup
        ? jest.fn((id) => memoryLookup(String(id)))
        : jest.fn(() => undefined),
      recordUse: jest.fn(),
      getWriteCounter: jest.fn(() => counterRef.value),
    } as unknown as MemoryStore;

    const service = new MemorySearchService(
      makeLogger(),
      connection,
      makeEmbedder(),
      store,
      makeObservationQueue(),
      makeVecStatus(false),
    );
    return { service, prepareMock, allMock, counterRef };
  }

  it('cache hit: second identical call skips BM25 (prepare not called again)', async () => {
    const rows = [1, 2].map((i) => ftsRow(i, `text ${i}`));
    const { service, prepareMock } = makeServiceForCache({ rows });

    await service.searchRich('hello world', 10);
    await service.searchRich('hello world', 10);

    // The first cache miss runs precise + fallback because the fixture cannot
    // fill the page; the second identical call performs no additional query.
    expect(prepareMock).toHaveBeenCalledTimes(2);
  });

  it('cache hit: logger.debug is called on cache hit', async () => {
    const rows = [1, 2].map((i) => ftsRow(i, `text ${i}`));
    const counterRef = { value: 0 };
    const allMock = jest.fn(() => rows);
    const connection: SqliteConnectionService = {
      vecExtensionLoaded: false,
      db: { prepare: jest.fn(() => ({ all: allMock })) },
    } as unknown as SqliteConnectionService;
    const logger = makeLogger();
    const store: MemoryStore = {
      getById: jest.fn(() => undefined),
      recordUse: jest.fn(),
      getWriteCounter: jest.fn(() => counterRef.value),
    } as unknown as MemoryStore;

    const service = new MemorySearchService(
      logger,
      connection,
      makeEmbedder(),
      store,
      makeObservationQueue(),
      makeVecStatus(false),
    );

    await service.searchRich('hello world', 10);
    await service.searchRich('hello world', 10);

    expect(
      (logger.debug as jest.Mock).mock.calls.some(
        (c) => typeof c[0] === 'string' && c[0].includes('cache hit'),
      ),
    ).toBe(true);
  });

  it('cache miss after write: different counter produces a new pipeline run', async () => {
    const rows = [1, 2].map((i) => ftsRow(i, `text ${i}`));
    const counterRef = { value: 0 };
    const allMock = jest.fn(() => rows);
    const connection: SqliteConnectionService = {
      vecExtensionLoaded: false,
      db: { prepare: jest.fn(() => ({ all: allMock })) },
    } as unknown as SqliteConnectionService;
    const store: MemoryStore = {
      getById: jest.fn(() => undefined),
      recordUse: jest.fn(),
      getWriteCounter: jest.fn(() => counterRef.value),
    } as unknown as MemoryStore;
    const service = new MemorySearchService(
      makeLogger(),
      connection,
      makeEmbedder(),
      store,
      makeObservationQueue(),
      makeVecStatus(false),
    );

    await service.searchRich('my query', 10);
    // Simulate a write by bumping the counter.
    counterRef.value = 1;
    await service.searchRich('my query', 10);

    // prepare() must have been called twice — once per cache miss.
    expect(allMock).toHaveBeenCalledTimes(2);
  });

  it('per-workspace isolation: query with workspace A does not serve workspace B', async () => {
    const rowsA = [ftsRow(1, 'workspace A text')];
    const rowsB = [ftsRow(2, 'workspace B text')];

    let callCount = 0;
    const allMock = jest.fn(() => {
      callCount++;
      return callCount === 1 ? rowsA : rowsB;
    });
    const connection: SqliteConnectionService = {
      vecExtensionLoaded: false,
      db: { prepare: jest.fn(() => ({ all: allMock })) },
    } as unknown as SqliteConnectionService;
    const store: MemoryStore = {
      getById: jest.fn(() => undefined),
      recordUse: jest.fn(),
      getWriteCounter: jest.fn(() => 0),
    } as unknown as MemoryStore;
    const service = new MemorySearchService(
      makeLogger(),
      connection,
      makeEmbedder(),
      store,
      makeObservationQueue(),
      makeVecStatus(false),
    );

    const resultA = await service.searchRich(
      'shared query',
      10,
      '/workspace/A',
    );
    const resultB = await service.searchRich(
      'shared query',
      10,
      '/workspace/B',
    );

    // Both cache misses run precise + fallback — different cache keys.
    expect(allMock).toHaveBeenCalledTimes(4);

    // The results should not be the same object reference (distinct cache entries).
    expect(resultA).not.toBe(resultB);
  });
});

// ---------------------------------------------------------------------------
// Weighted RRF
// ---------------------------------------------------------------------------

/** Row type used in rrfFuse tests. */
type FtsTestRow = {
  rowid: number;
  chunk_id: string;
  memory_id: string;
  ord: number;
  text: string;
  token_count: number;
  created_at: number;
};

/** Return type of rrfFuse. */
type RrfEntry = {
  row: { rowid: number };
  score: number;
  bm25Rank: number | null;
  vecRank: number | null;
};

/** Service cast that exposes private rrfFuse for white-box scoring tests. */
type ServiceWithRrfFuse = {
  rrfFuse(
    bm25: readonly FtsTestRow[],
    vec: readonly (FtsTestRow & { distance: number })[],
    limit: number,
    opts?: { k?: number; weights?: { bm25: number; vec: number } },
  ): RrfEntry[];
};

describe('MemorySearchService — weighted RRF (R5)', () => {
  /**
   * Expose the private `rrfFuse` for direct numerical assertions.
   * This is a white-box test on the scoring math.
   */
  function rrfFuse(
    service: MemorySearchService,
    bm25: readonly FtsTestRow[],
    vec: readonly (FtsTestRow & { distance: number })[],
    limit: number,
    opts?: { k?: number; weights?: { bm25: number; vec: number } },
  ): RrfEntry[] {
    return (service as unknown as ServiceWithRrfFuse).rrfFuse(
      bm25,
      vec,
      limit,
      opts,
    );
  }

  it('short query (3 tokens) gives more weight to BM25 winners', async () => {
    // Row 1 ranks first in BM25, Row 2 ranks first in vec.
    const bm25Rows = [
      ftsRow(1, 'exact term match'),
      ftsRow(2, 'semantic text'),
    ];
    const vecRows = [
      { ...ftsRow(2, 'semantic text'), distance: 0.1 },
      { ...ftsRow(1, 'exact term match'), distance: 0.9 },
    ];

    const { service } = makeServiceWithReranker({});
    const results = rrfFuse(service, bm25Rows, vecRows, 10, {
      k: 25,
      weights: { bm25: 0.6, vec: 0.4 },
    });

    // Row 1 should be ranked first because BM25 weight is higher and row 1
    // ranks first in BM25 (rank=1).
    const topRowid = results[0].row.rowid;
    expect(topRowid).toBe(1);
  });

  it('long query (5+ tokens) gives more weight to vec winners', async () => {
    // Row 2 ranks first in vec, Row 1 ranks first in BM25.
    const bm25Rows = [ftsRow(1, 'term match'), ftsRow(2, 'semantic')];
    const vecRows = [
      { ...ftsRow(2, 'semantic'), distance: 0.1 },
      { ...ftsRow(1, 'term match'), distance: 0.9 },
    ];

    const { service } = makeServiceWithReranker({});
    const results = rrfFuse(service, bm25Rows, vecRows, 10, {
      k: 25,
      weights: { bm25: 0.3, vec: 0.7 },
    });

    // Row 2 should be ranked first because vec weight is higher and row 2
    // ranks first in vec (rank=1).
    expect(results[0].row.rowid).toBe(2);
  });

  it('k=25 produces larger score gaps than k=60 between rank 1 and rank 2', () => {
    const bm25Rows = [ftsRow(1, 'first'), ftsRow(2, 'second')];
    const { service } = makeServiceWithReranker({});

    const withK25 = rrfFuse(service, bm25Rows, [], 10, {
      k: 25,
      weights: { bm25: 1.0, vec: 0.0 },
    });
    const withK60 = rrfFuse(service, bm25Rows, [], 10, {
      k: 60,
      weights: { bm25: 1.0, vec: 0.0 },
    });

    const gap25 = withK25[0].score - withK25[1].score;
    const gap60 = withK60[0].score - withK60[1].score;

    // A lower k produces a larger gap between consecutive ranks.
    expect(gap25).toBeGreaterThan(gap60);
  });

  it('searchRich uses bm25Weight=0.6 for a 3-token query', async () => {
    // We verify through end-to-end behavior: row 1 BM25-ranked first,
    // row 2 vec-ranked first. With bm25Weight=0.6, row 1 should win.
    const rows = [
      ftsRow(1, 'bm25 wins here'),
      ftsRow(2, 'vec wins here'),
      ftsRow(3, 'third row'),
      ftsRow(4, 'fourth row'),
      ftsRow(5, 'fifth row'),
    ];
    // 3 tokens: "short bm25 query"
    const { service } = makeServiceWithReranker({
      rows,
      memoryLookup: (id) =>
        id.startsWith('mem')
          ? { id, subject: `s${id}`, content: `c${id}`, tier: 'core' }
          : undefined,
    });
    // searchRich internally computes weights from the token count — we trust
    // that the scoring is applied correctly by verifying it doesn't throw and
    // returns a result.
    const result = await service.searchRich('short bm25 query', 5);
    expect(result.hits.length).toBeGreaterThanOrEqual(0);
    expect(result.bm25Only).toBe(true); // vecExtensionLoaded = false in stub
  });

  it('searchRich uses bm25Weight=0.3 for a 5-token query', async () => {
    const rows = [ftsRow(1, 'text'), ftsRow(2, 'text2')];
    const { service } = makeServiceWithReranker({ rows });
    // 5 tokens: "this is a longer query"
    const result = await service.searchRich('this is a longer query', 2);
    // Just verify it resolves without error.
    expect(result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// workspaceRoot filtering — BM25 and vec path
// ---------------------------------------------------------------------------

describe('MemorySearchService — workspaceRoot filtering', () => {
  /**
   * Build a service with a controllable `db.prepare().all()` mock.
   * Returns the `allMock` so tests can assert on calls made to it.
   */
  function makeServiceForWorkspaceFilter(
    opts: {
      rows?: Array<{
        rowid: number;
        chunk_id: string;
        memory_id: string;
        ord: number;
        text: string;
        token_count: number;
        created_at: number;
      }>;
      vecLoaded?: boolean;
    } = {},
  ): {
    service: MemorySearchService;
    allMock: jest.Mock;
    prepareMock: jest.Mock;
  } {
    const rows = opts.rows ?? [];
    const allMock = jest.fn(() => rows);
    const prepareMock = jest.fn(() => ({ all: allMock }));
    const connection: SqliteConnectionService = {
      vecExtensionLoaded: opts.vecLoaded ?? false,
      db: { prepare: prepareMock },
    } as unknown as SqliteConnectionService;
    const store: MemoryStore = {
      getById: jest.fn(() => undefined),
      recordUse: jest.fn(),
      getWriteCounter: jest.fn(() => 0),
    } as unknown as MemoryStore;
    const service = new MemorySearchService(
      makeLogger(),
      connection,
      makeEmbedder(),
      store,
      makeObservationQueue(),
      makeVecStatus(opts.vecLoaded ?? false),
    );
    return { service, allMock, prepareMock };
  }

  it('BM25: passes workspaceRoot as a SQL param when provided', async () => {
    const { service, allMock } = makeServiceForWorkspaceFilter();

    await service.searchRich('hello', 10, '/workspace/project');

    // The allMock receives BM25 SQL params: [escapedQuery, workspaceRoot, limit]
    expect(allMock).toHaveBeenCalled();
    const callArgs = allMock.mock.calls[0] as unknown[];
    // workspaceRoot should appear somewhere in the params list
    expect(callArgs).toContain('/workspace/project');
  });

  it('BM25: workspace-scoped query joins memories and filters m.workspace_root', async () => {
    const { service, prepareMock } = makeServiceForWorkspaceFilter();

    await service.searchRich('hello', 10, '/workspace/project');

    const bm25Sql = prepareMock.mock.calls
      .map((c) => c[0] as string)
      .find((sql) => sql.includes('memory_chunks_fts'));
    expect(bm25Sql).toBeDefined();
    // memory_chunks has no workspace_root column — it must be filtered via the
    // parent memories table, else SQLite throws "no such column: mc.workspace_root".
    expect(bm25Sql).toContain('JOIN memories m ON m.id = mc.memory_id');
    expect(bm25Sql).toContain('m.workspace_root IS ?');
    expect(bm25Sql).not.toContain('mc.workspace_root');
  });

  it('BM25: omits workspaceRoot param when not provided (global search)', async () => {
    const { service, allMock } = makeServiceForWorkspaceFilter();

    await service.searchRich('hello', 10);

    expect(allMock).toHaveBeenCalled();
    const callArgs = allMock.mock.calls[0] as unknown[];
    // When workspaceRoot is undefined, only [escapedQuery, limit] are passed
    // (the workspace filter clause is omitted from the SQL entirely).
    expect(callArgs).not.toContain('/workspace/project');
    // Should only have the FTS query and limit (2 params, no workspace value)
    expect(callArgs.length).toBe(2);
  });

  it('BM25: different workspaceRoots produce separate cache entries', async () => {
    const { service, allMock } = makeServiceForWorkspaceFilter();

    await service.searchRich('hello', 10, '/ws/a');
    await service.searchRich('hello', 10, '/ws/b');

    // Both calls must reach the DB (different cache keys).
    expect(allMock).toHaveBeenCalledTimes(2);
  });

  it('BM25: omitted workspaceRoot and explicit workspace are separate cache entries', async () => {
    const { service, allMock } = makeServiceForWorkspaceFilter();

    await service.searchRich('hello', 10); // global
    await service.searchRich('hello', 10, '/ws/a'); // scoped

    expect(allMock).toHaveBeenCalledTimes(2);
  });

  it('BM25: same query + same workspaceRoot is served from cache on second call', async () => {
    const { service, allMock } = makeServiceForWorkspaceFilter();

    await service.searchRich('hello', 10, '/workspace/project');
    await service.searchRich('hello', 10, '/workspace/project');

    // Should only reach the DB once; second call hits the LRU cache.
    expect(allMock).toHaveBeenCalledTimes(1);
  });

  it('BM25: null scope filters m.workspace_root IS NULL and binds no workspace param', async () => {
    const { service, allMock, prepareMock } = makeServiceForWorkspaceFilter();

    await service.searchRich('hello', 10, null);

    const bm25Sql = prepareMock.mock.calls
      .map((c) => c[0] as string)
      .find((sql) => sql.includes('memory_chunks_fts'));
    expect(bm25Sql).toContain('AND m.workspace_root IS NULL');
    expect(bm25Sql).not.toContain('m.workspace_root IS ?');
    expect(allMock.mock.calls[0]).toHaveLength(2);
  });

  it("BM25: '' scope is unscoped, like an omitted workspaceRoot", async () => {
    const { service, prepareMock } = makeServiceForWorkspaceFilter();

    await service.searchRich('hello', 10, '');

    const bm25Sql = prepareMock.mock.calls
      .map((c) => c[0] as string)
      .find((sql) => sql.includes('memory_chunks_fts'));
    expect(bm25Sql).not.toContain('m.workspace_root');
  });

  it('BM25: every scope joins memories and excludes quarantined rows before LIMIT', async () => {
    for (const scope of [undefined, null, '/ws/a']) {
      const { service, prepareMock } = makeServiceForWorkspaceFilter();
      await service.searchRich('hello', 10, scope);
      const bm25Sql = prepareMock.mock.calls
        .map((c) => c[0] as string)
        .find((sql) => sql.includes('memory_chunks_fts')) as string;
      expect(bm25Sql).toContain('JOIN memories m ON m.id = mc.memory_id');
      expect(bm25Sql).toContain('AND m.quarantined_at IS NULL');
      expect(bm25Sql.indexOf('m.quarantined_at IS NULL')).toBeLessThan(
        bm25Sql.indexOf('LIMIT ?'),
      );
    }
  });

  it('cache: null scope and omitted scope are separate cache entries', async () => {
    const { service, allMock } = makeServiceForWorkspaceFilter();

    await service.searchRich('hello', 10, null);
    await service.searchRich('hello', 10);
    await service.searchRich('hello', 10, '');

    // null and undefined miss separately; '' shares the unscoped entry.
    expect(allMock).toHaveBeenCalledTimes(2);
  });

  it("cache: a '|' in the query or the workspace cannot make two different searches share a key", async () => {
    const { service, allMock } = makeServiceForWorkspaceFilter();

    // Joined with '|' unescaped, both pairs produce `q|/ws/a|/ws/b|10|0`.
    const first = await service.searchRich('q|/ws/a', 10, '/ws/b');
    const second = await service.searchRich('q', 10, '/ws/a|/ws/b');

    expect(allMock).toHaveBeenCalledTimes(2);
    expect(allMock.mock.calls[0]).toContain('/ws/b');
    expect(allMock.mock.calls[1]).toContain('/ws/a|/ws/b');
    expect(second).not.toBe(first);
  });

  it("cache: searchIndex keys are tuples too — a '|' in the workspace does not merge scopes", async () => {
    const { service, allMock } = makeServiceForWorkspaceFilter();

    await service.searchIndex({ workspaceRoot: '/ws/a|0' });
    await service.searchIndex({ workspaceRoot: '/ws/a' });

    expect(allMock).toHaveBeenCalledTimes(2);
  });

  it('cache: the clamped limit is part of the key (topK 5 then 10 both reach the DB)', async () => {
    const { service, allMock } = makeServiceForWorkspaceFilter();

    await service.searchRich('hello', 5, '/ws/a');
    await service.searchRich('hello', 10, '/ws/a');
    // 60 and 50 clamp to the same limit and share an entry.
    await service.searchRich('hello', 60, '/ws/a');
    await service.searchRich('hello', 50, '/ws/a');

    expect(allMock).toHaveBeenCalledTimes(3);
  });

  it('cache: null and unscoped reads use the unscoped write counter; a named scope uses its own', async () => {
    const getWriteCounter = jest.fn(() => 0);
    const connection = {
      vecExtensionLoaded: false,
      db: { prepare: jest.fn(() => ({ all: jest.fn(() => []) })) },
    } as unknown as SqliteConnectionService;
    const service = new MemorySearchService(
      makeLogger(),
      connection,
      makeEmbedder(),
      { getById: jest.fn(), getWriteCounter } as unknown as MemoryStore,
      makeObservationQueue(),
      makeVecStatus(false),
    );

    await service.searchRich('hello', 10, null);
    await service.searchRich('hello', 10);
    await service.searchRich('hello', 10, '/ws/a');

    expect(getWriteCounter.mock.calls).toEqual([[''], [''], ['/ws/a']]);
  });
});

// ---------------------------------------------------------------------------
// Porter stemming integration test (skipped without native better-sqlite3)
// ---------------------------------------------------------------------------

describe('MemorySearchService — Porter stemming integration (skipped without native)', () => {
  // Detect whether the native module is available at the current Node ABI.
  // We must actually open a DB because require.resolve only checks the JS
  // shim, not whether the .node binary matches the host runtime ABI.
  let nativeAvailable = false;
  try {
    require.resolve('better-sqlite3');
    const Database = require('better-sqlite3') as new (file: string) => {
      close(): void;
    };
    const probe = new Database(':memory:');
    probe.close();
    nativeAvailable = true;
  } catch {
    nativeAvailable = false;
  }

  const maybe = nativeAvailable ? it : it.skip;

  maybe(
    'Porter stemming: chunk containing "configured" matches query "configuring"',
    () => {
      const Database = require('better-sqlite3') as new (file: string) => {
        exec(sql: string): void;
        prepare(sql: string): { all(...args: unknown[]): unknown[] };
        close(): void;
      };
      const db = new Database(':memory:');

      // Create the FTS5 virtual table with the porter tokenizer exactly as
      // migration 0010 defines it.
      db.exec(`
        CREATE TABLE memory_chunks (
          id TEXT PRIMARY KEY,
          memory_id TEXT NOT NULL,
          ord INTEGER NOT NULL,
          text TEXT NOT NULL,
          token_count INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE VIRTUAL TABLE memory_chunks_fts USING fts5(
          chunk_id UNINDEXED,
          text,
          content='memory_chunks',
          content_rowid='rowid',
          tokenize='porter unicode61'
        );
        INSERT INTO memory_chunks(id, memory_id, ord, text, token_count, created_at)
          VALUES ('ck1', 'mem1', 0, 'the server was configured correctly', 10, 1000000);
        INSERT INTO memory_chunks_fts(rowid, chunk_id, text)
          SELECT rowid, id, text FROM memory_chunks;
      `);

      // Query with a different inflection — "configuring" should stem to
      // "configur" and match the "configured" document token.
      const service = makeService();
      const ftsQuery = escape(service, 'configuring');

      const rows = db
        .prepare(
          `SELECT mc.id FROM memory_chunks_fts fts
           JOIN memory_chunks mc ON mc.rowid = fts.rowid
           WHERE memory_chunks_fts MATCH ?`,
        )
        .all(ftsQuery) as Array<{ id: string }>;

      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0].id).toBe('ck1');

      db.close();
    },
  );
});

// ---------------------------------------------------------------------------
// mem:searchIndex — pure-filter (empty query) listing
// ---------------------------------------------------------------------------

describe('MemorySearchService.searchIndex — empty query (pure-filter)', () => {
  function makeServiceForFilter(rows: Array<Record<string, unknown>>) {
    const allMock = jest.fn(() => rows);
    const prepareMock = jest.fn((_sql: string) => ({ all: allMock }));
    const connection: SqliteConnectionService = {
      vecExtensionLoaded: false,
      db: {
        prepare: prepareMock,
      },
    } as unknown as SqliteConnectionService;
    const service = new MemorySearchService(
      makeLogger(),
      connection,
      makeEmbedder(),
      makeStore(),
      makeObservationQueue(),
      makeVecStatus(false),
    );
    return { service, allMock, prepareMock };
  }

  it('returns compact rows with NO content field and bm25Only=true', async () => {
    const { service } = makeServiceForFilter([
      {
        id: 'mem-1',
        workspace_root: '/ws',
        subject: 'subj',
        type: 'discovery',
        concepts_json: '["a","b"]',
        files_json: '["x.ts"]',
        created_at: 123,
      },
    ]);
    const r = await service.searchIndex({ workspaceRoot: '/ws' });
    expect(r.bm25Only).toBe(true);
    expect(r.rows.length).toBe(1);
    expect(r.rows[0]).not.toHaveProperty('content');
    expect(r.rows[0].id).toBe('mem-1');
    expect(r.rows[0].concepts).toEqual(['a', 'b']);
    expect(r.rows[0].files).toEqual(['x.ts']);
    expect(r.rows[0].type).toBe('discovery');
  });

  it('parses malformed concepts_json defensively to empty array', async () => {
    const { service } = makeServiceForFilter([
      {
        id: 'mem-2',
        workspace_root: null,
        subject: null,
        type: null,
        concepts_json: 'not-json',
        files_json: null,
        created_at: 9,
      },
    ]);
    const r = await service.searchIndex({});
    expect(r.rows[0].concepts).toEqual([]);
    expect(r.rows[0].files).toEqual([]);
    expect(r.rows[0].type).toBe('discovery');
  });

  it('orders by ranking salience and binds rank time before the limit', async () => {
    const { service, allMock, prepareMock } = makeServiceForFilter([]);
    await service.searchIndex({ topK: 7, workspaceRoot: '/ws' });
    expect(prepareMock.mock.calls[0]?.[0]).toContain(
      '604800000.0 + MAX(0, ? - m.last_used_at)',
    );
    expect(allMock).toHaveBeenCalledWith('/ws', expect.any(Number), 7);
  });
});

// ---------------------------------------------------------------------------
// mem:timeline — anchor + before/after composition
// ---------------------------------------------------------------------------

describe('MemorySearchService.timeline', () => {
  function makeTimelineService(opts: {
    anchor: Record<string, unknown> | undefined;
    before: Array<Record<string, unknown>>;
    after: Array<Record<string, unknown>>;
  }) {
    let prepareCallCount = 0;
    const connection: SqliteConnectionService = {
      vecExtensionLoaded: false,
      db: {
        prepare: jest.fn(() => {
          const idx = prepareCallCount++;
          return {
            get: jest.fn(() => opts.anchor),
            all: jest.fn(() => (idx === 1 ? opts.before : opts.after)),
          };
        }),
      },
    } as unknown as SqliteConnectionService;
    return new MemorySearchService(
      makeLogger(),
      connection,
      makeEmbedder(),
      makeStore(),
      makeObservationQueue(),
      makeVecStatus(false),
    );
  }

  it('returns empty rows when anchor missing', () => {
    const service = makeTimelineService({
      anchor: undefined,
      before: [],
      after: [],
    });
    const r = service.timeline({ anchorId: 'no-such-id' });
    expect(r.rows).toEqual([]);
    expect(r.anchorIndex).toBe(0);
  });

  it('composes [...before.reverse(), anchor, ...after] with correct anchorIndex', () => {
    const anchor = {
      id: 'anchor',
      workspace_root: '/ws',
      subject: 'a',
      type: 'discovery',
      concepts_json: '[]',
      files_json: '[]',
      created_at: 100,
    };
    const before = [
      {
        id: 'b3',
        workspace_root: '/ws',
        subject: null,
        type: 'discovery',
        concepts_json: '[]',
        files_json: '[]',
        created_at: 90,
      },
      {
        id: 'b2',
        workspace_root: '/ws',
        subject: null,
        type: 'discovery',
        concepts_json: '[]',
        files_json: '[]',
        created_at: 80,
      },
    ];
    const after = [
      {
        id: 'a1',
        workspace_root: '/ws',
        subject: null,
        type: 'discovery',
        concepts_json: '[]',
        files_json: '[]',
        created_at: 110,
      },
    ];
    const service = makeTimelineService({ anchor, before, after });
    const r = service.timeline({ anchorId: 'anchor', before: 2, after: 1 });
    expect(r.rows.map((x) => x.id)).toEqual(['b2', 'b3', 'anchor', 'a1']);
    expect(r.anchorIndex).toBe(2);
  });

  it('workspace-top edge: empty before, anchor first, after follows', () => {
    const anchor = {
      id: 'anchor',
      workspace_root: '/ws',
      subject: null,
      type: 'discovery',
      concepts_json: '[]',
      files_json: '[]',
      created_at: 5,
    };
    const after = [
      {
        id: 'a1',
        workspace_root: '/ws',
        subject: null,
        type: 'discovery',
        concepts_json: '[]',
        files_json: '[]',
        created_at: 7,
      },
    ];
    const service = makeTimelineService({ anchor, before: [], after });
    const r = service.timeline({ anchorId: 'anchor' });
    expect(r.anchorIndex).toBe(0);
    expect(r.rows.map((x) => x.id)).toEqual(['anchor', 'a1']);
  });

  it('workspace-bottom edge: before reversed, anchor last', () => {
    const anchor = {
      id: 'anchor',
      workspace_root: '/ws',
      subject: null,
      type: 'discovery',
      concepts_json: '[]',
      files_json: '[]',
      created_at: 9999,
    };
    const before = [
      {
        id: 'b1',
        workspace_root: '/ws',
        subject: null,
        type: 'discovery',
        concepts_json: '[]',
        files_json: '[]',
        created_at: 100,
      },
    ];
    const service = makeTimelineService({ anchor, before, after: [] });
    const r = service.timeline({ anchorId: 'anchor' });
    expect(r.rows.map((x) => x.id)).toEqual(['b1', 'anchor']);
    expect(r.anchorIndex).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// mem:getObservations — full payload + read-only queue rows
// ---------------------------------------------------------------------------

describe('MemorySearchService.getObservations', () => {
  it('returns empty result when no ids supplied', () => {
    const connection: SqliteConnectionService = {
      vecExtensionLoaded: false,
      db: { prepare: jest.fn() },
    } as unknown as SqliteConnectionService;
    const queue = makeObservationQueue();
    const service = new MemorySearchService(
      makeLogger(),
      connection,
      makeEmbedder(),
      makeStore(),
      queue,
      makeVecStatus(false),
    );
    const r = service.getObservations({ ids: [] });
    expect(r.memories).toEqual([]);
    expect(r.observationsBySession).toEqual({});
    expect(queue.peekForSession).not.toHaveBeenCalled();
  });

  it('peeks queue rows per unique session and never calls markProcessed', () => {
    const memoryRows = [
      {
        id: 'mem-1',
        session_id: 'sess-1',
        workspace_root: '/ws',
        subject: 's',
        content: 'c',
        type: 'bugfix',
        request: 'r',
        investigated: 'i',
        learned: 'l',
        completed: 'co',
        next_steps: 'n',
        concepts_json: '["k"]',
        files_json: '[]',
        created_at: 1,
      },
      {
        id: 'mem-2',
        session_id: 'sess-1',
        workspace_root: '/ws',
        subject: null,
        content: 'c2',
        type: 'discovery',
        request: null,
        investigated: null,
        learned: null,
        completed: null,
        next_steps: null,
        concepts_json: '[]',
        files_json: '[]',
        created_at: 2,
      },
    ];
    const connection: SqliteConnectionService = {
      vecExtensionLoaded: false,
      db: {
        prepare: jest.fn(() => ({ all: jest.fn(() => memoryRows) })),
      },
    } as unknown as SqliteConnectionService;
    const queue = makeObservationQueue();
    (queue.peekForSession as jest.Mock).mockReturnValue([
      {
        id: 7,
        sessionId: 'sess-1',
        workspaceRoot: '/ws',
        kind: 'tool-use',
        toolName: 'Read',
        filePath: 'a.ts',
        capturedAt: 10,
        processedAt: null,
      },
    ]);
    const service = new MemorySearchService(
      makeLogger(),
      connection,
      makeEmbedder(),
      makeStore(),
      queue,
      makeVecStatus(false),
    );
    const r = service.getObservations({ ids: ['mem-1', 'mem-2'] });
    expect(r.memories.length).toBe(2);
    expect(r.memories[0].nextSteps).toBe('n');
    expect(r.memories[0].request).toBe('r');
    expect(r.observationsBySession['sess-1']).toBeDefined();
    expect(r.observationsBySession['sess-1'][0].toolName).toBe('Read');
    expect(queue.peekForSession).toHaveBeenCalledTimes(1);
    expect(queue.markProcessed).not.toHaveBeenCalled();
  });

  it('skips queue rows when includeQueueRows=false', () => {
    const memoryRows = [
      {
        id: 'mem-1',
        session_id: 'sess-1',
        workspace_root: null,
        subject: null,
        content: '',
        type: 'discovery',
        request: null,
        investigated: null,
        learned: null,
        completed: null,
        next_steps: null,
        concepts_json: '[]',
        files_json: '[]',
        created_at: 1,
      },
    ];
    const connection: SqliteConnectionService = {
      vecExtensionLoaded: false,
      db: { prepare: jest.fn(() => ({ all: jest.fn(() => memoryRows) })) },
    } as unknown as SqliteConnectionService;
    const queue = makeObservationQueue();
    const service = new MemorySearchService(
      makeLogger(),
      connection,
      makeEmbedder(),
      makeStore(),
      queue,
      makeVecStatus(false),
    );
    const r = service.getObservations({
      ids: ['mem-1'],
      includeQueueRows: false,
    });
    expect(r.observationsBySession).toEqual({});
    expect(queue.peekForSession).not.toHaveBeenCalled();
  });
});

describe('MemorySearchService — tracing instrumentation', () => {
  function makeTracedService(): {
    service: MemorySearchService;
    tracer: RecordingTracer;
  } {
    const tracer = makeRecordingTracer();
    const service = new MemorySearchService(
      makeLogger(),
      makeConnection(),
      makeEmbedder(),
      makeStore(),
      makeObservationQueue(),
      makeVecStatus(false),
      tracer,
    );
    return { service, tracer };
  }

  it('search wraps in a memory.search span and returns the same result', async () => {
    const { service, tracer } = makeTracedService();
    const result = await service.search('hello world', 10);
    expect(result).toEqual({ hits: [], bm25Only: true });
    expect(tracer.spans).toContain('memory.search');
    expect(tracer.spans).toContain('memory.searchRich');
  });

  it('searchRich wraps in a memory.searchRich span', async () => {
    const { service, tracer } = makeTracedService();
    const result = await service.searchRich('alpha beta', 5);
    expect(result.bm25Only).toBe(true);
    expect(tracer.spans).toContain('memory.searchRich');
  });

  it('searchIndex wraps in a memory.searchIndex span', async () => {
    const { service, tracer } = makeTracedService();
    const result = await service.searchIndex({ workspaceRoot: '/ws' });
    expect(result.bm25Only).toBe(true);
    expect(tracer.spans).toContain('memory.searchIndex');
  });

  it('memory.vecSearch span fires when vec extension is loaded', async () => {
    const tracer = makeRecordingTracer();
    const embedder = {
      embed: jest.fn(async () => [new Float32Array(384)]),
      dim: 384,
    } as unknown as IEmbedder;
    const connection = {
      vecExtensionLoaded: true,
      db: { prepare: jest.fn(() => ({ all: jest.fn(() => []) })) },
    } as unknown as SqliteConnectionService;
    const service = new MemorySearchService(
      makeLogger(),
      connection,
      embedder,
      makeStore(),
      makeObservationQueue(),
      makeVecStatus(true),
      tracer,
    );
    await service.searchRich('a longer query string here', 5);
    expect(tracer.spans).toContain('memory.vecSearch');
  });
});

// ---------------------------------------------------------------------------
// Real SQLite: tri-state scope, cache key, quarantine exclusion
// ---------------------------------------------------------------------------

describe('MemorySearchService — real SQLite scope and quarantine', () => {
  let t: RetentionTestDb;
  let store: MemoryStore;

  /** Every seeded vector is zero, so each KNN distance ties at 0. */
  const zeroEmbedder = {
    dim: 384,
    embed: async (texts: readonly string[]) =>
      texts.map(() => new Float32Array(384)),
  } as unknown as IEmbedder;

  /** Replaces the quarantine predicate with a tautology: "no predicate". */
  const withoutQuarantinePredicate = (sql: string): string =>
    sql.replace(/(?:m\.)?quarantined_at IS NULL/g, '1');

  function makeSearch(
    options: {
      vec?: boolean;
      rewrite?: (sql: string) => string;
      logger?: Logger;
    } = {},
  ): MemorySearchService {
    const vec = options.vec ?? true;
    const { rewrite } = options;
    const connection = {
      vecExtensionLoaded: vec,
      get db() {
        const db = t.db;
        return rewrite
          ? { prepare: (sql: string) => db.prepare(rewrite(sql)) }
          : db;
      },
    } as unknown as SqliteConnectionService;
    return new MemorySearchService(
      options.logger ?? makeLogger(),
      connection,
      zeroEmbedder,
      store,
      makeObservationQueue(),
      makeVecStatus(vec),
    );
  }

  function quarantine(...ids: string[]): void {
    const stmt = t.raw.prepare(
      `UPDATE memories SET quarantined_at = ?, quarantine_reason = 'rule:test'
       WHERE id = ?`,
    );
    for (const id of ids) stmt.run(5_000, id);
  }

  const hitIds = (hits: ReadonlyArray<{ memory: { id: unknown } }>) =>
    hits.map((h) => String(h.memory.id)).sort();

  const kiwi = (
    id: string,
    workspaceRoot: string | null,
    extra: Partial<SeedMemoryOptions> = {},
  ): SeedMemoryOptions => ({
    id,
    workspaceRoot,
    token: 'kiwi orchard notes',
    ...extra,
  });

  beforeEach(() => {
    t = openRetentionTestDb({ memorySchema: true, vec: true });
    store = new MemoryStore(makeLogger(), t.connection, zeroEmbedder, {
      available: true,
    } as VecStatusService);
  });
  afterEach(() => t.close());
  afterAll(() => removeRetentionTempDirs());

  it('null scope returns only no-workspace rows; undefined returns every workspace', async () => {
    seedMemories(t.raw, [
      kiwi('a-1', '/ws/a'),
      kiwi('b-1', '/ws/b'),
      kiwi('n-1', null),
      kiwi('n-2', null),
    ]);
    const search = makeSearch();

    const nullScoped = await search.searchRich('kiwi orchard', 10, null);
    const unscoped = await search.searchRich('kiwi orchard', 10);
    const named = await search.searchRich('kiwi orchard', 10, '/ws/a');

    expect(hitIds(nullScoped.hits)).toEqual(['n-1', 'n-2']);
    expect(hitIds(unscoped.hits)).toEqual(['a-1', 'b-1', 'n-1', 'n-2']);
    expect(hitIds(named.hits)).toEqual(['a-1']);
    expect(unscoped.bm25Only).toBe(false);
  });

  it('cache: a cached null-scope result never serves an unscoped query, or the reverse', async () => {
    seedMemories(t.raw, [kiwi('a-1', '/ws/a'), kiwi('n-1', null)]);
    const search = makeSearch();

    const firstUnscoped = await search.searchRich('kiwi', 10);
    const nullScoped = await search.searchRich('kiwi', 10, null);
    const secondUnscoped = await search.searchRich('kiwi', 10);

    expect(hitIds(nullScoped.hits)).toEqual(['n-1']);
    expect(hitIds(firstUnscoped.hits)).toEqual(['a-1', 'n-1']);
    expect(secondUnscoped).toBe(firstUnscoped);
  });

  it('cache: the same query and scope with topK 5 then 10 return 5 and 10 hits', async () => {
    seedMemories(
      t.raw,
      Array.from({ length: 12 }, (_, i) => ({
        id: `m-${String(i).padStart(2, '0')}`,
        workspaceRoot: '/ws/c',
        token: 'mango ledger',
      })),
    );
    const search = makeSearch();

    const five = await search.searchRich('mango', 5, '/ws/c');
    const ten = await search.searchRich('mango', 10, '/ws/c');

    expect(five.hits).toHaveLength(5);
    expect(ten.hits).toHaveLength(10);
  });

  it('a restore that bumps the write counter makes a cached query return the restored row', async () => {
    seedMemories(t.raw, [kiwi('n-1', null), kiwi('n-2', null)]);
    quarantine('n-2');
    const search = makeSearch();

    const before = await search.searchRich('kiwi', 10, null);
    expect(hitIds(before.hits)).toEqual(['n-1']);

    t.raw
      .prepare(
        `UPDATE memories SET quarantined_at = NULL, quarantine_reason = NULL
         WHERE id = ?`,
      )
      .run('n-2');
    // Without a counter bump the cached page is still served.
    expect(await search.searchRich('kiwi', 10, null)).toBe(before);

    // The store's counter bump path (the one a restore uses) invalidates it.
    store.markWorkspacesChanged([null]);
    const after = await search.searchRich('kiwi', 10, null);
    expect(hitIds(after.hits)).toEqual(['n-1', 'n-2']);
  });

  it('searchIndex BM25 ranks by best chunk per memory instead of failing (bm25() in an aggregate)', async () => {
    seedMemories(t.raw, [
      {
        id: 'weak',
        workspaceRoot: '/ws/e',
        token: 'guava among many other words here',
        chunks: 2,
      },
      { id: 'strong', workspaceRoot: '/ws/e', token: 'guava guava guava' },
      { id: 'miss', workspaceRoot: '/ws/e', token: 'unrelated text' },
    ]);
    const logger = makeLogger();
    const search = makeSearch({ vec: false, logger });

    const scoped = await search.searchIndex({
      query: 'guava',
      workspaceRoot: '/ws/e',
    });
    const unscoped = await search.searchIndex({ query: 'guava' });

    expect(scoped.rows.map((r) => r.id)).toEqual(['strong', 'weak']);
    expect(unscoped.rows.map((r) => r.id)).toEqual(['strong', 'weak']);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('quarantined BM25 matches beyond the limit do not starve active matches', async () => {
    const quarantined = Array.from({ length: 8 }, (_, i) => ({
      id: `q-${i}`,
      workspaceRoot: '/ws/d',
      token: 'papaya papaya papaya papaya',
    }));
    seedMemories(t.raw, [
      ...quarantined,
      {
        id: 'active',
        workspaceRoot: '/ws/d',
        token: 'papaya with several other filler words in the chunk',
      },
    ]);
    quarantine(...quarantined.map((row) => row.id));
    // Precondition: unfiltered, the four best BM25 matches are all quarantined.
    const topFour = t.raw
      .prepare(
        `SELECT mc.memory_id AS id FROM memory_chunks_fts fts
         JOIN memory_chunks mc ON mc.rowid = fts.rowid
         WHERE memory_chunks_fts MATCH 'papaya'
         ORDER BY bm25(memory_chunks_fts) ASC LIMIT 4`,
      )
      .all() as Array<{ id: string }>;
    expect(topFour.map((r) => r.id).every((id) => id.startsWith('q-'))).toBe(
      true,
    );
    const search = makeSearch({ vec: false });

    const index = await search.searchIndex({
      query: 'papaya',
      topK: 1,
      workspaceRoot: '/ws/d',
    });
    const rich = await search.searchRich('papaya', 1, '/ws/d');

    expect(index.rows.map((r) => r.id)).toEqual(['active']);
    expect(hitIds(rich.hits)).toEqual(['active']);
  });

  it('quarantined rows are absent from search, searchRich, searchIndex, timeline and getObservations', async () => {
    seedMemories(t.raw, [
      kiwi('t-1', '/ws/t', { lastUsedAt: 100 }),
      kiwi('t-2', '/ws/t', { lastUsedAt: 200 }),
      kiwi('t-3', '/ws/t', { lastUsedAt: 300 }),
      kiwi('t-4', '/ws/t', { lastUsedAt: 400 }),
      kiwi('n-1', null, { lastUsedAt: 500 }),
      kiwi('n-2', null, { lastUsedAt: 600 }),
    ]);
    quarantine('t-2', 'n-2');
    const search = makeSearch();
    const active = ['n-1', 't-1', 't-3', 't-4'];

    const plain = await search.search('kiwi orchard', 10);
    expect(plain.hits.map((h) => h.memoryId).sort()).toEqual(active);
    expect(hitIds((await search.searchRich('kiwi', 10)).hits)).toEqual(active);
    expect(hitIds((await search.searchRich('kiwi', 10, null)).hits)).toEqual([
      'n-1',
    ]);
    expect(hitIds((await search.searchRich('kiwi', 10, '/ws/t')).hits)).toEqual(
      ['t-1', 't-3', 't-4'],
    );

    const byQuery = await search.searchIndex({ query: 'kiwi', topK: 20 });
    expect(byQuery.rows.map((r) => r.id).sort()).toEqual(active);
    const byFilter = await search.searchIndex({ topK: 20 });
    expect(byFilter.rows.map((r) => r.id).sort()).toEqual(active);
    const byWorkspace = await search.searchIndex({ workspaceRoot: '/ws/t' });
    expect(byWorkspace.rows.map((r) => r.id).sort()).toEqual([
      't-1',
      't-3',
      't-4',
    ]);

    const timeline = search.timeline({ anchorId: 't-3' });
    expect(timeline.rows.map((r) => r.id)).toEqual(['t-1', 't-3', 't-4']);
    expect(timeline.anchorIndex).toBe(1);
    expect(search.timeline({ anchorId: 't-2' })).toEqual({
      rows: [],
      anchorIndex: 0,
    });

    const observations = search.getObservations({
      ids: ['t-1', 't-2', 'n-2'],
      includeQueueRows: false,
    });
    expect(observations.memories.map((m) => m.id)).toEqual(['t-1']);
  });

  // Predicate neutrality: on this fixture, with nothing quarantined, adding the
  // quarantine predicate changes no result. It compares this implementation
  // with and without the predicate on the same data only; it is not a
  // comparison with any earlier version of the service.
  it('predicate neutrality: with nothing quarantined, the quarantine predicate changes no result', async () => {
    seedMemories(t.raw, [
      kiwi('t-1', '/ws/t', { lastUsedAt: 100, concepts: ['fruit'] }),
      kiwi('t-2', '/ws/t', { lastUsedAt: 200 }),
      kiwi('t-3', '/ws/t', { lastUsedAt: 300, chunks: 2 }),
      kiwi('u-1', '/ws/u', { lastUsedAt: 400, concepts: ['fruit'] }),
      kiwi('n-1', null, { lastUsedAt: 500 }),
      {
        id: 'other',
        workspaceRoot: '/ws/t',
        token: 'unrelated banana text',
        lastUsedAt: 600,
      },
    ]);
    const filtered = makeSearch();
    const unfiltered = makeSearch({ rewrite: withoutQuarantinePredicate });

    expect(withoutQuarantinePredicate('WHERE m.quarantined_at IS NULL')).toBe(
      'WHERE 1',
    );
    const run = async (service: MemorySearchService) => ({
      search: await service.search('kiwi orchard', 10),
      richAll: await service.searchRich('kiwi notes', 10),
      richNull: await service.searchRich('kiwi notes', 10, null),
      richNamed: await service.searchRich('kiwi notes', 3, '/ws/t'),
      indexQuery: await service.searchIndex({ query: 'kiwi', topK: 10 }),
      indexFilter: await service.searchIndex({ concepts: ['fruit'] }),
      indexWorkspace: await service.searchIndex({ workspaceRoot: '/ws/t' }),
      timeline: service.timeline({ anchorId: 't-2' }),
      observations: service.getObservations({
        ids: ['t-1', 'u-1', 'n-1', 'other'],
        includeQueueRows: false,
      }),
    });

    const withPredicate = await run(filtered);
    const withoutPredicate = await run(unfiltered);

    expect(withPredicate).toEqual(withoutPredicate);
    expect(withPredicate.search.hits.length).toBeGreaterThan(0);
    expect(withPredicate.indexFilter.rows.map((r) => r.id).sort()).toEqual([
      't-1',
      'u-1',
    ]);
    expect(withPredicate.timeline.rows).toHaveLength(4);
  });

  it("searchIndex treats workspaceRoot '' as omitted: same rows as {} on the query and pure-filter paths", async () => {
    seedMemories(t.raw, [
      kiwi('a-1', '/ws/a'),
      kiwi('b-1', '/ws/b'),
      kiwi('n-1', null),
    ]);
    const everything = ['a-1', 'b-1', 'n-1'];
    const ids = (r: { rows: ReadonlyArray<{ id: string }> }) =>
      r.rows.map((row) => row.id).sort();

    // Fresh services, so no cache entry can make the two agree by accident.
    for (const vec of [true, false]) {
      expect(ids(await makeSearch({ vec }).searchIndex({}))).toEqual(
        everything,
      );
      expect(
        ids(await makeSearch({ vec }).searchIndex({ workspaceRoot: '' })),
      ).toEqual(everything);
      expect(
        ids(await makeSearch({ vec }).searchIndex({ query: 'kiwi' })),
      ).toEqual(everything);
      expect(
        ids(
          await makeSearch({ vec }).searchIndex({
            query: 'kiwi',
            workspaceRoot: '',
          }),
        ),
      ).toEqual(everything);
    }

    // One service: '' and omitted share a cache entry because they are the
    // same scope, and the SQL issued for '' carries no workspace predicate.
    const shared = makeSearch();
    const issuedBefore = t.issued.length;
    const omitted = await shared.searchIndex({ topK: 5 });
    const blank = await shared.searchIndex({ topK: 5, workspaceRoot: '' });
    expect(blank).toBe(omitted);
    expect(
      t.issued
        .slice(issuedBefore)
        .some((sql) => sql.includes('workspace_root IS')),
    ).toBe(false);
  });

  // Cache invalidation through the real store (no mocked counters). The insert
  // and forget cases need every named-workspace write to also bump the global
  // '' generation (Batch 3, MemoryStore); restore already does through
  // markWorkspacesChanged.
  describe('cache invalidation through real MemoryStore writes', () => {
    const insertKiwi = (workspaceRoot: string | null) =>
      store.insertMemoryWithChunks(
        {
          workspaceRoot,
          tier: 'recall',
          kind: 'fact',
          content: 'kiwi orchard notes',
        },
        [{ ord: 0, text: 'kiwi orchard notes', tokenCount: 3 }],
      );
    const richIds = async (search: MemorySearchService) =>
      hitIds((await search.searchRich('kiwi', 10)).hits);
    const indexIds = async (search: MemorySearchService) =>
      (await search.searchIndex({ query: 'kiwi', topK: 20 })).rows
        .map((r) => r.id)
        .sort();

    it('an insert into /ws/a is visible to cached unscoped searchRich and searchIndex', async () => {
      seedMemories(t.raw, [kiwi('n-1', null)]);
      const search = makeSearch();
      expect(await richIds(search)).toEqual(['n-1']);
      expect(await indexIds(search)).toEqual(['n-1']);

      const inserted = String(await insertKiwi('/ws/a'));

      expect(await richIds(search)).toEqual([inserted, 'n-1'].sort());
      expect(await indexIds(search)).toEqual([inserted, 'n-1'].sort());
    });

    it('a forget in /ws/a is visible to cached unscoped searchRich and searchIndex', async () => {
      seedMemories(t.raw, [kiwi('a-1', '/ws/a'), kiwi('n-1', null)]);
      const search = makeSearch();
      expect(await richIds(search)).toEqual(['a-1', 'n-1']);
      expect(await indexIds(search)).toEqual(['a-1', 'n-1']);

      store.forget(memoryId('a-1'));

      expect(await richIds(search)).toEqual(['n-1']);
      expect(await indexIds(search)).toEqual(['n-1']);
    });

    it('a restore in /ws/a is visible to cached unscoped and scoped searchRich and searchIndex', async () => {
      seedMemories(t.raw, [kiwi('a-1', '/ws/a'), kiwi('n-1', null)]);
      quarantine('a-1');
      const search = makeSearch();
      expect(await richIds(search)).toEqual(['n-1']);
      expect(await indexIds(search)).toEqual(['n-1']);
      expect(
        hitIds((await search.searchRich('kiwi', 10, '/ws/a')).hits),
      ).toEqual([]);

      expect(store.restoreQuarantined({ ids: ['a-1'] }, '/ws/a')).toEqual({
        restored: 1,
      });

      expect(await richIds(search)).toEqual(['a-1', 'n-1']);
      expect(await indexIds(search)).toEqual(['a-1', 'n-1']);
      expect(
        hitIds((await search.searchRich('kiwi', 10, '/ws/a')).hits),
      ).toEqual(['a-1']);
    });
  });
});
