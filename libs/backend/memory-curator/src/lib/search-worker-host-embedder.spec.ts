import { HostBridgeEmbedder } from './search-worker-host-embedder';
import type { SearchWorkerOutbound } from './search-worker.protocol';

function makeBridge(canRerank: boolean): { bridge: HostBridgeEmbedder; posted: SearchWorkerOutbound[] } {
  const posted: SearchWorkerOutbound[] = [];
  const bridge = new HostBridgeEmbedder({
    dim: 3,
    modelId: 'test-model',
    canRerank,
    post: (message) => posted.push(message),
    callTimeoutMs: 50,
    coldCallTimeoutMs: 200,
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
    jest.advanceTimersByTime(200);
    await expect(pending).rejects.toThrow('host embed timed out after 200 ms');
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

  it('gives a cold embedder the longer first-call budget, then the warm one', async () => {
    jest.useFakeTimers();
    const { bridge } = makeBridge(false);
    // Model still loading: 50 ms passes, the call is still waiting.
    const first = bridge.embed(['needle']);
    jest.advanceTimersByTime(150);
    expect(bridge.pendingCalls).toBe(1);
    bridge.settle({ kind: 'embed-result', id: 1, vectors: [[1, 2, 3]] });
    expect(await first).toEqual([Float32Array.from([1, 2, 3])]);
    // Warm now: the 50 ms budget applies.
    const second = bridge.embed(['needle']);
    jest.advanceTimersByTime(50);
    await expect(second).rejects.toThrow('host embed timed out after 50 ms');
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
