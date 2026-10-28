/**
 * In-process, per-destination write lock shared by every Ptah file writer.
 *
 * The wizard agent writer (agent-generation) and the agent-pack installer
 * (platform-core) both replace an existing file only after re-reading it and
 * checking the bytes against the baseline the user decided on. That
 * re-check and the mutation after it must not interleave with another Ptah
 * writer's re-check and mutation of the same file; otherwise two callers
 * holding the same valid baseline both pass and the later one silently
 * replaces the earlier one's result. Both writers therefore run their final
 * read and mutation inside {@link destinationWriteLock}, one module-level
 * instance per host process (Electron main, VS Code extension host, CLI):
 * every importer of `@ptah-extension/platform-core` shares it.
 *
 * Scope: this coordinates Ptah writers in one process. It does not lock the
 * file against editors or other processes; that remaining window is
 * documented at each writer.
 *
 * The lock is not reentrant: a holder must not acquire the same key again.
 */

import * as path from 'path';

/**
 * Key naming one destination however it was spelled: resolved to an absolute
 * path, and case-folded on win32 where `C:\A\x.md` and `c:\a\X.md` are the
 * same file.
 */
export function destinationLockKey(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** Holder chain of one key. */
interface KeyQueue {
  /** Settles when the last enqueued holder releases. Never rejects. */
  tail: Promise<void>;
  /** Holders running or waiting on this key. */
  pending: number;
}

/**
 * FIFO async mutex per destination key. Holders of different keys run
 * concurrently; holders of one key run one after another, and a holder that
 * throws or rejects still releases the key to the next waiter.
 */
export class DestinationWriteLock {
  private readonly queues = new Map<string, KeyQueue>();

  /** Run `task` while holding the lock for `filePath`; returns its result. */
  async run<T>(filePath: string, task: () => Promise<T>): Promise<T> {
    const key = destinationLockKey(filePath);
    const queue = this.queues.get(key) ?? {
      tail: Promise.resolve(),
      pending: 0,
    };
    const previous = queue.tail;
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    queue.tail = previous.then(() => held);
    queue.pending += 1;
    this.queues.set(key, queue);
    await previous;
    try {
      return await task();
    } finally {
      release();
      queue.pending -= 1;
      if (queue.pending === 0 && this.queues.get(key) === queue) {
        this.queues.delete(key);
      }
    }
  }

  /** Holders running or waiting on `filePath` (for tests and diagnostics). */
  pendingCount(filePath: string): number {
    return this.queues.get(destinationLockKey(filePath))?.pending ?? 0;
  }
}

/**
 * The single per-process instance shared by all Ptah writers. Wrap a
 * writer's final re-read and mutation of a destination in
 * `destinationWriteLock.run(destination, task)`.
 */
export const destinationWriteLock = new DestinationWriteLock();
