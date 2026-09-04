/**
 * `CuratorJobQueue` — one curation pass at a time (TASK_2026_376 F4).
 */
import {
  CURATOR_QUEUE_WAIT_CEILING_MS,
  CuratorJobQueue,
  CuratorQueueWaitTimeoutError,
} from './curator-job-queue';

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

  it('rejects a waiter that never gets its turn within the ceiling', async () => {
    // TASK_2026_376 R1, logic finding 3. `memory:runNow` calls `curate()` with
    // no signal, so an unbounded wait is a spinner the code cannot end.
    jest.useFakeTimers();
    try {
      const queue = new CuratorJobQueue(1000);
      const blocker = deferred();
      const ran: string[] = [];

      const first = queue.run(async () => {
        ran.push('first');
        await blocker.promise;
        return 'first';
      });
      const second = queue.run(async () => {
        ran.push('second');
        return 'second';
      });
      const rejection = second.catch((error: unknown) => error);

      await Promise.resolve();
      jest.advanceTimersByTime(1001);
      const error = await rejection;
      expect(error).toBeInstanceOf(CuratorQueueWaitTimeoutError);

      // The chain is NOT broken and the running pass is untouched.
      blocker.resolve();
      await expect(first).resolves.toBe('first');
      // The abandoned job is never invoked, even once its turn comes.
      await Promise.resolve();
      await Promise.resolve();
      expect(ran).toEqual(['first']);
    } finally {
      jest.useRealTimers();
    }
  });

  it('lets a later pass run normally after an abandoned one', async () => {
    // The ceiling is per waiter, so a pass submitted after the congestion
    // cleared gets its own full allowance and must not inherit the loser's.
    jest.useFakeTimers();
    try {
      const queue = new CuratorJobQueue(1000);
      const blocker = deferred();

      const first = queue.run(() => blocker.promise);
      const abandoned = queue.run(() => Promise.resolve('never'));
      const rejection = abandoned.catch(() => 'rejected');

      await Promise.resolve();
      jest.advanceTimersByTime(1001);
      await expect(rejection).resolves.toBe('rejected');

      blocker.resolve();
      await first;
      const third = queue.run(() => Promise.resolve('third'));
      await expect(third).resolves.toBe('third');
    } finally {
      jest.useRealTimers();
    }
  });

  it('never rejects a pass that gets its turn inside the ceiling', async () => {
    jest.useFakeTimers();
    try {
      const queue = new CuratorJobQueue(1000);
      const blocker = deferred();
      const first = queue.run(() => blocker.promise);
      const second = queue.run(() => Promise.resolve('second'));

      jest.advanceTimersByTime(500);
      blocker.resolve();
      await first;
      await expect(second).resolves.toBe('second');
      // The cancelled ceiling must not fire after the job started.
      jest.advanceTimersByTime(5000);
      await expect(second).resolves.toBe('second');
    } finally {
      jest.useRealTimers();
    }
  });

  it('ships a bounded default ceiling', () => {
    expect(CURATOR_QUEUE_WAIT_CEILING_MS).toBeGreaterThan(0);
    expect(Number.isFinite(CURATOR_QUEUE_WAIT_CEILING_MS)).toBe(true);
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
