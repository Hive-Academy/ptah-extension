import { createFakeAsyncGenerator } from './fake-async-generator';

describe('createFakeAsyncGenerator', () => {
  it('yields all items in order and terminates', async () => {
    const gen = createFakeAsyncGenerator([1, 2, 3]);
    const out: number[] = [];
    for await (const v of gen) {
      out.push(v);
    }
    expect(out).toEqual([1, 2, 3]);
  });

  it('throws AbortError immediately when signal is pre-aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const gen = createFakeAsyncGenerator(['a', 'b'], { signal: ctrl.signal });

    await expect(gen.next()).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('throws AbortError mid-iteration when signal aborts', async () => {
    const ctrl = new AbortController();
    const gen = createFakeAsyncGenerator([10, 20, 30], {
      signal: ctrl.signal,
    });

    const first = await gen.next();
    expect(first).toEqual({ done: false, value: 10 });

    ctrl.abort();
    await expect(gen.next()).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('respects delayMs via real timers and still aborts cooperatively', async () => {
    const ctrl = new AbortController();
    const gen = createFakeAsyncGenerator([1, 2], {
      signal: ctrl.signal,
      delayMs: 20,
    });

    const firstPromise = gen.next();
    ctrl.abort();
    await expect(firstPromise).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('return() short-circuits the iterator', async () => {
    const gen = createFakeAsyncGenerator(['x', 'y', 'z']);
    const first = await gen.next();
    expect(first.value).toBe('x');
    const ret = await gen.return('early');
    expect(ret.done).toBe(true);
    const after = await gen.next();
    expect(after.done).toBe(true);
  });
});
