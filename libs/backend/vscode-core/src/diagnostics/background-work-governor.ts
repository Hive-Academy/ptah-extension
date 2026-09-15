/**
 * BackgroundWorkGovernor — background work yields to the foreground
 * (TASK_2026_437 C14, INV-7).
 *
 * ## Why this exists
 *
 * On 2026-09-14 the Electron main loop lagged 265-615 ms every 2 s. The
 * watcher storm was the trigger, but every background pipeline — the memory
 * curator and skill synthesis one-shots, the symbol indexer, harness
 * reconciles, backups, index rebuilds — kept starting new units of work on the
 * same loop while the user was mid-turn and while the loop was measurably
 * blocked. Each one is cheap alone; started together, at the worst moment, they
 * are the freeze.
 *
 * This class answers one question for all of them: "may background work start
 * a unit NOW?" It owns derived state only. It does no work, holds no queue of
 * its own beyond `whenClear` waiters, and never cancels anything already
 * running.
 *
 * ## State
 *
 * `clear | foreground-busy | lagging | disposed`, derived from two inputs:
 *
 * - **Foreground sources** (`addForegroundSource`). agent-sdk registers one
 *   over `SessionTurnStateRegistry`: busy while any session is `generating`.
 *   vscode-core cannot import agent-sdk (the edge points the other way), so the
 *   source is structural — {@link ForegroundActivitySource}.
 * - **Event-loop samples** (`attachLagSource`, wired by `armDiagnostics`).
 *   Hysteresis, so one GC pause does not flap every adopter: enter `lagging`
 *   when p99 exceeds {@link LAG_ENTER_P99_MS} in {@link LAG_ENTER_WINDOWS}
 *   consecutive windows, or AT ONCE when one window's max reaches
 *   {@link LAG_FREEZE_MAX_MS} (see there); leave it when max stays under
 *   {@link LAG_EXIT_MAX_MS} for {@link LAG_EXIT_WINDOWS} consecutive windows.
 *
 * Foreground wins the label when both hold; either one makes the state not
 * clear. A host that never arms diagnostics (the CLI without `--verbose`) has
 * no lag source, so the governor runs on the foreground signal alone.
 *
 * `disposed` is terminal: the host is shutting down, nothing is admitted again,
 * and every pending `whenClear` waiter is rejected with an `AbortError` —
 * releasing them as `clear` would start background jobs during quit.
 *
 * ## Why background work is never starved (R-P7)
 *
 * A machine with constant lag, or a session that never leaves `generating`,
 * would otherwise hold background lanes forever. `whenClear` therefore has a
 * ceiling ({@link DEFAULT_MAX_DEFER_MS}, 10 min): past it the waiter resolves
 * `'timeout'` and the work proceeds. The ceiling is logged once per lane per
 * deferral episode; an episode ends when the state next becomes `clear`.
 *
 * ## Why it never holds the process open
 *
 * The only timers are `whenClear` ceilings, and they are `unref()`-ed, the same
 * rule as `EventLoopMonitor` — diagnostics-adjacent code must never be the
 * reason a process refuses to exit.
 */

import type { Logger } from '../logging/logger';
import type {
  EventLoopLagListener,
  EventLoopLagSample,
} from './event-loop-monitor';

/**
 * What background work is waiting on. `clear` is the only admitting state;
 * `disposed` is terminal (host shutdown).
 */
export type BackgroundWorkState =
  | 'clear'
  | 'foreground-busy'
  | 'lagging'
  | 'disposed';

export type BackgroundWorkStateListener = (state: BackgroundWorkState) => void;

/**
 * A structural foreground signal. Implemented outside this lib (agent-sdk's
 * turn-state registry) so vscode-core gains no dependency edge.
 */
export interface ForegroundActivitySource {
  /** True while the foreground is doing work background work must yield to. */
  isForegroundBusy(): boolean;
  /**
   * Call `listener` whenever `isForegroundBusy()` may have changed. Spurious
   * calls are fine — the governor re-reads and only emits on a real change.
   *
   * @returns An unsubscribe function.
   */
  onForegroundChange(listener: () => void): () => void;
}

/** The one method the governor needs from `EventLoopMonitor`. */
export interface LagSampleSource {
  onSample(listener: EventLoopLagListener): () => void;
}

