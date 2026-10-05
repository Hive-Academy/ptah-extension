import type {
  ExecutionChatMessage,
  ExecutionNode,
  TurnChangeSet,
} from '@ptah-extension/shared';
import {
  NO_CHANGE_SET_ANCHORS,
  type ChangeSetAnchors,
} from './transcript-change-set-anchors';
import {
  NO_TURN_SNAPSHOTS,
  TranscriptTurnSnapshots,
  changeSetForMessage,
  type TurnSnapshotSources,
} from './transcript-turn-snapshots';

function tree(id: string, startTime: number): ExecutionNode {
  return {
    id,
    type: 'message',
    status: 'complete',
    content: null,
    isCollapsed: false,
    children: [],
    startTime,
  } as unknown as ExecutionNode;
}

function user(id: string, timestamp: number): ExecutionChatMessage {
  return {
    id,
    role: 'user',
    rawContent: 'prompt',
    timestamp,
    streamingState: null,
  } as unknown as ExecutionChatMessage;
}

function assistant(
  id: string,
  startTime: number,
  usage: {
    input: number;
    output: number;
    cost: number;
    duration: number;
  } | null = null,
): ExecutionChatMessage {
  return {
    id,
    role: 'assistant',
    rawContent: 'reply',
    timestamp: startTime,
    streamingState: tree(`${id}-tree`, startTime),
    ...(usage && {
      tokens: { input: usage.input, output: usage.output },
      cost: usage.cost,
      duration: usage.duration,
    }),
  } as unknown as ExecutionChatMessage;
}

function changeSet(turnStartedAt: number, turnEndedAt: number): TurnChangeSet {
  return {
    sessionId: 's1',
    workspaceRoot: '/repo',
    turnStartedAt,
    turnEndedAt,
    files: [{ path: 'a.ts', status: 'M', additions: 1, deletions: 0 }],
    truncatedCount: 0,
    totals: { files: 1, additions: 1, deletions: 0 },
    countsUnavailable: false,
  };
}

const U1 = user('u1', 100);
const A1 = assistant('a1', 110);
const A2 = assistant('a2', 120, {
  input: 11,
  output: 7,
  cost: 0.031,
  duration: 4100,
});
const U2 = user('u2', 200);
const B1 = assistant('b1', 210);

function sources(
  overrides: Partial<TurnSnapshotSources> = {},
): TurnSnapshotSources {
  const messages = overrides.messages ?? [U1, A1, A2, U2, B1];
  return {
    messages,
    streamingBoundary: messages.length,
    changeSets: [],
    anchors: NO_CHANGE_SET_ANCHORS,
    settledThrough: -Infinity,
    ...overrides,
  };
}

describe('changeSetForMessage', () => {
  it('returns the newest set whose (start, end] window holds the message key', () => {
    const older = changeSet(100, 130);
    const newer = changeSet(105, 130);
    expect(changeSetForMessage(A1, [older, newer])).toBe(newer);
    expect(changeSetForMessage(B1, [older, newer])).toBeNull();
  });
});

