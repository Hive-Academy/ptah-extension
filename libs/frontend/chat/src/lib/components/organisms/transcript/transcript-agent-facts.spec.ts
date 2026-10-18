import {
  createExecutionChatMessage,
  createExecutionNode,
  type ExecutionChatMessage,
  type ExecutionNode,
} from '@ptah-extension/shared';
import { collectTurnAgentFacts } from './transcript-agent-facts';

const SENTINEL = 'SENTINEL-623-agent-private';

const ALLOWED_NODE_FIELDS = [
  'id',
  'toolCallId',
  'agentId',
  'agentType',
  'startTime',
  'tokens',
  'cost',
  'durationMs',
  'status',
];

function user(id: string, timestamp: number): ExecutionChatMessage {
  return createExecutionChatMessage({ id, role: 'user', timestamp });
}

function assistant(
  id: string,
  timestamp: number,
  children: readonly ExecutionNode[],
): ExecutionChatMessage {
  return createExecutionChatMessage({
    id,
    role: 'assistant',
    timestamp,
    streamingState: createExecutionNode({
      id: `${id}-root`,
      type: 'message',
      status: 'complete',
      children,
    }),
  });
}

/** A Task tool node with its agent node, the shape the tree builder emits. */
function taskTool(
  toolCallId: string,
  agent: ExecutionNode | null,
  toolName = 'Task',
): ExecutionNode {
  return createExecutionNode({
    id: `tool-${toolCallId}`,
    type: 'tool',
    status: 'complete',
    toolName,
    toolCallId,
    children: agent === null ? [] : [agent],
  });
}

function agent(
  id: string,
  toolCallId: string | undefined,
  extra: Partial<ExecutionNode> = {},
): ExecutionNode {
  return createExecutionNode({
    id,
    type: 'agent',
    status: 'complete',
    ...(toolCallId !== undefined ? { toolCallId } : {}),
    ...extra,
  });
}

