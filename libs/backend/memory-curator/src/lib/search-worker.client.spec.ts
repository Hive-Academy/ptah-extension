import 'reflect-metadata';
import type { IEmbedder } from '@ptah-extension/persistence-sqlite';
import { SearchWorkerClient } from './search-worker.client';
import type { ISearchWorkerFactory, ISearchWorkerProcess } from './search-worker.port';
import type { CuratorLogger } from './sqlite-reader-deps.types';

class FakeProcess implements ISearchWorkerProcess {
  readonly sent: unknown[] = [];
  killed = false;
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
  for (let i = 0; i < 5; i++) await Promise.resolve();
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

  it('degrades a hung worker, kills it, and respawns only after the backoff', async () => {
    jest.useFakeTimers();
    const children: FakeProcess[] = [];
    const client = new SearchWorkerClient(makeFactory(children), makeEmbedder(), makeLogger(), { timeoutMs: 100 });
    const pending = client.searchSymbols('Foo', 5);
    jest.advanceTimersByTime(100);
    expect(await pending).toEqual({ hits: [], bm25Only: true });
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
    client.dispose();
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
    client.dispose();
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
    client.dispose();
  });

  it('dispose kills the worker, degrades pending calls and never respawns', async () => {
    const children: FakeProcess[] = [];
    const client = new SearchWorkerClient(makeFactory(children), makeEmbedder(), makeLogger());
    const pending = client.getChunks('a');
    client.dispose();
    expect(children[0].killed).toBe(true);
    expect(await pending).toEqual([]);
    expect(await client.getChunks('b')).toEqual([]);
    expect(children).toHaveLength(1);
  });
});
