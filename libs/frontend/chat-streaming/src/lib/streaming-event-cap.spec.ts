import {
  createEmptyStreamingState,
  setStreamingEventCapped,
  STREAMING_EVENT_CAP,
} from '@ptah-extension/chat-types';
import type { TextDeltaEvent } from '@ptah-extension/shared';

function textDelta(id: string): TextDeltaEvent {
  return {
    id,
    eventType: 'text_delta',
    timestamp: 1,
    sessionId: 'session-1',
    source: 'stream',
    messageId: 'message-1',
    blockIndex: 0,
    delta: id,
  } as TextDeltaEvent;
}

describe('setStreamingEventCapped per-state cap', () => {
  it('keeps the default cap when eventCap is absent', () => {
    const state = createEmptyStreamingState();
    expect(state.eventCap).toBeUndefined();
    setStreamingEventCapped(state, textDelta('first'));
    setStreamingEventCapped(state, textDelta('second'));
    setStreamingEventCapped(state, textDelta('third'));
    expect(state.events.size).toBe(3);
    expect(STREAMING_EVENT_CAP).toBeGreaterThan(3);
  });

  it('evicts the oldest event at a smaller per-state cap', () => {
    const state = createEmptyStreamingState();
    state.eventCap = 2;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      setStreamingEventCapped(state, textDelta('first'));
      setStreamingEventCapped(state, textDelta('second'));
      setStreamingEventCapped(state, textDelta('third'));
      expect([...state.events.keys()]).toEqual(['second', 'third']);
      expect(state.events.size).toBe(2);
    } finally {
      warn.mockRestore();
    }
  });

  it('replaces an existing id without evicting at the per-state cap', () => {
    const state = createEmptyStreamingState();
    state.eventCap = 2;
    setStreamingEventCapped(state, textDelta('first'));
    setStreamingEventCapped(state, textDelta('second'));
    const replacement = textDelta('first');
    setStreamingEventCapped(state, replacement);
    expect([...state.events.keys()]).toEqual(['first', 'second']);
    expect(state.events.get('first')).toBe(replacement);
  });
});
