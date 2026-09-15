/**
 * `EventStormBreaker` — turns an unbounded file-system event rate into
 * "stop per-event work, do one refresh after it calms down" (TASK_2026_437
 * INV-6).
 *
 * ## Why this exists
 *
 * On 2026-09-14 removing ten agent worktrees (~7,400 files each) delivered tens
 * of thousands of delete events to the Electron main thread, and every one ran
 * JavaScript: a predicate, a timer re-arm, a path accumulation. Exclusion rules
 * remove that particular trigger; this breaker bounds every trigger nobody has
 * listed yet. Above a rate threshold the caller stops doing per-event work and
 * sets a dirty flag; when events stop — or the storm has lasted too long — the
 * caller issues exactly one refresh.
 *
 * ## Contract
 *
 * - {@link EventStormBreaker.record} once per raw event. `'normal'` → do the
 *   usual per-event work; `'entered'` → the storm just started (log once, arm a
 *   poll timer); `'storming'` → do nothing but remember the caller is dirty.
 * - {@link EventStormBreaker.poll} from the caller's own timer while storming.
 *   `'storming'` → keep waiting; `'exited'` → issue the one refresh now. It
 *   returns `'exited'` exactly once per storm; before a storm and after the
 *   exit it returns `'idle'`, so a stray timer can never cause a second refresh.
 * - A storm exits after `quietMs` without events, or FORCIBLY once it has lasted
 *   `maxStormMs`, so a storm that never ends still refreshes periodically. The
 *   breaker re-arms at a forced exit: the rate window is kept, so the next
 *   event of a still-running storm re-enters immediately.
 * - By design, a storm that never goes quiet therefore logs one enter/exit
 *   pair (and issues one refresh) per `maxStormMs`.
 *
 * Rate is measured with a sliding-window counter (the previous fixed window's
 * count weighted by how much of it still overlaps, plus the current window's
 * count) — O(1) and allocation-free, and unlike a plain fixed window it cannot
 * let a burst straddling a window boundary through at twice the threshold.
 *
 * Pure: the caller passes `now` and owns every timer. Not a port — a shared
 * mechanism the git watcher, the file index and the P2 watch host all use,
 * exactly like `glob-watch-plan.ts`.
 */

/** Tunables. Any missing, non-finite or out-of-range value falls back to its default. */
export interface EventStormBreakerOptions {
  /** Events per `windowMs` at which a storm is entered. Default 500; must be ≥ 1. */
  readonly enterEventsPerWindow?: number;
  /** Rate window length. Default 1 000 ms; must be > 0. */
  readonly windowMs?: number;
  /** Silence after the last event that ends a storm. Default 2 000 ms; must be > 0. */
  readonly quietMs?: number;
  /** Longest a storm may suppress work before one forced refresh. Default 30 000 ms; must be > 0. */
  readonly maxStormMs?: number;
}

/** Result of {@link EventStormBreaker.record}. */
export type StormRecordResult = 'normal' | 'entered' | 'storming';

/** Result of {@link EventStormBreaker.poll}. */
export type StormPollResult = 'idle' | 'storming' | 'exited';

/** Why the most recent storm ended. */
export type StormExitReason = 'quiet' | 'max-duration';

/** Counters for the caller's storm log lines. A fresh snapshot per call. */
export interface EventStormStats {
  /** True while a storm is in progress. */
  readonly storming: boolean;
  /** Events recorded during the current storm, or the last one when idle. */
  readonly stormEvents: number;
  /** `now` at which the current (or last) storm started; `undefined` before the first. */
  readonly stormStartedAt: number | undefined;
  /** Duration of the last completed storm in ms; `undefined` before the first exit. */
  readonly lastStormDurationMs: number | undefined;
  /** Why the last completed storm ended; `undefined` before the first exit. */
  readonly lastExitReason: StormExitReason | undefined;
  /** Storms entered since construction. */
  readonly stormsEntered: number;
  /** Storms that ended by `maxStormMs` rather than by quiet. */
  readonly forcedExits: number;
}

export const EVENT_STORM_BREAKER_DEFAULTS: Readonly<
  Required<EventStormBreakerOptions>
> = {
  enterEventsPerWindow: 500,
  windowMs: 1_000,
  quietMs: 2_000,
  maxStormMs: 30_000,
};

/** Environment variable names read by {@link readEventStormBreakerOptionsFromEnv}. */
export const EVENT_STORM_BREAKER_ENV = {
  enterEventsPerWindow: 'PTAH_WATCH_STORM_ENTER_EVENTS',
  windowMs: 'PTAH_WATCH_STORM_WINDOW_MS',
  quietMs: 'PTAH_WATCH_STORM_QUIET_MS',
  maxStormMs: 'PTAH_WATCH_STORM_MAX_MS',
} as const;

export class EventStormBreaker {
  private readonly enterEventsPerWindow: number;
  private readonly windowMs: number;
  private readonly quietMs: number;
  private readonly maxStormMs: number;

  private windowStartedAt: number | undefined;
  private currentWindowCount = 0;
  private previousWindowCount = 0;

  private storming = false;
  private stormStartedAt: number | undefined;
  private lastEventAt = 0;
  private stormEvents = 0;
  private lastStormDurationMs: number | undefined;
  private lastExitReason: StormExitReason | undefined;
  private stormsEntered = 0;
  private forcedExits = 0;

