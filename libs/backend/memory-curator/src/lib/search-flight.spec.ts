import { SearchFlight } from './search-flight';

describe('SearchFlight', () => {
  it('coalesces identical work and serializes distinct work without caching completed results', async () => {
    const flight = new SearchFlight<number>();
    let releaseFirst: (value: number) => void = () => undefined;
    let signalFirstStarted: () => void = () => undefined;
    const firstStarted = new Promise<void>((resolve) => { signalFirstStarted = resolve; });
    let calls = 0;
    const firstWork = jest.fn(() => {
      calls += 1;
      return calls === 1
        ? new Promise<number>((resolve) => { releaseFirst = resolve; signalFirstStarted(); })
        : Promise.resolve(1);
    });
    const secondWork = jest.fn(async () => 2);
    const first = flight.run('a', firstWork);
    const duplicate = flight.run('a', firstWork);
    const second = flight.run('b', secondWork);
    await firstStarted;
    expect(firstWork).toHaveBeenCalledTimes(1);
    expect(secondWork).not.toHaveBeenCalled();
    releaseFirst(1);
    expect(await first).toBe(1);
    expect(await duplicate).toBe(1);
    expect(await second).toBe(2);
    expect(await flight.run('a', firstWork)).toBe(1);
    expect(firstWork).toHaveBeenCalledTimes(2);
  });

  it('starts unserialized work at once behind a hung search, still sharing identical work', async () => {
    const flight = new SearchFlight<number>();
    void flight.run('hung', () => new Promise<number>(() => undefined));
    const work = jest.fn(async () => 4);
    const direct = flight.run('direct', work, { serialize: false });
    const joined = flight.run('direct', work, { serialize: false });
    expect(work).toHaveBeenCalledTimes(1);
    await expect(direct).resolves.toBe(4);
    await expect(joined).resolves.toBe(4);
    await Promise.resolve();
    await expect(flight.run('direct', work, { serialize: false })).resolves.toBe(4);
    expect(work).toHaveBeenCalledTimes(2);
  });

  it('runs later searches after a search throws', async () => {
    const flight = new SearchFlight<number>();
    const first = flight.run('a', async () => { throw new Error('search failed'); });
    const second = flight.run('b', async () => 2);
    await expect(first).rejects.toThrow('search failed');
    await expect(second).resolves.toBe(2);
  });

  it('releases the queue after a worker never settles', async () => {
    jest.useFakeTimers();
    try {
      const flight = new SearchFlight<number>();
      const hung = flight.run('hung', () => new Promise<number>(() => undefined));
      const later = flight.run('later', async () => 2);
      await jest.advanceTimersByTimeAsync(5_000);
      await expect(later).resolves.toBe(2);
      await expect(flight.run('hung', () => Promise.resolve(3))).resolves.toBe(3);
    } finally {
      jest.useRealTimers();
    }
  });
});
