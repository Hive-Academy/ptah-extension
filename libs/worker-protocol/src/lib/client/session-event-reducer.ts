/**
 * Client-side session event reducer (plan W7 "Client", W8). Pure: no I/O, no
 * timers, no clock. The host feeds it parsed `evt` frames, connection and
 * attach outcomes, and sends each `session.attach` the reducer returns. The
 * host reads what to render through {@link sessionView}.
 *
 * Applying frames:
 *
 * - Apply only `seq === last + 1`. A frame with `seq <= last` is a duplicate
 *   (a replay overlaps live frames, or a superseded attach still streams) and
 *   is dropped.
 * - `worker:baseline` replaces the rendered view and applies past any gap:
 *   everything before it is superseded (W8). A baseline at or below `last`,
 *   such as one a superseded attach resends, is a duplicate like any frame.
 * - `worker:history-mark` advances `last` and leaves the view object as is.
 * - A frame past a gap is held (at most {@link MAX_HELD_FRAMES}) and applies
 *   as soon as the gap closes.
 * - A frame from another epoch, or `ctl resync-required`, means the tracked
 *   log is gone: the state resets.
 *
 * Recovery. `target` is the highest `seq` known to exist (frames seen, and
 * the `headSeq` of a successful attach). At most one attach is in charge of
 * reaching it, the current recovery, identified by a token:
 *
 * - A gap with no recovery requests a replay: `{ afterSeq: last, epoch }`.
 * - Held-frame overflow drops the held frames and requests a resync: a fresh
 *   attach with no `afterSeq`, which starts at the latest baseline.
 * - `connected` (a new connection, or the first attach) requests a fresh
 *   attach before the first frame or during a resync, otherwise a replay
 *   from `last`.
 * - Every request carries a new token and supersedes the one before it. The
 *   host reports the outcome with that token (`attach-succeeded`,
 *   `attach-failed`); an outcome whose token is not the current recovery's is
 *   stale and ignored. A failure of the current request retries it at once,
 *   at most {@link MAX_ATTACH_RETRIES} times in a row; then the recovery
 *   waits for the next `connected` (the reducer has no clock for backoff).
 *   Host contract: connection loss is reported as `connected` on the new
 *   socket, not as `attach-failed`; a host that retries on a timer itself
 *   reconnects and dispatches `connected`.
 * - The recovery ends only after its attach succeeded and the view reached
 *   `target` with nothing held. A frame that happens to fill `last + 1`
 *   meanwhile does not end it.
 * - An attach that succeeds with a snapshot (W8: no log, or another process
 *   drives the session) ends recovery at once: the view becomes that saved,
 *   non-live transcript (`source: 'snapshot'`) until a log streams again.
 * - After a snapshot, frames and `resync-required` are ignored until the next
 *   `connected`. Frames carry no attach identity (W1), so a late frame from
 *   an older attach on the same connection cannot be told apart from a new
 *   log; a new connection is the boundary, since the old streams end with
 *   the old socket.
 */

import type { FlatStreamEventUnion } from '@ptah-extension/shared';
import {
  BaselineRecordSchema,
  eventId,
  isSessionEventType,
  type EventFrame,
  type SessionEventType,
} from '../frames';
import type { WorkerMethodParams, WorkerMethodResult } from '../methods';

/** One rendered record after the baseline. */
export interface SessionRecord {
  /** `${epoch}:${seq}` (W1). */
  readonly id: string;
  readonly seq: number;
  readonly type: SessionEventType;
  readonly ts: number;
  readonly payload: unknown;
}

/**
 * Where the view comes from: `log` follows the worker's event log; `snapshot`
 * is a saved transcript an attach returned for a session it cannot stream
 * (not logged, or another process drives it). A snapshot never updates.
 *
 * Host contract: a snapshot is left only through a new connection. To refresh
 * it (for example after the driver lock is released), the host replaces the
 * socket and dispatches `connected` once the new socket is open; the reducer
 * then asks for a fresh attach. Frames on the old connection are ignored.
 */
export type SessionViewSource = 'log' | 'snapshot';

/** What the transcript shows: the latest baseline plus the records after it. */
export interface SessionView {
  readonly source: SessionViewSource;
  /** The baseline in use, or the snapshot's events. */
  readonly baseline: readonly FlatStreamEventUnion[];
  /** `seq` of the baseline in use; `null` before the first one and for a snapshot. */
  readonly baselineSeq: number | null;
  readonly records: readonly SessionRecord[];
}

