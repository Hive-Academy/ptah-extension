/**
 * SessionTurnStateRegistry — the backend's single source of truth for
 * "is this session busy" (TASK_2026_360, plan §2.1).
 *
 * A pure in-memory reducer keyed by session id. No I/O, no timers. Every
 * returned state carries a fresh, per-session monotonic `revision`, so a
 * consumer can drop a replayed or duplicated event by comparing revisions.
 *
 * ## The revision is monotonic per SESSION ID, not per SDK query
 *
 * `revision` counts across every query that ever ran under one session id, and
 * that is load-bearing rather than incidental. The webview compares revisions
 * per SESSION (`TabManagerService.acceptsTurnState`) and accepts a restarted
 * counter only when the session id CHANGED — so a counter that restarted under
 * an UNCHANGED id is indistinguishable from a replay and gets dropped.
 *
 * `ChatStreamBroadcaster` deletes the record on every clean loop exit
 * (`turnState.clear`), and `chat:continue` → `autoResumeIfInactive` starts a
 * fresh SDK query under the SAME session id. Before this was per-session, that
 * resumed query emitted `generating@1` and terminal `idle@2` against a stored
 * baseline of 300-odd, so both were dropped before any side effect and the tab
 * kept `status: 'streaming'` for good — Stop button and streaming quotes on
 * forever while the backend sat idle (TASK_2026_371 D1).
 *
 * So `clear(sessionId)` deletes the RECORD but keeps a `revisionFloor`: the
 * last revision ever issued under that id. `ensure` seeds a fresh record from
 * that floor, which makes "the next commit is strictly greater than anything
 * ever emitted under this id" true by construction — the frontend guard's
 * assumption, satisfied here rather than loosened there. `chat:resume
 * --activate` and the rewind path restart a query under an existing id too, so
 * this closes them at the same time.
 *
 * The floor map is BOUNDED (`REVISION_FLOOR_MAP_LIMIT`), because this is a
 * long-lived Electron process and a map that only ever grows is a leak
 * whatever its retention rule.
 *
 * ## Why the Stop hook only snapshots
 *
 * The SDK dispatches the `Stop` hook from its transport read loop, BEFORE the
 * consumer has pulled the final `assistant` message of the same turn. Flipping
 * the phase from the hook would therefore race the chunks it describes. So the
 * hooks (`recordStop`, `recordFailure`) only stash a snapshot, and the phase
 * flips at `settleTurn`, which the stream transformer calls on the `result`
 * message — a position IN the chunk stream, where order is guaranteed.
 *
 * ## Alias
 *
 * A fresh session streams under its tabId until the SDK reports the real
 * UUID. `rekey` migrates the record. A hook can resolve its payload id first
 * and create the real-id entry (with a snapshot, at `idle@0`) while the stream
 * already committed `generating@1` under the tabId. So when both ids hold a
 * record, `rekey` MERGES them into the real-id entry instead of dropping one:
 * an in-flight `generating` (and its dedupe flag) wins from either side, the
 * real-id snapshots win over the placeholder's, and the revision baseline is
 * `max(placeholder, real)` — over both records AND both floors, since the real
 * id may have a floor from an earlier query whose record is already cleared —
 * so the next commit is strictly greater than anything already emitted under
 * either alias. It is wired to `SessionIdResolvedCallbackRegistry` in
 * `di/register.ts`.
 */
import { injectable } from 'tsyringe';
import type {
  SdkAssistantMessageError,
  SdkBackgroundTaskSummary,
  SdkSessionCronSummary,
  SdkTerminalReason,
  SessionTurnPhase,
  SessionTurnState,
  TurnStateEvent,
} from '@ptah-extension/shared';
import { generateEventId } from '../message-transform/message-transform-helpers';

/** What the `Stop` hook reports; consumed at `settleTurn`. */
export interface TurnStopSnapshot {
  readonly backgroundTasks: readonly SdkBackgroundTaskSummary[];
  readonly sessionCrons: readonly SdkSessionCronSummary[];
  readonly terminalReason: SdkTerminalReason | null;
}

/** What the `StopFailure` hook reports; consumed at `settleTurn`. */
export interface TurnFailureSnapshot {
  readonly error: SdkAssistantMessageError;
  readonly terminalReason: SdkTerminalReason | null;
}

