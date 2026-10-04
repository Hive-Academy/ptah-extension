import {
  createExecutionChatMessage,
  createExecutionNode,
  type ExecutionChatMessage,
  type ExecutionNode,
  type ExecutionStatus,
} from '@ptah-extension/shared';
import {
  anchorTurnTests,
  groupTurns,
  NO_TURN_TESTS_ANCHORS,
} from './transcript-turns';

function user(id: string, timestamp: number): ExecutionChatMessage {
  return createExecutionChatMessage({ id, role: 'user', timestamp });
}

function assistant(
  id: string,
  timestamp: number,
  streamingState: ExecutionNode | null = null,
): ExecutionChatMessage {
  return createExecutionChatMessage({
    id,
    role: 'assistant',
    timestamp,
    streamingState,
  });
}

function system(id: string, timestamp: number): ExecutionChatMessage {
  return createExecutionChatMessage({ id, role: 'system', timestamp });
}

function treeRoot(
  id: string,
  children: readonly ExecutionNode[] = [],
  status: ExecutionStatus = 'complete',
): ExecutionNode {
  return createExecutionNode({
    id,
    type: 'message',
    status,
    content: 'assistant reply',
    startTime: 1000,
    children: [...children],
  });
}

function bashNode(
  id: string,
  command: string,
  status: ExecutionStatus = 'complete',
): ExecutionNode {
  return createExecutionNode({
    id,
    type: 'tool',
    toolName: 'Bash',
    toolInput: { command },
    status,
    content: '',
  });
}

const PASSED_JEST = bashNode('n1', 'npx jest libs/frontend/chat');
const FAILED_PYTEST = bashNode('n2', 'pytest tests/', 'error');
const LIST_FILES = bashNode('n3', 'ls -la');

/** Two turns: u1 (100) a1 (110) a1b (120) | u2 (200) a2 (210). */
const TRANSCRIPT: readonly ExecutionChatMessage[] = [
  user('u1', 100),
  assistant('a1', 110, treeRoot('t1', [PASSED_JEST])),
  assistant('a1b', 120, treeRoot('t1b', [FAILED_PYTEST])),
  user('u2', 200),
  assistant('a2', 210, treeRoot('t2', [LIST_FILES])),
];

