import type { EventFrame } from '../frames';
import {
  MAX_ATTACH_RETRIES,
  MAX_HELD_FRAMES,
  initialSessionEventState,
  reduceSessionEvent,
  sessionView,
  type SessionAttachCommand,
  type SessionAttachRequest,
  type SessionEventAction,
  type SessionEventState,
} from './session-event-reducer';

const SESSION = 's-1';

function historyEvent(id: string) {
  return {
    id,
    eventType: 'text_delta' as const,
    timestamp: 1_700_000_000_000,
    sessionId: SESSION,
    messageId: 'm-1',
    delta: id,
    blockIndex: 0,
  };
}

function frame(
  seq: number,
  type = 'chat:chunk',
  payload: unknown = { text: `chunk-${seq}` },
  epoch = 'e-1',
): EventFrame {
  return {
    v: 1,
    kind: 'evt',
    sessionId: SESSION,
    epoch,
    seq,
    type,
    ts: seq,
    payload,
  };
}

function baseline(seq: number, ids: string[], epoch = 'e-1'): EventFrame {
  return frame(
    seq,
    'worker:baseline',
    {
      events: ids.map(historyEvent),
      historyMark: {
        count: ids.length,
        lastEventId: ids[ids.length - 1] ?? null,
      },
    },
    epoch,
  );
}

function historyMark(seq: number, epoch = 'e-1'): EventFrame {
  return frame(
    seq,
    'worker:history-mark',
    { historyMark: { count: 3, lastEventId: 'h-3' }, turnId: 't-1' },
    epoch,
  );
}

/** Feed frames one by one; collect every attach the reducer asks for. */
function run(
  frames: EventFrame[],
  start: SessionEventState = initialSessionEventState(SESSION),
): {
  state: SessionEventState;
  attaches: SessionAttachRequest[];
  commands: SessionAttachCommand[];
} {
  let state = start;
  const commands: SessionAttachCommand[] = [];
  for (const f of frames) {
    const step = reduceSessionEvent(state, { kind: 'event', frame: f });
    state = step.state;
    if (step.attach !== null) {
      commands.push(step.attach);
    }
  }
  return { state, attaches: commands.map((c) => c.params), commands };
}

function dispatch(state: SessionEventState, action: SessionEventAction) {
  return reduceSessionEvent(state, action);
}

/** Token of the recovery in charge; fails the test when there is none. */
function currentToken(state: SessionEventState): number {
  if (state.recovery === null) {
    throw new Error('expected a recovery in progress');
  }
  return state.recovery.token;
}

function succeeded(state: SessionEventState, headSeq: number, epoch = 'e-1') {
  return dispatch(state, {
    kind: 'attach-succeeded',
    token: currentToken(state),
    result: { mode: 'log', epoch, fromSeq: 1, headSeq },
  });
}

function renderedSeqs(state: SessionEventState): number[] {
  return sessionView(state).records.map((r) => r.seq);
}

describe('SessionEventReducer in-order apply', () => {
  it('applies seq === last + 1 and renders a record with the W1 event id', () => {
    const { state, attaches } = run([baseline(1, ['h-1']), frame(2), frame(3)]);
    expect(state.last).toBe(3);
    expect(attaches).toEqual([]);
    expect(sessionView(state).baseline.map((e) => e.id)).toEqual(['h-1']);
    expect(sessionView(state).records).toEqual([
      {
        id: 'e-1:2',
        seq: 2,
        type: 'chat:chunk',
        ts: 2,
        payload: { text: 'chunk-2' },
      },
      {
        id: 'e-1:3',
        seq: 3,
        type: 'chat:chunk',
        ts: 3,
        payload: { text: 'chunk-3' },
      },
    ]);
  });

  it('ignores a frame for another session', () => {
    const start = run([baseline(1, [])]).state;
    const step = dispatch(start, {
      kind: 'event',
      frame: { ...frame(2), sessionId: 'other' },
    });
    expect(step.state).toBe(start);
    expect(step.attach).toBeNull();
  });
});