  constructor(options: EventStormBreakerOptions = {}) {
    const defaults = EVENT_STORM_BREAKER_DEFAULTS;
    this.enterEventsPerWindow = validOrDefault(
      options.enterEventsPerWindow,
      1,
      defaults.enterEventsPerWindow,
    );
    this.windowMs = validOrDefault(
      options.windowMs,
      Number.MIN_VALUE,
      defaults.windowMs,
    );
    this.quietMs = validOrDefault(
      options.quietMs,
      Number.MIN_VALUE,
      defaults.quietMs,
    );
    this.maxStormMs = validOrDefault(
      options.maxStormMs,
      Number.MIN_VALUE,
      defaults.maxStormMs,
    );
  }

  /** True while a storm is in progress. */
  get isStorming(): boolean {
    return this.storming;
  }

  /**
   * Records one raw event at `now`. O(1), no allocation.
   *
   * A clock that goes backwards is treated as "no time passed" rather than
   * resetting the window, so it can neither end nor hide a storm.
   */
  record(now: number): StormRecordResult {
    this.advanceWindow(now);
    this.currentWindowCount++;

    if (this.storming) {
      this.stormEvents++;
      if (now > this.lastEventAt) this.lastEventAt = now;
      return 'storming';
    }

    if (this.estimatedRate(now) < this.enterEventsPerWindow) {
      return 'normal';
    }

    this.storming = true;
    this.stormStartedAt = now;
    this.lastEventAt = now;
    this.stormEvents = 1;
    this.stormsEntered++;
    return 'entered';
  }

  /**
   * Checks whether the current storm has ended at `now`. Returns `'exited'`
   * exactly once per storm, `'storming'` while it continues, and `'idle'` when
   * no storm is in progress.
   */
  poll(now: number): StormPollResult {
    if (!this.storming || this.stormStartedAt === undefined) return 'idle';

    if (now - this.lastEventAt >= this.quietMs) {
      this.exit(now, 'quiet');
      return 'exited';
    }
    if (now - this.stormStartedAt >= this.maxStormMs) {
      this.exit(now, 'max-duration');
      return 'exited';
    }
    return 'storming';
  }

  /**
   * Delay until the current storm could next exit — the earlier of the quiet
   * deadline and the forced-refresh deadline — so a caller can arm one timer
   * instead of polling on a fixed interval. `undefined` when not storming.
   */
  msUntilNextPoll(now: number): number | undefined {
    if (!this.storming || this.stormStartedAt === undefined) return undefined;
    const quietDeadline = this.lastEventAt + this.quietMs;
    const forcedDeadline = this.stormStartedAt + this.maxStormMs;
    return Math.max(0, Math.min(quietDeadline, forcedDeadline) - now);
  }

  /** Snapshot of the counters, for log lines. Allocates; not for the per-event path. */
  stats(): EventStormStats {
    return {
      storming: this.storming,
      stormEvents: this.stormEvents,
      stormStartedAt: this.stormStartedAt,
      lastStormDurationMs: this.lastStormDurationMs,
      lastExitReason: this.lastExitReason,
      stormsEntered: this.stormsEntered,
      forcedExits: this.forcedExits,
    };
  }

  private exit(now: number, reason: StormExitReason): void {
    this.storming = false;
    this.lastStormDurationMs = Math.max(0, now - (this.stormStartedAt ?? now));
    this.lastExitReason = reason;
    if (reason === 'max-duration') {
      this.forcedExits++;
    } else {
      // A quiet exit means the rate is genuinely low again; start counting
      // afresh so residual window counts cannot re-enter on the next event.
      this.windowStartedAt = undefined;
      this.currentWindowCount = 0;
      this.previousWindowCount = 0;
    }
  }

  private advanceWindow(now: number): void {
    if (this.windowStartedAt === undefined) {
      this.windowStartedAt = now;
      return;
    }
    const elapsed = now - this.windowStartedAt;
    if (elapsed < this.windowMs) return;

    const windowsPassed = Math.floor(elapsed / this.windowMs);
    // Exactly one window passed: the current count becomes the previous one.
    // More than one: the window before `now` saw no events.
    this.previousWindowCount =
      windowsPassed === 1 ? this.currentWindowCount : 0;
    this.currentWindowCount = 0;
    this.windowStartedAt += windowsPassed * this.windowMs;
  }

  private estimatedRate(now: number): number {
    // Clamped to [0, windowMs] so a clock that stepped backwards cannot weight
    // the previous window above 1.
    const elapsedInWindow = Math.min(
      this.windowMs,
      Math.max(0, now - (this.windowStartedAt ?? now)),
    );
    const previousWeight = (this.windowMs - elapsedInWindow) / this.windowMs;
    return this.previousWindowCount * previousWeight + this.currentWindowCount;
  }
}

/**
 * Reads breaker tunables from an environment map (normally `process.env`).
 * Unset, empty or non-numeric variables are omitted, so the constructor's
 * defaults and range checks apply. Taking the map as a parameter keeps this
 * module free of `process`, so it also runs inside workers and tests.
 */
export function readEventStormBreakerOptionsFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): EventStormBreakerOptions {
  const options: {
    -readonly [K in keyof EventStormBreakerOptions]: EventStormBreakerOptions[K];
  } = {};
  for (const key of Object.keys(EVENT_STORM_BREAKER_ENV) as Array<
    keyof typeof EVENT_STORM_BREAKER_ENV
  >) {
    const raw = env[EVENT_STORM_BREAKER_ENV[key]];
    if (raw === undefined || raw.trim().length === 0) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) options[key] = value;
  }
  return options;
}

function validOrDefault(
  value: number | undefined,
  minimum: number,
  fallback: number,
): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum
    ? value
    : fallback;
}
