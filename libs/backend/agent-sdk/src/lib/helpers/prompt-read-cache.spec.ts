import { PromptReadCache } from './prompt-read-cache';

describe('PromptReadCache', () => {
  it('shares concurrent reads and reuses the short-lived result', async () => {
    let resolveRead: ((value: string) => void) | undefined;
    const read = jest.fn(() => new Promise<string>((resolve) => { resolveRead = resolve; }));
    const cache = new PromptReadCache(2_000);
    const first = cache.run('/workspace', read);
    const second = cache.run('/workspace', read);
    expect(first).toBe(second);
    await Promise.resolve();
    expect(read).toHaveBeenCalledTimes(1);
    resolveRead?.('snapshot');
    expect(await first).toBe('snapshot');
    expect(await cache.run('/workspace', read)).toBe('snapshot');
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('invalidates a cached result', async () => {
    const read = jest.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second');
    const cache = new PromptReadCache();
    expect(await cache.run('key', read)).toBe('first');
    cache.invalidate();
    expect(await cache.run('key', read)).toBe('second');
  });
});