/**
 * Append-only record list with O(1) amortised append. Successive states share
 * one backing array; each log owns only its first `length` entries, so an
 * older state never sees a record appended after it. Appending to a log that
 * is no longer the newest (two states branched from one) copies its prefix
 * first.
 */
export class SessionRecordLog {
  static readonly EMPTY = new SessionRecordLog([], 0);

  private constructor(
    private readonly entries: SessionRecord[],
    readonly length: number,
  ) {}

  append(record: SessionRecord): SessionRecordLog {
    const entries =
      this.length > 0 && this.entries.length === this.length
        ? this.entries
        : this.entries.slice(0, this.length);
    entries.push(record);
    return new SessionRecordLog(entries, this.length + 1);
  }

  /** A copy of this log's records. */
  toArray(): SessionRecord[] {
    return this.entries.slice(0, this.length);
  }
}

/** The rendered transcript in its internal form; read it with {@link sessionView}. */
export interface SessionTranscript {
  readonly source: SessionViewSource;
  readonly baseline: readonly FlatStreamEventUnion[];
  readonly baselineSeq: number | null;
  readonly records: SessionRecordLog;
}

/** The attach request in charge of reaching `target`. */
export interface SessionRecovery {
  /** `replay` resumes from `last`; `resync` is a fresh attach (no `afterSeq`). */
  readonly kind: 'replay' | 'resync';
  /** Identifies the request; outcomes carrying another token are stale. */
  readonly token: number;
  /** The attach call succeeded; its records are streaming in. */
  readonly settled: boolean;
  /** Failed attaches this recovery already retried in a row. */
  readonly retries: number;
}

export interface SessionEventState {
  readonly sessionId: string;
  /** Epoch of the log being followed; `null` until the first frame. */
  readonly epoch: string | null;
  /** Highest `seq` applied; 0 before any. */
  readonly last: number;
  /** Highest `seq` known to exist in this epoch; never below `last`. */
  readonly target: number;
  readonly transcript: SessionTranscript;
  /** Frames past a gap, ascending by `seq`, no duplicates. */
  readonly held: readonly EventFrame[];
  readonly recovery: SessionRecovery | null;
  /** Token the next request gets. Never reused within one state lineage. */
  readonly nextToken: number;
  /**
   * A snapshot is shown and nothing may replace it until the next
   * `connected`: event frames and `resync-required` are ignored.
   */
  readonly fenced: boolean;
}

export type SessionAttachRequest = WorkerMethodParams<'session.attach'>;
export type SessionAttachResult = WorkerMethodResult<'session.attach'>;

/** A `session.attach` to send, with the token its outcome must carry. */
export interface SessionAttachCommand {
  readonly token: number;
  readonly params: SessionAttachRequest;
}

export type SessionEventAction =
  | { readonly kind: 'event'; readonly frame: EventFrame }
  | { readonly kind: 'resync-required' }
  /** A connection to the worker opened (first attach or reconnect). */
  | { readonly kind: 'connected' }
  | {
      readonly kind: 'attach-succeeded';
      readonly token: number;
      readonly result: SessionAttachResult;
    }
  | { readonly kind: 'attach-failed'; readonly token: number };

export interface SessionEventStep {
  readonly state: SessionEventState;
  /** A `session.attach` the host should send now, or `null`. */
  readonly attach: SessionAttachCommand | null;
}

/**
 * Most frames held past a gap. Holding is only a shortcut (a replay resends
 * every record after `last`); beyond this the reducer drops the held frames
 * and resyncs from a fresh attach.
 */
export const MAX_HELD_FRAMES = 1_000;

/**
 * Most immediate retries of a failed attach. Bounds the loop a permanent
 * error (or a closed connection rejecting at once) would otherwise spin.
 */
export const MAX_ATTACH_RETRIES = 3;

const EMPTY_TRANSCRIPT: SessionTranscript = Object.freeze({
  source: 'log',
  baseline: Object.freeze([]) as readonly FlatStreamEventUnion[],
  baselineSeq: null,
  records: SessionRecordLog.EMPTY,
});

export function initialSessionEventState(sessionId: string): SessionEventState {
  return {
    sessionId,
    epoch: null,
    last: 0,
    target: 0,
    transcript: EMPTY_TRANSCRIPT,
    held: [],
    recovery: null,
    nextToken: 1,
    fenced: false,
  };
}

