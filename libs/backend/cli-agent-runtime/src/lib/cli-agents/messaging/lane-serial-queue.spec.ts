import { LaneSerialQueue } from './lane-serial-queue';

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } {
  let resolve: () => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('LaneSerialQueue', () => {
  it('never overlaps two tasks for one lane and keeps their order', async () => {
    const queue = new LaneSerialQueue();
    const events: string[] = [];
    const gate = deferred();
    const first = queue.run('lane-a', async () => {
      events.push('first:start');
      await gate.promise;
      events.push('first:end');
      return 1;
    });
    const second = queue.run('lane-a', async () => {
      events.push('second:start');
      return 2;
    });
    await Promise.resolve();
    expect(events).toEqual(['first:start']);
    gate.resolve();
    await expect(first).resolves.toBe(1);
    await expect(second).resolves.toBe(2);
    expect(events).toEqual(['first:start', 'first:end', 'second:start']);
  });

  it('runs different lanes independently', async () => {
    const queue = new LaneSerialQueue();
    const gate = deferred();
    const blocked = queue.run('lane-a', () => gate.promise);
    await expect(queue.run('lane-b', async () => 'b')).resolves.toBe('b');
    gate.resolve();
    await blocked;
  });

  it('returns a failure to its own caller and still runs the next task', async () => {
    const queue = new LaneSerialQueue();
    const failing = queue.run('lane-a', async () => { throw new Error('boom'); });
    const next = queue.run('lane-a', async () => 'ok');
    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
  });

  it('deletes a lane entry once its chain settles', async () => {
    const queue = new LaneSerialQueue();
    const gate = deferred();
    const running = queue.run('lane-a', () => gate.promise);
    expect(queue.isBusy('lane-a')).toBe(true);
    expect(queue.size).toBe(1);
    gate.resolve();
    await running;
    await new Promise((resolve) => setImmediate(resolve));
    expect(queue.isBusy('lane-a')).toBe(false);
    expect(queue.size).toBe(0);
  });
});