describe('SessionEventReducer duplicates across reconnect', () => {
  it('drops frames with seq <= last that a reconnect replay resends', () => {
    const before = run([
      baseline(1, ['h-1']),
      frame(2),
      frame(3),
      frame(4),
    ]).state;
    // Reconnect: attach { afterSeq: 2 } replays 3, 4 and then 5 arrives live.
    const after = run([frame(3), frame(4), frame(5)], before);

    expect(after.attaches).toEqual([]);
    expect(renderedSeqs(after.state)).toEqual([2, 3, 4, 5]);
    expect(after.state.last).toBe(5);
  });

  it('drops a duplicate of a held frame', () => {
    const start = run([baseline(1, [])]).state;
    const { state } = run([frame(4), frame(4)], start);
    expect(state.held.map((f) => f.seq)).toEqual([4]);
  });
});

describe('SessionEventReducer gap → replay request', () => {
  it('holds frames past a gap and asks once for a replay from last', () => {
    const start = run([baseline(1, []), frame(2)]).state;
    const { state, attaches } = run([frame(5), frame(6)], start);

    expect(attaches).toEqual([
      { sessionId: SESSION, afterSeq: 2, epoch: 'e-1' },
    ]);
    expect(state.last).toBe(2);
    expect(state.held.map((f) => f.seq)).toEqual([5, 6]);
    expect(renderedSeqs(state)).toEqual([2]);
  });

  it('applies the held frames once the replay fills the gap', () => {
    const start = run([baseline(1, []), frame(2), frame(5), frame(6)]).state;
    const { state, attaches } = run([frame(3), frame(4), frame(5)], start);

    expect(attaches).toEqual([]);
    expect(state.last).toBe(6);
    expect(state.held).toEqual([]);
    expect(renderedSeqs(state)).toEqual([2, 3, 4, 5, 6]);
    // The replay ends once its attach succeeded and the view reached its head.
    expect(state.recovery).toMatchObject({ kind: 'replay', settled: false });
    expect(succeeded(state, 6).state.recovery).toBeNull();
  });

  it('keeps the replay until the view reaches the attach head', () => {
    const start = run([baseline(1, []), frame(2), frame(5)]).state;
    const settled = succeeded(start, 8).state;
    expect(settled.recovery).toMatchObject({ settled: true });
    const filled = run([frame(3), frame(4), frame(6), frame(7)], settled);
    expect(filled.state.recovery).not.toBeNull();
    expect(run([frame(8)], filled.state).state.recovery).toBeNull();
  });

  it('does not ask again while a replay is outstanding, even as last advances', () => {
    const start = run([baseline(1, []), frame(2), frame(6)]).state;
    // Replay starts streaming (3), and a new live frame (7) arrives past the gap.
    const { attaches } = run([frame(3), frame(7)], start);
    expect(attaches).toEqual([]);
  });

  it('asks again from the current last with a new token after attach-failed', () => {
    const start = run([baseline(1, []), frame(2), frame(6), frame(3)]).state;
    const token = currentToken(start);
    const step = dispatch(start, { kind: 'attach-failed', token });
    expect(step.attach).toEqual({
      token: token + 1,
      params: { sessionId: SESSION, afterSeq: 3, epoch: 'e-1' },
    });
    expect(step.state.recovery).toEqual({
      kind: 'replay',
      token: token + 1,
      settled: false,
      retries: 1,
    });
  });

  it('stops retrying after MAX_ATTACH_RETRIES failures in a row until the next connected', () => {
    let state = run([baseline(1, []), frame(2), frame(6)]).state;
    const sent: number[] = [];
    for (let i = 0; i <= MAX_ATTACH_RETRIES; i++) {
      const step = dispatch(state, {
        kind: 'attach-failed',
        token: currentToken(state),
      });
      state = step.state;
      if (step.attach) sent.push(step.attach.token);
    }
    expect(sent).toHaveLength(MAX_ATTACH_RETRIES);
    // A further gap does not restart it; the recovery is still in charge.
    expect(run([frame(8)], state).attaches).toEqual([]);
    const reconnected = dispatch(state, { kind: 'connected' });
    expect(reconnected.attach?.params).toEqual({
      sessionId: SESSION,
      afterSeq: 2,
      epoch: 'e-1',
    });
    expect(reconnected.state.recovery).toMatchObject({ retries: 0 });
  });

  it('ignores a failure or success that carries a stale token', () => {
    const start = run([baseline(1, []), frame(2), frame(6)]).state;
    const token = currentToken(start);
    const retried = dispatch(start, { kind: 'attach-failed', token }).state;

    const staleFailure = dispatch(retried, { kind: 'attach-failed', token });
    expect(staleFailure.attach).toBeNull();
    expect(staleFailure.state).toBe(retried);

    const staleSuccess = dispatch(retried, {
      kind: 'attach-succeeded',
      token,
      result: { mode: 'log', epoch: 'e-1', fromSeq: 3, headSeq: 6 },
    });
    expect(staleSuccess.state).toBe(retried);
  });

  it('asks for a replay from 0 when a fresh attach starts past seq 1 without a baseline', () => {
    const { state, attaches } = run([frame(3)]);
    expect(attaches).toEqual([
      { sessionId: SESSION, afterSeq: 0, epoch: 'e-1' },
    ]);
    expect(state.epoch).toBe('e-1');
  });
});