const views = new WeakMap<SessionTranscript, SessionView>();

/**
 * The view to render. Flattens the record log once per transcript: a state
 * whose transcript did not change (a history mark, a duplicate) returns the
 * same view object.
 */
export function sessionView(state: SessionEventState): SessionView {
  const { transcript } = state;
  const cached = views.get(transcript);
  if (cached !== undefined) {
    return cached;
  }
  const view: SessionView = {
    source: transcript.source,
    baseline: transcript.baseline,
    baselineSeq: transcript.baselineSeq,
    records: transcript.records.toArray(),
  };
  views.set(transcript, view);
  return view;
}

export function reduceSessionEvent(
  state: SessionEventState,
  action: SessionEventAction,
): SessionEventStep {
  switch (action.kind) {
    case 'resync-required':
      return state.fenced
        ? { state, attach: null }
        : requestRecovery(resetForNewLog(state, null, false), 'resync');
    case 'connected':
      // After a snapshot `epoch` is null, so this is a fresh attach.
      return requestRecovery(
        { ...state, fenced: false },
        state.epoch === null || state.recovery?.kind === 'resync'
          ? 'resync'
          : 'replay',
      );
    case 'attach-failed': {
      const attempt = currentAttempt(state, action.token);
      return attempt === null || attempt.retries >= MAX_ATTACH_RETRIES
        ? { state, attach: null }
        : requestRecovery(state, attempt.kind, attempt.retries + 1);
    }
    case 'attach-succeeded':
      return attachSucceeded(state, action.token, action.result);
    case 'event':
      return state.fenced
        ? { state, attach: null }
        : applyEvent(state, action.frame);
  }
}

// ---------------------------------------------------------------------------
// Internals.
// ---------------------------------------------------------------------------

/** The current recovery if `token` is its own and its call has not settled. */
function currentAttempt(
  state: SessionEventState,
  token: number,
): SessionRecovery | null {
  const { recovery } = state;
  return recovery !== null && recovery.token === token && !recovery.settled
    ? recovery
    : null;
}

function attachSucceeded(
  state: SessionEventState,
  token: number,
  result: SessionAttachResult,
): SessionEventStep {
  const attempt = currentAttempt(state, token);
  if (attempt === null) {
    return { state, attach: null };
  }
  if (result.mode === 'snapshot') {
    return { state: showSnapshot(state, result.events), attach: null };
  }
  // A log in another epoch is adopted when its first frame arrives.
  const head = result.epoch === state.epoch ? result.headSeq : state.target;
  return checkRecovery({
    ...state,
    target: Math.max(state.target, head),
    recovery: { ...attempt, settled: true },
  });
}

/**
 * The attach returned a saved transcript instead of a log: show it and stop
 * recovering, since no frame will follow. Sequence tracking starts over, so
 * the next `connected` asks for a fresh attach, and a log that streams later
 * (its baseline first) replaces the snapshot.
 */
function showSnapshot(
  state: SessionEventState,
  events: readonly FlatStreamEventUnion[],
): SessionEventState {
  return {
    ...resetForNewLog(state, null, false),
    fenced: true,
    transcript: {
      source: 'snapshot',
      baseline: events,
      baselineSeq: null,
      records: SessionRecordLog.EMPTY,
    },
  };
}

function applyEvent(
  state: SessionEventState,
  frame: EventFrame,
): SessionEventStep {
  if (frame.sessionId !== state.sessionId) {
    return { state, attach: null };
  }
  // First frame, or the worker's log for this session was recreated: the old
  // seq numbers mean nothing in the new epoch. A fresh attach in progress is
  // what brings a new epoch, so it stays in charge.
  const current =
    state.epoch === frame.epoch
      ? state
      : resetForNewLog(state, frame.epoch, state.recovery?.kind === 'resync');

  if (frame.seq <= current.last) {
    return { state: current, attach: null };
  }
  const seen = { ...current, target: Math.max(current.target, frame.seq) };
  if (frame.seq === seen.last + 1 || frame.type === 'worker:baseline') {
    return checkRecovery(drainHeld(applyFrame(seen, frame)));
  }
  return holdPastGap(seen, frame);
}

/** Start over for another log, keeping the token counter (and a resync, if asked). */
function resetForNewLog(
  state: SessionEventState,
  epoch: string | null,
  keepRecovery: boolean,
): SessionEventState {
  return {
    ...initialSessionEventState(state.sessionId),
    epoch,
    recovery: keepRecovery ? state.recovery : null,
    nextToken: state.nextToken,
  };
}

