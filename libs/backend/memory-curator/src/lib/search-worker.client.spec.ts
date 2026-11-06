import 'reflect-metadata';
import type { IEmbedder } from '@ptah-extension/persistence-sqlite';
import { SearchWorkerClient } from './search-worker.client';
import type { ISearchWorkerFactory, ISearchWorkerProcess } from './search-worker.port';
import type { CuratorLogger } from './sqlite-reader-deps.types';

class FakeProcess implements ISearchWorkerProcess {
  readonly sent: unknown[] = [];
  killed = false;
  /** A real utility process reports `exit` after `kill()`; a wedged one may not. */
  exitOnKill = true;
  private messageHandler: (message: unknown) => void = () => undefined;
  private exitHandler: (code: number | null) => void = () => undefined;
  postMessage(message: unknown): void {
    this.sent.push(message);
  }
  on(event: 'message', callback: (message: unknown) => void): void;
  on(event: 'exit', callback: (code: number | null) => void): void;
  on(
    event: 'message' | 'exit',
    callback: ((message: unknown) => void) | ((code: number | null) => void),
  ): void {
    if (event === 'message') this.messageHandler = callback as (message: unknown) => void;
    else this.exitHandler = callback as (code: number | null) => void;
  }
  kill(): void {
    this.killed = true;
    if (this.exitOnKill) this.exitHandler(null);
  }
  reply(message: unknown): void {
    this.messageHandler(message);
  }
  crash(): void {
    this.exitHandler(1);
  }
  /** Requests sent after the init message. */
  get queries(): unknown[] {
    return this.sent.slice(1);
  }
}

