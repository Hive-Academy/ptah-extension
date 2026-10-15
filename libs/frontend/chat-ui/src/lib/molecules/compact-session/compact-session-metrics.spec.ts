import {
  createEmptyStreamingState,
  setStreamingEventCapped,
  STREAMING_EVENT_CAP,
} from '@ptah-extension/chat-types';
import type {
  ExecutionChatMessage,
  ExecutionNode,
  ToolStartEvent,
} from '@ptah-extension/shared';
import {
  gitTitle,
  parseTodoList,
  sameGitState,
  summarizeTodos,
  todoTitle,
} from './compact-session-metrics';

const todos = [
  {
    content: 'First',
    activeForm: 'Working on first',
    status: 'in_progress' as const,
  },
  {
    content: 'Second',
    activeForm: 'Finishing second',
    status: 'completed' as const,
  },
];

function start(
  id: string,
  input?: Record<string, unknown>,
  parentToolUseId?: string,
): ToolStartEvent {
  return {
    id,
    eventType: 'tool_start',
    toolCallId: id,
    toolName: 'TodoWrite',
    isTaskTool: false,
    messageId: 'message',
    timestamp: 1,
    parentToolUseId,
    toolInput: input,
  };
}

function node(
  type: ExecutionNode['type'],
  children: readonly ExecutionNode[] = [],
  input?: Record<string, unknown>,
): ExecutionNode {
  return {
    id: `${type}-${children.length}`,
    type,
    status: 'completed',
    content: null,
    children,
    isCollapsed: false,
    toolName: type === 'tool' ? 'TodoWrite' : undefined,
    toolInput: input,
  };
}

function message(root: ExecutionNode): ExecutionChatMessage {
  return { id: 'final', role: 'assistant', timestamp: 0, streamingState: root };
}

