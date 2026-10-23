import {
  createExecutionNode,
  type FlatStreamEventUnion,
} from '@ptah-extension/shared';
import { laneTranscriptMessages } from './lane-transcript-messages';

describe('lane transcript message adaptation', () => {
  it('keeps SDK message trees intact for the main chat bubble', () => {
    const root = createExecutionNode({
      id: 'sdk-turn',
      type: 'message',
      startTime: 10,
    });
    const [message] = laneTranscriptMessages('sdk-lane', [root]);
    expect(message.role).toBe('assistant');
    expect(message.streamingState).toBe(root);
    expect(message.id).toBe('sdk-lane:sdk-turn');
  });

  it('groups CLI thinking, tools and answer into one message without copying nodes', () => {
    const nodes = ['thinking', 'tool', 'text'].map((type, i) =>
      createExecutionNode({
        id: `node-${i}`,
        type: type as 'thinking' | 'tool' | 'text',
        startTime: i + 10,
      }),
    );
    const [message] = laneTranscriptMessages('cli-lane', nodes);
    expect(message.streamingState?.children).toEqual(nodes);
    expect(message.streamingState?.children[1]).toBe(nodes[1]);
  });

  it('renders user events as user bubbles and separates the next assistant turn', () => {
    const events: FlatStreamEventUnion[] = [
      {
        id: 'start',
        eventType: 'message_start',
        messageId: 'prompt',
        role: 'user',
        timestamp: 20,
      },
      {
        id: 'delta',
        eventType: 'text_delta',
        messageId: 'prompt',
        delta: 'Continue',
        timestamp: 21,
      },
    ];
    const nodes = [
      createExecutionNode({
        id: 'first',
        type: 'text',
        content: 'First answer',
        startTime: 10,
      }),
      createExecutionNode({
        id: 'prompt-text-0',
        type: 'text',
        content: 'Continue',
        startTime: 20,
      }),
      createExecutionNode({
        id: 'next',
        type: 'text',
        content: 'Next answer',
        startTime: 30,
      }),
    ];
    const messages = laneTranscriptMessages('lane', nodes, events);
    expect(messages.map((message) => message.role)).toEqual([
      'assistant',
      'user',
      'assistant',
    ]);
    expect(messages[1].rawContent).toBe('Continue');
    expect(messages[2].streamingState?.children).toEqual([nodes[2]]);
    expect(
      laneTranscriptMessages('lane', [nodes[0], nodes[2]], events)[1]
        .rawContent,
    ).toBe('Continue');
  });
});