describe('TranscriptTurnSnapshots', () => {
  it('returns the shared empty map when there is no turn', () => {
    const snapshots = new TranscriptTurnSnapshots().compute(
      's1',
      sources({ messages: [U1] }),
    );
    expect(snapshots).toBe(NO_TURN_SNAPSHOTS);
  });

  it('maps every assistant message of a turn, never a user message', () => {
    const snapshots = new TranscriptTurnSnapshots().compute('s1', sources());
    expect([...snapshots.keys()]).toEqual(['a1', 'a2', 'b1']);
  });

  it('gives an open turn one shared all-pending snapshot', () => {
    const messages = [U1, A1, A2];
    const snapshots = new TranscriptTurnSnapshots().compute(
      's1',
      sources({ messages, streamingBoundary: 1 }),
    );
    expect(snapshots.get('a1')).toBe(snapshots.get('a2'));
    expect(snapshots.get('a1')).toEqual({
      state: 'pending',
      incomplete: false,
      diff: { kind: 'pending' },
      tests: { kind: 'pending' },
      usage: { kind: 'pending' },
    });
  });

  it("uses each block's own message usage (L-11) and the turn's diff and tests", () => {
    const covering = changeSet(105, 130);
    const snapshots = new TranscriptTurnSnapshots().compute(
      's1',
      sources({ changeSets: [covering] }),
    );
    const mid = snapshots.get('a1');
    const end = snapshots.get('a2');
    expect(mid?.usage).toEqual({ kind: 'unavailable' });
    expect(end?.usage).toEqual({
      kind: 'available',
      input: 11,
      output: 7,
      cost: 0.031,
      durationMs: 4100,
    });
    expect(end?.diff).toEqual({ kind: 'available', changeSet: covering });
    expect(mid?.diff).toBe(end?.diff);
    expect(mid?.tests).toBe(end?.tests);
  });

  it('keeps the newest finalized turn without a set pending until the store settles past it', () => {
    const turnSnapshots = new TranscriptTurnSnapshots();
    const pending = turnSnapshots.compute(
      's1',
      sources({ settledThrough: 209 }),
    );
    expect(pending.get('b1')?.diff).toEqual({ kind: 'pending' });
    expect(pending.get('b1')?.state).toBe('terminal');

    const settled = turnSnapshots.compute(
      's1',
      sources({ settledThrough: 210 }),
    );
    expect(settled.get('b1')?.diff).toEqual({ kind: 'unavailable' });
  });

  it('marks an older turn without a set unavailable at once', () => {
    const snapshots = new TranscriptTurnSnapshots().compute('s1', sources());
    expect(snapshots.get('a2')?.diff).toEqual({ kind: 'unavailable' });
    expect(snapshots.get('b1')?.diff).toEqual({ kind: 'pending' });
  });

  it("falls back to the anchor join's placement when no window covers the turn", () => {
    const skewed = changeSet(5_000, 6_000);
    const anchors: ChangeSetAnchors = new Map([['a2', [skewed]]]);
    const snapshots = new TranscriptTurnSnapshots().compute(
      's1',
      sources({ changeSets: [skewed], anchors }),
    );
    expect(snapshots.get('a2')?.diff).toEqual({
      kind: 'available',
      changeSet: skewed,
    });
  });

  it('keeps snapshot identity across recomputes while a turn is unchanged', () => {
    const turnSnapshots = new TranscriptTurnSnapshots();
    const first = turnSnapshots.compute('s1', sources());
    // A new message array with the same message objects: same snapshots.
    const second = turnSnapshots.compute(
      's1',
      sources({ messages: [U1, A1, A2, U2, B1] }),
    );
    expect(second.get('a1')).toBe(first.get('a1'));
    expect(second.get('a2')).toBe(first.get('a2'));
    expect(second.get('b1')).toBe(first.get('b1'));

    // A late push for the newest turn rebuilds only that turn.
    const third = turnSnapshots.compute(
      's1',
      sources({ changeSets: [changeSet(205, 230)] }),
    );
    expect(third.get('a2')).toBe(first.get('a2'));
    expect(third.get('b1')).not.toBe(first.get('b1'));
  });

  it('prunes turns that left the transcript', () => {
    const turnSnapshots = new TranscriptTurnSnapshots();
    const first = turnSnapshots.compute('s1', sources());
    turnSnapshots.compute('s1', sources({ messages: [U2, B1] }));
    const back = turnSnapshots.compute('s1', sources());
    expect(back.get('a2')).not.toBe(first.get('a2'));
    expect(back.get('a2')).toEqual(first.get('a2'));
  });

  it('starts over for a different session', () => {
    const turnSnapshots = new TranscriptTurnSnapshots();
    const first = turnSnapshots.compute('s1', sources());
    const other = turnSnapshots.compute('s2', sources());
    expect(other.get('a2')).not.toBe(first.get('a2'));
  });
});
