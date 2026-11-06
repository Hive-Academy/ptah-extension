import { HostBridgeEmbedder, HostCallSkippedError } from './search-worker-host-embedder';
import type { SearchWorkerOutbound } from './search-worker.protocol';

function makeBridge(canRerank: boolean): { bridge: HostBridgeEmbedder; posted: SearchWorkerOutbound[] } {
  const posted: SearchWorkerOutbound[] = [];
  const bridge = new HostBridgeEmbedder({
    dim: 3,
    modelId: 'test-model',
    canRerank,
    post: (message) => posted.push(message),
    callTimeoutMs: 50,
  });
  return { bridge, posted };
}

describe('HostBridgeEmbedder', () => {
  afterEach(() => jest.useRealTimers());

  it('asks the host to embed and settles with typed vectors', async () => {
    const { bridge, posted } = makeBridge(false);
    const pending = bridge.embed(['needle']);
    expect(posted).toEqual([{ kind: 'embed', id: 1, texts: ['needle'] }]);
    bridge.settle({ kind: 'embed-result', id: 1, vectors: [[1, 2, 3]] });
    expect(await pending).toEqual([Float32Array.from([1, 2, 3])]);
    expect(bridge.pendingCalls).toBe(0);
  });

  it('rejects when the host never answers, leaving nothing behind', async () => {
    jest.useFakeTimers();
    const { bridge } = makeBridge(false);
    const pending = bridge.embed(['needle']);
    jest.advanceTimersByTime(50);
    await expect(pending).rejects.toThrow('host embed timed out after 50 ms');
    expect(bridge.pendingCalls).toBe(0);
    // A late reply for the expired call is ignored.
    bridge.settle({ kind: 'embed-result', id: 1, vectors: [[1, 2, 3]] });
    expect(bridge.pendingCalls).toBe(0);
  });

  it('rejects when the host embed fails, so the search reports bm25Only', async () => {
    const { bridge } = makeBridge(false);
    const pending = bridge.embed(['needle']);
    bridge.settle({ kind: 'host-call-failed', id: 1, message: 'model unavailable' });
    await expect(pending).rejects.toThrow('model unavailable');
  });

  it('lets a warm embed wait past the old 2 s bound, up to the request-budget backstop', async () => {
    jest.useFakeTimers();
    const bridge = new HostBridgeEmbedder({ dim: 3, modelId: 'm', canRerank: false, post: () => undefined });
    const first = bridge.embed(['a']);
    bridge.settle({ kind: 'embed-result', id: 1, vectors: [[1, 2, 3]] });
    await first;
    // Warm: queued behind another query's embed and rerank for 4.9 s.
    const second = bridge.embed(['b']);
    jest.advanceTimersByTime(4_900);
    expect(bridge.pendingCalls).toBe(1);
    bridge.settle({ kind: 'embed-result', id: 2, vectors: [[3, 2, 1]] });
    expect(await second).toEqual([Float32Array.from([3, 2, 1])]);
    const third = bridge.embed(['c']);
    jest.advanceTimersByTime(5_000);
    await expect(third).rejects.toThrow('host embed timed out after 5000 ms');
  });

  it('rejects a shed rerank with HostCallSkippedError, a failed one with a plain Error', async () => {
    const { bridge } = makeBridge(true);
    const shed = bridge.rerank('q', [{ id: '1', text: 'a' }], 1);
    bridge.settle({ kind: 'host-call-failed', id: 1, message: 'host reranker busy', busy: true });
    await expect(shed).rejects.toBeInstanceOf(HostCallSkippedError);
    const failed = bridge.rerank('q', [{ id: '1', text: 'a' }], 1);
    bridge.settle({ kind: 'host-call-failed', id: 2, message: 'onnx failed' });
    await expect(failed).rejects.toThrow('onnx failed');
    await expect(failed).rejects.not.toBeInstanceOf(HostCallSkippedError);
  });

  it('rejects rerank without a host reranker, so search keeps the RRF order', async () => {
    const { bridge, posted } = makeBridge(false);
    await expect(bridge.rerank('q', [{ id: '1', text: 'a' }], 3)).rejects.toThrow('host reranker unavailable');
    expect(posted).toEqual([]);
  });

  it('forwards rerank calls and rejects on timeout', async () => {
    jest.useFakeTimers();
    const { bridge, posted } = makeBridge(true);
    const ok = bridge.rerank('q', [{ id: '1', text: 'a' }], 3);
    bridge.settle({ kind: 'rerank-result', id: 1, ranked: [{ id: '1', score: 0.9 }] });
    expect(await ok).toEqual([{ id: '1', score: 0.9 }]);
    const late = bridge.rerank('q', [{ id: '1', text: 'a' }], 3);
    jest.advanceTimersByTime(50);
    await expect(late).rejects.toThrow('timed out');
    expect(posted).toHaveLength(2);
  });

  it('dispose settles every pending call', async () => {
    const { bridge } = makeBridge(true);
    const embed = bridge.embed(['a']);
    const rerank = bridge.rerank('q', [{ id: '1', text: 'a' }], 1);
    await bridge.dispose();
    await expect(embed).rejects.toThrow('shutting down');
    await expect(rerank).rejects.toThrow('shutting down');
  });
});