describe('SessionEventReducer held-frame overflow → resync', () => {
  /** Baseline at 1, then MAX_HELD_FRAMES + 1 frames past a gap at 2: 3..1003. */
  function overflowed() {
    const start = run([baseline(1, ['h-1'])]).state;
    const frames = Array.from({ length: MAX_HELD_FRAMES + 1 }, (_, i) =>
      frame(i + 3),
    );
    return run(frames, start);
  }

  it('drops the held frames and asks once for a fresh attach that supersedes the replay', () => {
    const { state, commands } = overflowed();
    expect(commands).toEqual([
      { token: 1, params: { sessionId: SESSION, afterSeq: 1, epoch: 'e-1' } },
      { token: 2, params: { sessionId: SESSION } },
    ]);
    expect(state.held).toEqual([]);
    expect(state.recovery).toEqual({
      kind: 'resync',
      token: 2,
      settled: false,
      retries: 0,
    });
    expect(state.target).toBe(1_003);
    expect(state.last).toBe(1);
  });

  it('asks for no second fresh attach while the resync is outstanding', () => {
    const start = overflowed().state;
    const more = Array.from({ length: MAX_HELD_FRAMES + 1 }, (_, i) =>
      frame(i + 2_000),
    );
    const { state, attaches } = run(more, start);
    expect(attaches).toEqual([]);
    expect(state.recovery).toMatchObject({ kind: 'resync', token: 2 });
    expect(state.held).toEqual([]);
  });

  it('ignores a late failure of the superseded replay (no second attach)', () => {
    const start = overflowed().state;
    const stale = dispatch(start, { kind: 'attach-failed', token: 1 });
    expect(stale.attach).toBeNull();
    expect(stale.state).toBe(start);

    const current = dispatch(stale.state, { kind: 'attach-failed', token: 2 });
    expect(current.attach).toEqual({
      token: 3,
      params: { sessionId: SESSION },
    });
    // The retried attach's own late duplicate failure retries nothing more.
    expect(
      dispatch(current.state, { kind: 'attach-failed', token: 2 }).attach,
    ).toBeNull();
  });

  it('stays in resync when a contiguous live frame arrives, and retries a failed fresh attach (regression)', () => {
    const start = overflowed().state;
    const live = run([frame(2)], start);
    expect(live.attaches).toEqual([]);
    expect(live.state.last).toBe(2);
    expect(live.state.recovery).toMatchObject({ kind: 'resync', token: 2 });

    const failed = dispatch(live.state, { kind: 'attach-failed', token: 2 });
    expect(failed.attach).toEqual({ token: 3, params: { sessionId: SESSION } });
  });

  it('asks for a fresh attach, not a replay from last, on reconnect during the resync (regression)', () => {
    const live = run([frame(2)], overflowed().state).state;
    const step = dispatch(live, { kind: 'connected' });
    expect(step.attach).toEqual({ token: 3, params: { sessionId: SESSION } });
    // The attach on the dropped connection fails afterwards: stale, ignored.
    expect(
      dispatch(step.state, { kind: 'attach-failed', token: 2 }).attach,
    ).toBeNull();
  });

  it('ends the resync once the fresh attach succeeded and the view reached its head', () => {
    const start = overflowed().state;
    const settled = succeeded(start, 1_101).state;
    expect(settled.recovery).toMatchObject({ kind: 'resync', settled: true });

    const { state, attaches } = run(
      [baseline(1_100, ['h-1', 'h-2']), frame(1_101)],
      settled,
    );
    expect(attaches).toEqual([]);
    expect(state.recovery).toBeNull();
    expect(state.last).toBe(1_101);
    expect(sessionView(state).baselineSeq).toBe(1_100);
    expect(renderedSeqs(state)).toEqual([1_101]);
  });

  it('keeps the resync until the dropped frames are covered when the baseline is older', () => {
    // The latest baseline is the one at 1: the fresh attach resends 2..1003.
    const settled = succeeded(overflowed().state, 1_003).state;
    const replayed = Array.from({ length: 1_002 }, (_, i) => frame(i + 2));
    const partial = run(
      [baseline(1, ['h-1']), ...replayed.slice(0, 500)],
      settled,
    );
    expect(partial.state.recovery).not.toBeNull();
    const done = run(replayed.slice(500), partial.state);
    expect(done.state.recovery).toBeNull();
    expect(done.state.last).toBe(1_003);
    expect(done.attaches).toEqual([]);
  });

  it('drops a stale baseline at or below last that a superseded attach resends', () => {
    const live = run([frame(2)], overflowed().state).state;
    const before = sessionView(live);
    const { state } = run([baseline(1, ['stale'])], live);
    expect(state).toBe(live);
    expect(sessionView(state)).toBe(before);
  });

  it('holds live frames during the resync and applies them after the baseline', () => {
    const start = overflowed().state;
    const { state, attaches } = run(
      [frame(1_102), frame(1_103), baseline(1_100, ['h-1']), frame(1_101)],
      start,
    );
    expect(attaches).toEqual([]);
    expect(state.last).toBe(1_103);
    expect(state.held).toEqual([]);
    expect(renderedSeqs(state)).toEqual([1_101, 1_102, 1_103]);
    expect(succeeded(state, 1_103).state.recovery).toBeNull();
  });
});

