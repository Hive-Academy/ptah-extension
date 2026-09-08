/**
 * The ARMING half of the boot scan (TASK_2026_380), shared by both pipelines.
 *
 * `BootScanRunner` beside this file is already the pipeline-agnostic engine —
 * it takes `pipeline: 'skills' | 'memory'` and `skill-synthesis` imports it.
 * This is the gate in front of it, and it shipped as a byte-for-byte copy in
 * `SkillTriggerService` and `MemoryTriggerService` because the arming rule is a
 * property of "background work on a host that just launched", not of what
 * either scan then does. One copy, one place to get it wrong.
 *
 * ## Why the scan is armed rather than run from `start()`
 *
 * Neither scan is urgent: every session it reads ended before this process
 * existed. Running from `start()` put that work in the first seconds after
 * launch, competing with window creation and the SDK boot for the main thread —
 * the skills scan enqueuing a backlog of prefilter rows, the memory scan
 * issuing one LLM round trip per eligible session.
 *
 * ## Two conditions, two different questions
 *
 * The DELAY answers "has the host settled" — a clock question. The re-arm
 * answers "is the user working right now" — an activity question. Both are
 * needed: `lastActivityAt()` is `null` at boot (exactly as
 * `ForegroundActivityTracker.msSinceLastActivity` reports `Infinity`), so an
 * activity check on its own would always pass at the worst possible moment,
 * while a delay on its own would fire into a user mid-conversation.
 *
 * The re-arm is deliberately unbounded. It only ever continues while chat
 * activity keeps arriving, so it terminates as soon as the user stops, and a
 * host where the user never stops is one where the backlog genuinely should
 * keep waiting. `cancel()` clears the timer, so it cannot outlive the caller.
 *
 * `unref` keeps a pending scan from holding the process alive at shutdown.
 */

/**
 * The slice of `IWorkspaceProvider` this needs. A local structural port rather
 * than the import, so the scheduler stays a leaf and can be driven from a spec
 * with an object literal.
 */
export interface BootScanSchedulerConfigReader {
  getConfiguration<T>(
    section: string,
    key: string,
    defaultValue?: T,
  ): T | undefined;
}

/** The slice of `Logger` this needs. Structurally satisfied by the real one. */
export interface BootScanSchedulerLogger {
  debug(message: string, meta: Record<string, unknown>): void;
}

export interface BootScanSchedulerOptions {
  /**
   * Prefixed onto both log lines, e.g. `'[memory-curator]'`. Each pipeline owns
   * its own log channel and the messages are grepped for by name.
   */
  readonly logPrefix: string;
  readonly logger: BootScanSchedulerLogger;
  readonly workspace: BootScanSchedulerConfigReader;
  /** Settings section, `'ptah'` for both pipelines today. */
  readonly section: string;
  readonly delayMsKey: string;
  readonly delayMsDefault: number;
  readonly idleBackoffMsKey: string;
  readonly idleBackoffMsDefault: number;
  /**
   * Wall-clock instant of the last observed foreground chat turn, or `null`
   * when there has been none in this process. Read at DUE time, never cached.
   */
  readonly lastActivityAt: () => number | null;
  /**
   * Start the scan. Called at most once per armed timer, and synchronously when
   * the configured delay is `0`. The caller owns its own error handling — this
   * never awaits the result.
   */
  readonly run: (signal: AbortSignal) => void;
}

export class BootScanScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: BootScanSchedulerOptions) {}

  /**
   * Arm the scan. `delayMs` is supplied only by the internal re-arm, which
   * passes the backoff window; the first call reads the configured delay.
   */
  schedule(signal: AbortSignal, delayMs?: number): void {
    if (signal.aborted) return;
    const wait = delayMs ?? this.readDelayMs();
    if (wait <= 0) {
      this.options.run(signal);
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    const timer = setTimeout(() => {
      this.timer = null;
      if (signal.aborted) return;
      const backoff = this.readIdleBackoffMs();
      const lastActivityAt = this.options.lastActivityAt();
      const sinceActivity =
        lastActivityAt === null
          ? Number.POSITIVE_INFINITY
          : Math.max(0, Date.now() - lastActivityAt);
      if (backoff > 0 && sinceActivity < backoff) {
        this.options.logger.debug(
          `${this.options.logPrefix} boot scan deferred — foreground chat is active`,
          { sinceActivityMs: sinceActivity, backoffMs: backoff },
        );
        this.schedule(signal, backoff);
        return;
      }
      this.options.run(signal);
    }, wait);
    (timer as { unref?: () => void }).unref?.();
    this.timer = timer;
    this.options.logger.debug(`${this.options.logPrefix} boot scan armed`, {
      delayMs: wait,
    });
  }

  /** Drop any pending arm. Safe to call when nothing is armed. */
  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private readDelayMs(): number {
    return this.readPositiveMs(
      this.options.delayMsKey,
      this.options.delayMsDefault,
    );
  }

  private readIdleBackoffMs(): number {
    return this.readPositiveMs(
      this.options.idleBackoffMsKey,
      this.options.idleBackoffMsDefault,
    );
  }

  /** `0` is a legal value — it disables the gate — so only NaN falls back. */
  private readPositiveMs(key: string, fallback: number): number {
    const v = this.options.workspace.getConfiguration<number>(
      this.options.section,
      key,
      fallback,
    );
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
  }
}
