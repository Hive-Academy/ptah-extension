/**
 * Serialized writer over an arbitrary `Writable` stream.
 *
 * TASK_2026_104 Batch 3.
 *
 * Internally queues writes so concurrent callers see strict FIFO ordering.
 * Awaits the `'drain'` event when `process.stdout.write(...)` returns
 * `false`, preventing memory growth under backpressure on slow consumers.
 *
 * `flush()` resolves once the queue is empty — call it before
 * `process.exit(...)` so the final notification isn't lost on Windows pipes
 * (per task-description.md §10 Reliability).
 *
 * No DI, no globals. Tests can pass any `Writable` (`PassThrough`).
 */

import type { Writable } from 'node:stream';

export interface StdoutWriterOptions {
  /** Sink stream — defaults to `process.stdout`. */
  output?: Writable;
}

interface QueueItem {
  payload: string;
  resolve: () => void;
  reject: (error: Error) => void;
}

export class StdoutWriter {
  private readonly output: Writable;
  private readonly queue: QueueItem[] = [];
  private draining = false;
  /** Promise tracking the in-flight write chain (or `null` when idle). */
  private chain: Promise<void> | null = null;

  constructor(options: StdoutWriterOptions = {}) {
    this.output = options.output ?? process.stdout;
  }

  /**
   * Enqueue a payload for serial write. Resolves once the chunk has been
   * accepted by the underlying stream (`drain` awaited if needed).
   */
  write(payload: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.queue.push({ payload, resolve, reject });
      this.drainQueue();
    });
  }

  /**
   * Resolve once every enqueued write has completed. Safe to call multiple
   * times; if the queue is empty it resolves on the next microtask tick.
   */
  async flush(): Promise<void> {
    if (this.chain === null && this.queue.length === 0) {
      return;
    }
    // Snapshot the current chain; new writes after this call are intentionally
    // not awaited (caller can call flush() again).
    await this.chain;
  }

  private drainQueue(): void {
    if (this.draining) {
      // Already draining — runQueue's loop will pick up the freshly enqueued
      // item before it exits.
      return;
    }
    this.draining = true;
    this.chain = this.runQueue().finally(() => {
      this.draining = false;
      this.chain = null;
      // If new writes were enqueued while `.finally` callbacks were settling
      // (e.g. caller awaited write #1 then synchronously called write #2 in
      // the same microtask before our finally ran), kick off another drain.
      if (this.queue.length > 0) {
        this.drainQueue();
      }
    });
  }

  private async runQueue(): Promise<void> {
    // Loop until the queue is empty AND no new items have been pushed during
    // the current iteration's awaited write. Items pushed by callers while
    // we're draining will be picked up by this same loop.
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) break;
      try {
        await this.writeOne(item.payload);
        item.resolve();
      } catch (error) {
        item.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private writeOne(payload: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const ok = this.output.write(payload, 'utf8', (err) => {
        if (err) {
          reject(err);
          return;
        }
        if (ok) {
          resolve();
        }
        // If !ok, resolution waits on 'drain' below.
      });

      if (!ok) {
        this.output.once('drain', () => resolve());
      }
    });
  }
}