describe('SessionEventReducer connect', () => {
  it('asks for a fresh attach before the first frame', () => {
    const step = dispatch(initialSessionEventState(SESSION), {
      kind: 'connected',
    });
    expect(step.attach).toEqual({ token: 1, params: { sessionId: SESSION } });
    expect(step.state.recovery).toEqual({
      kind: 'resync',
      token: 1,
      settled: false,
      retries: 0,
    });
  });

  it('retries a failed resume from last, then ends once caught up', () => {
    const start = run([baseline(1, []), frame(2)]).state;
    const resumed = dispatch(start, { kind: 'connected' });
    const failed = dispatch(resumed.state, {
      kind: 'attach-failed',
      token: currentToken(resumed.state),
    });
    expect(failed.attach?.params).toEqual({
      sessionId: SESSION,
      afterSeq: 2,
      epoch: 'e-1',
    });
    const caughtUp = succeeded(failed.state, 2).state;
    expect(caughtUp.recovery).toBeNull();
    // A later gap asks for a replay again.
    expect(run([frame(4)], caughtUp).attaches).toEqual([
      { sessionId: SESSION, afterSeq: 2, epoch: 'e-1' },
    ]);
  });
});

describe('SessionEventReducer snapshot attach', () => {
  function snapshot(state: SessionEventState, ids: string[], token?: number) {
    return dispatch(state, {
      kind: 'attach-succeeded',
      token: token ?? currentToken(state),
      result: {
        mode: 'snapshot',
        events: ids.map(historyEvent),
        live: false,
      },
    });
  }

  it('shows a snapshot returned by the first attach as a non-live view', () => {
    const connected = dispatch(initialSessionEventState(SESSION), {
      kind: 'connected',
    }).state;
    const step = snapshot(connected, ['s-1', 's-2']);

    expect(step.attach).toBeNull();
    expect(step.state.recovery).toBeNull();
    expect(sessionView(step.state)).toEqual({
      source: 'snapshot',
      baseline: ['s-1', 's-2'].map(historyEvent),
      baselineSeq: null,
      records: [],
    });
  });

  it('ends a resync after overflow with the snapshot as the view (regression)', () => {
    const start = run([baseline(1, ['h-1'])]).state;
    const overflow = run(
      Array.from({ length: MAX_HELD_FRAMES + 1 }, (_, i) => frame(i + 3)),
      start,
    ).state;
    expect(overflow.target).toBe(1_003);

    const { state } = snapshot(overflow, ['saved']);
    expect(state.recovery).toBeNull();
    expect(state.held).toEqual([]);
    expect(state.target).toBe(0);
    expect(state.last).toBe(0);
    expect(sessionView(state).source).toBe('snapshot');
    expect(sessionView(state).baseline.map((e) => e.id)).toEqual(['saved']);
  });

  it('ignores a snapshot whose token is stale', () => {
    const start = run([baseline(1, ['h-1']), frame(2), frame(4)]).state;
    const stale = currentToken(start);
    const retried = dispatch(start, {
      kind: 'attach-failed',
      token: stale,
    }).state;

    const step = snapshot(retried, ['saved'], stale);
    expect(step.state).toBe(retried);
    expect(sessionView(step.state).source).toBe('log');
  });

  /** Overflow at last=1 (replay token 1, resync token 2), then a snapshot for token 2. */
  function snapshotAfterOverflow() {
    const start = run([baseline(1, ['h-1'])]).state;
    const overflow = run(
      Array.from({ length: MAX_HELD_FRAMES + 1 }, (_, i) => frame(i + 3)),
      start,
    ).state;
    return snapshot(overflow, ['saved']).state;
  }

  it('ignores a late baseline from the superseded replay (view stays the snapshot)', () => {
    const shown = snapshotAfterOverflow();
    const view = sessionView(shown);
    const { state, attaches } = run([baseline(1_004, ['late'])], shown);

    expect(attaches).toEqual([]);
    expect(state).toBe(shown);
    expect(sessionView(state)).toBe(view);
    expect(sessionView(state).source).toBe('snapshot');
  });

  it('requests no attach for late non-baseline frames after a snapshot', () => {
    const shown = snapshotAfterOverflow();
    const { state, attaches } = run([frame(1_004), frame(1_010)], shown);

    expect(attaches).toEqual([]);
    expect(state).toBe(shown);
    expect(dispatch(shown, { kind: 'resync-required' }).attach).toBeNull();
  });

  it('lets a log take over after connected following a snapshot', () => {
    const shown = snapshotAfterOverflow();
    const reconnect = dispatch(shown, { kind: 'connected' });
    expect(reconnect.attach).toEqual({
      token: 3,
      params: { sessionId: SESSION },
    });
    expect(reconnect.state.fenced).toBe(false);

    const settled = succeeded(reconnect.state, 1_200, 'e-1').state;
    const { state } = run([baseline(1_200, ['fresh']), frame(1_201)], settled);
    expect(sessionView(state).source).toBe('log');
    expect(sessionView(state).baseline.map((e) => e.id)).toEqual(['fresh']);
    expect(renderedSeqs(state)).toEqual([1_201]);
  });

  it('resumes live from a later log attach after a snapshot', () => {
    const connected = dispatch(initialSessionEventState(SESSION), {
      kind: 'connected',
    }).state;
    const shown = snapshot(connected, ['saved']).state;

    const reconnect = dispatch(shown, { kind: 'connected' });
    expect(reconnect.attach?.params).toEqual({ sessionId: SESSION });
    const settled = succeeded(reconnect.state, 6, 'e-9').state;

    const { state, attaches } = run(
      [
        baseline(5, ['h-1', 'h-2'], 'e-9'),
        frame(6, 'chat:chunk', undefined, 'e-9'),
      ],
      settled,
    );
    expect(attaches).toEqual([]);
    expect(sessionView(state).source).toBe('log');
    expect(sessionView(state).baselineSeq).toBe(5);
    expect(renderedSeqs(state)).toEqual([6]);
    expect(state.epoch).toBe('e-9');
    expect(state.recovery).toBeNull();
  });
});

