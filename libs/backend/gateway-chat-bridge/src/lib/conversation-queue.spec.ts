import { ConversationQueue } from './conversation-queue';

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (err: unknown) => void;
} {
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('ConversationQueue', () => {
  it('runs tasks for the same key serially in submission order', async () => {
    const queue = new ConversationQueue();
    const order: string[] = [];
    const first = deferred();

    const a = queue.enqueue('k', async () => {
      order.push('a-start');
      await first.promise;
      order.push('a-end');
    });
    const b = queue.enqueue('k', async () => {
      order.push('b-start');
      order.push('b-end');
    });

    await Promise.resolve();
    expect(order).toEqual(['a-start']);
    first.resolve();
    await Promise.all([a, b]);

    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });

  it('runs tasks for different keys concurrently', async () => {
    const queue = new ConversationQueue();
    const order: string[] = [];
    const gate = deferred();

    const a = queue.enqueue('k1', async () => {
      order.push('k1-start');
      await gate.promise;
      order.push('k1-end');
    });
    const b = queue.enqueue('k2', async () => {
      order.push('k2-start');
    });

    await b;
    expect(order).toContain('k1-start');
    expect(order).toContain('k2-start');
    expect(order).not.toContain('k1-end');

    gate.resolve();
    await a;
    expect(order).toContain('k1-end');
  });

  it('does not wedge the chain when a task rejects', async () => {
    const queue = new ConversationQueue();
    const ran: string[] = [];

    const failing = queue.enqueue('k', async () => {
      ran.push('fail');
      throw new Error('boom');
    });
    await expect(failing).rejects.toThrow('boom');

    const next = queue.enqueue('k', async () => {
      ran.push('ok');
    });
    await expect(next).resolves.toBeUndefined();
    expect(ran).toEqual(['fail', 'ok']);
  });
});