function holdPastGap(
  state: SessionEventState,
  frame: EventFrame,
): SessionEventStep {
  const held = insertHeld(state.held, frame);
  if (held.length > MAX_HELD_FRAMES) {
    // Holding more is not worth it: drop the held frames (`target` still
    // remembers them) and let a fresh attach fill the view from a baseline.
    const dropped = { ...state, held: [] };
    return state.recovery?.kind === 'resync'
      ? { state: dropped, attach: null }
      : requestRecovery(dropped, 'resync');
  }
  const next = { ...state, held };
  return state.recovery === null
    ? requestRecovery(next, 'replay')
    : { state: next, attach: null };
}

/** Send a new attach that supersedes any earlier one. */
function requestRecovery(
  state: SessionEventState,
  kind: SessionRecovery['kind'],
  retries = 0,
): SessionEventStep {
  const token = state.nextToken;
  const params: SessionAttachRequest =
    kind === 'resync' || state.epoch === null
      ? { sessionId: state.sessionId }
      : {
          sessionId: state.sessionId,
          afterSeq: state.last,
          epoch: state.epoch,
        };
  return {
    state: {
      ...state,
      recovery: { kind, token, settled: false, retries },
      nextToken: token + 1,
    },
    attach: { token, params },
  };
}

/**
 * End a recovery whose attach succeeded once the view reached `target` with
 * nothing held. Before that, keep it: its stream is still filling the view.
 */
function checkRecovery(state: SessionEventState): SessionEventStep {
  const { recovery } = state;
  const caughtUp = state.held.length === 0 && state.last >= state.target;
  if (recovery !== null && recovery.settled && caughtUp) {
    return { state: { ...state, recovery: null }, attach: null };
  }
  return { state, attach: null };
}

/** Insert keeping ascending `seq`; a second frame for a held `seq` is a duplicate. */
function insertHeld(
  held: readonly EventFrame[],
  frame: EventFrame,
): readonly EventFrame[] {
  let index = held.length;
  while (index > 0 && held[index - 1].seq > frame.seq) {
    index -= 1;
  }
  if (index > 0 && held[index - 1].seq === frame.seq) {
    return held;
  }
  return [...held.slice(0, index), frame, ...held.slice(index)];
}

/** Apply held frames that are now contiguous; drop the ones a baseline superseded. */
function drainHeld(state: SessionEventState): SessionEventState {
  let current = state;
  let index = 0;
  const held = state.held;
  while (index < held.length) {
    const next = held[index];
    if (next.seq <= current.last) {
      index += 1;
      continue;
    }
    if (next.seq === current.last + 1 || next.type === 'worker:baseline') {
      current = applyFrame(current, next);
      index += 1;
      continue;
    }
    break;
  }
  return index === 0 ? current : { ...current, held: held.slice(index) };
}

function applyFrame(
  state: SessionEventState,
  frame: EventFrame,
): SessionEventState {
  if (frame.type === 'worker:history-mark') {
    return { ...state, last: frame.seq };
  }
  if (frame.type === 'worker:baseline') {
    const baseline = BaselineRecordSchema.safeParse(frame.payload);
    if (!baseline.success) {
      // parseWorkerFrame closes the connection 4400 on a malformed baseline,
      // so only a hand-built frame reaches this. It still advances `last` so
      // the stream does not stall behind it, but it cannot replace the view.
      return { ...state, last: frame.seq };
    }
    return {
      ...state,
      last: frame.seq,
      transcript: {
        source: 'log',
        baseline: baseline.data.events,
        baselineSeq: frame.seq,
        records: SessionRecordLog.EMPTY,
      },
    };
  }
  if (!isSessionEventType(frame.type)) {
    // parseWorkerFrame refuses types outside SESSION_EVENT_TYPES; a hand-built
    // frame of another type keeps the sequence moving without rendering.
    return { ...state, last: frame.seq };
  }
  const record: SessionRecord = {
    id: eventId(frame.epoch, frame.seq),
    seq: frame.seq,
    type: frame.type,
    ts: frame.ts,
    payload: frame.payload,
  };
  return {
    ...state,
    last: frame.seq,
    transcript: {
      ...state.transcript,
      records: state.transcript.records.append(record),
    },
  };
}
