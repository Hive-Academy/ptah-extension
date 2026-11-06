/**
 * Partial answers and request budgets in `MemorySearchService`: a capped
 * scoped KNN keeps its rows and is not cached, a shed rerank keeps the RRF
 * order and is not cached, and a deadline-bound search does not wait in the
 * process-wide serial queue.
 */
import 'reflect-metadata';
import type { IEmbedder, SqliteDatabase, SqliteStatement } from '@ptah-extension/persistence-sqlite';
import { MemorySearchService } from './memory-search.service';
import { MemoryStore } from './memory.store';
import { ObservationQueueStore } from './observation-queue.store';
import { HostBridgeEmbedder } from './search-worker-host-embedder';
import type { CuratorLogger, SqliteDbProvider } from './sqlite-reader-deps.types';

interface ChunkRow {
  rowid: number;
  chunk_id: string;
  memory_id: string;
  ord: number;
  text: string;
  token_count: number;
  created_at: number;
}

function chunk(rowid: number): ChunkRow {
  return {
    rowid,
    chunk_id: `ck${rowid}`,
    memory_id: `mem${rowid}`,
    ord: 0,
    text: `lexical match ${rowid}`,
    token_count: 3,
    created_at: 1,
  };
}

function makeLogger(): jest.Mocked<CuratorLogger> {
  return { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

interface Fixture {
  readonly connection: SqliteDbProvider;
  /** `k` of every bounded (scoped) KNN statement run. */
  readonly knnK: number[];
}

/**
 * `knn` answers the scoped (`k = ?`) and unscoped KNN statements; every other
 * statement answers `rows`.
 */
function makeConnection(rows: ChunkRow[], knn: () => unknown[]): Fixture {
  const knnK: number[] = [];
  const statementFor = (sql: string): SqliteStatement => ({
    all: (...params: unknown[]) => {
      if (sql.includes('embedding MATCH ? AND k = ?')) {
        knnK.push(Number(params[1]));
        return knn();
      }
      if (sql.includes('embedding MATCH ?')) return knn();
      return rows;
    },
    get: () => undefined,
    run: () => ({ changes: 0, lastInsertRowid: 0 }),
    iterate: () => [][Symbol.iterator](),
  });
  const db: SqliteDatabase = {
    exec: () => undefined,
    prepare: statementFor,
    pragma: () => undefined,
    close: () => undefined,
    open: true,
    inTransaction: false,
    transaction: (fn) => fn,
  };
  return { connection: { db, vecExtensionLoaded: true, handleFatalWriteError: () => false }, knnK };
}

function makeService(connection: SqliteDbProvider, embedder: IEmbedder, logger: CuratorLogger): MemorySearchService {
  const store: MemoryStore = Object.assign(Object.create(MemoryStore.prototype), {
    getById: (id: string) => ({ id, subject: id, content: id, tier: 'recall' }),
    recordUse: jest.fn(),
    getWriteCounter: () => 0,
  });
  const observationQueue: ObservationQueueStore = Object.create(ObservationQueueStore.prototype);
  return new MemorySearchService(logger, connection, embedder, store, observationQueue, { available: true });
}

function staticEmbedder(dim = 384): IEmbedder {
  return { embed: async () => [new Float32Array(dim)], dim, modelId: 'test-model', dispose: async () => undefined };
}

describe('MemorySearchService — capped scoped KNN is partial, not a failure', () => {
  it('keeps the partial vector rows, answers bm25Only:false without a warning, and does not cache', async () => {
    const rows = [1, 2, 3].map(chunk);
    // The cap-sized KNN held one scoped row (rowid 2): fewer than requested.
    const { connection, knnK } = makeConnection(rows, () => [{ inspected: 2048, rowid: 2, distance: 0.1 }]);
    const logger = makeLogger();
    const service = makeService(connection, staticEmbedder(), logger);

    const result = await service.searchRich('lexical match', 5, '/tiny-workspace', Date.now() + 4_500);

    expect(result.bm25Only).toBe(false);
    expect(result.hits.find((hit) => hit.chunk.id === 'ck2')?.vecRank).toBeDefined();
    expect(logger.warn).not.toHaveBeenCalled();
    await service.searchRich('lexical match', 5, '/tiny-workspace', Date.now() + 4_500);
    expect(knnK).toEqual([2048, 2048]);
  });

  it('does not cache a capped searchIndex answer, but caches an exact one', async () => {
    const capped = makeConnection([], () => [{ inspected: 2048, rowid: null, distance: null }]);
    const cappedLogger = makeLogger();
    const cappedService = makeService(capped.connection, staticEmbedder(), cappedLogger);
    const first = await cappedService.searchIndex({ query: 'lexical', workspaceRoot: '/tiny-workspace' });
    expect(first.bm25Only).toBe(false);
    await cappedService.searchIndex({ query: 'lexical', workspaceRoot: '/tiny-workspace' });
    expect(capped.knnK).toEqual([2048, 2048]);
    expect(cappedLogger.warn).not.toHaveBeenCalled();

    // The table was exhausted (fewer than the cap inspected): exact, cached.
    const exact = makeConnection([], () => [{ inspected: 12, rowid: null, distance: null }]);
    const exactService = makeService(exact.connection, staticEmbedder(), makeLogger());
    await exactService.searchIndex({ query: 'lexical', workspaceRoot: '/tiny-workspace' });
    await exactService.searchIndex({ query: 'lexical', workspaceRoot: '/tiny-workspace' });
    expect(exact.knnK).toEqual([2048]);
  });
});

describe('MemorySearchService — shed or skipped rerank', () => {
  afterEach(() => jest.useRealTimers());
  /** A worker-side bridge whose host answers embeds and sheds every rerank. */
  function busyHostBridge(): { bridge: HostBridgeEmbedder; reranks: () => number } {
    let reranks = 0;
    const bridge: HostBridgeEmbedder = new HostBridgeEmbedder({
      dim: 3,
      modelId: 'test-model',
      canRerank: true,
      post: (message) => {
        if (message.kind === 'embed') bridge.settle({ kind: 'embed-result', id: message.id, vectors: [[1, 2, 3]] });
        if (message.kind === 'rerank') {
          reranks++;
          bridge.settle({ kind: 'host-call-failed', id: message.id, message: 'host reranker busy', busy: true });
        }
      },
    });
    return { bridge, reranks: () => reranks };
  }

  it('answers a shed rerank in RRF order without a warning and does not cache it', async () => {
    const rows = [1, 2, 3, 4, 5, 6].map(chunk);
    const { connection } = makeConnection(rows, () => [{ rowid: 1, distance: 0.1 }]);
    const { bridge, reranks } = busyHostBridge();
    const logger = makeLogger();
    const service = makeService(connection, bridge, logger);

    const result = await service.searchRich('lexical match', 5, undefined, Date.now() + 4_500);
    expect(result.bm25Only).toBe(false);
    expect(result.hits.length).toBeGreaterThan(0);
    expect(logger.warn).not.toHaveBeenCalled();
    await service.searchRich('lexical match', 5, undefined, Date.now() + 4_500);
    // Not served from the cache: the second search asked for a rerank again.
    expect(reranks()).toBe(2);
  });

  it('keeps a deadline-missed rerank uncached and warns only if the reranker really fails', async () => {
    jest.useFakeTimers();
    const rows = [1, 2, 3, 4, 5, 6].map(chunk);
    const { connection } = makeConnection(rows, () => [{ rowid: 1, distance: 0.1 }]);
    let reranks = 0;
    const bridge = new HostBridgeEmbedder({
      dim: 3,
      modelId: 'test-model',
      canRerank: true,
      post: (message) => {
        if (message.kind === 'embed') bridge.settle({ kind: 'embed-result', id: message.id, vectors: [[1, 2, 3]] });
        if (message.kind === 'rerank') {
          reranks++;
          if (reranks === 2) bridge.settle({ kind: 'rerank-result', id: message.id, ranked: [{ id: '1', score: 1 }] });
        }
      },
    });
    const logger = makeLogger();
    const service = makeService(connection, bridge, logger);

    const first = service.searchRich('lexical match', 5, undefined, Date.now() + 4_500);
    await jest.advanceTimersByTimeAsync(4_500);
    expect((await first).hits.length).toBeGreaterThan(0);
    expect(logger.warn).not.toHaveBeenCalled();
    await service.searchRich('lexical match', 5, undefined, Date.now() + 4_500);
    expect(reranks).toBe(2);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('skips the rerank with too little time left and does not cache that answer', async () => {
    const rows = [1, 2, 3, 4, 5, 6].map(chunk);
    const { connection } = makeConnection(rows, () => [{ rowid: 1, distance: 0.1 }]);
    const { bridge, reranks } = busyHostBridge();
    const logger = makeLogger();
    const service = makeService(connection, bridge, logger);

    const hurried = await service.searchRich('lexical match', 5, undefined, Date.now() + 900);
    expect(hurried.bm25Only).toBe(false);
    expect(reranks()).toBe(0);
    expect(logger.warn).not.toHaveBeenCalled();
    await service.searchRich('lexical match', 5, undefined, Date.now() + 4_500);
    expect(reranks()).toBe(1);
  });
});

describe('MemorySearchService — deadline-bound searches', () => {
  afterEach(() => jest.useRealTimers());

  it('do not wait in the process-wide serial queue behind a stalled search', async () => {
    jest.useFakeTimers();
    const rows = [1, 2].map(chunk);
    const { connection } = makeConnection(rows, () => [{ rowid: 1, distance: 0.1 }]);
    const embedder: IEmbedder = {
      embed: (texts) =>
        texts[0] === 'stalled'
          ? new Promise<Float32Array[]>(() => undefined)
          : Promise.resolve([new Float32Array(384)]),
      dim: 384,
      modelId: 'test-model',
      dispose: async () => undefined,
    };
    const logger = makeLogger();
    const service = makeService(connection, embedder, logger);

    const stalled = service.searchRich('stalled', 5, undefined, Date.now() + 4_500);
    let quickSettled = false;
    const quick = service.searchRich('quick', 5, undefined, Date.now() + 4_500).then((response) => {
      quickSettled = true;
      return response;
    });
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(quickSettled).toBe(true);
    expect((await quick).bm25Only).toBe(false);

    jest.advanceTimersByTime(4_300);
    expect((await stalled).bm25Only).toBe(true);
  });

  it('skip the KNN when the embed arrives after the deadline', async () => {
    jest.useFakeTimers();
    const rows = [1, 2].map(chunk);
    let knnRuns = 0;
    const { connection } = makeConnection(rows, () => {
      knnRuns++;
      return [{ rowid: 1, distance: 0.1 }];
    });
    let release: (vectors: Float32Array[]) => void = () => undefined;
    const embedder: IEmbedder = {
      embed: () => new Promise<Float32Array[]>((resolve) => (release = resolve)),
      dim: 384,
      modelId: 'test-model',
      dispose: async () => undefined,
    };
    const service = makeService(connection, embedder, makeLogger());
    const pending = service.searchRich('late', 5, undefined, Date.now() + 1_000);
    jest.advanceTimersByTime(1_000);
    expect((await pending).bm25Only).toBe(true);
    release([new Float32Array(384)]);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(knnRuns).toBe(0);
  });
});
