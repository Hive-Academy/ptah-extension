/**
 * Serializes expensive synchronous searches and shares identical in-flight work.
 *
 * `serialize: false` keeps the sharing but skips the process-wide queue. The
 * SQLite search worker uses it: its requests carry deadlines, so a wait here
 * is spent from their budgets, and its single thread already runs one
 * statement at a time; the queue would only serialize the embed and rerank
 * waits between statements.
 */
export class SearchFlight<T> {
  private static readonly MAX_QUEUE_WAIT_MS = 5_000;
  private static tail: Promise<void> = Promise.resolve();
  private readonly pending = new Map<string, Promise<T>>();

  run(key: string, work: () => Promise<T>, options: { readonly serialize?: boolean } = {}): Promise<T> {
    const existing = this.pending.get(key);
    if (existing) return existing;
    if (options.serialize === false) {
      const direct = work();
      this.pending.set(key, direct);
      void direct.then(
        () => { this.pending.delete(key); },
        () => { this.pending.delete(key); },
      );
      return direct;
    }
    const result = SearchFlight.tail.then(work);
    this.pending.set(key, result);
    SearchFlight.tail = Promise.race([
      result.then(() => undefined, () => undefined),
      new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (this.pending.get(key) === result) this.pending.delete(key);
          resolve();
        }, SearchFlight.MAX_QUEUE_WAIT_MS);
        timer.unref?.();
        void result.finally(() => clearTimeout(timer)).catch(() => {
          // degradation-audit: reported - result is returned to its caller.
        });
      }),
    ]);
    void result.then(
      () => { this.pending.delete(key); },
      () => { this.pending.delete(key); },
    );
    return result;
  }
}
