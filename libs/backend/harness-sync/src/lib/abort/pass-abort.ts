/**
 * Cancellation for a reconcile pass, and the one rule that makes it safe.
 *
 * Preflight races the reconcile against a 1500 ms budget. Before TASK_2026_323
 * the losing pass was never cancelled — it kept walking `~/.ptah/user`,
 * `readFileSync`-ing and sha256-ing every file of every skill, on the main
 * thread, long after the session that asked for it had moved on. With three
 * chat sessions and a handful of rival CLI agents each starting their own
 * preflight, that background work is a standing source of event-loop lag in
 * the Electron main process, which is where the whole app's UI lives.
 *
 * Cancelling it is only safe because of what CAN be cancelled:
 *
 * **The signal is checked in the READ phases only — never during apply.**
 * `HarnessManifestBuilder.build` and `IHarnessTarget.plan` hash the disk and
 * write nothing (that is the port's contract), so abandoning one leaves every
 * manifest and every target directory exactly as it found them. The moment a
 * target is about to write, {@link HarnessPassSignal.commit} detaches the
 * signal and that target runs to completion — a target that is making real
 * progress is never interrupted, and a half-written target with no manifest
 * entry for what landed remains impossible.
 *
 * **The commit point is PER TARGET, not per pass**, because each target
 * persists its own manifest immediately after its own apply. A pass-wide commit
 * would mean the first target needing a single write made the other five
 * uncancellable, and on the six-target preflight path that is most of the
 * hashing this exists to stop paying for. `HarnessReconcilerService` therefore
 * mints one of these per target and disposes it in the same `finally`.
 *
 * **An aborted pass records nothing.** It updates no health cache, emits no
 * `health` event and saves no manifest, so nothing downstream can mistake it
 * for a completed pass. The per-workspace 60 s throttle is deliberately still
 * stamped: a preflight that cannot finish its walk inside the budget would
 * otherwise re-run in full on the very next session start and abort again,
 * burning the same work forever. The next pass past the throttle re-runs it.
 */

/** Thrown out of a read phase when the pass's budget expired. */
export class HarnessPassAbortedError extends Error {
  constructor(message = 'harness pass aborted') {
    super(message);
    this.name = 'HarnessPassAbortedError';
  }
}

/**
 * True for our own abort and for the `AbortError` a Node API raises off the
 * same signal, so a caller distinguishing "cancelled" from "failed" does not
 * have to know which layer noticed first.
 */
export function isPassAbortedError(error: unknown): boolean {
  return (
    error instanceof HarnessPassAbortedError ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

/** Throw {@link HarnessPassAbortedError} when `signal` has been aborted. */
export function throwIfPassAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new HarnessPassAbortedError();
}

/**
 * Hand the event loop a turn.
 *
 * `setImmediate` and not `queueMicrotask`: a microtask runs before I/O and
 * timers, so a walk that yielded that way would still starve the loop it is
 * trying to unblock. This is the whole point of the async walk — the hashing
 * costs the same either way, but between two directories the renderer's IPC,
 * an agent's stdout and the next timer all get to run.
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

/**
 * One target's cancellation, with a commit point past which it cannot be
 * cancelled.
 *
 * `signal` is what the read phases check. `commit()` is called once, by the
 * reconciler, immediately before that target's first write; after it the signal
 * is detached and a later abort is ignored. `dispose()` releases the listener
 * on the caller's signal so a preflight controller does not accumulate one per
 * target per pass.
 */
export interface HarnessPassSignal {
  /** `undefined` when the caller supplied no signal — the uncancellable case. */
  readonly signal: AbortSignal | undefined;
  /** Past this point the pass runs to completion. Idempotent. */
  commit(): void;
  /** Detach from the caller's signal. Idempotent. */
  dispose(): void;
}

/**
 * Wrap a caller's signal in one this pass controls.
 *
 * The indirection is what `commit()` needs: the reconciler cannot un-abort the
 * caller's controller, so it forwards to its own and stops forwarding once the
 * pass has started writing.
 */
export function createHarnessPassSignal(
  outer: AbortSignal | undefined,
): HarnessPassSignal {
  if (outer === undefined) {
    return {
      signal: undefined,
      commit: () => undefined,
      dispose: () => undefined,
    };
  }

  const inner = new AbortController();
  let attached = true;
  const forward = (): void => {
    inner.abort();
  };

  const detach = (): void => {
    if (!attached) return;
    attached = false;
    outer.removeEventListener('abort', forward);
  };

  if (outer.aborted) {
    inner.abort();
    attached = false;
  } else {
    outer.addEventListener('abort', forward, { once: true });
  }

  return {
    signal: inner.signal,
    commit: detach,
    dispose: detach,
  };
}
