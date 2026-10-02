import {
  createExecutionChatMessage,
  type ExecutionChatMessage,
  type ExecutionNode,
  type TurnChangeSet,
} from '@ptah-extension/shared';
import {
  anchorChangeSets,
  NO_CHANGE_SET_ANCHORS,
} from './transcript-change-set-anchors';

function user(id: string, timestamp: number): ExecutionChatMessage {
  return createExecutionChatMessage({ id, role: 'user', timestamp });
}

function assistant(id: string, timestamp: number): ExecutionChatMessage {
  return createExecutionChatMessage({ id, role: 'assistant', timestamp });
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

/** Two turns: u1 (100) a1 (110) a1b (120) | u2 (200) a2 (210). */
const TRANSCRIPT = [
  user('u1', 100),
  assistant('a1', 110),
  assistant('a1b', 120),
  user('u2', 200),
  assistant('a2', 210),
];

describe('anchorChangeSets', () => {
  it('returns the shared empty map when there is nothing to join', () => {
    expect(anchorChangeSets([], [changeSet(1, 2)])).toBe(NO_CHANGE_SET_ANCHORS);
    expect(anchorChangeSets(TRANSCRIPT, [])).toBe(NO_CHANGE_SET_ANCHORS);
  });

  it('anchors each set after the last assistant message started in its turn', () => {
    const first = changeSet(105, 150);
    const second = changeSet(205, 260);
    const anchors = anchorChangeSets(TRANSCRIPT, [first, second]);
    expect(anchors.get('a1b')).toEqual([first]);
    expect(anchors.get('a2')).toEqual([second]);
    expect(anchors.size).toBe(2);
  });

  it('uses the streaming tree start time, not the minted timestamp', () => {
    const streaming = createExecutionChatMessage({
      id: 'live',
      role: 'assistant',
      timestamp: 999_999,
      streamingState: { startTime: 215 } as ExecutionNode,
    });
    const set = changeSet(205, 260);
    const anchors = anchorChangeSets(
      [...TRANSCRIPT.slice(0, 4), streaming],
      [set],
    );
    expect(anchors.get('live')).toEqual([set]);
  });

  it('falls back to the last assistant message before the next user message', () => {
    // Turn window misses every assistant key (e.g. a clock mismatch).
    const set = changeSet(101, 105);
    expect(anchorChangeSets(TRANSCRIPT, [set]).get('a1b')).toEqual([set]);
  });

  it('renders no card for a turn whose messages are not loaded', () => {
    const olderTurn = changeSet(10, 20);
    expect(anchorChangeSets(TRANSCRIPT, [olderTurn])).toBe(
      NO_CHANGE_SET_ANCHORS,
    );
  });

  it('renders no card for a turn with no assistant message yet', () => {
    const set = changeSet(201, 205);
    expect(anchorChangeSets(TRANSCRIPT.slice(0, 4), [set])).toBe(
      NO_CHANGE_SET_ANCHORS,
    );
  });

  it('splits adjacent turns by time and keeps several sets on one message oldest first', () => {
    const early = changeSet(105, 112);
    const late = changeSet(112, 150);
    expect(anchorChangeSets(TRANSCRIPT, [early, late]).get('a1b')).toEqual([
      late,
    ]);
    expect(anchorChangeSets(TRANSCRIPT, [early, late]).get('a1')).toEqual([
      early,
    ]);
    const both = anchorChangeSets(
      [user('u', 1), assistant('a', 5)],
      [changeSet(2, 6), changeSet(3, 7)],
    );
    expect(both.get('a')?.map((set) => set.turnStartedAt)).toEqual([2, 3]);
  });
});
