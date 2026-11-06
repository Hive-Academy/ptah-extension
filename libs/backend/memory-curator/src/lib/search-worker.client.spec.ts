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
  /** Report `ready` as soon as `init` arrives, like a worker that boots at once. */
  constructor(private readonly autoReady: boolean) {}
  postMessage(message: unknown): void {
    this.sent.push(message);
    const isInit = typeof message === 'object' && message !== null && Reflect.get(message, 'kind') === 'init';
    if (isInit && this.autoReady) this.messageHandler({ kind: 'ready', vecLoaded: true });
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

function makeFactory(children: FakeProcess[], autoReady = true): ISearchWorkerFactory {
  return {
    spawn: () => {
      const child = new FakeProcess(autoReady);
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
    expect(child.queries).toEqual([
      { kind: 'symbols', id: 1, query: 'foo', topK: 3, workspaceRoot: '/work', budgetMs: expect.any(Number), sentAtMs: expect.any(Number) },
    ]);
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
    const response = client.searchMemory('needle', 5);
    expect(children[0].queries[0]).toEqual(expect.objectContaining({ budgetMs: expect.any(Number) }));
    const query = children[0].queries[0] as { budgetMs: number };
    expect(query.budgetMs).toBeLessThan(5_000);
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
    // The liveness timer defers its final check to the next event-loop turn.
    jest.advanceTimersByTime(1);
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
    jest.advanceTimersByTime(1);
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
      queueTimeoutMs: 100,
      maxInFlight: 1,
      livenessMs: 10_000,
    });
    const running = client.getChunks('a');
    const queued = client.getChunks('b');
    jest.advanceTimersByTime(100);
    expect(await running).toEqual([]);
    expect(await queued).toEqual([]);
    // The worker still owes id 1, so nothing else was dispatched.
    expect(children[0].queries).toEqual([{ kind: 'chunks', id: 1, memoryId: 'a', budgetMs: expect.any(Number), sentAtMs: expect.any(Number) }]);
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

  it('start() forks the worker before any request and leaves the embedder warm-up to the first request', async () => {
    const children: FakeProcess[] = [];
    const embed = jest.fn<Promise<Float32Array[]>, [readonly string[]]>(async () => []);
    const logger = makeLogger();
    const client = new SearchWorkerClient(makeFactory(children), makeEmbedder(embed), logger);
    client.start();
    expect(children).toHaveLength(1);
    expect(children[0].sent[0]).toEqual(expect.objectContaining({ kind: 'init' }));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('forked'), { reason: 'boot' });
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('ready'),
      expect.objectContaining({ sinceForkMs: expect.any(Number) }),
    );
    expect(embed).not.toHaveBeenCalled();
    client.start();
    expect(children).toHaveLength(1);
    const response = client.getChunks('m1');
    expect(embed).toHaveBeenCalledWith(['warmup']);
    expect(children[0].queries).toHaveLength(1);
    children[0].reply({ kind: 'result', id: 1, result: [] });
    expect(await response).toEqual([]);
    void client.getChunks('m2');
    expect(embed).toHaveBeenCalledTimes(1);
    void client.dispose();
  });

  it('sends a deadline with every request kind', async () => {
    const children: FakeProcess[] = [];
    const client = new SearchWorkerClient(makeFactory(children), makeEmbedder(), makeLogger());
    void client.listMemories('/ws', 4);
    void client.getChunks('m1');
    void client.searchSymbolPage({ workspaceRoot: '/work', query: 'Foo', limit: 20, offset: 0 });
    for (const query of children[0].queries) {
      expect(query).toEqual(expect.objectContaining({ budgetMs: expect.any(Number), sentAtMs: expect.any(Number) }));
    }
    expect(children[0].queries).toHaveLength(3);
    void client.dispose();
  });

  it('dispatches nothing before ready, and starts the timeout and deadline at ready', async () => {
    jest.useFakeTimers();
    const children: FakeProcess[] = [];
    const logger = makeLogger();
    const client = new SearchWorkerClient(makeFactory(children, false), makeEmbedder(), logger);
    const response = client.searchMemory('needle', 5, '/work');
    // A slow cold boot: 4 s pass before the worker is ready.
    jest.advanceTimersByTime(4_000);
    expect(children[0].queries).toEqual([]);
    children[0].reply({ kind: 'ready', vecLoaded: true });
    expect(children[0].queries).toEqual([expect.objectContaining({ id: 1, budgetMs: 4_500 })]);
    // 4.9 s after ready (8.9 s after the request) the answer still counts.
    jest.advanceTimersByTime(4_900);
    const hit = { hits: [], bm25Only: true };
    children[0].reply({ kind: 'result', id: 1, result: hit });
    expect(await response).toEqual(hit);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('expires a symbol page during boot and never dispatches it after ready', async () => {
    jest.useFakeTimers();
    const children: FakeProcess[] = [];
    const client = new SearchWorkerClient(makeFactory(children, false), makeEmbedder(), makeLogger());
    const deadlineMs = performance.now() + 100;
    const response = client.searchSymbolPage({ query: 'Foo', limit: 20, offset: 0 }, deadlineMs);
    jest.advanceTimersByTime(100);
    expect(await response).toEqual({ items: [], total: 0 });
    children[0].reply({ kind: 'ready', vecLoaded: true });
    expect(children[0].queries).toEqual([]);
    void client.dispose();
  });

  it('caps a running memory request and its worker deadline to the caller', async () => {
    jest.useFakeTimers();
    const children: FakeProcess[] = [];
    const client = new SearchWorkerClient(makeFactory(children), makeEmbedder(), makeLogger());
    const deadlineMs = performance.now() + 100;
    const response = client.searchMemory('needle', 5, '/work', deadlineMs);
    const sent = children[0].queries[0] as { budgetMs: number };
    expect(sent.budgetMs).toBeLessThanOrEqual(100);
    jest.advanceTimersByTime(100);
    expect(await response).toEqual({ hits: [], bm25Only: true });
    void client.dispose();
  });

  it('lets a request wait 15 s host-side for a slow boot before it degrades', async () => {
    jest.useFakeTimers();
    const children: FakeProcess[] = [];
    const logger = makeLogger();
    const client = new SearchWorkerClient(makeFactory(children, false), makeEmbedder(), logger);
    const response = client.getChunks('m1');
    let settled = false;
    void response.then(() => { settled = true; });
    jest.advanceTimersByTime(14_999);
    await flush();
    expect(settled).toBe(false);
    jest.advanceTimersByTime(1);
    expect(await response).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('timed out'),
      expect.objectContaining({ phase: 'queued', timeoutMs: 15_000 }),
    );
    void client.dispose();
  });

  it('restarts a worker that never reports ready', () => {
    jest.useFakeTimers();
    const children: FakeProcess[] = [];
    const logger = makeLogger();
    const client = new SearchWorkerClient(makeFactory(children, false), makeEmbedder(), logger);
    void client.getChunks('m1');
    jest.advanceTimersByTime(30_000);
    expect(children[0].killed).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('not ready'), expect.anything());
    jest.advanceTimersByTime(250);
    void client.getChunks('m1');
    expect(children).toHaveLength(2);
    void client.dispose();
  });

  it('backs off exponentially across an init-failed loop; ready and log messages do not reset it', () => {
    jest.useFakeTimers();
    const children: FakeProcess[] = [];
    const client = new SearchWorkerClient(makeFactory(children), makeEmbedder(), makeLogger());
    for (const backoffMs of [250, 500, 1_000, 2_000]) {
      void client.getChunks('m1');
      const child = children[children.length - 1];
      child.reply({ kind: 'log', level: 'info', message: 'opening' });
      child.reply({ kind: 'init-failed', message: 'SQLITE_CANTOPEN' });
      const spawned = children.length;
      jest.advanceTimersByTime(backoffMs - 1);
      void client.getChunks('m1');
      expect(children).toHaveLength(spawned);
      jest.advanceTimersByTime(1);
    }
    void client.dispose();
  });

  it('resets the backoff only after a valid result', async () => {
    jest.useFakeTimers();
    const children: FakeProcess[] = [];
    const client = new SearchWorkerClient(makeFactory(children), makeEmbedder(), makeLogger());
    void client.getChunks('a');
    children[0].crash();
    jest.advanceTimersByTime(250);
    void client.getChunks('b');
    children[1].crash();
    // Second failure: 500 ms.
    jest.advanceTimersByTime(499);
    void client.getChunks('c');
    expect(children).toHaveLength(2);
    jest.advanceTimersByTime(1);
    const ok = client.getChunks('d');
    children[2].reply({ kind: 'result', id: 3, result: [] });
    expect(await ok).toEqual([]);
    void client.getChunks('e');
    children[2].crash();
    // Reset by the result: back to 250 ms.
    jest.advanceTimersByTime(250);
    void client.getChunks('f');
    expect(children).toHaveLength(4);
    void client.dispose();
  });

  it('restarts a worker that hangs again, with a growing backoff (no unreachable cap)', async () => {
    jest.useFakeTimers();
    const children: FakeProcess[] = [];
    const client = new SearchWorkerClient(makeFactory(children), makeEmbedder(), makeLogger(), {
      timeoutMs: 100,
      livenessMs: 300,
    });
    for (const [index, backoffMs] of [250, 500, 1_000].entries()) {
      void client.getChunks('m1');
      jest.advanceTimersByTime(300);
      jest.advanceTimersByTime(1);
      expect(children[index].killed).toBe(true);
      jest.advanceTimersByTime(backoffMs - 1);
      void client.getChunks('m1');
      expect(children).toHaveLength(index + 1);
      jest.advanceTimersByTime(1);
    }
    void client.dispose();
  });

  it('re-checks liveness after queued messages before restarting a worker', () => {
    jest.useFakeTimers();
    const children: FakeProcess[] = [];
    const client = new SearchWorkerClient(makeFactory(children), makeEmbedder(), makeLogger(), {
      timeoutMs: 10_000,
      livenessMs: 300,
    });
    void client.getChunks('m1');
    // The watchdog timer fires...
    jest.advanceTimersToNextTimer();
    // ...but a worker message that was queued behind it is handled first.
    children[0].reply({ kind: 'log', level: 'debug', message: 'still scanning' });
    jest.advanceTimersToNextTimer();
    expect(children[0].killed).toBe(false);
    // Silent for a whole window after that message: now it is restarted.
    jest.advanceTimersByTime(300);
    expect(children[0].killed).toBe(true);
    void client.dispose();
  });

  it('does not let an invalid host-call message degrade the query with the same id', async () => {
    const children: FakeProcess[] = [];
    const client = new SearchWorkerClient(makeFactory(children), makeEmbedder(), makeLogger());
    const response = client.getChunks('m1');
    children[0].reply({ kind: 'embed', id: 1, texts: 'not-an-array' });
    children[0].reply({ kind: 'result', id: 1, result: [] });
    expect(await response).toEqual([]);
    expect(children[0].killed).toBe(false);
    const second = client.listMemories('/ws', 4);
    children[0].reply({ kind: 'result', id: 2, result: { memories: [], total: 9 } });
    expect((await second).total).toBe(9);
  });

  it('logs a late error for a request that already timed out at debug, once', async () => {
    jest.useFakeTimers();
    const children: FakeProcess[] = [];
    const logger = makeLogger();
    const client = new SearchWorkerClient(makeFactory(children), makeEmbedder(), logger, { timeoutMs: 100 });
    const response = client.getChunks('m1');
    jest.advanceTimersByTime(100);
    expect(await response).toEqual([]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    children[0].reply({ kind: 'error', id: 1, message: 'request deadline passed before it started' });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('late error'), expect.anything());
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

