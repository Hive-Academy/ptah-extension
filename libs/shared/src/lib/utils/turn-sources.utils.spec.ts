import type { ExecutionChatMessage, ExecutionNode } from '../types/execution';
import type { TurnChangeSet } from '../types/rpc/rpc-change-set.types';

import { buildTurnSourceSnapshot } from './turn-sources.utils';

const changeSet: TurnChangeSet = {
  sessionId: 'session',
  workspaceRoot: 'C:/workspace',
  turnStartedAt: 1,
  turnEndedAt: 2,
  files: [],
  truncatedCount: 0,
  totals: { files: 0, additions: 0, deletions: 0 },
  countsUnavailable: false,
};

function assistant(
  overrides: Partial<ExecutionChatMessage> = {},
): ExecutionChatMessage {
  const root: ExecutionNode = {
    id: 'root',
    type: 'message',
    status: 'complete',
    content: null,
    isCollapsed: false,
    children: [],
  };
  return {
    id: 'assistant',
    role: 'assistant',
    timestamp: 1,
    streamingState: root,
    tokens: { input: 10, output: 20 },
    cost: 0,
    duration: 500,
    ...overrides,
  };
}

describe('buildTurnSourceSnapshot', () => {
  it('keeps every source pending before the turn is finalized', () => {
    const message = assistant();
    expect(
      buildTurnSourceSnapshot({
        turnMessages: [message],
        blockMessage: message,
        changeSet: 'pending',
        finalized: false,
      }),
    ).toEqual({
      state: 'pending',
      incomplete: false,
      diff: { kind: 'pending' },
      tests: { kind: 'pending' },
      usage: { kind: 'pending' },
    });
  });

  it('builds terminal sources from the turn tree, change set, and block message', () => {
    const message = assistant();
    expect(
      buildTurnSourceSnapshot({
        turnMessages: [message],
        blockMessage: message,
        changeSet,
        finalized: true,
      }),
    ).toEqual({
      state: 'terminal',
      incomplete: false,
      diff: { kind: 'available', changeSet },
      tests: {
        kind: 'available',
        runs: [],
        summary: { total: 0, passed: 0, failed: 0, running: 0, unknown: 0 },
      },
      usage: {
        kind: 'available',
        input: 10,
        output: 20,
        cost: 0,
        durationMs: 500,
      },
    });
  });

  it('marks absent change-set, execution-tree, and usage data unavailable rather than zero', () => {
    const message = assistant({
      streamingState: null,
      tokens: undefined,
      cost: null,
      duration: undefined,
    });
    expect(
      buildTurnSourceSnapshot({
        turnMessages: [message],
        blockMessage: message,
        changeSet: null,
        finalized: true,
      }),
    ).toEqual({
      state: 'terminal',
      incomplete: false,
      diff: { kind: 'unavailable' },
      tests: { kind: 'unavailable' },
      usage: { kind: 'unavailable' },
    });
  });

  it('marks terminal errors incomplete and preserves a late-pending change set', () => {
    const message = assistant({
      streamingState: {
        id: 'root',
        type: 'message',
        status: 'error',
        content: null,
        isCollapsed: false,
        children: [],
      },
    });
    const snapshot = buildTurnSourceSnapshot({
      turnMessages: [message],
      blockMessage: message,
      changeSet: 'pending',
      finalized: true,
    });
    expect(snapshot.incomplete).toBe(true);
    expect(snapshot.diff).toEqual({ kind: 'pending' });
  });

  it('marks a finalized turn incomplete when a test command remains non-terminal', () => {
    const message = assistant({
      streamingState: {
        id: 'root',
        type: 'message',
        status: 'complete',
        content: null,
        isCollapsed: false,
        children: [
          {
            id: 'test',
            type: 'tool',
            status: 'streaming',
            content: null,
            isCollapsed: false,
            children: [],
            toolName: 'Bash',
            toolInput: { command: 'npm test' },
          },
        ],
      },
    });
    expect(
      buildTurnSourceSnapshot({
        turnMessages: [message],
        blockMessage: message,
        changeSet,
        finalized: true,
      }).incomplete,
    ).toBe(true);
  });

  it('uses the late change set when the same terminal turn is resolved again', () => {
    const message = assistant();
    expect(
      buildTurnSourceSnapshot({
        turnMessages: [message],
        blockMessage: message,
        changeSet: 'pending',
        finalized: true,
      }).diff,
    ).toEqual({ kind: 'pending' });
    expect(
      buildTurnSourceSnapshot({
        turnMessages: [message],
        blockMessage: message,
        changeSet,
        finalized: true,
      }).diff,
    ).toEqual({ kind: 'available', changeSet });
  });
});
