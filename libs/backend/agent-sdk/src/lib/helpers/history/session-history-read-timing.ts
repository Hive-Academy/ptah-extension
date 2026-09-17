/**
 * Slow-read attribution for `SessionHistoryReaderService.readSessionHistory`
 * (TASK_2026_437, C13).
 *
 * A resume was measured at 0.6–1.6 s of main-thread lag, but nothing said
 * whether that time went to reading and parsing the JSONL or to the
 * synchronous replay and projection that follows. This collaborator keeps the
 * phase clock for one read and, when the read took at least
 * `PTAH_HISTORY_SLOW_WARN_MS` (default 250), logs one
 * `[SessionHistoryReader] slow history read` line with the phase split.
 *
 * Contract:
 *  - Measurement only. It never throws into the reader: a throwing logger is
 *    swallowed, and every method is safe to call in any order.
 *  - A read that fails after its transcript loaded still reports, with
 *    `failed: true`, so the slowest reads (large or corrupt histories) are not
 *    the ones that go unattributed.
 *  - At most one line per session per minute. The table of sessions is capped;
 *    at the cap only the session slow least recently is evicted.
 *
 * Phases are disjoint. `readMs` runs from the start of the read to the moment
 * the transcript and agent sessions are loaded; `projectMs` is the synchronous
 * replay, stats and projection; `pricingMs` is the awaited pricing hydration
 * that runs between the two projection halves and is NOT included in
 * `projectMs`. `durationMs` also covers untimed bookkeeping between phases, so
 * `readMs + projectMs + pricingMs <= durationMs` rather than a strict partition.
 */
import type { Logger } from '@ptah-extension/vscode-core';
import { readMsEnv, roundMs } from '@ptah-extension/vscode-core';

export const SESSION_HISTORY_SLOW_WARN_MS_ENV = 'PTAH_HISTORY_SLOW_WARN_MS';

/**
 * 250 ms. A resume that slow is visible to the user, and the measured
 * `chat:resume` lag was 0.6–1.6 s (TASK_2026_437 context) — a lower bar would
 * log every ordinary resume and bury the ones that matter.
 */
export const DEFAULT_SESSION_HISTORY_SLOW_WARN_MS = 250;

/** At most one slow-read line per session per window. */
export const SESSION_HISTORY_SLOW_LOG_WINDOW_MS = 60_000;

/** Bound on remembered sessions for the rate limit. */
export const SESSION_HISTORY_SLOW_TABLE_MAX_ENTRIES = 128;

type TimedPhase = 'project' | 'pricing';

/** Phase clock for a single `readSessionHistory` call. */
export class HistoryReadStopwatch {
  private readonly startedAt: number;
  private readDoneAt: number | undefined;
  private projectMs = 0;
  private pricingMs = 0;
  private openPhase: TimedPhase | undefined;
  private phaseStartedAt = 0;
  private mainMessageCount = 0;
  private agentSessionCount = 0;
  private eventCount: number | undefined;
  private finished = false;

  constructor(
    private readonly owner: SessionHistoryReadTiming,
    private readonly sessionId: string,
  ) {
    this.startedAt = owner.now();
  }

  /** The transcript and agent sessions are loaded; the read phase is over. */
  readDone(mainMessageCount: number, agentSessionCount: number): void {
    this.readDoneAt = this.owner.now();
    this.mainMessageCount = mainMessageCount;
    this.agentSessionCount = agentSessionCount;
  }

  /** Start timing `phase`, closing any phase still open. */
  begin(phase: TimedPhase): void {
    this.closePhase();
    this.openPhase = phase;
    this.phaseStartedAt = this.owner.now();
  }

  /** Stop timing the open phase, if any. */
  end(): void {
    this.closePhase();
  }

  /** Record the replayed event count once it is known. */
  events(eventCount: number): void {
    this.eventCount = eventCount;
  }