describe('collectTurnAgentFacts', () => {
  describe('turn attribution (D7)', () => {
    it('gives one entry per user message, started at its timestamp', () => {
      const messages = [
        user('u1', 1_000),
        assistant('a1', 1_100, [taskTool('t1', agent('n1', 't1'))]),
        user('u2', 2_000),
        assistant('a2', 2_100, [taskTool('t2', agent('n2', 't2'))]),
        assistant('a3', 2_200, [taskTool('t3', agent('n3', 't3'))]),
      ];

      const turns = collectTurnAgentFacts(messages);

      expect(turns.map((turn) => turn.startedAt)).toEqual([1_000, 2_000]);
      expect(turns.map((turn) => turn.nodes.map((n) => n.id))).toEqual([
        ['n1'],
        ['n2', 'n3'],
      ]);
      expect(turns.map((turn) => turn.spawnToolCallIds)).toEqual([
        ['t1'],
        ['t2', 't3'],
      ]);
    });

    it('keeps a turn whose user message has no reply yet (CLI lane window)', () => {
      const turns = collectTurnAgentFacts([
        user('u1', 1_000),
        assistant('a1', 1_100, []),
        user('u2', 2_000),
      ]);

      expect(turns).toEqual([
        { startedAt: 1_000, nodes: [], spawnToolCallIds: [] },
        { startedAt: 2_000, nodes: [], spawnToolCallIds: [] },
      ]);
    });

    it('includes an active tree missing from the live assistant record', () => {
      const activeTree = createExecutionNode({
        id: 'live-a1',
        type: 'message',
        children: [taskTool('t-live', agent('n-live', 't-live'))],
      });

      const turns = collectTurnAgentFacts(
        [
          user('u1', 1_000),
          createExecutionChatMessage({
            id: 'a1',
            role: 'assistant',
            timestamp: 1_100,
          }),
        ],
        [activeTree],
      );

      expect(turns[0].nodes.map((node) => node.id)).toEqual(['n-live']);
      expect(turns[0].spawnToolCallIds).toEqual(['t-live']);
    });

    it('does not collect an active tree twice when its record already carries it', () => {
      const tree = createExecutionNode({
        id: 'a1-root',
        type: 'message',
        children: [taskTool('t1', agent('n1', 't1'))],
      });

      const turns = collectTurnAgentFacts(
        [
          user('u1', 1_000),
          createExecutionChatMessage({
            id: 'a1',
            role: 'assistant',
            timestamp: 1_100,
            streamingState: tree,
          }),
        ],
        [tree],
      );

      expect(turns[0].nodes.map((node) => node.id)).toEqual(['n1']);
    });

    it('attributes nothing before the first user message', () => {
      const turns = collectTurnAgentFacts([
        assistant('a0', 500, [taskTool('t0', agent('n0', 't0'))]),
        user('u1', 1_000),
        assistant('a1', 1_100, [taskTool('t1', agent('n1', 't1'))]),
      ]);

      expect(turns).toHaveLength(1);
      expect(turns[0].nodes.map((n) => n.id)).toEqual(['n1']);
      expect(turns[0].spawnToolCallIds).toEqual(['t1']);
    });

    it('skips system messages and legacy assistant messages with no tree', () => {
      const turns = collectTurnAgentFacts([
        user('u1', 1_000),
        createExecutionChatMessage({
          id: 's1',
          role: 'system',
          timestamp: 1_050,
          streamingState: createExecutionNode({
            id: 's-root',
            type: 'message',
            children: [taskTool('t-sys', agent('n-sys', 't-sys'))],
          }),
        }),
        createExecutionChatMessage({
          id: 'a-legacy',
          role: 'assistant',
          timestamp: 1_060,
        }),
      ]);

      expect(turns).toEqual([
        { startedAt: 1_000, nodes: [], spawnToolCallIds: [] },
      ]);
    });

    it('walks the whole tree in execution order, nested agents included', () => {
      const nested = taskTool('t-inner', agent('n-inner', 't-inner'));
      const outer = agent('n-outer', 't-outer', { children: [nested] });
      const turns = collectTurnAgentFacts([
        user('u1', 1_000),
        assistant('a1', 1_100, [
          taskTool('t-outer', outer),
          taskTool(
            't-agent-tool',
            agent('n-agent-tool', 't-agent-tool'),
            'Agent',
          ),
        ]),
      ]);

      expect(turns[0].nodes.map((n) => n.id)).toEqual([
        'n-outer',
        'n-inner',
        'n-agent-tool',
      ]);
      expect(turns[0].spawnToolCallIds).toEqual([
        't-outer',
        't-inner',
        't-agent-tool',
      ]);
    });

    it('lists each spawn tool call id once and ignores other tools', () => {
      const turns = collectTurnAgentFacts([
        user('u1', 1_000),
        assistant('a1', 1_100, [
          taskTool('t1', agent('n1', 't1')),
          createExecutionNode({
            id: 'bash',
            type: 'tool',
            toolName: 'Bash',
            toolCallId: 'bash-1',
          }),
        ]),
        assistant('a2', 1_200, [taskTool('t1', null)]),
      ]);

      expect(turns[0].spawnToolCallIds).toEqual(['t1']);
    });
  });

  describe('A3: subagent records match by the Task tool_use id', () => {
    it('R5.9(d): a record-only agent finds its turn through the Task tool node', () => {
      // A background subagent: the Task tool node is in the tree, and no agent
      // node carries values. The record's parentToolUseId is the tool's id.
      const turns = collectTurnAgentFacts([
        user('u1', 1_000),
        assistant('a1', 1_100, [taskTool('toolu_bg', null)]),
        user('u2', 2_000),
        assistant('a2', 2_100, []),
      ]);

      expect(turns[0].nodes).toEqual([]);
      expect(turns[0].spawnToolCallIds).toEqual(['toolu_bg']);
      expect(turns[1].spawnToolCallIds).not.toContain('toolu_bg');
    });

    it('keeps a background placeholder out of N but its id in the spawn list', () => {
      const turns = collectTurnAgentFacts([
        user('u1', 1_000),
        assistant('a1', 1_100, [
          taskTool(
            'toolu_bg',
            agent('n-bg', 'toolu_bg', { isBackground: true, duration: 5 }),
          ),
        ]),
      ]);

      expect(turns[0].nodes).toEqual([]);
      expect(turns[0].spawnToolCallIds).toEqual(['toolu_bg']);
    });

    it('lists an agent node id when the agent has no Task tool node above it', () => {
      const turns = collectTurnAgentFacts([
        user('u1', 1_000),
        assistant('a1', 1_100, [agent('n1', 'toolu_direct')]),
      ]);

      expect(turns[0].spawnToolCallIds).toEqual(['toolu_direct']);
    });
  });

  describe('allow-listed fields (R5.1, D6)', () => {
    it('copies the allowed fields, summing input and output tokens', () => {
      const turns = collectTurnAgentFacts([
        user('u1', 1_000),
        assistant('a1', 1_100, [
          taskTool(
            't1',
            agent('n1', 't1', {
              status: 'streaming',
              agentId: 'adcecb2',
              agentType: 'frontend-developer',
              startTime: 1_150,
              tokenUsage: { input: 600, output: 400, cacheRead: 9_000 },
              cost: 0.1,
              duration: 4_200,
            }),
          ),
        ]),
      ]);

      expect(turns[0].nodes).toEqual([
        {
          id: 'n1',
          toolCallId: 't1',
          agentId: 'adcecb2',
          agentType: 'frontend-developer',
          startTime: 1_150,
          tokens: 1_000,
          cost: 0.1,
          durationMs: 4_200,
          status: 'streaming',
        },
      ]);
    });

    it('keeps a null cost (pricing unknown) and leaves missing values absent', () => {
      const turns = collectTurnAgentFacts([
        user('u1', 1_000),
        assistant('a1', 1_100, [
          agent('n1', undefined, { agentId: 'a1', cost: null }),
          agent('n2', undefined),
        ]),
      ]);

      expect(turns[0].nodes).toEqual([
        { id: 'n1', agentId: 'a1', cost: null, status: 'complete' },
        { id: 'n2', status: 'complete' },
      ]);
    });

    it('never copies prompt, description, summary, content, tool or error text', () => {
      const leaky = agent('n1', 't1', {
        content: SENTINEL,
        agentPrompt: SENTINEL,
        agentDescription: SENTINEL,
        summaryContent: SENTINEL,
        error: SENTINEL,
        toolInput: { prompt: SENTINEL },
        toolOutput: SENTINEL,
        model: SENTINEL,
        children: [
          createExecutionNode({
            id: 'n1-text',
            type: 'text',
            content: SENTINEL,
          }),
        ],
      });
      const turns = collectTurnAgentFacts([
        user('u1', 1_000),
        assistant('a1', 1_100, [
          createExecutionNode({
            id: 'tool-t1',
            type: 'tool',
            toolName: 'Task',
            toolCallId: 't1',
            toolInput: { description: SENTINEL, prompt: SENTINEL },
            toolOutput: SENTINEL,
            children: [leaky],
          }),
        ]),
      ]);

      expect(JSON.stringify(turns)).not.toContain(SENTINEL);
      for (const fact of turns[0].nodes) {
        for (const key of Object.keys(fact)) {
          expect(ALLOWED_NODE_FIELDS).toContain(key);
        }
      }
    });
  });

  it('keeps no state between calls', () => {
    const messages = [
      user('u1', 1_000),
      assistant('a1', 1_100, [taskTool('t1', agent('n1', 't1'))]),
    ];

    const first = collectTurnAgentFacts(messages);
    const second = collectTurnAgentFacts([user('u9', 9_000)]);

    expect(second).toEqual([
      { startedAt: 9_000, nodes: [], spawnToolCallIds: [] },
    ]);
    expect(first[0].nodes.map((n) => n.id)).toEqual(['n1']);
  });

  describe('sub-agent store trees', () => {
    const messages = [
      user('u1', 1_000),
      assistant('a1', 1_100, [taskTool('parent', agent('top', 'parent'))]),
    ];

    it('adds nested and nested-of-nested agents to their parent turn in order', () => {
      const trees = new Map<string, ExecutionNode[]>([
        ['parent', [taskTool('child', agent('nested', 'child'))]],
        ['child', [taskTool('grandchild', agent('deep', 'grandchild'))]],
      ]);
      const turns = collectTurnAgentFacts(
        messages,
        [],
        (key) => trees.get(key) ?? [],
      );

      expect(turns[0].nodes.map((node) => node.id)).toEqual([
        'top',
        'nested',
        'deep',
      ]);
      expect(turns[0].spawnToolCallIds).toEqual([
        'parent',
        'child',
        'grandchild',
      ]);
    });

    it('keeps the top-level fact when a store tree repeats its key', () => {
      const turns = collectTurnAgentFacts(messages, [], (key) =>
        key === 'parent'
          ? [
              agent('store-copy', 'parent'),
              agent('nested', 'child'),
              agent('duplicate', 'child'),
            ]
          : [],
      );
      expect(turns[0].nodes.map((node) => node.id)).toEqual(['top', 'nested']);
    });

    it('keeps the first top-level fact for a repeated key', () => {
      const turns = collectTurnAgentFacts(
        [
          user('u1', 1_000),
          assistant('a1', 1_100, [
            agent('first', 'parent'),
            agent('second', 'parent'),
          ]),
        ],
        [],
        () => [],
      );
      expect(turns[0].nodes.map((node) => node.id)).toEqual(['first']);
    });

    it('guards against agent-key cycles', () => {
      const treeFor = jest.fn((key: string): ExecutionNode[] =>
        key === 'parent'
          ? [agent('nested', 'child')]
          : [agent('back', 'parent')],
      );
      const turns = collectTurnAgentFacts(messages, [], treeFor);
      expect(turns[0].nodes.map((node) => node.id)).toEqual(['top', 'nested']);
      expect(treeFor).toHaveBeenCalledTimes(2);
    });

    it('keeps the top-level fact when the store has no entry', () => {
      const turns = collectTurnAgentFacts(messages, [], () => []);
      expect(turns[0].nodes.map((node) => node.id)).toEqual(['top']);
    });

    it('does not read the store for a turn without agents', () => {
      const treeFor = jest.fn(() => []);
      collectTurnAgentFacts(
        [user('empty', 1), assistant('plain', 2, [])],
        [],
        treeFor,
      );
      expect(treeFor).not.toHaveBeenCalled();
    });
  });
});
