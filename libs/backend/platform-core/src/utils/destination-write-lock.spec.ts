/**
 * `DestinationWriteLock` — unit specs (TASK_2026_701 A2).
 *
 * Pure in-memory: no file is touched; paths are only lock keys.
 */

import * as path from 'path';
import {
  DestinationWriteLock,
  destinationLockKey,
  destinationWriteLock,
} from './destination-write-lock';

/** A promise plus its resolver, for holding a task open. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Let every queued microtask and pending promise callback run. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

const FILE = path.resolve('/workspace/.claude/agents/react-expert.md');

describe('DestinationWriteLock', () => {
  it('runs holders of one destination one after another, in arrival order', async () => {
    const lock = new DestinationWriteLock();
    const events: string[] = [];
    const firstGate = deferred();

    const first = lock.run(FILE, async () => {
      events.push('first:start');
      await firstGate.promise;
      events.push('first:end');
      return 'first';
    });
    const second = lock.run(FILE, async () => {
      events.push('second:start');
      return 'second';
    });

    await flush();
    expect(events).toEqual(['first:start']);
    expect(lock.pendingCount(FILE)).toBe(2);

    firstGate.resolve();
    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
    expect(events).toEqual(['first:start', 'first:end', 'second:start']);
    expect(lock.pendingCount(FILE)).toBe(0);
  });

  it('runs holders of different destinations concurrently', async () => {
    const lock = new DestinationWriteLock();
    const gate = deferred();
    const started: string[] = [];

    const a = lock.run(FILE, async () => {
      started.push('a');
      await gate.promise;
    });
    const b = lock.run(
      path.resolve('/workspace/.claude/agents/other.md'),
      async () => {
        started.push('b');
      },
    );

    await b;
    expect(started).toEqual(['a', 'b']);
    gate.resolve();
    await a;
  });

  it('releases the destination when a holder throws or rejects', async () => {
    const lock = new DestinationWriteLock();

    await expect(
      lock.run(FILE, async () => {
        throw new Error('write failed');
      }),
    ).rejects.toThrow('write failed');
    await expect(
      lock.run(FILE, () => Promise.reject(new Error('rejected'))),
    ).rejects.toThrow('rejected');

    await expect(lock.run(FILE, async () => 'next')).resolves.toBe('next');
    expect(lock.pendingCount(FILE)).toBe(0);
  });

  it('a waiter queued behind a failing holder still runs', async () => {
    const lock = new DestinationWriteLock();
    const gate = deferred();

    const failing = lock.run(FILE, async () => {
      await gate.promise;
      throw new Error('boom');
    });
    const waiter = lock.run(FILE, async () => 'ran');
    gate.resolve();

    await expect(failing).rejects.toThrow('boom');
    await expect(waiter).resolves.toBe('ran');
  });

  it('treats differently spelled paths to one file as one destination', async () => {
    const lock = new DestinationWriteLock();
    const gate = deferred();
    const events: string[] = [];
    const dotted = path.join(
      path.dirname(FILE),
      '..',
      'agents',
      path.basename(FILE),
    );

    const first = lock.run(FILE, async () => {
      events.push('first');
      await gate.promise;
    });
    const second = lock.run(dotted, async () => {
      events.push('second');
    });

    await flush();
    expect(events).toEqual(['first']);
    expect(lock.pendingCount(dotted)).toBe(2);
    gate.resolve();
    await Promise.all([first, second]);
    expect(events).toEqual(['first', 'second']);
  });

  describe('destinationLockKey', () => {
    it('resolves relative segments to one absolute key', () => {
      const dotted = path.join(
        path.dirname(FILE),
        '.',
        '..',
        'agents',
        'react-expert.md',
      );
      expect(destinationLockKey(dotted)).toBe(destinationLockKey(FILE));
      expect(path.isAbsolute(destinationLockKey('relative/x.md'))).toBe(true);
    });

    it('case-folds on win32 only', () => {
      const upper = FILE.toUpperCase();
      if (process.platform === 'win32') {
        expect(destinationLockKey(upper)).toBe(destinationLockKey(FILE));
      } else {
        expect(destinationLockKey(upper)).not.toBe(destinationLockKey(FILE));
      }
    });
  });

  it('exports one shared process-wide instance', () => {
    expect(destinationWriteLock).toBeInstanceOf(DestinationWriteLock);
  });
});
