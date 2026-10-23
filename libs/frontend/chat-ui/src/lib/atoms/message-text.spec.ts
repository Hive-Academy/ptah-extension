import type {
  ExecutionChatMessage,
  ExecutionNode,
} from '@ptah-extension/shared';
import { extractMessageText } from './message-text';

function makeNode(partial: Partial<ExecutionNode>): ExecutionNode {
  return {
    id: 'n',
    type: 'text',
    content: '',
    children: [],
    ...partial,
  } as unknown as ExecutionNode;
}

function makeMessage(partial: Partial<ExecutionChatMessage>): ExecutionChatMessage {
  return {
    id: 'm',
    role: 'assistant',
    timestamp: 0,
    ...partial,
  } as unknown as ExecutionChatMessage;
}

describe('extractMessageText', () => {
  it('returns user rawContent', () => {
    expect(
      extractMessageText(makeMessage({ role: 'user', rawContent: 'hello' })),
    ).toBe('hello');
  });

  it('collects text and message nodes of an assistant tree, skipping others', () => {
    const tree = makeNode({
      type: 'message',
      content: 'intro',
      children: [
        makeNode({ type: 'text', content: 'first' }),
        makeNode({ type: 'tool', content: 'tool output' }),
        makeNode({
          type: 'agent',
          content: 'agent label',
          children: [makeNode({ type: 'text', content: 'nested' })],
        }),
      ],
    });

    expect(extractMessageText(makeMessage({ streamingState: tree }))).toBe(
      'intro\n\nfirst\n\nnested',
    );
  });

  it('falls back to rawContent for an assistant message without a tree', () => {
    expect(
      extractMessageText(
        makeMessage({ streamingState: undefined, rawContent: 'raw answer' }),
      ),
    ).toBe('raw answer');
  });

  it('returns an empty string when there is no content', () => {
    expect(extractMessageText(makeMessage({ role: 'user' }))).toBe('');
  });
});
