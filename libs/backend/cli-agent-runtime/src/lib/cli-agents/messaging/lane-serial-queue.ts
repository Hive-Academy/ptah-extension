/**
 * Per-lane promise chain shared by send, the reconciler and the scheduler
 * (Component 6). Two tasks for the same lane never overlap; tasks for
 * different lanes run independently. A task's failure is returned to its own
 * caller and never blocks the next task. A lane's entry is deleted once its
 * chain settles, so the map holds only lanes with queued or running work.
 *
 * Do not call `run` for a lane from inside a task already running for that
 * same lane: the inner task waits for the outer one and neither settles.
 */
export class LaneSerialQueue {
  private readonly tails = new Map<string, Promise<void>>();

  run<T>(laneId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(laneId) ?? Promise.resolve();
    const result = previous.then(task);
    // The tail swallows the task's outcome on purpose: the caller receives it
    // through `result`, and the next task must start whatever this one did.
    const tail = result.then(() => undefined, () => undefined);
    this.tails.set(laneId, tail);
    void tail.then(() => {
      if (this.tails.get(laneId) === tail) this.tails.delete(laneId);
    });
    return result;
  }

  isBusy(laneId: string): boolean {
    return this.tails.has(laneId);
  }

  /** Lanes with queued or running work. */
  get size(): number {
    return this.tails.size;
  }
}
