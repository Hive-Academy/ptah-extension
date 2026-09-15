/**
 * TurnStateForegroundSource — the background-work governor's foreground
 * signal over `SessionTurnStateRegistry` (TASK_2026_437 C14, INV-7).
 *
 * Busy while any session is `generating`, EXCEPT a record that has been
 * generating longer than {@link STALE_GENERATING_CEILING_MS}. Such a record is
 * almost certainly one whose teardown never ran (`forceIdle` / `settleTurn`
 * missed), and the registry's LRU bound only evicts it after 256 other session
 * ids — in single-tab use, never. Counted as busy, it would hold every
 * background lane to its 10-minute deferral ceiling for the life of the
 * process. It is ignored FOR THIS SIGNAL ONLY: turn state is not touched, and
 * one warn line names it.
 *
 * **The age is measured from the turn's START** (`since`, the `generating`
 * commit), not from its last activity: the registry records no per-chunk
 * timestamp. So a LEGITIMATE turn that runs past 60 min also stops counting —
 * background lanes resume beside it for the rest of that turn. Nothing in this
 * codebase bounds a turn's length, so that is a real (if rare) case, accepted
 * because the alternative is a leaked record starving background work forever.
 *
 * The registry notifies only on turn transitions, and nothing transitions when
 * a record goes stale, so this source arms one `unref()`-ed timer for the
 * earliest stale deadline and notifies its listeners when it fires. The timer
 * lives only while someone is subscribed.
 */
import type {
  ForegroundActivitySource,
  Logger,
} from '@ptah-extension/vscode-core';
import type { GeneratingSession } from './session-turn-state.registry';

/**
 * 60 min from turn start. Long past an ordinary agentic turn (minutes), short
 * enough that a leaked record stops starving background work within the
 * session. A real turn longer than this is not background-gated for its
 * remainder — see the file header.
 */
export const STALE_GENERATING_CEILING_MS = 60 * 60_000;

/** The registry surface this source reads. */
export interface GeneratingSessionsSource {
  generatingSessions(): readonly GeneratingSession[];
  onGeneratingChange(listener: () => void): () => void;
}

/** Clock seam, so the spec drives the ceiling without real time. */
export interface ForegroundSourceClock {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const REAL_CLOCK: ForegroundSourceClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => {
    const handle = setTimeout(callback, ms);
    // A diagnostics-adjacent timer is never the reason a process stays alive.
    handle.unref();
    return handle;
  },
  clearTimeout: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

const LOG_TAG = '[TurnStateForegroundSource]';

export class TurnStateForegroundSource implements ForegroundActivitySource {
  private readonly listeners = new Set<() => void>();
  /** `sessionId@since` of stale records already warned about. */
  private readonly warnedStale = new Set<string>();
  private unsubscribeRegistry: (() => void) | undefined;
  private staleTimer: unknown;

  constructor(
    private readonly registry: GeneratingSessionsSource,
    private readonly logger: Logger,
    private readonly clock: ForegroundSourceClock = REAL_CLOCK,
    private readonly staleCeilingMs: number = STALE_GENERATING_CEILING_MS,
  ) {}

  /**
   * True while a session has been generating for less than the stale ceiling.
   * Also (re)arms the stale-deadline timer for the youngest-to-expire record.
   */
  isForegroundBusy(): boolean {
    const now = this.clock.now();
    const current = new Set<string>();
    let nextStaleAt = Number.POSITIVE_INFINITY;
    for (const { sessionId, since } of this.registry.generatingSessions()) {
      const staleAt = since + this.staleCeilingMs;
      if (now < staleAt) {
        nextStaleAt = Math.min(nextStaleAt, staleAt);
        continue;
      }
      const key = `${sessionId}@${since}`;
      current.add(key);
      if (!this.warnedStale.has(key)) {
        this.warnedStale.add(key);
        this.logger.warn(
          `${LOG_TAG} session generating past the stale ceiling — no longer holding background work`,
          {
            sessionId,
            generatingForMs: now - since,
            staleCeilingMs: this.staleCeilingMs,
          },
        );
      }
    }
    // Forget records that settled or were evicted, so the set stays bounded.
    for (const key of this.warnedStale) {
      if (!current.has(key)) this.warnedStale.delete(key);
    }
    const busy = Number.isFinite(nextStaleAt);
    this.armStaleTimer(busy ? nextStaleAt - now : null);
    return busy;
  }

  onForegroundChange(listener: () => void): () => void {
    this.listeners.add(listener);
    if (this.unsubscribeRegistry === undefined) {
      this.unsubscribeRegistry = this.registry.onGeneratingChange(() => {
        this.notify();
      });
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size > 0) return;
      this.unsubscribeRegistry?.();
      this.unsubscribeRegistry = undefined;
      this.armStaleTimer(null);
    };
  }

  private armStaleTimer(delayMs: number | null): void {
    if (this.staleTimer !== undefined) {
      this.clock.clearTimeout(this.staleTimer);
      this.staleTimer = undefined;
    }
    if (delayMs === null || this.listeners.size === 0) return;
    this.staleTimer = this.clock.setTimeout(() => {
      this.staleTimer = undefined;
      this.notify();
    }, delayMs);
  }

  /**
   * Fan out, isolated per listener. Runs inside the registry's turn
   * transitions, so a throw here must never reach them.
   */
  private notify(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error: unknown) {
        this.logger.warn(`${LOG_TAG} foreground listener threw`, {
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
