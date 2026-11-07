/**
 * Runs async tasks one at a time PER KEY, in call order; different keys run
 * independently.
 *
 * `CodeSymbolStore.replaceFileSymbols` writes a large file in several
 * transactions with a yield between them. Without this, a second replace of
 * the same file (a watcher reindex during the startup run) could commit its
 * rows between two chunks of the first and leave a mix of both.
 */
export class KeyedSerialQueue {
  private readonly tails = new Map<string, Promise<void>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    // `task` runs after the previous one SETTLES, whichever way: a failed
    // write must not block the next write of the same file.
    const result = previous.then(task, task);
    // The tail only orders the next task. Its outcome reaches the caller
    // through `result`, so the tail itself settles quietly instead of
    // raising a second, unhandled rejection for the same failure.
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }

  /** Keys with a task queued or running. */
  get size(): number {
    return this.tails.size;
  }
}