interface TurnRecord {
  state: SessionTurnState;
  stopSnapshot: TurnStopSnapshot | null;
  failure: TurnFailureSnapshot | null;
  /** Dedupe: one 'generating' per turn, however many assistant messages. */
  generatingEmitted: boolean;
}

type TurnStateDraft = Omit<SessionTurnState, 'revision' | 'timestamp'>;

/**
 * Upper bound for the revision-floor map; the least-recently-written entry is
 * evicted. One entry is a session-id string plus a small integer, so the cap
 * costs tens of kilobytes. The cap stays: this is a long-lived Electron
 * process and a map that only ever grows is a leak.
 *
 * The number matches `SURFACE_REVISION_MAP_LIMIT` in the webview's
 * `TurnStateApplier`, but that is a coincidence and NOT a justification. That
 * map bounds `surfaceRevisions`, which is read only for events resolving no
 * tab and whose only effect is the sidebar dot. The consumer this floor exists
 * to stay ahead of is `tab.lastTurnStateRevision` on `TabState`, which has no
 * bound and no eviction at all.
 *
 * So eviction is NOT free. A floor is re-written on every commit, so the victim
 * is a session that has emitted nothing for the last 256 sessions' worth of
 * traffic — but that session's tab may still be open, inside this same running
 * process, still holding the high revision it last accepted. Losing the floor
 * restarts this counter under an id that consumer still remembers, and every
 * event of the next turn loses `revision > last`. That is TASK_2026_371 D1
 * again: a tab stuck on `status: 'streaming'` while the backend is idle.
 *
 * A process restart is a different event and does not have this problem: the
 * webview reloads and `lastTurnStateRevision` is excluded from persistence
 * (`libs/frontend/chat-state/src/lib/tab-persistence.ts`,
 * `projectTabForPersist`), so a restored tab starts at `undefined` and accepts
 * anything.
 *
 * The residual eviction gap is closed on the frontend, not here:
 * `TabManagerService.acceptsTurnState` accepts a TERMINAL phase on a bound tab
 * even at or below its last revision (TASK_2026_371). Change one half and read
 * the other.
 */
export const REVISION_FLOOR_MAP_LIMIT = 256;

/**
 * Wrap a state as the `turn_state` chunk-stream event. `messageId` is never
 * rendered; it only satisfies `FlatStreamEvent`.
 */
export function toTurnStateEvent(
  sessionId: string,
  state: SessionTurnState,
): TurnStateEvent {
  return {
    id: generateEventId(),
    eventType: 'turn_state',
    timestamp: state.timestamp,
    sessionId,
    source: 'complete',
    messageId: `turn-state-${sessionId}`,
    phase: state.phase,
    revision: state.revision,
    backgroundTasks: state.backgroundTasks,
    sessionCrons: state.sessionCrons,
    terminalReason: state.terminalReason,
    ...(state.error !== undefined ? { error: state.error } : {}),
  };
}

/**
 * Fold the placeholder record (`from`) into the canonical one (`to`) at
 * `rekey`. An in-flight `generating` wins from either side; otherwise the
 * canonical state is kept. Canonical snapshots win over the placeholder's.
 * The revision baseline is the max of both so the next `commit` is strictly
 * greater than anything already emitted under either alias. `rekey` raises that
 * baseline again against both ids' revision FLOORS before storing the result,
 * which is what extends the same guarantee over a query whose record `clear`
 * already removed.
 */
function mergeRecords(from: TurnRecord, to: TurnRecord): TurnRecord {
  const generating =
    to.state.phase === 'generating'
      ? to.state
      : from.state.phase === 'generating'
        ? from.state
        : null;
  const state = generating ?? to.state;
  const revision = Math.max(from.state.revision, to.state.revision);
  return {
    state: revision === state.revision ? state : { ...state, revision },
    stopSnapshot: to.stopSnapshot ?? from.stopSnapshot,
    failure: to.failure ?? from.failure,
    generatingEmitted:
      generating !== null || to.generatingEmitted || from.generatingEmitted,
  };
}

