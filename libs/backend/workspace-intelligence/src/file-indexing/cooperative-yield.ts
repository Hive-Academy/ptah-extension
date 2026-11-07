/**
 * Cooperative scheduling for long in-process walks on the host's main loop.
 *
 * The Electron main process runs the workspace walk on the same thread that
 * serves IPC, timers and streaming chat sessions, so a walk over tens of
 * thousands of paths must hand the loop back regularly. Awaiting I/O does not
 * guarantee that: a run of paths that are filtered out before any I/O is a
 * tight synchronous loop, and `await` on an already-settled promise is only a
 * MICROtask, which drains inside the same loop turn.
 */

/**
 * Longest synchronous slice a walk keeps before it yields. One display frame:
 * far under the 50 ms a slice may take without being felt, and large enough
 * that a 15k-path walk yields a few dozen times rather than once per path.
 */
export const WALK_SLICE_BUDGET_MS = 16;

/**
 * Hand the event loop a turn.
 *
 * `setImmediate` rather than `Promise.resolve()`: a resolved promise is a
 * microtask, so awaiting it drains back into the same loop turn and starves
 * timers, I/O callbacks and IPC exactly as the uninterrupted loop did.
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

/**
 * Time budget for one synchronous slice of a walk.
 *
 * Usage, once per item: `if (slice.expired()) await slice.yield();`. The check
 * is a clock read, so items within the budget pay no `await` at all.
 */
export class WalkSlice {
  private sliceStartMs = performance.now();

  constructor(private readonly budgetMs: number = WALK_SLICE_BUDGET_MS) {}

  /** True once the current slice has used its budget. */
  expired(): boolean {
    return performance.now() - this.sliceStartMs >= this.budgetMs;
  }

  /** Yield one macrotask turn, then start a fresh slice. */
  async yield(): Promise<void> {
    await yieldToEventLoop();
    this.sliceStartMs = performance.now();
  }
}
