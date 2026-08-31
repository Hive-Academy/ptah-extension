/**
 * SessionTurnStateRegistry — the backend's single source of truth for
 * "is this session busy" (TASK_2026_360, plan §2.1).
 *
 * A pure in-memory reducer keyed by session id. No I/O, no timers. Every
 * returned state carries a fresh, per-session monotonic `revision`, so a
 * consumer can drop a replayed or duplicated event by comparing revisions.
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
 * `max(placeholder, real)` so the next commit is strictly greater than anything
 * already emitted under either alias. It is wired to
 * `SessionIdResolvedCallbackRegistry` in `di/register.ts`.
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
 * greater than anything already emitted under either alias.
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
    return this.commit(record, {
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

    return this.commit(record, {
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
    return this.commit(record, {
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
    return this.commit(record, {
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
   * is always deleted; a missing placeholder record is a no-op.
   */
  rekey(placeholderId: string, realId: string): void {
    if (!placeholderId || !realId || placeholderId === realId) {
      return;
    }
    const from = this.records.get(placeholderId);
    if (!from) {
      return;
    }
    this.records.delete(placeholderId);
    const to = this.records.get(realId);
    this.records.set(realId, to ? mergeRecords(from, to) : from);
  }

  clear(sessionId: string): void {
    this.records.delete(sessionId);
  }

  private ensure(sessionId: string): TurnRecord {
    let record = this.records.get(sessionId);
    if (!record) {
      record = {
        state: {
          phase: 'idle',
          revision: 0,
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

  private commit(record: TurnRecord, draft: TurnStateDraft): SessionTurnState {
    const next: SessionTurnState = {
      ...draft,
      revision: record.state.revision + 1,
      timestamp: Date.now(),
    };
    record.state = next;
    return next;
  }
}
