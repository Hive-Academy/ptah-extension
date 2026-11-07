import 'reflect-metadata';
import type { IEmbedder } from '@ptah-extension/persistence-sqlite';
import { EmbedderWorkerClient } from './embedder/embedder-worker-client';
import { HostRerankBusyError, SearchWorkerHostCalls } from './search-worker-host-calls';
import type { CuratorLogger } from './sqlite-reader-deps.types';

type Ranked = ReadonlyArray<{ id: string; score: number }>;

function makeLogger(): jest.Mocked<CuratorLogger> {
  return { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

function makeEmbedder(embed: IEmbedder['embed']): IEmbedder {
  return { dim: 1, modelId: 'test', embed, dispose: async () => undefined };
}

/** A real `EmbedderWorkerClient` prototype with the model calls replaced. */
function makeWorkerClient(rerank: EmbedderWorkerClient['rerank'], warmup?: () => Promise<void>): EmbedderWorkerClient {
  const client: EmbedderWorkerClient = Object.create(EmbedderWorkerClient.prototype);
  client.rerank = rerank;
  client.embed = async (texts) => texts.map(() => new Float32Array([1]));
  client.warmup = warmup ?? (async () => undefined);
  return client;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: Error) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

const candidates = [{ id: '1', text: 'a' }, { id: '2', text: 'b' }];

describe('SearchWorkerHostCalls', () => {
  afterEach(() => jest.useRealTimers());

  it('deducts host-call transit and rejects expired calls without taking an embed slot', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(10_000);
    try {
      const embed = jest.fn(async () => [new Float32Array([1])]);
      const logger = makeLogger();
      const service = new SearchWorkerHostCalls(makeEmbedder(embed), logger);
      const expired = await service.answer({ kind: 'embed', id: 1, texts: ['old'], budgetMs: 100, sentAtMs: 9_800 });
      expect(expired).toEqual({ kind: 'host-call-failed', id: 1, message: 'host embed deadline expired' });
      expect(embed).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('expired in transit'), { transitMs: 100 });
      const active = await service.answer({ kind: 'embed', id: 2, texts: ['new'], budgetMs: 100, sentAtMs: 9_960 });
      expect(active.kind).toBe('embed-result');
      expect(embed).toHaveBeenCalledTimes(1);
      await service.answer({ kind: 'embed', id: 3, texts: ['future'], budgetMs: 100, sentAtMs: 10_050 });
      await service.answer({ kind: 'embed', id: 4, texts: ['legacy'], budgetMs: 100 });
      expect(embed).toHaveBeenCalledTimes(3);
    } finally {
      now.mockRestore();
    }
  });

  it('caps a delivered host embed at the budget left after transit', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(10_000);
    const pendingEmbed = deferred<Float32Array[]>();
    const embed = jest.fn(() => pendingEmbed.promise);
    const service = new SearchWorkerHostCalls(makeEmbedder(embed), makeLogger());
    const answer = service.answer({ kind: 'embed', id: 5, texts: ['slow'], budgetMs: 100, sentAtMs: 9_960 });
    jest.advanceTimersByTime(59);
    await flush();
    expect(embed).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    await expect(answer).resolves.toEqual({ kind: 'host-call-failed', id: 5, message: expect.stringContaining('60 ms') });
    pendingEmbed.resolve([new Float32Array([1])]);
    await flush();
  });

  it('coalesces and caches identical embeddings across database changes', async () => {
    const embed = jest.fn(async () => [new Float32Array([1])]);
    const service = new SearchWorkerHostCalls(makeEmbedder(embed), makeLogger());
    const [first, second] = await Promise.all([service.embed(['needle']), service.embed(['needle'])]);
    expect(first).toEqual(second);
    await service.embed(['needle']);
    expect(embed).toHaveBeenCalledTimes(1);
  });

  it('starts queued distinct calls in FIFO order when capacity opens', async () => {
    const releases: Array<(value: Float32Array[]) => void> = [];
    const embed = jest.fn(() => new Promise<Float32Array[]>((resolve) => { releases.push(resolve); }));
    const service = new SearchWorkerHostCalls(makeEmbedder(embed), makeLogger());
    const first = service.embed(['a']);
    const second = service.embed(['b']);
    const third = service.embed(['c']);
    await flush();
    expect(embed.mock.calls).toHaveLength(2);
    releases[0]([new Float32Array([1])]);
    await first;
    await flush();
    expect(embed).toHaveBeenLastCalledWith(['c']);
    releases[1]([new Float32Array([2])]);
    releases[2]([new Float32Array([3])]);
    await Promise.all([second, third]);
  });

  it('removes an expired queued embed without starting duplicate work', async () => {
    jest.useFakeTimers();
    const calls: Array<Deferred<Float32Array[]>> = [];
    const embed = jest.fn(() => {
      const call = deferred<Float32Array[]>();
      calls.push(call);
      return call.promise;
    });
    const service = new SearchWorkerHostCalls(makeEmbedder(embed), makeLogger());
    const first = service.embed(['a']);
    const second = service.embed(['b']);
    await flush();
    const queued = service.embed(['c'], performance.now() + 50);
    jest.advanceTimersByTime(50);
    await expect(queued).rejects.toThrow();
    calls[0].resolve([new Float32Array([1])]);
    await flush();
    expect(embed).toHaveBeenCalledTimes(2);
    calls[1].resolve([new Float32Array([2])]);
    await Promise.all([first, second]);
  });

  it('keeps a queued identical embed for the later caller after the first deadline', async () => {
    jest.useFakeTimers();
    const calls: Array<Deferred<Float32Array[]>> = [];
    const embed = jest.fn(() => {
      const call = deferred<Float32Array[]>();
      calls.push(call);
      return call.promise;
    });
    const service = new SearchWorkerHostCalls(makeEmbedder(embed), makeLogger());
    const first = service.embed(['a']);
    const second = service.embed(['b']);
    await flush();
    const short = service.embed(['c'], performance.now() + 50);
    const long = service.embed(['c'], performance.now() + 2_000);
    jest.advanceTimersByTime(50);
    await expect(short).rejects.toThrow();
    calls[0].resolve([new Float32Array([1])]);
    await flush();
    expect(embed).toHaveBeenCalledTimes(3);
    calls[2].resolve([new Float32Array([3])]);
    await expect(long).resolves.toEqual([new Float32Array([3])]);
    calls[1].resolve([new Float32Array([2])]);
    await Promise.all([first, second]);
  });

  it('holds an embed slot until the embedder settles, not until the caller stops waiting', async () => {
    jest.useFakeTimers();
    const calls: Array<Deferred<Float32Array[]>> = [];
    const embed = jest.fn(() => {
      const call = deferred<Float32Array[]>();
      calls.push(call);
      return call.promise;
    });
    const service = new SearchWorkerHostCalls(makeEmbedder(embed), makeLogger());
    const first = service.embed(['a']);
    const second = service.embed(['b']);
    await flush();
    jest.advanceTimersByTime(5_000);
    await expect(first).rejects.toThrow('host embed did not finish within 5000 ms');
    await expect(second).rejects.toThrow('did not finish');
    // Both embeds are still running in the embedder: a third distinct one waits.
    const third = service.embed(['c']);
    await flush();
    expect(embed).toHaveBeenCalledTimes(2);
    calls[0].resolve([new Float32Array([1])]);
    await flush();
    expect(embed).toHaveBeenCalledTimes(3);
    calls[2].resolve([new Float32Array([3])]);
    await expect(third).resolves.toEqual([new Float32Array([3])]);
    calls[1].resolve([new Float32Array([2])]);
  });

  it('caches an embedding that arrives after its caller stopped waiting', async () => {
    jest.useFakeTimers();
    const call = deferred<Float32Array[]>();
    const embed = jest.fn(() => call.promise);
    const service = new SearchWorkerHostCalls(makeEmbedder(embed), makeLogger());
    const late = service.embed(['needle']);
    await flush();
    jest.advanceTimersByTime(5_000);
    await expect(late).rejects.toThrow('did not finish');
    call.resolve([new Float32Array([0.5])]);
    await flush();
    await expect(service.embed(['needle'])).resolves.toEqual([new Float32Array([0.5])]);
    expect(embed).toHaveBeenCalledTimes(1);
  });

  it('retries a failed embed at once (no cool-down) and never caches a wrong-size vector', async () => {
    const embed = jest
      .fn<Promise<Float32Array[]>, [readonly string[]]>()
      .mockRejectedValueOnce(new Error('model busy'))
      .mockResolvedValueOnce([new Float32Array([1, 2])])
      .mockResolvedValue([new Float32Array([1])]);
    const service = new SearchWorkerHostCalls(makeEmbedder(embed), makeLogger());
    await expect(service.embed(['q'])).rejects.toThrow('model busy');
    await flush();
    await expect(service.embed(['q'])).resolves.toEqual([new Float32Array([1, 2])]);
    await flush();
    await expect(service.embed(['q'])).resolves.toEqual([new Float32Array([1])]);
    expect(embed).toHaveBeenCalledTimes(3);
  });

  it('runs one rerank at a time, sheds distinct ones as busy, joins and caches identical ones', async () => {
    const call = deferred<Ranked>();
    const rerank = jest.fn(() => call.promise);
    const service = new SearchWorkerHostCalls(makeWorkerClient(rerank), makeLogger());
    const first = service.rerank('q', candidates, 2);
    const joined = service.rerank('q', candidates, 2);
    await expect(service.rerank('other', candidates, 2)).rejects.toThrow(HostRerankBusyError);
    call.resolve([{ id: '2', score: 0.9 }]);
    await expect(first).resolves.toEqual([{ id: '2', score: 0.9 }]);
    await expect(joined).resolves.toEqual([{ id: '2', score: 0.9 }]);
    await flush();
    // Cached by query, topK and candidates; the slot is free again.
    await expect(service.rerank('q', candidates, 2)).resolves.toEqual([{ id: '2', score: 0.9 }]);
    expect(rerank).toHaveBeenCalledTimes(1);
    const changed = deferred<Ranked>();
    rerank.mockImplementationOnce(() => changed.promise);
    const fresh = service.rerank('q', [{ id: '1', text: 'changed' }], 2);
    changed.resolve([{ id: '1', score: 0.5 }]);
    await expect(fresh).resolves.toEqual([{ id: '1', score: 0.5 }]);
    expect(rerank).toHaveBeenCalledTimes(2);
  });

  it('keeps the rerank slot until the reranker settles, past the caller timeout', async () => {
    jest.useFakeTimers();
    const call = deferred<Ranked>();
    const service = new SearchWorkerHostCalls(makeWorkerClient(() => call.promise), makeLogger());
    const first = service.rerank('q', candidates, 2);
    jest.advanceTimersByTime(5_000);
    await expect(first).rejects.toThrow('host rerank did not finish');
    await expect(service.rerank('other', candidates, 2)).rejects.toThrow(HostRerankBusyError);
    call.resolve([]);
    await flush();
    await expect(service.rerank('other', candidates, 2)).resolves.toEqual([]);
  });

  it('answers a shed rerank as busy at debug, and a real failure at warn', async () => {
    const call = deferred<Ranked>();
    const logger = makeLogger();
    const rerank = jest.fn(() => call.promise);
    const service = new SearchWorkerHostCalls(makeWorkerClient(rerank), logger);
    const running = service.answer({ kind: 'rerank', id: 1, query: 'q', candidates, topK: 2 });
    const shed = await service.answer({ kind: 'rerank', id: 2, query: 'other', candidates, topK: 2 });
    expect(shed).toEqual({ kind: 'host-call-failed', id: 2, message: 'host reranker busy', busy: true });
    expect(logger.warn).not.toHaveBeenCalled();
    call.reject(new Error('onnx failed'));
    expect(await running).toEqual({ kind: 'host-call-failed', id: 1, message: 'onnx failed' });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('host rerank failed'), { error: 'onnx failed' });
  });

  it('answers a rerank as unavailable without a worker reranker', async () => {
    const service = new SearchWorkerHostCalls(makeEmbedder(async () => []), makeLogger());
    expect(await service.answer({ kind: 'rerank', id: 7, query: 'q', candidates, topK: 1 })).toEqual({
      kind: 'host-call-failed',
      id: 7,
      message: 'reranker unavailable',
    });
  });

  it('warms both models while holding the rerank slot', async () => {
    const warm = deferred<void>();
    const service = new SearchWorkerHostCalls(makeWorkerClient(async () => [], () => warm.promise), makeLogger());
    const warming = service.warmup();
    await expect(service.rerank('q', candidates, 2)).rejects.toThrow(HostRerankBusyError);
    warm.resolve();
    await warming;
    await flush();
    await expect(service.rerank('q', candidates, 2)).resolves.toEqual([]);
  });

  it('warns once when the embedder has not answered for 30 s, and again only after it recovers', async () => {
    jest.useFakeTimers();
    const logger = makeLogger();
    const calls: Array<Deferred<Float32Array[]>> = [];
    const service = new SearchWorkerHostCalls(makeEmbedder(() => {
      const call = deferred<Float32Array[]>();
      calls.push(call);
      return call.promise;
    }), logger);
    const first = service.embed(['a']);
    const second = service.embed(['b']);
    await flush();
    jest.advanceTimersByTime(30_000);
    await expect(first).rejects.toThrow('did not finish');
    await expect(second).rejects.toThrow('did not finish');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('has not answered'), { outstandingMs: 30_000 });
    calls[0].resolve([new Float32Array([1])]);
    calls[1].resolve([new Float32Array([1])]);
    await flush();
    void service.embed(['c']).catch(() => undefined);
    await flush();
    jest.advanceTimersByTime(30_000);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('keeps the hung episode open while another overdue call is still outstanding', async () => {
    jest.useFakeTimers();
    const logger = makeLogger();
    const calls: Array<Deferred<Float32Array[]>> = [];
    const service = new SearchWorkerHostCalls(makeEmbedder(() => {
      const call = deferred<Float32Array[]>();
      calls.push(call);
      return call.promise;
    }), logger);
    const first = service.embed(['a']);
    const second = service.embed(['b']);
    await flush();
    jest.advanceTimersByTime(30_000);
    await expect(first).rejects.toThrow('did not finish');
    await expect(second).rejects.toThrow('did not finish');
    expect(logger.warn).toHaveBeenCalledTimes(1);

    calls[0].resolve([new Float32Array([1])]);
    await flush();
    const third = service.embed(['c']);
    await flush();
    jest.advanceTimersByTime(30_000);
    await expect(third).rejects.toThrow('did not finish');
    expect(logger.warn).toHaveBeenCalledTimes(1);

    calls[1].resolve([new Float32Array([1])]);
    calls[2].resolve([new Float32Array([1])]);
    await flush();
    const fourth = service.embed(['d']);
    await flush();
    jest.advanceTimersByTime(30_000);
    await expect(fourth).rejects.toThrow('did not finish');
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });
});

