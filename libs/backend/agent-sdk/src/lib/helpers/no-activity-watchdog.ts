/**
 * NoActivityWatchdog — a resettable stream-inactivity timer.
 *
 * Fires `onTimeout` exactly once when `timeoutMs` elapses without a `kick()`.
 * Any `kick()` before the deadline pushes the deadline out by another full
 * window, so a stream that keeps producing ANY event (message, partial /
 * streaming delta, tool_use, tool_result, thinking) never trips it, while a
 * stream that goes fully silent for the whole window does.
 *
 * This replaces the old stderr-pattern "provider error" heuristic: instead of
 * guessing "stuck" from stderr text (brittle in both directions), we treat a
 * turn that emits zero stream activity for the window as stuck and surface it.
 *
 * Lifecycle: `start()` arms it, `kick()` resets it, `stop()` disarms it
 * permanently. After `stop()` — or after it has fired once — `start()`/`kick()`
 * are no-ops, so the callback can never fire late or twice. Callers MUST call
 * `stop()` in a `finally` so the timer can neither leak nor fire after the turn
 * ends (success, error, or abort).
 *
 * `hold()` / `release()` suspend the window for silence Ptah itself caused.
 * A turn parked on `canUseTool` — a permission prompt, an AskUserQuestion card,
 * an ExitPlanMode confirmation — emits zero SDK messages by construction, so
 * without a hold the watchdog reads "a human is reading the prompt" as "the
 * provider is stuck" and aborts a perfectly healthy session out from under the
 * user. The UI's own bound for that wait is 5 minutes
 * (`ASK_USER_QUESTION_IDLE_TIMEOUT_MS`); this watchdog's 3 minutes used to win,
 * which is how a New Project run died mid-question (TASK_2026_317).
 * Reference-counted, because concurrent tool calls (subagents) overlap.
 */
export class NoActivityWatchdog {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private fired = false;
  private stopped = false;
  private started = false;
  private holds = 0;

  constructor(
    private readonly timeoutMs: number,
    private readonly onTimeout: () => void,
  ) {}

  /** Arm the inactivity timer. No-op once the watchdog has fired or stopped. */
  start(): void {
    if (this.stopped || this.fired) {
      return;
    }
    this.started = true;
    this.arm();
  }

  /**
   * Reset the inactivity window on stream activity. No-op once the watchdog
   * has fired or stopped.
   */
  kick(): void {
    if (this.stopped || this.fired) {
      return;
    }
    this.arm();
  }

  /**
   * Suspend the inactivity window while the turn is legitimately blocked on a
   * user decision. Nestable — the window stays suspended until every matching
   * `release()` has landed.
   */
  hold(): void {
    if (this.stopped || this.fired) {
      return;
    }
    this.holds += 1;
    this.clear();
  }

  /**
   * Drop one hold. When the last one goes, the turn is running again and a
   * fresh FULL window starts — time spent waiting on the user is never counted
   * against the provider. Idempotent below zero, so an unbalanced release from
   * a teardown path cannot re-arm a watchdog that was never held.
   */
  release(): void {
    if (this.holds === 0) {
      return;
    }
    this.holds -= 1;
    if (this.holds > 0 || this.stopped || this.fired || !this.started) {
      return;
    }
    this.arm();
  }

  /** True while at least one hold is outstanding. Exposed for tests/diagnostics. */
  get isHeld(): boolean {
    return this.holds > 0;
  }

  /** Disarm permanently. Idempotent — safe to call from every teardown path. */
  stop(): void {
    this.stopped = true;
    this.clear();
  }

  private arm(): void {
    if (this.holds > 0) {
      // Held: stay disarmed. `release()` starts the fresh window.
      this.clear();
      return;
    }
    this.clear();
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.stopped || this.fired) {
        return;
      }
      this.fired = true;
      this.onTimeout();
    }, this.timeoutMs);
  }

  private clear(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

/**
 * How long a turn may produce NO stream activity before the watchdog treats the
 * session as stuck and aborts it.
 *
 * 180s (3 minutes) is deliberately generous: the timer resets on ANY stream
 * event, so this is the ceiling on a *fully silent* gap, not a turn cap. It
 * must clear the legitimate silent gaps —
 *   - p99 first-token latency for reasoning models and cold local Ollama loads
 *     (the old first-response timeout used 90s for this alone),
 *   - a long-running tool call whose only stream events are the tool_use at the
 *     start and the tool_result at the end (e.g. a multi-minute shell build),
 *   - extended thinking (which, with includePartialMessages on, streams deltas
 *     that keep kicking the timer anyway).
 * A turn that emits zero events for 3 full minutes is stuck, not slow, so we
 * surface it instead of hanging the UI forever.
 */
export const NO_ACTIVITY_TIMEOUT_MS = 180_000;

/**
 * The `hold()` / `release()` half of {@link NoActivityWatchdog}, as consumed by
 * code that only needs to suspend the window (the `canUseTool` wrapper) and has
 * no business starting, kicking or stopping it.
 */
export interface ActivityHold {
  hold(): void;
  release(): void;
}