describe('SessionEventReducer epoch reset', () => {
  it('resets on resync-required and asks for a fresh attach with no afterSeq', () => {
    const start = run([baseline(1, ['h-1']), frame(2), frame(5)]).state;
    const step = dispatch(start, { kind: 'resync-required' });

    const token = start.nextToken;
    expect(step.attach).toEqual({ token, params: { sessionId: SESSION } });
    expect(step.state).toEqual({
      ...initialSessionEventState(SESSION),
      recovery: { kind: 'resync', token, settled: false, retries: 0 },
      nextToken: token + 1,
    });
    expect(dispatch(step.state, { kind: 'connected' }).attach?.params).toEqual({
      sessionId: SESSION,
    });
  });

  it('starts over when a frame from a new epoch arrives', () => {
    const start = run([baseline(1, ['h-1']), frame(2), frame(3)]).state;
    const { state, attaches } = run(
      [
        baseline(1, ['h-1', 'h-2'], 'e-2'),
        frame(2, 'chat:chunk', { text: 'new' }, 'e-2'),
      ],
      start,
    );

    expect(attaches).toEqual([]);
    expect(state.epoch).toBe('e-2');
    expect(state.last).toBe(2);
    expect(sessionView(state).baseline.map((e) => e.id)).toEqual([
      'h-1',
      'h-2',
    ]);
    expect(sessionView(state).records).toEqual([
      {
        id: 'e-2:2',
        seq: 2,
        type: 'chat:chunk',
        ts: 2,
        payload: { text: 'new' },
      },
    ]);
  });

  it('drops the old epoch held frames and replay state', () => {
    const start = run([baseline(1, []), frame(2), frame(9)]).state;
    expect(start.recovery).toMatchObject({ kind: 'replay' });
    const { state } = run([baseline(1, [], 'e-2')], start);
    expect(state.held).toEqual([]);
    expect(state.recovery).toBeNull();
    // Tokens are not reused across the reset.
    expect(state.nextToken).toBe(start.nextToken);
  });
});