function makeLogger(): jest.Mocked<CuratorLogger> {
  return { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

function makeEmbedder(embed?: IEmbedder['embed']): IEmbedder {
  return {
    dim: 3,
    modelId: 'test-model',
    embed: embed ?? (async (texts) => texts.map(() => new Float32Array([1, 2, 3]))),
    dispose: async () => undefined,
  };
}

function makeFactory(children: FakeProcess[]): ISearchWorkerFactory {
  return {
    spawn: () => {
      const child = new FakeProcess();
      children.push(child);
      return child;
    },
    databaseConfig: () => ({ dbPath: '/db/ptah.sqlite', vecPath: '/vec/vec0.dll' }),
  };
}

const symbolHit = {
  id: 's1',
  workspaceRoot: '/work',
  filePath: 'a.ts',
  kind: 'function',
  symbolName: 'foo',
  subject: 'foo()',
  text: 'function foo() {}',
  tokenCount: 4,
  score: 0.5,
};

/** Let queued microtasks (async host-call handlers) run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe('SearchWorkerClient', () => {
  afterEach(() => jest.useRealTimers());

  it('initialises the worker, then resolves the validated result', async () => {
    const children: FakeProcess[] = [];
    const client = new SearchWorkerClient(makeFactory(children), makeEmbedder(), makeLogger());
    const response = client.searchSymbols('foo', 3, '/work');
    const [child] = children;
    expect(child.sent[0]).toEqual({
      kind: 'init',
      dbPath: '/db/ptah.sqlite',
      vecPath: '/vec/vec0.dll',
      embedderDim: 3,
      embedderModelId: 'test-model',
      rerankAvailable: false,
    });
    expect(child.queries).toEqual([{ kind: 'symbols', id: 1, query: 'foo', topK: 3, workspaceRoot: '/work' }]);
    child.reply({ kind: 'result', id: 1, result: { hits: [symbolHit], bm25Only: false } });
    expect(await response).toEqual({ hits: [symbolHit], bm25Only: false });
  });

  it('degrades a result that fails its kind schema without restarting the worker', async () => {
    const children: FakeProcess[] = [];
    const logger = makeLogger();
    const client = new SearchWorkerClient(makeFactory(children), makeEmbedder(), logger);
    const response = client.searchSymbols('foo', 3);
    // A memory-list page is not a symbol hit page.
    children[0].reply({ kind: 'result', id: 1, result: { memories: [], total: 0 } });
    expect(await response).toEqual({ hits: [], bm25Only: true });
    expect(children[0].killed).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('result failed validation'),
      expect.objectContaining({ kind: 'symbols' }),
    );
  });

  it('ignores invalid worker messages', async () => {
    jest.useFakeTimers();
    const children: FakeProcess[] = [];
    const logger = makeLogger();
    const client = new SearchWorkerClient(makeFactory(children), makeEmbedder(), logger, { timeoutMs: 100 });
    const response = client.getChunks('m1');
    children[0].reply({ id: 1, result: [] });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('invalid worker message'), expect.anything());
    jest.advanceTimersByTime(100);
    expect(await response).toEqual([]);
  });

  it('releases an identifiable invalid result so the next queued request runs', async () => {
    const children: FakeProcess[] = [];
    const client = new SearchWorkerClient(makeFactory(children), makeEmbedder(), makeLogger(), { maxInFlight: 1 });
    const first = client.getChunks('a');
    const second = client.getChunks('b');
    expect(children[0].queries).toHaveLength(1);
    children[0].reply({ kind: 'error', id: 1, message: 42 });
    expect(await first).toEqual([]);
    expect(children[0].queries).toHaveLength(2);
    children[0].reply({ kind: 'result', id: 2, result: [] });
    await second;
  });

  it('dispatches a memory deadline before its client timeout', async () => {
    const children: FakeProcess[] = [];
    const client = new SearchWorkerClient(makeFactory(children), makeEmbedder(), makeLogger());
    const before = Date.now();
    const response = client.searchMemory('needle', 5);
    expect(children[0].queries[0]).toEqual(expect.objectContaining({ deadlineMs: expect.any(Number) }));
    const query = children[0].queries[0] as { deadlineMs: number };
    expect(query.deadlineMs - before).toBeLessThan(5_000);
    children[0].reply({ kind: 'result', id: 1, result: { hits: [], bm25Only: true } });
    await response;
  });

  it('degrades a hung worker, kills it after the liveness window, and respawns only after the backoff', async () => {
    jest.useFakeTimers();
    const children: FakeProcess[] = [];
    const client = new SearchWorkerClient(makeFactory(children), makeEmbedder(), makeLogger(), {
      timeoutMs: 100,
      livenessMs: 300,
    });
    const pending = client.searchSymbols('Foo', 5);
    children[0].reply({ kind: 'ready', vecLoaded: true });
    jest.advanceTimersByTime(100);
    expect(await pending).toEqual({ hits: [], bm25Only: true });
    // One timeout is not a stall: the worker is only killed after 300 ms of silence.
    expect(children[0].killed).toBe(false);
    jest.advanceTimersByTime(200);
    expect(children[0].killed).toBe(true);
    // Inside the backoff window: answered at once, nothing spawned or queued.
    expect(await client.searchSymbols('Foo', 5)).toEqual({ hits: [], bm25Only: true });
    expect(children).toHaveLength(1);
    jest.advanceTimersByTime(250);
    const retry = client.searchSymbols('Foo', 5);
    expect(children).toHaveLength(2);
    children[1].reply({ kind: 'result', id: 2, result: { hits: [], bm25Only: false } });
    expect(await retry).toEqual({ hits: [], bm25Only: false });
  });

  it('caps the restart backoff at 30 seconds', () => {
    jest.useFakeTimers();
    const children: FakeProcess[] = [];
    const client = new SearchWorkerClient(makeFactory(children), makeEmbedder(), makeLogger());
    for (let i = 0; i < 12; i++) {
      void client.searchMemory('x', 2);
      children[children.length - 1].crash();
      jest.advanceTimersByTime(30_000);
    }
    expect(children).toHaveLength(12);
  });

  it('does not restart a worker that is waiting on the host embedder', async () => {
    jest.useFakeTimers();
    const children: FakeProcess[] = [];
    let release: (vectors: Float32Array[]) => void = () => undefined;
    const embedder = makeEmbedder(() => new Promise((resolve) => (release = resolve)));
    const client = new SearchWorkerClient(makeFactory(children), embedder, makeLogger(), { timeoutMs: 100 });
    const pending = client.searchMemory('needle', 3, '/work');
    children[0].reply({ kind: 'embed', id: 1, texts: ['needle'] });
    jest.advanceTimersByTime(100);
    expect(await pending).toEqual({ hits: [], bm25Only: true });
    expect(children[0].killed).toBe(false);
    release([new Float32Array([0.5, 0.25, 1])]);
    await flush();
    expect(children[0].sent.at(-1)).toEqual({ kind: 'embed-result', id: 1, vectors: [[0.5, 0.25, 1]] });
  });

  it('answers a rerank call as failed when the host embedder cannot rerank', async () => {
    const children: FakeProcess[] = [];
    const client = new SearchWorkerClient(makeFactory(children), makeEmbedder(), makeLogger());
    void client.searchMemory('needle', 3);
    children[0].reply({ kind: 'rerank', id: 7, query: 'needle', candidates: [{ id: '1', text: 'a' }], topK: 3 });
    await flush();
    expect(children[0].sent.at(-1)).toEqual({ kind: 'host-call-failed', id: 7, message: 'reranker unavailable' });
    void client.dispose();
  });

  it('degrades pending calls when the process crashes', async () => {
    const children: FakeProcess[] = [];
    const client = new SearchWorkerClient(makeFactory(children), makeEmbedder(), makeLogger());
    const memory = client.searchMemory('x', 2);
    const page = client.searchSymbolPage({ workspaceRoot: '/work', query: 'Foo', limit: 20, offset: 0 });
    const listing = client.listMemories('/ws', 4);
    const chunks = client.getChunks('memory-1');
    children[0].crash();
    expect(await memory).toEqual({ hits: [], bm25Only: true });
    expect(await page).toEqual({ items: [], total: 0 });
    expect(await listing).toEqual({ memories: [], total: 0 });
    expect(await chunks).toEqual([]);
  });

  it('degrades a worker-reported query error and keeps the worker', async () => {
    const children: FakeProcess[] = [];
    const client = new SearchWorkerClient(makeFactory(children), makeEmbedder(), makeLogger());
    const response = client.listMemories('/ws', 4);
    children[0].reply({ kind: 'error', id: 1, message: 'SQLITE_BUSY' });
    expect(await response).toEqual({ memories: [], total: 0 });
    expect(children[0].killed).toBe(false);
  });

  it('kills the worker and backs off when init fails', async () => {
    const children: FakeProcess[] = [];
    const client = new SearchWorkerClient(makeFactory(children), makeEmbedder(), makeLogger());
    const response = client.getChunks('m1');
    children[0].reply({ kind: 'init-failed', message: 'SQLITE_CANTOPEN' });
    expect(await response).toEqual([]);
    expect(children[0].killed).toBe(true);
    expect(await client.getChunks('m1')).toEqual([]);
    expect(children).toHaveLength(1);
  });

  it('answers degraded once the in-flight cap is reached', async () => {
    const children: FakeProcess[] = [];
    const client = new SearchWorkerClient(makeFactory(children), makeEmbedder(), makeLogger(), { maxPending: 2 });
    void client.getChunks('a');
    void client.getChunks('b');
    expect(await client.getChunks('c')).toEqual([]);
    expect(children[0].queries).toHaveLength(2);
    void client.dispose();
  });

  it('rejects an invalid request before it reaches the worker', async () => {
    const children: FakeProcess[] = [];
    const client = new SearchWorkerClient(makeFactory(children), makeEmbedder(), makeLogger());
    expect(await client.searchMemory('x'.repeat(10_001), 3)).toEqual({ hits: [], bm25Only: true });
    expect(children).toHaveLength(0);
  });

  it('forwards worker logs at their level', () => {
    const children: FakeProcess[] = [];
    const logger = makeLogger();
    const client = new SearchWorkerClient(makeFactory(children), makeEmbedder(), logger);
    void client.getChunks('a');
    children[0].reply({ kind: 'log', level: 'debug', message: 'cap reached', context: { scopedHits: 1 } });
    expect(logger.debug).toHaveBeenCalledWith('[sqlite-search-worker] cap reached', { scopedHits: 1 });
    void client.dispose();
  });

  it('rebuilds a worker Error, with its stack and cause, for the host logger', () => {
    const children: FakeProcess[] = [];
    const logger = makeLogger();
    const client = new SearchWorkerClient(makeFactory(children), makeEmbedder(), logger);
    void client.getChunks('a');
    children[0].reply({
      kind: 'log',
      level: 'error',
      message: 'a write reached the read-only search connection',
      error: {
        name: 'SqliteError',
        message: 'attempt to write a readonly database',
        stack: 'SqliteError: attempt to write a readonly database\n    at run (worker.mjs:1:1)',
        cause: { name: 'Error', message: 'SQLITE_READONLY' },
      },
    });
    const [text, logged] = logger.error.mock.calls[0];
    expect(text).toBe('[sqlite-search-worker] a write reached the read-only search connection');
    expect(logged).toBeInstanceOf(Error);
    if (!(logged instanceof Error)) throw new Error('expected an Error');
    expect(logged.name).toBe('SqliteError');
    expect(logged.message).toBe('attempt to write a readonly database');
    expect(logged.stack).toContain('worker.mjs:1:1');
    expect(logged.cause).toBeInstanceOf(Error);
    void client.dispose();
  });

  it('dispose kills the worker, degrades pending calls and never respawns', async () => {
    const children: FakeProcess[] = [];
    const client = new SearchWorkerClient(makeFactory(children), makeEmbedder(), makeLogger());
    const pending = client.getChunks('a');
    await client.dispose();
    expect(children[0].killed).toBe(true);
    expect(await pending).toEqual([]);
    expect(await client.getChunks('b')).toEqual([]);
    expect(children).toHaveLength(1);
  });

  it('dispose waits for the exit, bounded, before resolving', async () => {
    jest.useFakeTimers();
    const children: FakeProcess[] = [];
    const logger = makeLogger();
    const client = new SearchWorkerClient(makeFactory(children), makeEmbedder(), logger, { exitWaitMs: 2_000 });
    void client.getChunks('a');
    children[0].exitOnKill = false;
    let settled = false;
    const disposed = client.dispose().then(() => {
      settled = true;
    });
    await flush();
    expect(children[0].killed).toBe(true);
    expect(settled).toBe(false);
    jest.advanceTimersByTime(2_000);
    await disposed;
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('did not exit'), { waitedMs: 2_000 });
  });

  it('dispose waits for an old child after reset cleared the process field', async () => {
    jest.useFakeTimers();
    const children: FakeProcess[] = [];
    const client = new SearchWorkerClient(makeFactory(children), makeEmbedder(), makeLogger(), { exitWaitMs: 100 });
    void client.getChunks('a');
    children[0].exitOnKill = false;
    children[0].reply({ kind: 'init-failed', message: 'database unavailable' });
    let settled = false;
    const disposed = client.dispose().then(() => { settled = true; });
    await flush();
    expect(settled).toBe(false);
    jest.advanceTimersByTime(100);
    await disposed;
  });

  it('times a request from its dispatch, so requests queued behind slow ones still answer', async () => {
    jest.useFakeTimers();
    const children: FakeProcess[] = [];
    const client = new SearchWorkerClient(makeFactory(children), makeEmbedder(), makeLogger(), {
      timeoutMs: 100,
      queueTimeoutMs: 1_000,
      maxInFlight: 1,
    });
    const pages = [1, 2, 3, 4].map(() => client.listMemories('/ws', 4));
    const child = children[0];
    // Each query takes 60 ms in the worker; the last one finishes at 240 ms,
    // well past 100 ms from its enqueue, but only 60 ms after its dispatch.
    for (let id = 1; id <= 4; id++) {
      expect(child.queries).toHaveLength(id);
      jest.advanceTimersByTime(60);
      child.reply({ kind: 'result', id, result: { memories: [], total: id } });
    }
    expect((await Promise.all(pages)).map((page) => page.total)).toEqual([1, 2, 3, 4]);
    expect(child.killed).toBe(false);
  });

  it('does not kill a worker serving 4 concurrent slow-but-progressing requests', async () => {
    jest.useFakeTimers();
    const children: FakeProcess[] = [];
    const logger = makeLogger();
    const client = new SearchWorkerClient(makeFactory(children), makeEmbedder(), logger, {
      timeoutMs: 100,
      livenessMs: 150,
    });
    const pages = [1, 2, 3, 4].map(() => client.listMemories('/ws', 4));
    const child = children[0];
    expect(child.queries).toHaveLength(4);
    // The single-threaded worker finishes one every 80 ms: later ones miss
    // their budget, but the worker keeps talking, so it is never restarted.
    for (let id = 1; id <= 4; id++) {
      jest.advanceTimersByTime(80);
      child.reply({ kind: 'result', id, result: { memories: [], total: id } });
    }
    const totals = (await Promise.all(pages)).map((page) => page.total);
    expect(totals[0]).toBe(1);
    expect(totals.slice(1)).toEqual([0, 0, 0]);
    expect(child.killed).toBe(false);
    expect(children).toHaveLength(1);
    // The worker is still in service: the next request is answered by it.
    const next = client.listMemories('/ws', 4);
    child.reply({ kind: 'result', id: 5, result: { memories: [], total: 5 } });
    expect((await next).total).toBe(5);
    expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('unresponsive'), expect.anything());
  });

  it('restarts a truly stalled worker once it has been silent for the liveness window', async () => {
    jest.useFakeTimers();
    const children: FakeProcess[] = [];
    const logger = makeLogger();
    const client = new SearchWorkerClient(makeFactory(children), makeEmbedder(), logger, {
      timeoutMs: 100,
      livenessMs: 250,
    });
    const first = client.listMemories('/ws', 4);
    const second = client.getChunks('m1');
    children[0].reply({ kind: 'ready', vecLoaded: true });
    jest.advanceTimersByTime(100);
    expect(await first).toEqual({ memories: [], total: 0 });
    expect(await second).toEqual([]);
    expect(children[0].killed).toBe(false);
    jest.advanceTimersByTime(150);
    expect(children[0].killed).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('unresponsive'),
      expect.objectContaining({ owed: 2 }),
    );
    jest.advanceTimersByTime(250);
    void client.getChunks('m2');
    expect(children).toHaveLength(2);
  });

  it('bounds the queue wait and never sends a request that timed out queued', async () => {
    jest.useFakeTimers();
    const children: FakeProcess[] = [];
    const client = new SearchWorkerClient(makeFactory(children), makeEmbedder(), makeLogger(), {
      timeoutMs: 100,
      maxInFlight: 1,
      livenessMs: 10_000,
    });
    const running = client.getChunks('a');
    const queued = client.getChunks('b');
    jest.advanceTimersByTime(100);
    expect(await running).toEqual([]);
    expect(await queued).toEqual([]);
    // The worker still owes id 1, so nothing else was dispatched.
    expect(children[0].queries).toEqual([{ kind: 'chunks', id: 1, memoryId: 'a' }]);
    children[0].reply({ kind: 'result', id: 1, result: [] });
    expect(children[0].queries).toHaveLength(1);
  });

  it('warms the host embedder when it forks a worker that can search vectors', () => {
    const children: FakeProcess[] = [];
    const embed = jest.fn<Promise<Float32Array[]>, [readonly string[]]>(async () => []);
    const client = new SearchWorkerClient(makeFactory(children), makeEmbedder(embed), makeLogger());
    void client.getChunks('a');
    void client.getChunks('b');
    expect(embed).toHaveBeenCalledTimes(1);
    expect(embed).toHaveBeenCalledWith(['warmup']);
    void client.dispose();
  });

  it('drops one row with an unknown memory type and keeps the rest of the page', async () => {
    const children: FakeProcess[] = [];
    const logger = makeLogger();
    const client = new SearchWorkerClient(makeFactory(children), makeEmbedder(), logger);
    const response = client.searchMemory('needle', 5);
    const hit = (id: string, type: string) => ({
      memory: {
        id,
        sessionId: null,
        workspaceRoot: '/ws',
        tier: 'recall',
        kind: 'fact',
        subject: null,
        content: 'needle',
        sourceMessageIds: [],
        salience: 1,
        decayRate: 0,
        hits: 0,
        pinned: false,
        createdAt: 1,
        updatedAt: 1,
        lastUsedAt: 1,
        expiresAt: null,
        request: null,
        investigated: null,
        learned: null,
        completed: null,
        nextSteps: null,
        type,
        concepts: [],
        files: [],
      },
      chunk: { id: `${id}-c`, memoryId: id, ord: 0, text: 'needle', tokenCount: 1, createdAt: 1 },
      score: 1,
      bm25Rank: 1,
      vecRank: null,
    });
    children[0].reply({
      kind: 'result',
      id: 1,
      result: { hits: [hit('m1', 'decision'), hit('m2', 'mystery'), hit('m3', 'bugfix')], bm25Only: false },
    });
    const page = await response;
    expect(page.bm25Only).toBe(false);
    expect(page.hits.map((h) => String(h.memory.id))).toEqual(['m1', 'm3']);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('dropped result rows'),
      expect.objectContaining({ kind: 'memory', dropped: 1, kept: 2, path: 'memory.type' }),
    );
  });
});