@injectable()
export class SessionTurnStateRegistry {
  private readonly records = new Map<string, TurnRecord>();
  /**
   * Last revision ISSUED under a session id, kept ACROSS `clear` — the floor a
   * fresh record is seeded from. See the "monotonic per SESSION ID" section of
   * the file header for why the record alone is not enough, and
   * `REVISION_FLOOR_MAP_LIMIT` for the bound.
   */
  private readonly revisionFloors = new Map<string, number>();

  /**
   * Root assistant `message_start`. Returns a NEW state on the first call of a
   * turn and `null` on every later call until the turn settles.
   *
   * Snapshots are deliberately NOT cleared here: a slow consumer can pull the
   * turn's first `message_start` after the SDK already fired `Stop` for it.
   */
  markGenerating(sessionId: string): SessionTurnState | null {
    const record = this.ensure(sessionId);
    if (record.generatingEmitted) {
      return null;
    }
    record.generatingEmitted = true;
    return this.commit(sessionId, record, {
      phase: 'generating',
      backgroundTasks: [],
      sessionCrons: [],
      terminalReason: null,
    });
  }

  /** `Stop` hook — snapshot only, no phase change. */
  recordStop(sessionId: string, snapshot: TurnStopSnapshot): void {
    this.ensure(sessionId).stopSnapshot = snapshot;
  }

  /** `StopFailure` hook — snapshot only, no phase change. */
  recordFailure(sessionId: string, failure: TurnFailureSnapshot): void {
    this.ensure(sessionId).failure = failure;
  }

  /**
   * `result` message — the turn boundary on the stream. Derives the terminal
   * phase from the snapshots, consumes them, and re-arms the generating dedupe.
   */
  settleTurn(sessionId: string): SessionTurnState {
    const record = this.ensure(sessionId);
    const stop = record.stopSnapshot;
    const failure = record.failure;
    const backgroundTasks = stop?.backgroundTasks ?? [];
    const sessionCrons = stop?.sessionCrons ?? [];

    const phase: SessionTurnPhase = failure
      ? 'failed'
      : backgroundTasks.length > 0
        ? 'awaiting-background'
        : sessionCrons.length > 0
          ? 'sleeping'
          : 'idle';

    record.stopSnapshot = null;
    record.failure = null;
    record.generatingEmitted = false;

    return this.commit(sessionId, record, {
      phase,
      backgroundTasks,
      sessionCrons,
      terminalReason: failure?.terminalReason ?? stop?.terminalReason ?? null,
      ...(failure ? { error: failure.error } : {}),
    });
  }

  /**
   * `SubagentStop` hook / `task_notification` while NOT generating: replace the
   * background-task list. `awaiting-background` with nothing left drops to
   * `sleeping` (crons pending) or `idle`; `idle` / `sleeping` with tasks
   * appearing rises to `awaiting-background`. Never touches `generating` and
   * never resurrects `failed`. Returns `null` when nothing was applied.
   */
  applySnapshot(
    sessionId: string,
    backgroundTasks: readonly SdkBackgroundTaskSummary[],
  ): SessionTurnState | null {
    const record = this.records.get(sessionId);
    if (!record || record.state.phase === 'generating') {
      return null;
    }
    const current = record.state;
    let phase = current.phase;
    if (phase === 'awaiting-background' && backgroundTasks.length === 0) {
      phase = current.sessionCrons.length > 0 ? 'sleeping' : 'idle';
    } else if (
      (phase === 'idle' || phase === 'sleeping') &&
      backgroundTasks.length > 0
    ) {
      phase = 'awaiting-background';
    }
    return this.commit(sessionId, record, {
      phase,
      backgroundTasks: [...backgroundTasks],
      sessionCrons: current.sessionCrons,
      terminalReason: current.terminalReason,
      ...(current.error !== undefined ? { error: current.error } : {}),
    });
  }

  /** Stream error / abort / session end. Drops every pending snapshot. */
  forceIdle(
    sessionId: string,
    terminalReason?: SdkTerminalReason,
  ): SessionTurnState {
    const record = this.ensure(sessionId);
    record.stopSnapshot = null;
    record.failure = null;
    record.generatingEmitted = false;
    return this.commit(sessionId, record, {
      phase: 'idle',
      backgroundTasks: [],
      sessionCrons: [],
      terminalReason: terminalReason ?? null,
    });
  }

