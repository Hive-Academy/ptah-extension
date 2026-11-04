import type { EventFrame } from '../frames';
import {
  MAX_HELD_FRAMES,
  initialSessionEventState,
  reduceSessionEvent,
  resumeAttachParams,
  sessionView,
  type SessionEventAction,
  type SessionEventState,
  type SessionEventStep,
} from './session-event-reducer';

const SESSION = 's-1';

function historyEvent(id: string) {
  return {
    id,
    eventType: 'text_delta',
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

/** Feed frames one by one; collect every attach request the reducer makes. */
function run(
  frames: EventFrame[],
  start: SessionEventState = initialSessionEventState(SESSION),
): { state: SessionEventState; attaches: SessionEventStep['attach'][] } {
  let state = start;
  const attaches: SessionEventStep['attach'][] = [];
  for (const f of frames) {
    const step = reduceSessionEvent(state, { kind: 'event', frame: f });
    state = step.state;
    if (step.attach !== null) {
      attaches.push(step.attach);
    }
  }
  return { state, attaches };
}

function dispatch(state: SessionEventState, action: SessionEventAction) {
  return reduceSessionEvent(state, action);
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
    expect(state.replayFrom).toBeNull();
    expect(renderedSeqs(state)).toEqual([2, 3, 4, 5, 6]);
  });

  it('does not ask again while a replay is outstanding, even as last advances', () => {
    const start = run([baseline(1, []), frame(2), frame(6)]).state;
    // Replay starts streaming (3), and a new live frame (7) arrives past the gap.
    const { attaches } = run([frame(3), frame(7)], start);
    expect(attaches).toEqual([]);
  });

  it('asks again from the current last after replay-failed', () => {
    const start = run([baseline(1, []), frame(2), frame(6), frame(3)]).state;
    const step = dispatch(start, { kind: 'replay-failed' });
    expect(step.attach).toEqual({
      sessionId: SESSION,
      afterSeq: 3,
      epoch: 'e-1',
    });
    expect(step.state.replayFrom).toBe(3);
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
  /** Baseline at 1, then MAX_HELD_FRAMES + 1 frames past a gap at 2. */
  function overflowed() {
    const start = run([baseline(1, ['h-1'])]).state;
    const frames = Array.from({ length: MAX_HELD_FRAMES + 1 }, (_, i) =>
      frame(i + 3),
    );
    return run(frames, start);
  }

  it('drops the held frames and the replay, and asks once for a fresh attach', () => {
    const { state, attaches } = overflowed();
    expect(attaches).toEqual([
      { sessionId: SESSION, afterSeq: 1, epoch: 'e-1' },
      { sessionId: SESSION },
    ]);
    expect(state.held).toEqual([]);
    expect(state.replayFrom).toBeNull();
    expect(state.resyncing).toBe(true);
    expect(state.last).toBe(1);
  });

  it('asks for no second fresh attach while the resync is outstanding', () => {
    const start = overflowed().state;
    const more = Array.from({ length: MAX_HELD_FRAMES + 1 }, (_, i) =>
      frame(i + 2_000),
    );
    const { state, attaches } = run(more, start);
    expect(attaches).toEqual([]);
    expect(state.resyncing).toBe(true);
    expect(state.held).toEqual([]);
  });

  it('applies the fresh attach baseline and ends the resync', () => {
    const start = overflowed().state;
    const { state, attaches } = run(
      [baseline(1_100, ['h-1', 'h-2']), frame(1_101)],
      start,
    );
    expect(attaches).toEqual([]);
    expect(state.resyncing).toBe(false);
    expect(state.last).toBe(1_101);
    expect(sessionView(state).baselineSeq).toBe(1_100);
    expect(renderedSeqs(state)).toEqual([1_101]);
  });

  it('asks for the fresh attach again when it fails (regression: no stale replayFrom)', () => {
    const start = overflowed().state;
    const failed = dispatch(start, { kind: 'replay-failed' });
    expect(failed.attach).toEqual({ sessionId: SESSION });
    expect(failed.state.resyncing).toBe(true);
    expect(failed.state.replayFrom).toBeNull();

    const { state } = run([baseline(1_100, ['h-1'])], failed.state);
    expect(state.resyncing).toBe(false);
    expect(sessionView(state).baselineSeq).toBe(1_100);
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
    expect(state.resyncing).toBe(false);
    expect(renderedSeqs(state)).toEqual([1_101, 1_102, 1_103]);
  });
});

describe('SessionEventReducer epoch reset', () => {
  it('resets on resync-required and asks for a fresh attach with no afterSeq', () => {
    const start = run([baseline(1, ['h-1']), frame(2), frame(5)]).state;
    const step = dispatch(start, { kind: 'resync-required' });

    expect(step.attach).toEqual({ sessionId: SESSION });
    expect(step.state).toEqual(initialSessionEventState(SESSION));
    expect(resumeAttachParams(step.state)).toEqual({ sessionId: SESSION });
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
    expect(start.replayFrom).toBe(2);
    const { state } = run([baseline(1, [], 'e-2')], start);
    expect(state.held).toEqual([]);
    expect(state.replayFrom).toBeNull();
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
    expect(state.replayFrom).toBeNull();
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
    const resume = resumeAttachParams(start);
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
    expect(disturbed.state.replayFrom).toBeNull();
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