describe('SessionEventReducer baseline replace', () => {
  it('replaces the rendered view with the new baseline', () => {
    const start = run([baseline(1, ['h-1']), frame(2), frame(3)]).state;
    const { state } = run(
      [baseline(4, ['h-1', 'h-2', 'h-3']), frame(5)],
      start,
    );

    expect(sessionView(state).baselineSeq).toBe(4);
    expect(sessionView(state).baseline.map((e) => e.id)).toEqual([
      'h-1',
      'h-2',
      'h-3',
    ]);
    expect(renderedSeqs(state)).toEqual([5]);
  });

  it('applies a baseline past a gap without a replay (old afterSeq attach, W8 step 2)', () => {
    // The client saw up to 3; a desktop turn happened; the worker appended a
    // fresh baseline at 9 and the attach replays from it.
    const start = run([baseline(1, ['h-1']), frame(2), frame(3)]).state;
    const { state, attaches } = run(
      [baseline(9, ['h-1', 'd-1']), frame(10)],
      start,
    );

    expect(attaches).toEqual([]);
    expect(state.last).toBe(10);
    expect(sessionView(state).baseline.map((e) => e.id)).toEqual([
      'h-1',
      'd-1',
    ]);
    expect(renderedSeqs(state)).toEqual([10]);
  });

  it('discards held frames the baseline superseded and keeps the later ones', () => {
    const start = run([baseline(1, []), frame(2), frame(4), frame(8)]).state;
    const { state } = run([baseline(7, ['h-1'])], start);

    expect(state.last).toBe(8);
    expect(state.held).toEqual([]);
    expect(renderedSeqs(state)).toEqual([8]);
  });
});

