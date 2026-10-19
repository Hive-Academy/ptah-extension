import {
  createExecutionChatMessage,
  createExecutionNode,
  type ExecutionChatMessage,
  type ExecutionNode,
} from '@ptah-extension/shared';
import {
  TranscriptTurnContexts,
  turnAgentKeysOf,
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
