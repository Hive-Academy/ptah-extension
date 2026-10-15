import type { ToolStartEvent, TextDeltaEvent } from '@ptah-extension/shared';
import {
  createEmptyStreamingState,
  setStreamingEventCapped,
  STREAMING_EVENT_CAP,
} from '@ptah-extension/chat-types';

function start(
  id: string,
  timestamp: number,
  parentToolUseId?: string,
): ToolStartEvent {
  return {
    id,
    eventType: 'tool_start',
    toolCallId: id,
    toolName: 'TodoWrite',
    isTaskTool: false,
    messageId: 'message',
    sessionId: 'session',
    timestamp,
    parentToolUseId,
  };
}

describe('TodoWrite streaming marker', () => {
  it('records top-level starts and ignores sub-agent starts', () => {
    const state = createEmptyStreamingState();
    setStreamingEventCapped(state, start('parent', 1));
    setStreamingEventCapped(state, start('child', 2, 'agent'));
    expect(state.latestTodoWrite).toEqual({
      toolCallId: 'parent',
      timestamp: 1,
    });
  });

  it('updates before same-id replacement and ignores older timestamps', () => {
    const state = createEmptyStreamingState();
    setStreamingEventCapped(state, start('same', 1));
    setStreamingEventCapped(state, start('same', 3));
    setStreamingEventCapped(state, start('older', 2));
    expect(state.latestTodoWrite).toEqual({ toolCallId: 'same', timestamp: 3 });
  });

  it('retains the marker after FIFO eviction', () => {
    const state = createEmptyStreamingState();
    setStreamingEventCapped(state, start('todo', 1));
    for (let i = 0; i < STREAMING_EVENT_CAP; i++) {
      const event: TextDeltaEvent = {
        id: `delta-${i}`,
        eventType: 'text_delta',
        messageId: 'message',
        sessionId: 'session',
        timestamp: i + 2,
        blockIndex: 0,
        delta: 'x',
      };
      setStreamingEventCapped(state, event);
    }
    expect(state.events.has('todo')).toBe(false);
    expect(state.latestTodoWrite).toEqual({ toolCallId: 'todo', timestamp: 1 });
  });
});
