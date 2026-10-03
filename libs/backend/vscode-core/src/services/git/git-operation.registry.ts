/**
 * One running operation's hold on its id: the signal that stops it, and the
 * release that frees the id. `settle` must run exactly when the operation
 * settles, success or failure; calling it again is a no-op.
 */
export interface GitOperationHandle {
  /** Aborts on `cancel(operationId)` or when the caller's own signal aborts. */
  readonly signal: AbortSignal | undefined;
  settle(): void;
}

const UNTRACKED: GitOperationHandle = {
  signal: undefined,
  settle: () => undefined,
};

/**
 * The cancellable git operations running now, keyed by the caller's
 * `operationId` (TASK_2026_576 Component 30). `git:cancelOperation` reaches a
 * running commit through here; nothing else does.
 *
 * An entry exists only between {@link start} and its handle's `settle`, so the
 * map holds at most the operations in flight. Ids are compared verbatim.
 */
export class GitOperationRegistry {
  private readonly running = new Map<string, AbortController>();

  /**
   * Register `operationId` for one operation. The handle's signal aborts on
   * {@link cancel} or when `callerSignal` aborts (already aborted counts).
   *
   * Without an id the operation is not cancellable from here: the handle
   * carries `callerSignal` unchanged and registers nothing. Returns `null`
   * when an operation with this id is already running.
   */
  start(
    operationId: string | undefined,
    callerSignal?: AbortSignal,
  ): GitOperationHandle | null {
    if (operationId === undefined) {
      return callerSignal ? { ...UNTRACKED, signal: callerSignal } : UNTRACKED;
    }
    if (this.running.has(operationId)) return null;

    const controller = new AbortController();
    const onCallerAbort = (): void => controller.abort();
    if (callerSignal?.aborted) {
      controller.abort();
    } else {
      callerSignal?.addEventListener('abort', onCallerAbort, { once: true });
    }
    this.running.set(operationId, controller);

    let settled = false;
    return {
      signal: controller.signal,
      settle: () => {
        if (settled) return;
        settled = true;
        callerSignal?.removeEventListener('abort', onCallerAbort);
        if (this.running.get(operationId) === controller) {
          this.running.delete(operationId);
        }
      },
    };
  }

  /**
   * Stop the running operation registered as `operationId`. True when one was
   * running (aborting an already-aborted one still answers true); false when
   * none is.
   */
  cancel(operationId: string): boolean {
    const controller = this.running.get(operationId);
    if (!controller) return false;
    controller.abort();
    return true;
  }
}