/**
 * The read side adopters depend on. `BackgroundWorkGovernor` implements it; an
 * adopter that only admits or drains takes this rather than the class, so its
 * spec needs no timers. An adopter must treat a `'disposed'` notification as
 * cancellation of anything it still holds.
 */
export interface BackgroundWorkSignal {
  isClear(): boolean;
  /** @returns An unsubscribe function. */
  onChange(listener: BackgroundWorkStateListener): () => void;
}

export interface WhenClearOptions {
  /** Aborting removes the waiter and rejects with an `AbortError`. */
  signal?: AbortSignal;
  /**
   * Starvation ceiling. Past it the promise resolves `'timeout'` and the caller
   * proceeds. A non-finite or non-positive value uses
   * {@link DEFAULT_MAX_DEFER_MS}.
   */
  maxDeferMs?: number;
  /** Caller name for the ceiling log line. Never affects admission. */
  lane?: string;
}

export type WhenClearOutcome = 'clear' | 'timeout';

/** Timer seam, so the governor spec drives ceilings without real time. */
export interface GovernorTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/**
 * Enter `lagging` above 100 ms p99. The interaction budget: below ~100 ms a
 * response still feels instantaneous (the same band `EventLoopMonitor`'s
 * threshold doc argues from). p99 rather than max, so one long tick in an
 * otherwise healthy window does not count as sustained pressure.
 */
export const LAG_ENTER_P99_MS = 100;

/** Two consecutive 2 s windows — a sustained 4 s, not a spike. */
export const LAG_ENTER_WINDOWS = 2;

/**
 * One window whose max reaches 1 s enters `lagging` immediately.
 *
 * A TOTAL freeze defeats the two-window p99 rule: the sampler is a timer on
 * the blocked loop, so a multi-second block yields at most ONE post-freeze
 * window (its p99 is the healthy ticks around the block, not the block), and
 * the next window is quiet — the entry streak reaches 1 and resets. A 1 s
 * block is no GC pause and no paint: it is exactly the freeze this class
 * exists for, and the recovery window right after it is the worst moment to
 * start background work.
 */
export const LAG_FREEZE_MAX_MS = 1_000;

/**
 * Leave `lagging` only when the WORST delay is under 40 ms. Max rather than
 * p99, and well under the entry bar, so a loop hovering around the threshold
 * does not release background work straight back onto itself.
 */
export const LAG_EXIT_MAX_MS = 40;

/** Three consecutive quiet windows (6 s) before background work resumes. */
export const LAG_EXIT_WINDOWS = 3;

/**
 * 10 min. Long enough to cover a long generating turn and a real stall; short
 * enough that a memory-curator or skill-synthesis backlog still drains within
 * the session it was produced in (R-P7).
 */
export const DEFAULT_MAX_DEFER_MS = 600_000;

const LOG_TAG = '[background-work]';