describe('groupTurns', () => {
  it('ends each turn at the last assistant message before the next user message', () => {
    const turns = groupTurns(TRANSCRIPT, 5);
    expect(turns.map((turn) => turn.endMessageId)).toEqual(['a1b', 'a2']);
    expect(turns[0].roots).toEqual([TRANSCRIPT[1].streamingState, TRANSCRIPT[2].streamingState]);
    expect(turns[1].roots).toEqual([TRANSCRIPT[4].streamingState]);
  });

  it('skips roles other than user and assistant, and messages before the first user message', () => {
    const transcript = [
      system('s0', 50),
      assistant('a0', 60, treeRoot('t0')),
      user('u1', 100),
      system('s1', 105),
      assistant('a1', 110, treeRoot('t1')),
      assistant('a2', 120),
    ];
    // `s0`/`a0` predate the first user message (their turn lives on an
    // unloaded older page): no row rather than a partial one. `s1` neither
    // starts nor ends a turn.
    const turns = groupTurns(transcript, 6);
    expect(turns.map((turn) => turn.endMessageId)).toEqual(['a2']);
    expect(turns[0].roots).toEqual([transcript[4].streamingState]);
  });

  it('skips legacy null-tree assistant messages but keeps them as turn endings (A-4)', () => {
    // Finalized messages are minted with their tree as `streamingState`
    // (libs/frontend/chat-streaming/src/lib/message-finalization.service.ts:221-241);
    // a `null` tree is the legacy empty-root shape that service stopped
    // minting (:181-191). The legacy message still ends the turn, it just
    // contributes no root and therefore no test runs.
    const transcript = [
      user('u1', 100),
      assistant('a1', 110, treeRoot('t1', [PASSED_JEST])),
      assistant('a2', 120, null),
    ];
    const turns = groupTurns(transcript, 3);
    expect(turns.map((turn) => turn.endMessageId)).toEqual(['a2']);
    expect(turns[0].roots).toEqual([transcript[1].streamingState]);
  });

  it('marks a turn finalized only when its ending message is below the streaming boundary', () => {
    // Boundary 3: u1/a1/a1b finalized, u2/a2 still streaming.
    const streaming = groupTurns(TRANSCRIPT, 3);
    expect(streaming.map((turn) => turn.finalized)).toEqual([true, false]);
    // During history replay the boundary is the total count, so replayed
    // turns count as finalized and the row survives a reload (Req 1.8).
    const replayed = groupTurns(TRANSCRIPT, TRANSCRIPT.length);
    expect(replayed.map((turn) => turn.finalized)).toEqual([true, true]);
  });

  it('marks an aborted or errored turn incomplete (A-3)', () => {
    // An abort maps every streaming node, root included, to `interrupted`
    // before the tree is retained
    // (libs/frontend/chat-streaming/src/lib/message-finalization.service.ts:140-144, 337-355);
    // a failed turn ends with an `error` root. The finalization stats copy
    // (:153-175) is what makes these the trees the transcript actually sees.
    const interrupted = [
      user('u1', 100),
      assistant('a1', 110, treeRoot('t1', [PASSED_JEST], 'interrupted')),
    ];
    expect(groupTurns(interrupted, 2)[0].incomplete).toBe(true);

    const errored = [
      user('u1', 100),
      assistant('a1', 110, treeRoot('t1', [], 'error')),
    ];
    expect(groupTurns(errored, 2)[0].incomplete).toBe(true);
  });

  it('marks a turn incomplete when a test node never finished after finalization (A-3)', () => {
    const pending = [
      user('u1', 100),
      assistant('a1', 110, treeRoot('t1', [PASSED_JEST, bashNode('n4', 'npm test', 'pending')])),
    ];
    expect(groupTurns(pending, 2)[0].incomplete).toBe(true);

    // A non-test tool that never finished, or a finished turn, is not incomplete.
    const settled = [
      user('u1', 100),
      assistant('a1', 110, treeRoot('t1', [PASSED_JEST, bashNode('n4', 'ls', 'pending')])),
    ];
    expect(groupTurns(settled, 2)[0].incomplete).toBe(false);

    // A still-streaming turn is simply not done — incomplete stays false.
    expect(groupTurns(pending, 0)[0].incomplete).toBe(false);
  });
});

describe('anchorTurnTests', () => {
  it('returns the shared empty map when there is nothing to anchor', () => {
    expect(anchorTurnTests([], 0)).toBe(NO_TURN_TESTS_ANCHORS);
    // A turn with only non-test Bash commands (Req 1.4) or only legacy
    // null-tree messages gets no entry either.
    const noop = [
      user('u1', 100),
      assistant('a1', 110, treeRoot('t1', [LIST_FILES])),
      user('u2', 200),
      assistant('a2', 210, null),
    ];
    expect(anchorTurnTests(noop, 4)).toBe(NO_TURN_TESTS_ANCHORS);
  });

  it('anchors the turn’s runs after the turn-ending message, in execution order', () => {
    const anchors = anchorTurnTests(TRANSCRIPT, 5);
    expect(anchors.size).toBe(1);
    expect(anchors.get('a1b')).toEqual({
      runs: [
        { command: 'npx jest libs/frontend/chat', outcome: 'passed' },
        { command: 'pytest tests/', outcome: 'failed' },
      ],
      incomplete: false,
    });
    expect(anchors.get('a2')).toBeUndefined();
  });

  it('propagates the incomplete flag to the anchor', () => {
    // The tests finished but the turn was aborted right after (the root was
    // still streaming when the abort mapped it to `interrupted`), so the run
    // resolves to `passed` while the row still says "(incomplete)".
    const aborted = [
      user('u1', 100),
      assistant('a1', 110, treeRoot('t1', [PASSED_JEST], 'interrupted')),
    ];
    const anchors = anchorTurnTests(aborted, 2);
    expect(anchors.get('a1')).toEqual({
      runs: [{ command: 'npx jest libs/frontend/chat', outcome: 'passed' }],
      incomplete: true,
    });
  });

  it('anchors nothing for a turn that is still streaming', () => {
    const live = [
      user('u1', 100),
      assistant('a1', 110, treeRoot('t1', [PASSED_JEST])),
    ];
    expect(anchorTurnTests(live, 1).get('a1')).toBeUndefined();
  });
});
