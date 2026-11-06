import 'reflect-metadata';
import { SearchWorkerHostCalls } from './search-worker-host-calls';

describe('SearchWorkerHostCalls', () => {
  afterEach(() => jest.useRealTimers());

  it('coalesces and caches identical embeddings across database changes', async () => {
    const embed = jest.fn(async () => [new Float32Array([1, 2, 3])]);
    const service = new SearchWorkerHostCalls({ dim: 3, modelId: 'test', embed, dispose: async () => undefined });
    const [first, second] = await Promise.all([service.embed(['needle']), service.embed(['needle'])]);
    expect(first).toEqual(second);
    await service.embed(['needle']);
    expect(embed).toHaveBeenCalledTimes(1);
  });

  it('starts queued distinct calls in FIFO order when capacity opens', async () => {
    const releases: Array<(value: Float32Array[]) => void> = [];
    const embed = jest.fn(() => new Promise<Float32Array[]>((resolve) => { releases.push(resolve); }));
    const service = new SearchWorkerHostCalls({ dim: 3, modelId: 'test', embed, dispose: async () => undefined });
    const first = service.embed(['a']);
    const second = service.embed(['b']);
    const third = service.embed(['c']);
    await Promise.resolve();
    expect(embed.mock.calls).toHaveLength(2);
    releases[0]([new Float32Array([1])]);
    await first;
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(embed).toHaveBeenLastCalledWith(['c']);
    releases[1]([new Float32Array([2])]);
    releases[2]([new Float32Array([3])]);
    await Promise.all([second, third]);
  });

  it('queues a third distinct query and cools down only timed-out work', async () => {
    jest.useFakeTimers();
    const embed = jest.fn(() => new Promise<Float32Array[]>(() => undefined));
    const service = new SearchWorkerHostCalls({ dim: 3, modelId: 'test', embed, dispose: async () => undefined });
    const first = service.embed(['a']);
    const second = service.embed(['b']);
    const third = service.embed(['c']);
    await Promise.resolve();
    expect(embed).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(3_500);
    await expect(third).rejects.toThrow('queue wait timed out');
    jest.advanceTimersByTime(4_000);
    await expect(first).rejects.toThrow('timed out');
    await expect(second).rejects.toThrow('timed out');
    await expect(service.embed(['a'])).rejects.toThrow('cooling down');
    const afterQueueTimeout = service.embed(['c']);
    await Promise.resolve();
    expect(embed).toHaveBeenCalledTimes(3);
    jest.advanceTimersByTime(4_000);
    await expect(afterQueueTimeout).rejects.toThrow('timed out');
  });
});
