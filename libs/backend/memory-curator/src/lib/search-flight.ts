/** Serializes expensive synchronous searches and shares identical in-flight work. */
export class SearchFlight<T> {
  private static readonly MAX_QUEUE_WAIT_MS = 5_000;
  private static tail: Promise<void> = Promise.resolve();
  private readonly pending = new Map<string, Promise<T>>();

  run(key: string, work: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key);
    if (existing) return existing;
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
