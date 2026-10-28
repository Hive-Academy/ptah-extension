import {
  createExecutionChatMessage,
  createExecutionNode,
  type ExecutionChatMessage,
  type ExecutionNode,
  type ExecutionStatus,
} from '@ptah-extension/shared';
import type { SessionAgent } from '../../../services/session-agents/session-agent-roster';
import {
  TranscriptTurnContexts,
  liveTurnIdsOf,
  turnAgentKeysOf,
  turnAgentsOf,
} from './transcript-turn-contexts';

function messagesWithAgent(): ExecutionChatMessage[] {
  return [
    createExecutionChatMessage({ id: 'u1', role: 'user', timestamp: 1 }),
    createExecutionChatMessage({
      id: 'a1',
      role: 'assistant',
      timestamp: 2,
      streamingState: createExecutionNode({
        id: 'root',
        type: 'message',
        status: 'complete',
        children: [
          createExecutionNode({
            id: 'parent',
            type: 'agent',
            status: 'complete',
            toolCallId: 'parent-call',
          }),
        ],
      }),
    }),
  ];
}

describe('turnAgentKeysOf store trees', () => {
  it('adds nested keys to the spawning turn and guards key cycles', () => {
    const messages = messagesWithAgent();
    const contexts = new TranscriptTurnContexts().compute(messages);
    const trees = new Map<string, ExecutionNode[]>([
      [
        'parent-call',
        [
          createExecutionNode({
            id: 'child',
            type: 'agent',
            status: 'complete',
            toolCallId: 'child-call',
          }),
        ],
      ],
      [
        'child-call',
        [
          createExecutionNode({
            id: 'cycle',
            type: 'agent',
            status: 'complete',
            toolCallId: 'parent-call',
          }),
        ],
      ],
    ]);
    const treeFor = jest.fn((key: string) => trees.get(key) ?? []);

    const keys = turnAgentKeysOf(messages, contexts, treeFor);
    const turnId = contexts.get('a1')?.turnId;
    expect(turnId).toBeDefined();
    expect([...keys.get(turnId!)!]).toEqual([
      'sub:parent-call',
      'bg:parent-call',
      'sub:child-call',
      'bg:child-call',
    ]);
    expect(treeFor).toHaveBeenCalledTimes(2);
  });

  it('does not read the store for a turn without an agent', () => {
    const messages = [
      createExecutionChatMessage({ id: 'u1', role: 'user', timestamp: 1 }),
    ];
    const treeFor = jest.fn(() => []);
    expect(
      turnAgentKeysOf(
        messages,
        new TranscriptTurnContexts().compute(messages),
        treeFor,
      ).size,
    ).toBe(0);
    expect(treeFor).not.toHaveBeenCalled();
  });
});

function messagesWithSpawn(toolName: string, toolOutput: unknown,
  status: ExecutionStatus = 'complete', isError = false): ExecutionChatMessage[] {
  return [
    createExecutionChatMessage({ id: 'u1', role: 'user', timestamp: 1 }),
    createExecutionChatMessage({ id: 'a1', role: 'assistant', timestamp: 2,
      streamingState: createExecutionNode({ id: 'root', type: 'message', status: 'complete',
        children: [createExecutionNode({ id: 'spawn', type: 'tool', toolName, toolOutput, status, isError })] }),
    }),
  ];
}

describe('turn CLI lanes', () => {
  it.each(['ptah_agent_spawn', 'mcp__ptah__ptah_agent_spawn'])(
    'links a successful %s result to its spawning turn', (toolName) => {
      const messages = messagesWithSpawn(toolName, '## Agent Spawned\n**Agent ID:** agent-42\n**Status:** running');
      const contexts = new TranscriptTurnContexts().compute(messages);
      const keys = turnAgentKeysOf(messages, contexts);
      expect([...keys.get(contexts.get('a1')!.turnId)!]).toEqual(['cli:agent-42']);
    });

  it('reads replayed MCP text content and resolves the roster lane', () => {
    const messages = messagesWithSpawn('mcp__ptah__ptah_agent_spawn', {
      content: [{ type: 'text', text: '**Agent ID:** replayed-7' }],
    });
    const contexts = new TranscriptTurnContexts().compute(messages);
    const turnId = contexts.get('a1')!.turnId;
    const keys = turnAgentKeysOf(messages, contexts);
    const cli: SessionAgent = { key: 'cli:replayed-7', kind: 'cli', name: 'CLI', cliId: 'codex',
      agentType: null, status: 'running', startedAt: 1, endedAt: null, activity: null, openRequestIds: [] };
    expect(turnAgentsOf(keys, [cli], new Map()).get(turnId)).toEqual([cli]);
  });

  it.each([
    ['error', false, '**Agent ID:** failed-1'],
    ['complete', true, '**Agent ID:** failed-2'],
    ['complete', false, 'Spawn failed'],
  ] as const)('ignores failed or missing spawn output (%s, %s)', (status, isError, output) => {
    const messages = messagesWithSpawn('ptah_agent_spawn', output, status, isError);
    expect(turnAgentKeysOf(messages, new TranscriptTurnContexts().compute(messages)).size).toBe(0);
  });

  it('keeps a running CLI lane from making its completed turn live', () => {
    const cli: SessionAgent = { key: 'cli:agent-42', kind: 'cli', name: 'CLI', cliId: 'codex',
      agentType: null, status: 'running', startedAt: 1, endedAt: null, activity: null, openRequestIds: [] };
    const turnAgents = new Map([['turn', [cli]]]);
    expect(liveTurnIdsOf(new Set(), turnAgents).size).toBe(0);
    expect(liveTurnIdsOf(new Set(['turn']), new Map([['turn', [cli]]])).has('turn')).toBe(true);
    expect(liveTurnIdsOf(new Set(), new Map([['turn', [{ ...cli, key: 'sub:call', kind: 'subagent' }]]])).has('turn')).toBe(true);
  });
});
