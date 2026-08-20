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
 */
export class NoActivityWatchdog {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private fired = false;
  private stopped = false;

  constructor(
    private readonly timeoutMs: number,
    private readonly onTimeout: () => void,
  ) {}

  /** Arm the inactivity timer. No-op once the watchdog has fired or stopped. */
  start(): void {
    if (this.stopped || this.fired) {
      return;
    }
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

  /** Disarm permanently. Idempotent — safe to call from every teardown path. */
  stop(): void {
    this.stopped = true;
    this.clear();
  }

  private arm(): void {
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