describe('SessionEventReducer history mark', () => {
  it('advances last with no view change and no gap request', () => {
    const start = run([
      baseline(1, ['h-1']),
      frame(2),
      frame(3, 'worker:turn.end', { turnId: 't-1' }),
    ]).state;
    const step = dispatch(start, { kind: 'event', frame: historyMark(4) });

    expect(step.attach).toBeNull();
    expect(step.state.last).toBe(4);
    expect(sessionView(step.state)).toBe(sessionView(start));

    const next = run([frame(5)], step.state);
    expect(next.attaches).toEqual([]);
    expect(renderedSeqs(next.state)).toEqual([2, 3, 5]);
  });

  it('replayed after a worker restart (afterSeq = turn.end seq) it changes nothing', () => {
    const start = run([
      baseline(1, ['h-1']),
      frame(2, 'worker:turn.end', { turnId: 't-1' }),
    ]).state;
    const resume = dispatch(start, { kind: 'connected' }).attach?.params;
    expect(resume).toEqual({ sessionId: SESSION, afterSeq: 2, epoch: 'e-1' });

    const step = dispatch(start, { kind: 'event', frame: historyMark(3) });
    expect(step.attach).toBeNull();
    expect(sessionView(step.state)).toBe(sessionView(start));
  });
});

describe('SessionEventReducer: duplicates and gaps render the same as no disconnect', () => {
  const stream = [
    baseline(1, ['h-1']),
    frame(2, 'worker:turn.begin', { turnId: 't-1' }),
    frame(3),
    frame(4),
    frame(5, 'permission:request', { id: 'p-1' }),
    frame(6, 'worker:permission.answered', {
      requestId: 'p-1',
      decision: 'allow',
      by: 'laptop',
    }),
    frame(7),
    frame(8, 'worker:turn.end', { turnId: 't-1' }),
    historyMark(9),
    frame(10, 'chat:complete', {}),
  ];

  it('renders identically after a disconnect with overlap, reordering and a gap', () => {
    const clean = run(stream).state;

    // Live until 4, link drops; 6 and 7 arrive before the replay (gap), the
    // reconnect replays from 4 (3 and 4 again as duplicates of an older
    // afterSeq), then live frames overlap the tail of the replay.
    const f = (seq: number) => stream[seq - 1];
    const disturbed = run([
      f(1),
      f(2),
      f(3),
      f(4),
      f(6),
      f(7),
      f(3),
      f(4),
      f(5),
      f(6),
      f(7),
      f(8),
      f(8),
      f(9),
      f(9),
      f(10),
      f(10),
    ]);

    expect(disturbed.attaches).toEqual([
      { sessionId: SESSION, afterSeq: 4, epoch: 'e-1' },
    ]);
    expect(sessionView(disturbed.state)).toEqual(sessionView(clean));
    expect(disturbed.state.last).toBe(clean.last);
    expect(disturbed.state.held).toEqual([]);
    expect(succeeded(disturbed.state, 10).state.recovery).toBeNull();
  });
});

describe('SessionEventReducer record log', () => {
  it('keeps an older state view unchanged when two states branch from it', () => {
    const base = run([baseline(1, []), frame(2)]).state;
    const a = run([frame(3, 'chat:chunk', { text: 'a' })], base).state;
    const b = run([frame(3, 'chat:chunk', { text: 'b' })], base).state;

    expect(renderedSeqs(base)).toEqual([2]);
    expect(sessionView(a).records.map((r) => r.payload)).toEqual([
      { text: 'chunk-2' },
      { text: 'a' },
    ]);
    expect(sessionView(b).records.map((r) => r.payload)).toEqual([
      { text: 'chunk-2' },
      { text: 'b' },
    ]);
  });

  it('applies a long stream in linear time (records are not copied per event)', () => {
    // 200 000 events: copying every record per event would move ~2e10
    // references and time the test out.
    const count = 200_000;
    let state = run([baseline(1, [])]).state;
    for (let seq = 2; seq <= count + 1; seq += 1) {
      state = reduceSessionEvent(state, {
        kind: 'event',
        frame: frame(seq),
      }).state;
    }
    const records = sessionView(state).records;
    expect(records).toHaveLength(count);
    expect(records[count - 1].seq).toBe(count + 1);
  });
});
