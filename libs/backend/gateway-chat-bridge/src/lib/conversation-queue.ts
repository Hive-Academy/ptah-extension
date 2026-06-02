/**
 * ConversationQueue — per-key serial promise chain.
 *
 * Guarantees concurrency 1 per key (turns for the same conversation run in
 * submission order) while allowing distinct keys to run concurrently. A
 * rejected task settles its own chain link only and never wedges subsequent
 * tasks on the same key.
 */
export class ConversationQueue {
  private readonly tails = new Map<string, Promise<void>>();

  enqueue(key: string, task: () => Promise<void>): Promise<void> {
    const prior = this.tails.get(key) ?? Promise.resolve();
    const run = prior.then(
      () => task(),
      () => task(),
    );
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, settled);
    void settled.then(() => {
      if (this.tails.get(key) === settled) {
        this.tails.delete(key);
      }
    });
    return run;
  }

  get activeKeyCount(): number {
    return this.tails.size;
  }
}
