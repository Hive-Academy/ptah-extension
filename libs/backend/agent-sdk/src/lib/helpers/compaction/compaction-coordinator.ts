/**
 * CompactionCoordinator — the one owner of per-session compaction state
 * (TASK_2026_597 A8, component 21).
 *
 * The coordinator is a pure state machine: callers feed it the SDK events they
 * already see (context reading at turn end, PreCompact / PostCompact hooks,
 * `status: 'compacting'`, `compact_boundary`, turn end) and it answers with
 * the resulting state. It sends nothing to the SDK itself. A
 * coordinator-initiated compact is sent by the caller over the streamed
 * `/compact` path (`slash-command-interceptor.ts`: a `new-query` command
 * delivered through the session's input stream, no `endSession`).
 *
 * States and transitions: see {@link CompactionState}. Out-of-order events
 * (one the current state has no transition for) are ignored and reported as
 * `false` to the caller.
 *
 * - Dedupe: a manual `/compact` while TRIGGERED or COMPACTING is not resent;
 *   the caller shows {@link COMPACTION_ALREADY_RUNNING_MESSAGE}.
 * - Rebind: PostCompact may report a different `session_id`; the session's
 *   record moves to it, open dwell timer included.
 * - Dwell: an open compaction (TRIGGERED or COMPACTING) that sees no
 *   `compact_boundary` within {@link COMPACTION_MAX_DWELL_MS} goes to BACKOFF.
 * - OBSERVE_ONLY: never acts, never changes state, never dedupes.
 *
 * Every state change is emitted to subscribers after it is committed. A
 * subscriber that throws does not undo the change or stop the other
 * subscribers; its error is rethrown on a microtask so it still surfaces.
 *
 * Lifetime: one timer at most per session, cleared on leaving the open
 * states, on `unregister` and on `dispose`. `dispose` is synchronous and
 * idempotent; every call after it is a no-op.
 */
import {
  COMPACTION_ALREADY_RUNNING_MESSAGE,
  COMPACTION_ARM_RATIO,
  COMPACTION_MAX_DWELL_MS,
  CompactionState,
  type CompactionBoundaryTokens,
  type CompactionContextReading,
  type CompactionSessionClass,
  type CompactionStateChange,
  type CompactionStateListener,
  type CompactionTimerHandle,
  type CompactionTimers,
  type CompactionTransitionTrigger,
  type ManualCompactDecision,
  type PreCompactTrigger,
} from './compaction-state.types';

