import 'reflect-metadata';
import {
  CodexEventTranslator,
  type CodexHistoryThread,
  type CodexHistoryTurn,
  type CodexSessionHistory,
} from '@ptah-extension/codex-runtime';
import { CodexChatEvents } from './codex-chat-events';
import { projectCodexHistory } from './codex-history-projector';

const items: CodexHistoryTurn['items'] = [
  { type: 'userMessage', id: 'user-1', clientId: 'client-1', content: [
    { type: 'text', text: 'Explain this' },
    { type: 'image', url: 'data:image/png;base64,abc' },
  ] },
  { type: 'reasoning', id: 'reason-1', summary: ['First thought'] },
  { type: 'plan', id: 'plan-1', text: 'Step one' },
  { type: 'commandExecution', id: 'command-1', command: 'pwd', cwd: '/repo', commandActions: [], status: 'completed', aggregatedOutput: '/repo', exitCode: 0 },
  { type: 'fileChange', id: 'file-1', status: 'completed', changes: [{ path: '/repo/a.ts', diff: '+a', kind: { type: 'add' } }] },
  { type: 'mcpToolCall', id: 'mcp-1', server: 'server', tool: 'lookup', arguments: { key: 'a' }, status: 'completed', result: { content: [{ type: 'text', text: 'found' }] } },
  { type: 'dynamicToolCall', id: 'dynamic-1', tool: 'calculate', arguments: { n: 2 }, status: 'completed', success: true, contentItems: [{ type: 'inputText', text: '4' }] },
  { type: 'collabAgentToolCall', id: 'collab-1', senderThreadId: 'root', receiverThreadIds: ['child'], status: 'completed', tool: 'spawnAgent', agentsStates: {}, prompt: 'Inspect files' },
  { type: 'agentMessage', id: 'answer-1', text: 'Done.' },
];

function thread(id: string, parentThreadId: string | null, turns: CodexHistoryTurn[]): CodexHistoryThread {
  return {
    id, parentThreadId, turns, cliVersion: 'pinned', createdAt: 100,
    updatedAt: 200, cwd: '/repo', ephemeral: false, modelProvider: 'openai',
    preview: '', projectId: null, sessionId: 'session', source: 'appServer',
    status: { type: 'idle' },
  };
}

/** Hand-built pinned-schema fixture; live thread/read shape is UNCONFIRMED. */
const snapshot: CodexSessionHistory = {
  rootThreadId: 'root',
  threads: [
    thread('root', null, [
      { id: 'turn-1', status: 'completed', startedAt: 100, completedAt: 110, items: [...items], itemsView: 'full' },
      { id: 'turn-2', status: 'completed', startedAt: 120, completedAt: 130, items: [
        { type: 'userMessage', id: 'user-2', content: [{ type: 'text', text: 'Follow up' }] },
        { type: 'agentMessage', id: 'answer-2', text: 'Second answer' },
      ], itemsView: 'full' },
    ]),
    thread('child', 'root', [
      { id: 'child-turn', status: 'completed', startedAt: 112, completedAt: 115, items: [
        { type: 'agentMessage', id: 'child-answer', text: 'Child answer' },
      ], itemsView: 'full' },
    ]),
  ],
};