describe('compact todo metrics', () => {
  it('validates every item and rejects folded input', () => {
    expect(parseTodoList({ todos })).toEqual(todos);
    for (const invalid of [
      { ...todos[0], status: 'started' },
      { status: 'pending', activeForm: 'Doing' },
      { status: 'pending', content: 'Do' },
    ]) {
      expect(parseTodoList({ todos: [invalid] })).toBeNull();
    }
    expect(parseTodoList({ todos: 'folded' })).toBeNull();
  });

  it('prefers top-level live TodoWrite over interleaved sub-agent writes', () => {
    const state = createEmptyStreamingState();
    setStreamingEventCapped(state, start('parent', { todos }));
    setStreamingEventCapped(state, start('child', { todos: [] }, 'agent'));
    expect(summarizeTodos([], state)).toEqual({
      kind: 'known',
      done: 1,
      total: 2,
      active: 'Working on first',
    });
  });

  it('returns unknown for an evicted start or partial streaming JSON despite older finalized data', () => {
    const older = [message(node('message', [node('tool', [], { todos })]))];
    const state = createEmptyStreamingState();
    setStreamingEventCapped(state, start('new'));
    state.events.delete('new');
    expect(summarizeTodos(older, state)).toEqual({ kind: 'unknown' });
    state.toolInputAccumulators.set('new-input', '{"todos":[');
    expect(summarizeTodos(older, state)).toEqual({ kind: 'unknown' });
    state.toolInputAccumulators.set('new-input', JSON.stringify({ todos: [] }));
    expect(summarizeTodos(older, state)).toEqual({ kind: 'none' });
  });

  it('does not resurrect an older finalized list after a live turn is compacted', () => {
    const older = [message(node('message', [node('tool', [], { todos })]))];
    const afterCompaction = createEmptyStreamingState();
    afterCompaction.latestTodoWrite = { toolCallId: 'live', timestamp: 10 };
    expect(summarizeTodos(older, afterCompaction)).toEqual({ kind: 'unknown' });
  });

  it('keeps the latest streamed list after its start is evicted or compacted', () => {
    const state = createEmptyStreamingState();
    setStreamingEventCapped(state, start('todo'));
    state.toolCallMap.set('todo', ['todo']);
    state.toolInputAccumulators.set('todo-input', JSON.stringify({ todos }));
    setStreamingEventCapped(state, {
      id: 'todo-result',
      eventType: 'tool_result',
      toolCallId: 'todo',
      messageId: 'message',
      timestamp: 2,
      output: 'ok',
      isError: false,
    });
    for (let i = 0; i < STREAMING_EVENT_CAP; i++) {
      setStreamingEventCapped(state, {
        id: `filler-${i}`,
        eventType: 'message_delta',
        messageId: 'other',
        timestamp: 3,
        tokenUsage: { input: 0, output: 0 },
      });
    }
    expect(state.events.has('todo')).toBe(false);
    expect(state.toolInputAccumulators.has('todo-input')).toBe(false);
    const known = {
      kind: 'known',
      done: 1,
      total: 2,
      active: 'Working on first',
    };
    expect(summarizeTodos([], state)).toEqual(known);
    const afterCompaction = createEmptyStreamingState();
    afterCompaction.latestTodoWrite = state.latestTodoWrite;
    expect(summarizeTodos([], afterCompaction)).toEqual(known);
  });

  it('retains the streamed input when the start is evicted before its result', () => {
    const state = createEmptyStreamingState();
    setStreamingEventCapped(state, start('todo'));
    state.toolCallMap.set('todo', ['todo']);
    state.toolInputAccumulators.set('todo-input', JSON.stringify({ todos }));
    for (let i = 0; i < STREAMING_EVENT_CAP; i++) {
      setStreamingEventCapped(state, {
        id: `filler-${i}`,
        eventType: 'message_delta',
        messageId: 'other',
        timestamp: 3,
        tokenUsage: { input: 0, output: 0 },
      });
    }
    expect(summarizeTodos([], state)).toMatchObject({
      kind: 'known',
      total: 2,
    });
  });

  it('does not read a finalized todo older than the compaction boundary', () => {
    const older = message(node('message', [node('tool', [], { todos })]));
    const finalized = { ...message(node('message')), timestamp: 2 };
    expect(summarizeTodos([older, finalized], null, 1)).toEqual({
      kind: 'unknown',
    });
  });

  it('compares git values and distinguishes unavailable and failed titles', () => {
    expect(
      sameGitState(
        { kind: 'known', additions: 2, deletions: 1, partial: false },
        { kind: 'known', additions: 2, deletions: 1, partial: false },
      ),
    ).toBe(true);
    expect(
      sameGitState(
        { kind: 'known', additions: 2, deletions: 1, partial: false },
        { kind: 'known', additions: 3, deletions: 1, partial: false },
      ),
    ).toBe(false);
    expect(gitTitle({ kind: 'unknown', reason: 'unavailable' })).toBe(
      'Git changes unavailable',
    );
    expect(gitTitle({ kind: 'unknown', reason: 'failed' })).toBe(
      'Could not read git status',
    );
    expect(todoTitle({ kind: 'none' })).toBe('Todos not reported by this session');
  });

  it('ignores agent-nested finalized writes and uses the newest top-level tool', () => {
    const root = node('message', [
      node('tool', [], { todos: [] }),
      node('agent', [node('tool', [], { todos })]),
      node('tool', [], { todos }),
    ]);
    expect(summarizeTodos([message(root)], null)).toEqual({
      kind: 'known',
      done: 1,
      total: 2,
      active: 'Working on first',
    });
    expect(
      summarizeTodos(
        [
          message(
            node('message', [node('agent', [node('tool', [], { todos })])]),
          ),
        ],
        null,
      ),
    ).toEqual({ kind: 'none' });
  });

  it('reports malformed newest finalized input as unknown', () => {
    const old = message(node('message', [node('tool', [], { todos })]));
    const recent = message(
      node('message', [node('tool', [], { todos: 'folded' })]),
    );
    expect(summarizeTodos([old, recent], null)).toEqual({ kind: 'unknown' });
  });
});