  /**
   * Close the read and report it if slow. Idempotent — the first call wins, so
   * the reader can call it on success and again from its `catch`. A read that
   * never loaded its transcript has nothing to attribute and is not reported.
   */
  finish(failed: boolean): void {
    if (this.finished) return;
    this.finished = true;
    this.closePhase();
    if (this.readDoneAt === undefined) return;
    this.owner.report(this.sessionId, {
      durationMs: this.owner.now() - this.startedAt,
      readMs: this.readDoneAt - this.startedAt,
      projectMs: this.projectMs,
      pricingMs: this.pricingMs,
      mainMessageCount: this.mainMessageCount,
      agentSessionCount: this.agentSessionCount,
      eventCount: this.eventCount,
      failed,
    });
  }

  private closePhase(): void {
    if (this.openPhase === undefined) return;
    const elapsedMs = this.owner.now() - this.phaseStartedAt;
    if (this.openPhase === 'project') this.projectMs += elapsedMs;
    else this.pricingMs += elapsedMs;
    this.openPhase = undefined;
  }
}

/** Attribution fields for one finished read. */
export interface HistoryReadTimingReport {
  readonly durationMs: number;
  readonly readMs: number;
  readonly projectMs: number;
  readonly pricingMs: number;
  readonly mainMessageCount: number;
  readonly agentSessionCount: number;
  /** Absent when the read failed before replay produced events. */
  readonly eventCount: number | undefined;
  readonly failed: boolean;
}

export interface SessionHistoryReadTimingOptions {
  /** Log at or above this many ms. Defaults to the env var, then 250. */
  readonly thresholdMs?: number;
  /** Monotonic millisecond clock. Test seam; defaults to `performance.now`. */
  readonly now?: () => number;
}

/**
 * Owns the threshold and the per-session rate limit; hands out one
 * {@link HistoryReadStopwatch} per read.
 */
export class SessionHistoryReadTiming {
  readonly now: () => number;
  private readonly thresholdMs: number;
  /** sessionId → last slow-read line time, in least-recently-slow order. */
  private readonly loggedAt = new Map<string, number>();

  constructor(
    private readonly logger: Logger,
    options: SessionHistoryReadTimingOptions = {},
  ) {
    this.thresholdMs =
      options.thresholdMs ??
      readMsEnv(SESSION_HISTORY_SLOW_WARN_MS_ENV) ??
      DEFAULT_SESSION_HISTORY_SLOW_WARN_MS;
    this.now = options.now ?? (() => performance.now());
  }

  begin(sessionId: string): HistoryReadStopwatch {
    return new HistoryReadStopwatch(this, sessionId);
  }

  /** Called by {@link HistoryReadStopwatch.finish}. Cheap below threshold. */
  report(sessionId: string, timing: HistoryReadTimingReport): void {
    if (timing.durationMs < this.thresholdMs) return;
    const at = this.now();
    const last = this.loggedAt.get(sessionId);
    // Delete-then-set keeps Map insertion order = least recently slow first.
    this.loggedAt.delete(sessionId);
    if (last !== undefined && at - last < SESSION_HISTORY_SLOW_LOG_WINDOW_MS) {
      this.loggedAt.set(sessionId, last);
      return;
    }
    if (this.loggedAt.size >= SESSION_HISTORY_SLOW_TABLE_MAX_ENTRIES) {
      const oldest = this.loggedAt.keys().next();
      if (!oldest.done) this.loggedAt.delete(oldest.value);
    }
    this.loggedAt.set(sessionId, at);
    try {
      this.logger.warn('[SessionHistoryReader] slow history read', {
        sessionId,
        durationMs: roundMs(timing.durationMs),
        readMs: roundMs(timing.readMs),
        projectMs: roundMs(timing.projectMs),
        pricingMs: roundMs(timing.pricingMs),
        mainMessageCount: timing.mainMessageCount,
        agentSessionCount: timing.agentSessionCount,
        eventCount: timing.eventCount,
        failed: timing.failed,
      });
    } catch {
      // A diagnostics line must never fail a history read or replace its error.
    }
  }
}
