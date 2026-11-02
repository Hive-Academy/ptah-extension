/**
 * Client-side session event reducer (plan W7 "Client", W8). Pure: no I/O, no
 * timers, no clock. The host feeds it parsed `evt` frames and control signals
 * and acts on the `attach` request it returns.
 *
 * Rules:
 *
 * - Apply only `seq === last + 1`. A frame with `seq <= last` is a duplicate
 *   (a reconnect replays from the host's `afterSeq`, live frames can overlap
 *   the replay) and is dropped.
 * - A frame with `seq > last + 1` is a gap: the frame is held, and the reducer
 *   asks for a replay from `last` (`session.attach { afterSeq: last }`). One
 *   replay resends every record after `last`, so no second request is made
 *   while it is outstanding. Held frames apply as soon as the gap closes, so a
 *   replay plus live frames renders exactly what an unbroken stream would. If
 *   the host's attach call fails, it dispatches `replay-failed` and the
 *   reducer asks again from the current `last`.
 * - `worker:baseline` replaces the rendered view. A baseline with a higher
 *   `seq` than `last + 1` is applied at once: everything before it is
 *   superseded by it, so the gap before a baseline never needs a replay. This
 *   is also how a fresh attach starts (W8: attach with no `afterSeq` starts at
 *   the latest baseline's `seq`).
 * - `worker:history-mark` advances `last` and leaves the view object as is.
 * - A frame from a different epoch, or a `ctl resync-required`, means the log
 *   the client tracked is gone: the state resets. On `resync-required` the
 *   reducer asks for a fresh attach with no `afterSeq` (W7 epoch mismatch).
 */

import type { FlatStreamEventUnion } from '@ptah-extension/shared';
import {
  BaselineRecordSchema,
  eventId,
  isSessionEventType,
  type EventFrame,
  type SessionEventType,
} from '../frames';
import type { WorkerMethodParams } from '../methods';

/** One rendered record after the baseline. */
export interface SessionRecord {
  /** `${epoch}:${seq}` (W1). */
  readonly id: string;
  readonly seq: number;
  readonly type: SessionEventType;
  readonly ts: number;
  readonly payload: unknown;
}

/** What the transcript shows: the latest baseline plus the records after it. */
export interface SessionView {
  readonly baseline: readonly FlatStreamEventUnion[];
  /** `seq` of the baseline in use, or `null` before the first baseline. */
  readonly baselineSeq: number | null;
  readonly records: readonly SessionRecord[];
}

export interface SessionEventState {
  readonly sessionId: string;
  /** Epoch of the log being followed; `null` until the first frame. */
  readonly epoch: string | null;
  /** Highest `seq` applied; 0 before any. */
  readonly last: number;
  readonly view: SessionView;
  /** Frames past a gap, ascending by `seq`, no duplicates. */
  readonly held: readonly EventFrame[];
  /** `afterSeq` of the replay requested for the current gap, while it is outstanding. */
  readonly replayFrom: number | null;
}

export type SessionEventAction =
  | { readonly kind: 'event'; readonly frame: EventFrame }
  | { readonly kind: 'resync-required' }
  | { readonly kind: 'replay-failed' };

export type SessionAttachRequest = WorkerMethodParams<'session.attach'>;

export interface SessionEventStep {
  readonly state: SessionEventState;
  /** A `session.attach` the host should send now, or `null`. */
  readonly attach: SessionAttachRequest | null;
}

/**
 * Most frames held past a gap. Holding is only a shortcut (the replay resends
 * every record after `last`), so beyond this the held frames are dropped and
 * the outstanding replay fills the view.
 */
export const MAX_HELD_FRAMES = 1_000;

const EMPTY_VIEW: SessionView = Object.freeze({
  baseline: Object.freeze([]) as readonly FlatStreamEventUnion[],
  baselineSeq: null,
  records: Object.freeze([]) as readonly SessionRecord[],
});

export function initialSessionEventState(sessionId: string): SessionEventState {
  return {
    sessionId,
    epoch: null,
    last: 0,
    view: EMPTY_VIEW,
    held: [],
    replayFrom: null,
  };
}

/**
 * The `session.attach` params that resume this state after a reconnect:
 * `afterSeq` and `epoch` when a log is being followed, otherwise a fresh
 * attach.
 */
export function resumeAttachParams(
  state: SessionEventState,
): SessionAttachRequest {
  return state.epoch === null
    ? { sessionId: state.sessionId }
    : { sessionId: state.sessionId, afterSeq: state.last, epoch: state.epoch };
}

export function reduceSessionEvent(
  state: SessionEventState,
  action: SessionEventAction,
): SessionEventStep {
  if (action.kind === 'resync-required') {
    const reset = initialSessionEventState(state.sessionId);
    return { state: reset, attach: { sessionId: state.sessionId } };
  }

  if (action.kind === 'replay-failed') {
    if (state.replayFrom === null || state.epoch === null) {
      return { state, attach: null };
    }
    if (state.held.length === 0) {
      return { state: { ...state, replayFrom: null }, attach: null };
    }
    return requestReplay(state, state.epoch);
  }

  const { frame } = action;
  if (frame.sessionId !== state.sessionId) {
    return { state, attach: null };
  }

  let current = state;
  if (current.epoch !== frame.epoch) {
    // First frame, or the worker's log for this session was recreated: the
    // old seq numbers mean nothing in the new epoch.
    current = {
      ...initialSessionEventState(state.sessionId),
      epoch: frame.epoch,
    };
  }

  if (frame.seq <= current.last) {
    return { state: current, attach: null };
  }

  if (frame.seq === current.last + 1 || frame.type === 'worker:baseline') {
    const applied = applyFrame(current, frame);
    return { state: drainHeld(applied), attach: null };
  }

  return holdPastGap(current, frame);
}

// ---------------------------------------------------------------------------
// Internals.
// ---------------------------------------------------------------------------

function holdPastGap(
  state: SessionEventState,
  frame: EventFrame,
): SessionEventStep {
  const held = insertHeld(state.held, frame);
  const next = { ...state, held: held.length > MAX_HELD_FRAMES ? [] : held };
  if (state.replayFrom !== null) {
    return { state: next, attach: null };
  }
  return requestReplay(next, frame.epoch);
}

function requestReplay(
  state: SessionEventState,
  epoch: string,
): SessionEventStep {
  return {
    state: { ...state, replayFrom: state.last },
    attach: { sessionId: state.sessionId, afterSeq: state.last, epoch },
  };
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
  const remaining = index === 0 ? held : held.slice(index);
  return {
    ...current,
    held: remaining,
    // The gap closed when nothing is left waiting; a later gap asks again.
    replayFrom: remaining.length === 0 ? null : current.replayFrom,
  };
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
      view: {
        baseline: baseline.data.events,
        baselineSeq: frame.seq,
        records: [],
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
    view: { ...state.view, records: [...state.view.records, record] },
  };
}
