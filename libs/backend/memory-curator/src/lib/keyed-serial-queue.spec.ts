import { KeyedSerialQueue } from './keyed-serial-queue';

describe('KeyedSerialQueue', () => {
  const tick = (): Promise<void> =>
    new Promise<void>((resolve) => setImmediate(resolve));

  it('runs tasks of one key in call order, one at a time', async () => {
    const queue = new KeyedSerialQueue();
    const log: string[] = [];
    const task = (name: string) => async (): Promise<string> => {
      log.push(`${name}:start`);
      await tick();
      log.push(`${name}:end`);
      return name;
    };

    const results = await Promise.all([
      queue.run('a', task('first')),
      queue.run('a', task('second')),
    ]);

    expect(results).toEqual(['first', 'second']);
    expect(log).toEqual([
      'first:start',
      'first:end',
      'second:start',
      'second:end',
    ]);
  });

  it('runs different keys independently', async () => {
    const queue = new KeyedSerialQueue();
    const log: string[] = [];
    const task = (name: string) => async (): Promise<void> => {
      log.push(`${name}:start`);
      await tick();
      log.push(`${name}:end`);
    };

    await Promise.all([queue.run('a', task('a')), queue.run('b', task('b'))]);

    expect(log.slice(0, 2)).toEqual(['a:start', 'b:start']);
  });

  it('delivers a failure to its caller and still runs the next task', async () => {
    const queue = new KeyedSerialQueue();
    const failing = queue.run('a', () => Promise.reject(new Error('boom')));
    const next = queue.run('a', () => Promise.resolve('ran'));

    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ran');
  });

  it('forgets a key once its last task settled', async () => {
    const queue = new KeyedSerialQueue();
    await queue.run('a', () => Promise.resolve());
    await tick();
    expect(queue.size).toBe(0);
  });
});
