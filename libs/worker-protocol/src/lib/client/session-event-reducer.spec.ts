import type { EventFrame } from '../frames';
import {
  MAX_HELD_FRAMES,
  initialSessionEventState,
  reduceSessionEvent,
  resumeAttachParams,
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
  return state.view.records.map((r) => r.seq);
}

describe('SessionEventReducer in-order apply', () => {
  it('applies seq === last + 1 and renders a record with the W1 event id', () => {
    const { state, attaches } = run([baseline(1, ['h-1']), frame(2), frame(3)]);
    expect(state.last).toBe(3);
    expect(attaches).toEqual([]);
    expect(state.view.baseline.map((e) => e.id)).toEqual(['h-1']);
    expect(state.view.records).toEqual([
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

  it('bounds the held frames and keeps the replay outstanding', () => {
    const start = run([baseline(1, [])]).state;
    const frames = Array.from({ length: MAX_HELD_FRAMES + 1 }, (_, i) =>
      frame(i + 3),
    );
    const { state, attaches } = run(frames, start);
    expect(attaches).toHaveLength(1);
    expect(state.held.length).toBeLessThanOrEqual(MAX_HELD_FRAMES);
    expect(state.replayFrom).toBe(1);
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
    expect(state.view.baseline.map((e) => e.id)).toEqual(['h-1', 'h-2']);
    expect(state.view.records).toEqual([
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

    expect(state.view.baselineSeq).toBe(4);
    expect(state.view.baseline.map((e) => e.id)).toEqual(['h-1', 'h-2', 'h-3']);
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
    expect(state.view.baseline.map((e) => e.id)).toEqual(['h-1', 'd-1']);
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
    expect(step.state.view).toBe(start.view);

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
    expect(step.state.view).toBe(start.view);
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
    expect(disturbed.state.view).toEqual(clean.view);
    expect(disturbed.state.last).toBe(clean.last);
    expect(disturbed.state.held).toEqual([]);
    expect(disturbed.state.replayFrom).toBeNull();
  });
});