  get(sessionId: string): SessionTurnState | undefined {
    return this.records.get(sessionId)?.state;
  }

  /**
   * Migrate a record from the placeholder id (tabId) to the real SDK UUID.
   * Synchronous. When `realId` already holds a record (a hook resolved its
   * payload id before the stream did), the two are merged into the real-id
   * entry — see the "Alias" section of the file header. The placeholder entry
   * is always deleted; a missing placeholder record moves no state.
   *
   * The revision FLOORS migrate too, and they migrate even when there is no
   * record to move: the placeholder's floor is always dropped (the alias is
   * dead) and folded into the real id's, so a revision the placeholder already
   * emitted cannot be re-issued under the canonical id after a `clear` took its
   * record away. The surviving baseline is the max of both floors and the
   * merged record's own revision — the real id may carry a floor from an
   * earlier query whose record `clear` already deleted — and it is written onto
   * the surviving record as well as the floor, so the record cannot sit below
   * its own id's floor.
   */
  rekey(placeholderId: string, realId: string): void {
    if (!placeholderId || !realId || placeholderId === realId) {
      return;
    }
    const placeholderFloor = this.revisionFloors.get(placeholderId) ?? 0;
    this.revisionFloors.delete(placeholderId);
    const from = this.records.get(placeholderId);
    if (from) {
      this.records.delete(placeholderId);
    }
    const to = this.records.get(realId);
    const merged = from ? (to ? mergeRecords(from, to) : from) : to;
    const baseline = Math.max(
      merged?.state.revision ?? 0,
      placeholderFloor,
      this.revisionFloors.get(realId) ?? 0,
    );
    if (merged) {
      this.records.set(
        realId,
        baseline === merged.state.revision
          ? merged
          : { ...merged, state: { ...merged.state, revision: baseline } },
      );
    }
    if (baseline > 0) {
      this.noteFloor(realId, baseline);
    }
  }

  /**
   * Forget the session's record. The revision FLOOR survives on purpose, so a
   * later query under the same id resumes the counter instead of restarting it
   * — see the "monotonic per SESSION ID" section of the file header.
   */
  clear(sessionId: string): void {
    this.records.delete(sessionId);
  }

  private ensure(sessionId: string): TurnRecord {
    let record = this.records.get(sessionId);
    if (!record) {
      record = {
        state: {
          phase: 'idle',
          // Seeded from the floor, not from 0: the next commit must beat every
          // revision ever emitted under this id, including a previous query's.
          revision: this.revisionFloors.get(sessionId) ?? 0,
          backgroundTasks: [],
          sessionCrons: [],
          terminalReason: null,
          timestamp: Date.now(),
        },
        stopSnapshot: null,
        failure: null,
        generatingEmitted: false,
      };
      this.records.set(sessionId, record);
    }
    return record;
  }

  private commit(
    sessionId: string,
    record: TurnRecord,
    draft: TurnStateDraft,
  ): SessionTurnState {
    const next: SessionTurnState = {
      ...draft,
      revision: record.state.revision + 1,
      timestamp: Date.now(),
    };
    record.state = next;
    this.noteFloor(sessionId, next.revision);
    return next;
  }

  /**
   * Raise the floor for `sessionId` and keep the map inside
   * `REVISION_FLOOR_MAP_LIMIT`. `Math.max` makes "a floor never goes down" a
   * local invariant rather than one inferred from the callers. The entry is
   * re-inserted (delete then set) so Map key order IS write recency, which
   * makes the eviction below drop the floor nobody has written for longest
   * instead of the oldest session still in use; re-inserting an existing key
   * also shrinks the map first, so an update can never evict anything.
   */
  private noteFloor(sessionId: string, revision: number): void {
    const next = Math.max(revision, this.revisionFloors.get(sessionId) ?? 0);
    this.revisionFloors.delete(sessionId);
    if (this.revisionFloors.size >= REVISION_FLOOR_MAP_LIMIT) {
      const oldest = this.revisionFloors.keys().next().value;
      if (oldest !== undefined) this.revisionFloors.delete(oldest);
    }
    this.revisionFloors.set(sessionId, next);
  }
}
