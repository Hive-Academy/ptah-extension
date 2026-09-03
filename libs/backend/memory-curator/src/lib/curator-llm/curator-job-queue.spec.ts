/**
 * `CuratorJobQueue` — one curation pass at a time (TASK_2026_376 F4).
 */
import { CuratorJobQueue } from './curator-job-queue';

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
} {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('CuratorJobQueue', () => {
  it('runs one job at a time, in submission order', async () => {
    const queue = new CuratorJobQueue();
    const order: string[] = [];
    const first = deferred();
    const second = deferred();

    const a = queue.run(async () => {
      order.push('a:start');
      await first.promise;
      order.push('a:end');
      return 'a';
    });
    const b = queue.run(async () => {
      order.push('b:start');
      await second.promise;
      order.push('b:end');
      return 'b';
    });

    await Promise.resolve();
    // The whole point: b has not started while a is still running.
    expect(order).toEqual(['a:start']);

    first.resolve();
    await a;
    await Promise.resolve();
    expect(order).toEqual(['a:start', 'a:end', 'b:start']);

    second.resolve();
    await expect(b).resolves.toBe('b');
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });

  it('a failed job never takes down the queue', async () => {
    const queue = new CuratorJobQueue();

    const failing = queue.run(() =>
      Promise.reject(new Error('curate blew up')),
    );
    const following = queue.run(() => Promise.resolve('still ran'));

    await expect(failing).rejects.toThrow('curate blew up');
    await expect(following).resolves.toBe('still ran');
  });

  it('reports the passes it is holding', async () => {
    const queue = new CuratorJobQueue();
    const gate = deferred();

    const a = queue.run(() => gate.promise);
    const b = queue.run(() => Promise.resolve());
    expect(queue.pending).toBe(2);

    gate.resolve();
    await Promise.all([a, b]);
    expect(queue.pending).toBe(0);
  });
});
