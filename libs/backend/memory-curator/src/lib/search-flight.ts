/** Serializes expensive synchronous searches and shares identical in-flight work. */
export class SearchFlight<T> {
  private static tail: Promise<void> = Promise.resolve();
  private readonly pending = new Map<string, Promise<T>>();

  run(key: string, work: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key);
    if (existing) return existing;
    const result = SearchFlight.tail.then(work);
    this.pending.set(key, result);
    SearchFlight.tail = result.then(() => undefined, () => undefined);
    void result.then(
      () => { this.pending.delete(key); },
      () => { this.pending.delete(key); },
    );
    return result;
  }
}