const REAL_TIMERS: GovernorTimers = {
  setTimeout: (callback, ms) => {
    const handle = setTimeout(callback, ms);
    // Never the reason the process stays alive. See the file header.
    handle.unref();
    return handle;
  },
  clearTimeout: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

interface ClearWaiter {
  readonly resolve: (outcome: WhenClearOutcome) => void;
  readonly reject: (error: Error) => void;
  /** Clears the ceiling timer and the abort listener. */
  detach: () => void;
}

interface ForegroundEntry {
  readonly source: ForegroundActivitySource;
  busy: boolean;
  unsubscribe: () => void;
}

/** Thrown to a `whenClear` waiter whose signal fires first, or at dispose. */
function abortError(message: string): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

const ABORTED_MESSAGE = 'Aborted while waiting for background work to clear.';
const DISPOSED_MESSAGE =
  'Background-work governor disposed (host shutting down).';

/**
 * Registered as a lazily constructed singleton under
 * `TOKENS.BACKGROUND_WORK_GOVERNOR` in `registerVsCodeCorePlatformAgnostic`, so
 * every host has one. Constructing it starts nothing. Every host disposes it on
 * shutdown (through the diagnostics handle, or the CLI's own teardown when it
 * never armed diagnostics).
 */
export class BackgroundWorkGovernor implements BackgroundWorkSignal {
  private readonly foreground = new Set<ForegroundEntry>();
  private readonly listeners = new Set<BackgroundWorkStateListener>();
  private readonly waiters = new Set<ClearWaiter>();
  /** Lanes whose ceiling was already logged in the current deferral episode. */
  private readonly ceilingLoggedLanes = new Set<string>();
  private detachLag: (() => void) | undefined;
  private lagging = false;
  private enterStreak = 0;
  private exitStreak = 0;
  private current: BackgroundWorkState = 'clear';

  constructor(
    private readonly logger: Logger,
    private readonly timers: GovernorTimers = REAL_TIMERS,
  ) {}

  /** The derived state. */
  get state(): BackgroundWorkState {
    return this.current;
  }

  isClear(): boolean {
    return this.current === 'clear';
  }

  /**
   * Subscribe to state changes. Fires once per real transition, never for a
   * re-read that produced the same state. A throwing listener is logged and
   * does not stop the others.
   *
   * @returns An unsubscribe function.
   */
  onChange(listener: BackgroundWorkStateListener): () => void {
    if (this.current === 'disposed') return () => undefined;
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Resolve `'clear'` once the state is clear — immediately if it already is —
   * or `'timeout'` at the starvation ceiling, whichever comes first. Rejects
   * with an `AbortError` on abort and when the governor is (or becomes)
   * disposed.
   */
  whenClear(options: WhenClearOptions = {}): Promise<WhenClearOutcome> {
    const { signal } = options;
    const lane = options.lane ?? 'unnamed';
    if (this.current === 'disposed') {
      return Promise.reject(abortError(DISPOSED_MESSAGE));
    }
    if (signal?.aborted) return Promise.reject(abortError(ABORTED_MESSAGE));
    if (this.isClear()) return Promise.resolve('clear');

    const maxDeferMs =
      options.maxDeferMs !== undefined &&
      Number.isFinite(options.maxDeferMs) &&
      options.maxDeferMs > 0
        ? Math.floor(options.maxDeferMs)
        : DEFAULT_MAX_DEFER_MS;

    return new Promise<WhenClearOutcome>((resolve, reject) => {
      const waiter: ClearWaiter = {
        resolve,
        reject,
        detach: () => undefined,
      };
      let removeAbort: (() => void) | undefined;
      const timer = this.timers.setTimeout(() => {
        this.waiters.delete(waiter);
        waiter.detach();
        this.logCeilingOnce(lane, maxDeferMs);
        resolve('timeout');
      }, maxDeferMs);
      waiter.detach = () => {
        this.timers.clearTimeout(timer);
        if (removeAbort) removeAbort();
      };

      if (signal) {
        const onAbort = (): void => {
          this.waiters.delete(waiter);
          waiter.detach();
          reject(abortError(ABORTED_MESSAGE));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        removeAbort = () => signal.removeEventListener('abort', onAbort);
      }

      this.waiters.add(waiter);
    });
  }

  /**
   * Add a foreground signal. Read once now and again on each of its change
   * callbacks. A no-op after dispose.
   *
   * @returns A remover; the state is re-derived without the source.
   */
  addForegroundSource(source: ForegroundActivitySource): () => void {
    if (this.current === 'disposed') return () => undefined;
    const entry: ForegroundEntry = {
      source,
      busy: false,
      unsubscribe: () => undefined,
    };
    this.foreground.add(entry);
    entry.unsubscribe = source.onForegroundChange(() => {
      this.refreshForeground(entry);
    });
    this.refreshForeground(entry);
    return () => {
      if (!this.foreground.delete(entry)) return;
      entry.unsubscribe();
      this.recompute();
    };
  }

  /**
   * Feed event-loop samples into the lag hysteresis. One source at a time: a
   * second attach replaces the first, because two monitors would count each
   * window twice and halve both streak lengths. A no-op after dispose.
   *
   * @returns A detacher. Detaching clears the lag half of the state — with no
   *   samples arriving, nothing could ever end a `lagging` state.
   */
  attachLagSource(source: LagSampleSource): () => void {
    if (this.current === 'disposed') return () => undefined;
    this.detachLagSource();
    const unsubscribe = source.onSample((sample) => {
      this.handleSample(sample);
    });
    const detach = (): void => {
      if (this.detachLag !== detach) return;
      this.detachLag = undefined;
      unsubscribe();
      this.resetLag();
      this.recompute();
    };
    this.detachLag = detach;
    return detach;
  }

  /**
   * Shutdown. Terminal and idempotent: detaches every source, tells listeners
   * `'disposed'` (so an adopter cancels what it holds), then drops them, and
   * rejects every pending `whenClear` waiter with an `AbortError`.
   */
  dispose(): void {
    if (this.current === 'disposed') return;
    // First, so the detach below cannot re-derive `clear` and release waiters.
    this.current = 'disposed';
    this.detachLagSource();
    for (const entry of this.foreground) entry.unsubscribe();
    this.foreground.clear();
    this.resetLag();
    const pending = [...this.waiters];
    this.waiters.clear();
    for (const waiter of pending) {
      waiter.detach();
      waiter.reject(abortError(DISPOSED_MESSAGE));
    }
    this.notify('disposed');
    this.listeners.clear();
    this.ceilingLoggedLanes.clear();
  }

  private detachLagSource(): void {
    if (this.detachLag !== undefined) this.detachLag();
  }

  private logCeilingOnce(lane: string, maxDeferMs: number): void {
    if (this.ceilingLoggedLanes.has(lane)) return;
    this.ceilingLoggedLanes.add(lane);
    this.logger.warn(`${LOG_TAG} deferral ceiling reached — proceeding`, {
      lane,
      maxDeferMs,
      state: this.current,
    });
  }

  /**
   * Re-read one foreground source. A source that throws counts as NOT busy:
   * the governor fails open, the same rule adopters follow when the governor
   * itself is unavailable — a broken signal must not stall background work.
   */
  private refreshForeground(entry: ForegroundEntry): void {
    if (!this.foreground.has(entry)) return;
    let busy = false;
    try {
      busy = entry.source.isForegroundBusy();
    } catch (error: unknown) {
      this.logger.warn(
        `${LOG_TAG} foreground source threw — treating as idle`,
        {
          reason: error instanceof Error ? error.message : String(error),
        },
      );
    }
    entry.busy = busy;
    this.recompute();
  }

  private handleSample(sample: EventLoopLagSample): void {
    if (!this.lagging) {
      const frozen = sample.maxMs >= LAG_FREEZE_MAX_MS;
      this.enterStreak =
        sample.p99Ms > LAG_ENTER_P99_MS ? this.enterStreak + 1 : 0;
      if (!frozen && this.enterStreak < LAG_ENTER_WINDOWS) return;
      this.lagging = true;
      this.enterStreak = 0;
      this.exitStreak = 0;
      this.logger.info(`${LOG_TAG} lagging — deferring background work`, {
        p99Ms: sample.p99Ms,
        maxMs: sample.maxMs,
        trigger: frozen ? 'freeze' : 'sustained',
      });
    } else {
      this.exitStreak =
        sample.maxMs < LAG_EXIT_MAX_MS ? this.exitStreak + 1 : 0;
      if (this.exitStreak < LAG_EXIT_WINDOWS) return;
      this.resetLag();
      this.logger.info(`${LOG_TAG} lag cleared`, { maxMs: sample.maxMs });
    }
    this.recompute();
  }

  private resetLag(): void {
    this.lagging = false;
    this.enterStreak = 0;
    this.exitStreak = 0;
  }

  private recompute(): void {
    if (this.current === 'disposed') return;
    let foregroundBusy = false;
    for (const entry of this.foreground) {
      if (entry.busy) {
        foregroundBusy = true;
        break;
      }
    }
    const next: BackgroundWorkState = foregroundBusy
      ? 'foreground-busy'
      : this.lagging
        ? 'lagging'
        : 'clear';
    if (next === this.current) return;
    this.current = next;
    if (next === 'clear') {
      // The deferral episode is over: the next hold may log its ceiling again.
      this.ceilingLoggedLanes.clear();
      this.releaseWaiters();
    }
    this.notify(next);
  }

  private releaseWaiters(): void {
    const pending = [...this.waiters];
    this.waiters.clear();
    for (const waiter of pending) {
      waiter.detach();
      waiter.resolve('clear');
    }
  }

  private notify(state: BackgroundWorkState): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(state);
      } catch (error: unknown) {
        this.logger.warn(`${LOG_TAG} state listener threw`, {
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