/** Process timers; unref'd so an open dwell timer never holds the process. */
const NODE_TIMERS: CompactionTimers = {
  setTimeout(callback, ms) {
    const handle = setTimeout(callback, ms);
    handle.unref?.();
    return handle;
  },
  clearTimeout(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

interface SessionRecord {
  sessionId: string;
  state: CompactionState;
  dwellTimer: CompactionTimerHandle | undefined;
}

/** True when the class may be acted on (not Codex proxy, E2 passed). */
function canAct(sessionClass: CompactionSessionClass): boolean {
  return !sessionClass.codexProxy && sessionClass.e2Passed === true;
}

function isOpen(state: CompactionState): boolean {
  return (
    state === CompactionState.TRIGGERED || state === CompactionState.COMPACTING
  );
}

export class CompactionCoordinator {
  private readonly timers: CompactionTimers;
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly listeners = new Set<CompactionStateListener>();
  private disposed = false;

  constructor(timers?: CompactionTimers) {
    this.timers = timers ?? NODE_TIMERS;
  }

  /**
   * Start tracking a session. Returns its initial state: IDLE when the class
   * may be acted on, OBSERVE_ONLY otherwise. Re-registering a session resets
   * it.
   */
  register(
    sessionId: string,
    sessionClass: CompactionSessionClass,
  ): CompactionState | undefined {
    if (this.disposed) return undefined;
    this.unregister(sessionId);
    const state = canAct(sessionClass)
      ? CompactionState.IDLE
      : CompactionState.OBSERVE_ONLY;
    this.sessions.set(sessionId, { sessionId, state, dwellTimer: undefined });
    return state;
  }

  /** Stop tracking a session and clear its timer. */
  unregister(sessionId: string): void {
    const record = this.sessions.get(sessionId);
    if (!record) return;
    this.clearDwell(record);
    this.sessions.delete(sessionId);
  }

  /** Current state, or `undefined` for an unknown session. */
  getState(sessionId: string): CompactionState | undefined {
    return this.sessions.get(sessionId)?.state;
  }

  /** Subscribe to state changes. Returns the unsubscribe function. */
  subscribe(listener: CompactionStateListener): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** True when the coordinator wants the caller to send a streamed `/compact`. */
  shouldInitiateCompact(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.state === CompactionState.ARMED;
  }

  /** IDLE → ARMED when the reading reaches the arm ratio of the window. */
  onContextUsage(
    sessionId: string,
    reading: CompactionContextReading,
  ): boolean {
    const record = this.sessions.get(sessionId);
    if (!record || record.state !== CompactionState.IDLE) return false;
    if (!(reading.maxTokens > 0)) return false;
    if (reading.totalTokens < reading.maxTokens * COMPACTION_ARM_RATIO) {
      return false;
    }
    this.transition(record, CompactionState.ARMED, 'threshold');
    return true;
  }

  /** IDLE or ARMED → TRIGGERED on PreCompact; starts the dwell timer. */
  onPreCompact(sessionId: string, trigger: PreCompactTrigger): boolean {
    const record = this.sessions.get(sessionId);
    if (
      !record ||
      (record.state !== CompactionState.IDLE &&
        record.state !== CompactionState.ARMED)
    ) {
      return false;
    }
    this.transition(record, CompactionState.TRIGGERED, trigger);
    this.startDwell(record);
    return true;
  }

  /** TRIGGERED → COMPACTING on `status: 'compacting'`. */
  onStatusCompacting(sessionId: string): boolean {
    const record = this.sessions.get(sessionId);
    if (!record || record.state !== CompactionState.TRIGGERED) return false;
    this.transition(record, CompactionState.COMPACTING, 'status-compacting');
    return true;
  }

  /**
   * TRIGGERED or COMPACTING → COOLDOWN on `compact_boundary`. TRIGGERED is
   * accepted too: the boundary is the proof the compaction finished, and a
   * missed status message must not end in a false BACKOFF.
   */
  onCompactBoundary(
    sessionId: string,
    tokens: CompactionBoundaryTokens,
  ): boolean {
    const record = this.sessions.get(sessionId);
    if (!record || !isOpen(record.state)) return false;
    this.clearDwell(record);
    this.transition(
      record,
      CompactionState.COOLDOWN,
      'compact-boundary',
      tokens.preTokens,
      tokens.postTokens,
    );
    return true;
  }

  /** COOLDOWN or BACKOFF → IDLE when a turn ends. */
  onTurnEnd(sessionId: string): boolean {
    const record = this.sessions.get(sessionId);
    if (
      !record ||
      (record.state !== CompactionState.COOLDOWN &&
        record.state !== CompactionState.BACKOFF)
    ) {
      return false;
    }
    this.transition(record, CompactionState.IDLE, 'turn-end');
    return true;
  }

  /**
   * Rebind on PostCompact: when the hook reports a different `session_id`,
   * the record (state and open timer) moves to it. A record already held
   * under the new id is replaced. Returns `true` when a rebind happened.
   */
  onPostCompact(sessionId: string, postCompactSessionId: string): boolean {
    if (!postCompactSessionId || postCompactSessionId === sessionId) {
      return false;
    }
    const record = this.sessions.get(sessionId);
    if (!record) return false;
    this.unregister(postCompactSessionId);
    this.sessions.delete(sessionId);
    record.sessionId = postCompactSessionId;
    this.sessions.set(postCompactSessionId, record);
    return true;
  }

  /**
   * Decide what to do with a manual `/compact`: dedupe while a compaction is
   * open (TRIGGERED or COMPACTING), send otherwise.
   */
  requestManualCompact(sessionId: string): ManualCompactDecision {
    const state = this.sessions.get(sessionId)?.state;
    if (state !== undefined && isOpen(state)) {
      return { action: 'deduped', message: COMPACTION_ALREADY_RUNNING_MESSAGE };
    }
    return { action: 'send' };
  }

  /** Clear every timer, session and subscriber. Synchronous and idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const record of this.sessions.values()) {
      this.clearDwell(record);
    }
    this.sessions.clear();
    this.listeners.clear();
  }

  private startDwell(record: SessionRecord): void {
    this.clearDwell(record);
    record.dwellTimer = this.timers.setTimeout(() => {
      record.dwellTimer = undefined;
      // The record may have been unregistered or replaced since the timer started.
      if (this.sessions.get(record.sessionId) !== record) return;
      if (!isOpen(record.state)) return;
      this.transition(record, CompactionState.BACKOFF, 'dwell-timeout');
    }, COMPACTION_MAX_DWELL_MS);
  }

  private clearDwell(record: SessionRecord): void {
    if (record.dwellTimer === undefined) return;
    this.timers.clearTimeout(record.dwellTimer);
    record.dwellTimer = undefined;
  }

  private transition(
    record: SessionRecord,
    to: CompactionState,
    trigger: CompactionTransitionTrigger,
    preTokens?: number,
    postTokens?: number,
  ): void {
    const from = record.state;
    record.state = to;
    const change: CompactionStateChange = {
      sessionId: record.sessionId,
      from,
      to,
      trigger,
      ...(preTokens !== undefined ? { preTokens } : {}),
      ...(postTokens !== undefined ? { postTokens } : {}),
    };
    for (const listener of [...this.listeners]) {
      try {
        listener(change);
      } catch (error) {
        // A subscriber failure must not undo a committed transition or skip
        // the other subscribers; rethrow it outside the machine instead.
        queueMicrotask(() => {
          throw error;
        });
      }
    }
  }
}