describe('projectCodexHistory', () => {
  it('keeps two spawn results distinct and releases each after its last receiver', () => {
    const spawn = (id: string, receivers: string[]): CodexHistoryTurn['items'][number] => ({
      type: 'collabAgentToolCall', id, senderThreadId: 'root',
      receiverThreadIds: receivers, status: 'completed', tool: 'spawnAgent',
      agentsStates: {}, prompt: 'Inspect',
    });
    const rootTurn: CodexHistoryTurn = {
      id: 'root-turn', status: 'completed', startedAt: 100,
      completedAt: 101, itemsView: 'full',
      items: [spawn('first', ['a', 'b']), spawn('second', ['c'])],
    };
    const child = (id: string, end: number): CodexHistoryTurn => {
      const item: CodexHistoryTurn['items'][number] = {
        type: 'agentMessage', id: `${id}-answer`, text: `${id} answer`,
      };
      return {
        id: `${id}-turn`, status: 'completed', startedAt: end,
        completedAt: end, itemsView: 'full', items: [item],
        itemEntries: [{ turnId: `${id}-turn`, item, startedAtMs: end * 1000 }],
      };
    };
    const history = projectCodexHistory('session', {
      rootThreadId: 'root', threads: [
        thread('root', null, [rootTurn]),
        thread('a', 'root', [child('a', 102)]),
        thread('b', 'root', [child('b', 104)]),
        thread('c', 'root', [child('c', 103)]),
      ],
    }).events;
    const results = history.filter((event) => event.eventType === 'tool_result');
    expect(results).toHaveLength(2);
    expect(new Set(results.map((event) => event.id)).size).toBe(2);
    expect(results).toContainEqual(expect.objectContaining({
      toolCallId: 'first', output: 'a answer\nb answer',
    }));
    expect(results).toContainEqual(expect.objectContaining({
      toolCallId: 'second', output: 'c answer',
    }));
    const index = (predicate: (event: typeof history[number]) => boolean) =>
      history.findIndex(predicate);
    expect(index((event) => event.eventType === 'tool_result' &&
      event.toolCallId === 'first')).toBeGreaterThan(index((event) =>
      event.eventType === 'message_complete' &&
      event.messageId === '["b","b-turn"]'));
    expect(index((event) => event.eventType === 'tool_result' &&
      event.toolCallId === 'second')).toBeGreaterThan(index((event) =>
      event.eventType === 'message_complete' &&
      event.messageId === '["c","c-turn"]'));
    const live = new CodexChatEvents('session', {
      contextId: 'live', processGeneration: 1, threadId: 'root', turnId: 'root-turn',
    }, { result: () => undefined, content: () => undefined,
      live: () => undefined, compaction: () => undefined,
      error: () => undefined }, () => 100_000);
    let sequence = 0;
    const root = { contextId: 'live', processGeneration: 1,
      threadId: 'root', turnId: 'root-turn' };
    const liveEvents = [
      ...live.map({ ...root, sequence: ++sequence, type: 'toolStarted',
        toolId: 'first', toolName: 'spawnAgent', agentThreadIds: ['a', 'b'],
        input: { subagent_type: 'codex', description: 'Inspect', prompt: 'Inspect' } }),
      ...live.map({ ...root, sequence: ++sequence, type: 'toolCompleted',
        toolId: 'first', status: 'completed', agentThreadIds: ['a', 'b'], output: null }),
      ...live.map({ ...root, sequence: ++sequence, type: 'toolStarted',
        toolId: 'second', toolName: 'spawnAgent', agentThreadIds: ['c'],
        input: { subagent_type: 'codex', description: 'Inspect', prompt: 'Inspect' } }),
      ...live.map({ ...root, sequence: ++sequence, type: 'toolCompleted',
        toolId: 'second', status: 'completed', agentThreadIds: ['c'], output: null }),
      ...live.map({ ...root, sequence: ++sequence, type: 'terminal', status: 'completed' }),
    ];
    for (const id of ['a', 'c', 'b']) {
      const childIdentity = { ...root, threadId: id, turnId: `${id}-turn`,
        parentToolUseId: id === 'c' ? 'second' : 'first' };
      liveEvents.push(...live.map({ ...childIdentity, sequence: ++sequence,
        type: 'textFinal', itemId: `${id}-answer`, text: `${id} answer` }));
      liveEvents.push(...live.map({ ...childIdentity, sequence: ++sequence,
        type: 'terminal', status: 'completed' }));
    }
    const contract = (events: typeof history) => events.map((event) => ({
      type: event.eventType,
      parent: event.parentToolUseId,
      tool: event.eventType === 'tool_start' || event.eventType === 'tool_result' ||
        event.eventType === 'agent_start' ? event.toolCallId : undefined,
      agent: event.eventType === 'agent_start' ? event.agentId : undefined,
      output: event.eventType === 'tool_result' ? event.output : undefined,
      text: event.eventType === 'text_delta' ? event.delta : undefined,
    }));
    expect(contract(history)).toEqual(contract(liveEvents));
  });
  it('keeps the parent turn active when a linked child turn completes', () => {
    const result = jest.fn();
    const mapper = new CodexChatEvents('session', {
      contextId: 'live', processGeneration: 1, threadId: 'root', turnId: 'root-turn',
    }, { result, content: () => undefined, live: () => undefined,
      compaction: () => undefined, error: () => undefined }, () => 1);
    mapper.map({ contextId: 'live', processGeneration: 1, threadId: 'root', turnId: 'root-turn',
      sequence: 1, type: 'toolStarted', toolId: 'spawn', toolName: 'spawnAgent',
      input: { subagent_type: 'codex', description: 'Inspect' }, agentThreadIds: ['child'] });
    expect(mapper.map({ contextId: 'live', processGeneration: 1, threadId: 'root', turnId: 'root-turn',
      sequence: 2, type: 'toolCompleted', toolId: 'spawn', status: 'completed',
      output: { receiverThreadIds: ['child'] }, agentThreadIds: ['child'] }))
      .not.toContainEqual(expect.objectContaining({ eventType: 'tool_result', toolCallId: 'spawn' }));
    const childComplete = mapper.map({
      contextId: 'live', processGeneration: 1, threadId: 'child', turnId: 'child-turn',
      sequence: 3, type: 'terminal', status: 'completed', parentToolUseId: 'spawn',
    });
    expect(childComplete).toContainEqual(expect.objectContaining({
      eventType: 'message_complete', parentToolUseId: 'spawn',
    }));
    expect(childComplete).toContainEqual(expect.objectContaining({
      eventType: 'tool_result', toolCallId: 'spawn',
    }));
    expect(result).not.toHaveBeenCalled();
    expect(mapper.map({
      contextId: 'live', processGeneration: 1, threadId: 'root', turnId: 'root-turn',
      sequence: 4, type: 'terminal', status: 'completed',
    })).toContainEqual(expect.objectContaining({ eventType: 'message_complete' }));
    expect(result).toHaveBeenCalledTimes(1);
  });
  it('replays the live spawn, child completion and finished wait contract', () => {
    const spawn: CodexHistoryTurn['items'][number] = {
      type: 'collabAgentToolCall', id: 'spawn', senderThreadId: 'root',
      receiverThreadIds: ['child'], status: 'completed', tool: 'spawnAgent',
      agentsStates: {}, prompt: 'Inspect parser',
    };
    const wait: CodexHistoryTurn['items'][number] = {
      type: 'collabAgentToolCall', id: 'wait-1', senderThreadId: 'root',
      receiverThreadIds: ['child'], status: 'completed', tool: 'wait', agentsStates: {},
    };
    const childMessage: CodexHistoryTurn['items'][number] = {
      type: 'agentMessage', id: 'child-answer', text: 'Found it',
    };
    const rootTurn: CodexHistoryTurn = {
      id: 'root-turn', status: 'completed', startedAt: 100, completedAt: 105,
      items: [spawn, wait], itemsView: 'full',
      itemEntries: [
        { turnId: 'root-turn', item: spawn, startedAtMs: 101_000 },
        { turnId: 'root-turn', item: wait, startedAtMs: 104_000 },
      ],
    };
    const childTurn: CodexHistoryTurn = {
      id: 'child-turn', status: 'completed', startedAt: 102, completedAt: 103,
      items: [childMessage], itemsView: 'full',
    };
    const history = projectCodexHistory('session', { rootThreadId: 'root', threads: [
      thread('root', null, [rootTurn]), thread('child', 'root', [childTurn]),
    ] }).events;
    const mapper = new CodexChatEvents('session', {
      contextId: 'live', processGeneration: 1, threadId: 'root', turnId: 'root-turn',
    }, {
      result: () => undefined, content: () => undefined, live: () => undefined,
      compaction: () => undefined, error: () => undefined,
    }, () => 1);
    const translator = new CodexEventTranslator('live', 1);
    const liveFrame = (
      method: string,
      params: Record<string, unknown>,
      parentToolUseId?: string,
    ) => translator.translate({ method, params }).flatMap((event) =>
      mapper.map(parentToolUseId === undefined
        ? event : { ...event, parentToolUseId }));
    const live = [
      ...liveFrame('item/started', {
        threadId: 'root', turnId: 'root-turn', item: spawn, startedAtMs: 101_000,
      }),
      ...liveFrame('item/completed', {
        threadId: 'root', turnId: 'root-turn', item: spawn, completedAtMs: 101_000,
      }),
      ...liveFrame('item/completed', {
        threadId: 'child', turnId: 'child-turn', item: childMessage,
        completedAtMs: 103_000,
      }, 'spawn'),
      ...liveFrame('turn/completed', { threadId: 'child', turn: {
        id: 'child-turn', status: 'completed', items: [],
      } }, 'spawn'),
      ...liveFrame('item/started', {
        threadId: 'root', turnId: 'root-turn', item: wait, startedAtMs: 104_000,
      }),
      ...liveFrame('item/completed', {
        threadId: 'root', turnId: 'root-turn', item: wait, completedAtMs: 104_000,
      }),
      ...liveFrame('turn/completed', { threadId: 'root', turn: {
        id: 'root-turn', status: 'completed', items: [],
      } }),
    ];
    const contract = (events: typeof history) => events.map((event) => {
      switch (event.eventType) {
        case 'tool_start': return { type: event.eventType, id: event.toolCallId, name: event.toolName, input: event.toolInput, task: event.isTaskTool, parent: event.parentToolUseId };
        case 'tool_result': return { type: event.eventType, id: event.toolCallId, output: event.output, error: event.isError, parent: event.parentToolUseId };
        case 'agent_start': return { type: event.eventType, id: event.toolCallId, agentId: event.agentId, agentType: event.agentType, description: event.agentDescription, prompt: event.agentPrompt, parent: event.parentToolUseId };
        case 'text_delta': return { type: event.eventType, text: event.delta, parent: event.parentToolUseId };
        case 'message_start': return { type: event.eventType, role: event.role, parent: event.parentToolUseId };
        case 'message_complete': return { type: event.eventType, reason: event.stopReason, parent: event.parentToolUseId };
        default: return { type: event.eventType };
      }
    });
    expect(contract(history)).toEqual(contract(live));
    const waits = history.filter((event) => (event.eventType === 'tool_start' || event.eventType === 'tool_result') && event.toolCallId === 'wait-1');
    expect(waits.map((event) => event.eventType)).toEqual(['tool_start', 'tool_result']);
  });
  it('projects complete ordered turns, child cards, stable ids and absent usage', () => {
    const first = projectCodexHistory('session', snapshot);
    const second = projectCodexHistory('session', snapshot);
    expect(first).toEqual(second);
    expect(first.stats).toBeNull();
    expect(first.skippedItems).toEqual([]);
    expect(first.events.map((event) => event.id)).toEqual(second.events.map((event) => event.id));
    expect(new Set(first.events.map((event) => event.id)).size).toBe(first.events.length);
    expect(first.events.every((event) => event.timestamp >= 100_000)).toBe(true);
    expect(first.events.map((event) => event.timestamp)).toEqual([...first.events.map((event) => event.timestamp)].sort((a, b) => a - b));
    expect(first.events.filter((event) => event.eventType === 'message_start' && event.role === 'user')).toHaveLength(2);
    expect(first.events.filter((event) => event.eventType === 'message_start' && event.role === 'assistant')).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: '["root","turn-1"]:start', messageId: '["root","turn-1"]', sessionId: 'session', role: 'assistant' }),
      expect.objectContaining({ id: '["child","child-turn"]:start', messageId: '["child","child-turn"]', sessionId: 'session', role: 'assistant', parentToolUseId: 'collab-1' }),
    ]));
    expect(first.events.find((event) => event.eventType === 'message_start' && event.role === 'user')).toMatchObject({ imageCount: 1, clientMessageId: 'client-1' });
    expect(first.events.filter((event) => event.eventType === 'message_complete')).toHaveLength(5);
    expect(first.events.filter((event) => event.eventType === 'thinking_delta').map((event) => event.delta)).toEqual(['First thought', 'Step one']);
    expect(first.events.filter((event) => event.eventType === 'tool_start').map((event) => event.toolCallId)).toEqual(['command-1', 'file-1', 'mcp-1', 'dynamic-1', 'collab-1']);
    expect(first.events.filter((event) => event.eventType === 'tool_result').map((event) => event.toolCallId)).toEqual(['command-1', 'file-1', 'mcp-1', 'dynamic-1', 'collab-1']);
    expect(first.events).toContainEqual(expect.objectContaining({ eventType: 'agent_start', agentId: 'child', toolCallId: 'collab-1' }));
    expect(first.events).toContainEqual(expect.objectContaining({ eventType: 'tool_start', toolCallId: 'collab-1', toolName: 'Task', isTaskTool: true, toolInput: { subagent_type: 'codex', description: 'Inspect files', prompt: 'Inspect files' } }));
    expect(first.events).toContainEqual(expect.objectContaining({ eventType: 'agent_start', agentId: 'child', agentType: 'codex', agentDescription: 'Inspect files', parentToolUseId: 'collab-1', source: 'history', messageId: '["root","turn-1"]' }));
    expect(first.events).toContainEqual(expect.objectContaining({ eventType: 'text_delta', delta: 'Child answer', parentToolUseId: 'collab-1' }));
    expect(first.events.some((event) => event.eventType === 'message_delta')).toBe(false);
    expect(first.events.filter((event) => event.eventType === 'message_complete').every((event) => !('tokenUsage' in event))).toBe(true);
  });

  it('uses the live translator and mapper for tool presentation', () => {
    const translator = new CodexEventTranslator('history', 0);
    const identity = { contextId: 'history', processGeneration: 0, threadId: 'root', turnId: 'turn-1' };
    const mapper = new CodexChatEvents('session', identity, {
      result: () => undefined, content: () => undefined, live: () => undefined,
      compaction: () => undefined, error: () => undefined,
    }, () => 100_000);
    const liveItems = items.flatMap((item) => item.type === 'userMessage' ? [] :
      (['item/started', 'item/completed'] as const).flatMap((method) =>
        translator.translate({ method, params: {
          threadId: 'root', turnId: 'turn-1', item,
          ...(method === 'item/started'
            ? { startedAtMs: 100_000 }
            : { completedAtMs: 100_000 }),
        } })
          .flatMap((event) => mapper.map(event))));
    const live = [...liveItems, ...mapper.map({
      ...identity, sequence: 999, type: 'terminal', status: 'completed',
    })];
    const projected = projectCodexHistory('session', snapshot).events;
    const toolShape = (events: typeof projected) => events.filter((event) =>
      event.eventType === 'tool_start' || event.eventType === 'tool_result').map((event) => {
      if (event.eventType === 'tool_start') return { eventType: event.eventType, toolCallId: event.toolCallId, toolName: event.toolName, toolInput: event.toolInput, isTaskTool: event.isTaskTool };
      return { eventType: event.eventType, toolCallId: event.toolCallId, output: event.output, isError: event.isError };
    });
    expect(toolShape(projected).filter((event) => event.toolCallId !== 'collab-1'))
      .toEqual(toolShape(live).filter((event) => event.toolCallId !== 'collab-1'));
    expect(projected).toContainEqual(expect.objectContaining({
      eventType: 'tool_result', toolCallId: 'collab-1', output: 'Child answer',
    }));
    const liveStart = live.find((event) => event.eventType === 'message_start');
    const projectedStart = projected.find((event) => event.eventType === 'message_start' && event.messageId === '["root","turn-1"]');
    expect(projectedStart).toMatchObject({ id: liveStart?.id, sessionId: liveStart?.sessionId, messageId: liveStart?.messageId });
    expect(projected.filter((event) => event.messageId === '["root","turn-1"]' && event.eventType !== 'agent_start')
      .every((event) => event.sessionId === 'session')).toBe(true);
  });

  it('keeps item order when entries are partial or non-monotonic', () => {
    const firstItem: CodexHistoryTurn['items'][number] = { type: 'agentMessage', id: 'a', text: 'A' };
    const secondItem: CodexHistoryTurn['items'][number] = { type: 'agentMessage', id: 'b', text: 'B' };
    const thirdItem: CodexHistoryTurn['items'][number] = { type: 'agentMessage', id: 'c', text: 'C' };
    const turn: CodexHistoryTurn = { id: 'ordered', status: 'completed', startedAt: 120, completedAt: 130,
      items: [firstItem, secondItem, thirdItem], itemsView: 'full',
      itemEntries: [
        { turnId: 'ordered', item: firstItem, startedAtMs: 120_500 },
        { turnId: 'ordered', item: secondItem, startedAtMs: 120_100 },
      ],
    };
    const events = projectCodexHistory('session', { rootThreadId: 'root', threads: [thread('root', null, [turn])] }).events;
    const text = events.filter((event) => event.eventType === 'text_delta');
    expect(text.map((event) => event.delta)).toEqual(['A', 'B', 'C']);
    expect(text.map((event) => event.timestamp)).toEqual([120_500, 120_500, 120_500]);
  });

  it.each(['failed', 'interrupted', 'inProgress'] as const)('projects %s turn settlement', (status) => {
    const turn: CodexHistoryTurn = { id: status, status, startedAt: 140, completedAt: 141,
      items: [{ type: 'agentMessage', id: `answer-${status}`, text: 'Partial' }], itemsView: 'full',
      ...(status === 'failed' ? { error: { message: 'Turn failed' } } : {}),
    };
    const events = projectCodexHistory('session', { rootThreadId: 'root', threads: [thread('root', null, [turn])] }).events;
    expect(events).toContainEqual(expect.objectContaining({ eventType: 'message_complete', stopReason: status === 'inProgress' ? 'interrupted' : status }));
    if (status === 'failed') {
      expect(events).toContainEqual(expect.objectContaining({ eventType: 'text_delta', source: 'complete', delta: 'Codex reported a runtime error.' }));
      expect(JSON.stringify(events)).not.toContain('Turn failed');
    }
  });

  it('shows a fixed failure notice when no assistant item was produced', () => {
    const turn: CodexHistoryTurn = { id: 'failed-empty', status: 'failed', startedAt: 142, completedAt: 143,
      items: [], itemsView: 'full', error: { message: 'Private provider failure at /secret/path' } };
    const events = projectCodexHistory('session', { rootThreadId: 'root', threads: [thread('root', null, [turn])] }).events;
    expect(events).toContainEqual(expect.objectContaining({ eventType: 'message_start', role: 'assistant', messageId: '["root","failed-empty"]' }));
    expect(events).toContainEqual(expect.objectContaining({ eventType: 'text_delta', source: 'complete', delta: 'Codex reported a runtime error.' }));
    expect(events).toContainEqual(expect.objectContaining({ eventType: 'message_complete', stopReason: 'failed' }));
    expect(JSON.stringify(events)).not.toContain('Private provider failure at /secret/path');
  });

  it('shows the same fixed notice when a failed turn has no error message', () => {
    const turn: CodexHistoryTurn = { id: 'failed-no-message', status: 'failed', startedAt: 144, completedAt: 145,
      items: [], itemsView: 'full' };
    const events = projectCodexHistory('session', { rootThreadId: 'root', threads: [thread('root', null, [turn])] }).events;
    expect(events).toContainEqual(expect.objectContaining({ eventType: 'message_start', role: 'assistant' }));
    expect(events).toContainEqual(expect.objectContaining({ eventType: 'text_delta', delta: 'Codex reported a runtime error.' }));
    expect(events).toContainEqual(expect.objectContaining({ eventType: 'message_complete', stopReason: 'failed' }));
  });

  it('does not open an assistant message for empty reasoning or user-only turns', () => {
    const turn: CodexHistoryTurn = { id: 'empty', status: 'completed', startedAt: 150, completedAt: 151,
      items: [
        { type: 'userMessage', id: 'user-empty', content: [{ type: 'text', text: 'Prompt' }] },
        { type: 'reasoning', id: 'reason-empty', summary: [] },
      ], itemsView: 'full' };
    const events = projectCodexHistory('session', { rootThreadId: 'root', threads: [thread('root', null, [turn])] }).events;
    expect(events.filter((event) => event.eventType === 'message_start' && event.role === 'assistant')).toEqual([]);
    expect(events.filter((event) => event.eventType === 'message_complete')).toHaveLength(1);
  });

  it('shows async question text and records compaction and unsupported user content', () => {
    const turn: CodexHistoryTurn = { id: 'async', status: 'completed', startedAt: 160, completedAt: 161,
      items: [
        { type: 'userMessage', id: 'user-async', content: [{ type: 'audio', url: 'data:audio/abc' }] },
        { type: 'agentMessage', id: 'question', text: 'Choose a path', delivery: 'async', questions: [{ title: 'Path?', options: ['A', 'B'] }] },
        { type: 'contextCompaction', id: 'compact' },
      ], itemsView: 'full' };
    const result = projectCodexHistory('session', { rootThreadId: 'root', threads: [thread('root', null, [turn])] });
    expect(result.events).toContainEqual(expect.objectContaining({ eventType: 'text_delta', delta: 'Choose a path' }));
    expect(result.skippedItems).toEqual(expect.arrayContaining([
      { threadId: 'root', turnId: 'async', itemId: 'user-async', reason: 'unsupportedUserContent:audio' },
      { threadId: 'root', turnId: 'async', itemId: 'question', reason: 'asyncQuestionsNotPresented' },
      { threadId: 'root', turnId: 'async', itemId: 'compact', reason: 'compactionNotPresented' },
    ]));
  });

  it('uses parentThreadId to retain unresolved child scope', () => {
    const child = thread('orphan-child', 'root', [{ id: 'child-turn', status: 'completed', startedAt: 170, completedAt: 171,
      items: [{ type: 'agentMessage', id: 'child-text', text: 'Nested' }], itemsView: 'full' }]);
    const result = projectCodexHistory('session', { rootThreadId: 'root', threads: [thread('root', null, []), child] });
    const parentToolUseId = '["root","orphan-child","unresolved-parent-tool"]';
    expect(result.events).toContainEqual(expect.objectContaining({ eventType: 'text_delta', delta: 'Nested', parentToolUseId }));
    expect(result.skippedItems).toContainEqual({ threadId: 'orphan-child', turnId: 'child-turn', itemId: 'orphan-child', reason: 'unresolvedParentTool' });
  });

  it('links a child through a non-spawn collaboration tool and nests a grandchild', () => {
    const rootTurn: CodexHistoryTurn = { id: 'parent-turn', status: 'completed', startedAt: 180, completedAt: 181,
      items: [{ type: 'collabAgentToolCall', id: 'resume-child', senderThreadId: 'root', receiverThreadIds: ['child'], status: 'completed', tool: 'resumeAgent', agentsStates: {} }], itemsView: 'full' };
    const childTurn: CodexHistoryTurn = { id: 'child-turn', status: 'completed', startedAt: 182, completedAt: 183,
      items: [{ type: 'collabAgentToolCall', id: 'spawn-grandchild', senderThreadId: 'child', receiverThreadIds: ['grandchild'], status: 'completed', tool: 'spawnAgent', agentsStates: {} }], itemsView: 'full' };
    const grandchildTurn: CodexHistoryTurn = { id: 'grandchild-turn', status: 'completed', startedAt: 184, completedAt: 185,
      items: [{ type: 'agentMessage', id: 'grandchild-answer', text: 'Deep' }], itemsView: 'full' };
    const result = projectCodexHistory('session', { rootThreadId: 'root', threads: [
      thread('root', null, [rootTurn]), thread('child', 'root', [childTurn]), thread('grandchild', 'child', [grandchildTurn]),
    ] });
    expect(result.skippedItems).toEqual([]);
    expect(result.events).not.toContainEqual(expect.objectContaining({ eventType: 'agent_start', agentId: 'child', toolCallId: 'resume-child' }));
    expect(result.events).toContainEqual(expect.objectContaining({ eventType: 'agent_start', agentId: 'grandchild', toolCallId: 'spawn-grandchild', parentToolUseId: 'spawn-grandchild' }));
    expect(result.events).toContainEqual(expect.objectContaining({ eventType: 'text_delta', delta: 'Deep', parentToolUseId: 'spawn-grandchild' }));
  });

  it('uses a collaboration tool from another thread when parentThreadId differs', () => {
    const ownerTurn: CodexHistoryTurn = { id: 'owner-turn', status: 'completed', startedAt: 186, completedAt: 187,
      items: [{ type: 'collabAgentToolCall', id: 'cross-thread-spawn', senderThreadId: 'owner', receiverThreadIds: ['cross-child'], status: 'completed', tool: 'spawnAgent', agentsStates: {} }], itemsView: 'full' };
    const childTurn: CodexHistoryTurn = { id: 'cross-child-turn', status: 'completed', startedAt: 188, completedAt: 189,
      items: [{ type: 'agentMessage', id: 'cross-answer', text: 'Cross-thread answer' }], itemsView: 'full' };
    const result = projectCodexHistory('session', { rootThreadId: 'root', threads: [
      thread('root', null, []), thread('owner', 'root', [ownerTurn]), thread('cross-child', 'root', [childTurn]),
    ] });
    expect(result.events).toContainEqual(expect.objectContaining({ eventType: 'text_delta', delta: 'Cross-thread answer', parentToolUseId: 'cross-thread-spawn' }));
    expect(result.skippedItems).not.toContainEqual(expect.objectContaining({ threadId: 'cross-child', reason: 'unresolvedParentTool' }));
  });

  it('does not nest the root or a child under a collaboration tool in that child', () => {
    const rootTurn: CodexHistoryTurn = { id: 'root-turn', status: 'completed', startedAt: 190, completedAt: 191,
      items: [{ type: 'agentMessage', id: 'root-answer', text: 'Root answer' }], itemsView: 'full' };
    const childTurn: CodexHistoryTurn = { id: 'child-turn', status: 'completed', startedAt: 192, completedAt: 193,
      items: [
        { type: 'collabAgentToolCall', id: 'child-message', senderThreadId: 'child', receiverThreadIds: ['root', 'child'], status: 'completed', tool: 'sendInput', agentsStates: {} },
        { type: 'agentMessage', id: 'child-answer', text: 'Child answer' },
      ], itemsView: 'full' };
    const result = projectCodexHistory('session', { rootThreadId: 'root', threads: [
      thread('root', null, [rootTurn]), thread('child', 'root', [childTurn]),
    ] });
    const rootEvents = result.events.filter((event) => event.messageId === '["root","root-turn"]');
    expect(rootEvents.length).toBeGreaterThan(0);
    expect(rootEvents.every((event) => !('parentToolUseId' in event))).toBe(true);
    expect(result.events).toContainEqual(expect.objectContaining({
      eventType: 'text_delta', delta: 'Child answer',
      parentToolUseId: '["root","child","unresolved-parent-tool"]',
    }));
    expect(result.skippedItems).toContainEqual(expect.objectContaining({ threadId: 'child', reason: 'unresolvedParentTool' }));
  });

  it('does not link an ancestor under a descendant tool', () => {
    const childTurn: CodexHistoryTurn = { id: 'child-turn', status: 'completed', startedAt: 194, completedAt: 195,
      items: [{ type: 'agentMessage', id: 'child-answer', text: 'Child answer' }], itemsView: 'full' };
    const grandchildTurn: CodexHistoryTurn = { id: 'grandchild-turn', status: 'completed', startedAt: 196, completedAt: 197,
      items: [{ type: 'collabAgentToolCall', id: 'message-ancestor', senderThreadId: 'grandchild', receiverThreadIds: ['child'], status: 'completed', tool: 'sendInput', agentsStates: {} }], itemsView: 'full' };
    const result = projectCodexHistory('session', { rootThreadId: 'root', threads: [
      thread('root', null, []), thread('child', 'root', [childTurn]), thread('grandchild', 'child', [grandchildTurn]),
    ] });
    expect(result.events).toContainEqual(expect.objectContaining({
      eventType: 'text_delta', delta: 'Child answer',
      parentToolUseId: '["root","child","unresolved-parent-tool"]',
    }));
    expect(result.events).not.toContainEqual(expect.objectContaining({ eventType: 'agent_start', agentId: 'child', toolCallId: 'message-ancestor' }));
  });

  it('records unsupported items without crashing or exposing their payload', () => {
    const unknown = JSON.parse('{"type":"futureSecretItem","id":"unknown-1","secret":"keep-private"}') as CodexHistoryTurn['items'][number];
    const root = snapshot.threads[0];
    const turn = root.turns[0];
    const changed: CodexSessionHistory = { rootThreadId: 'root', threads: [{ ...root, turns: [{ ...turn, items: [...turn.items, unknown] }] }] };
    const result = projectCodexHistory('session', changed);
    expect(result.skippedItems).toEqual([{ threadId: 'root', turnId: 'turn-1', itemId: 'unknown-1', reason: 'unsupportedItem' }]);
    expect(JSON.stringify(result.events)).not.toContain('keep-private');
  });
});
