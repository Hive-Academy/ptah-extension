import {
  createEmptyStreamingState,
  setStreamingEventCapped,
  STREAMING_EVENT_CAP,
} from '@ptah-extension/chat-types';
import type { FlatStreamEventUnion } from '@ptah-extension/shared';

interface SeedTextDelta {
  readonly id: string;
  readonly messageId: string;
}

function makeTextDelta(id: string, messageId: string): FlatStreamEventUnion {
  return {
    id,
    eventType: 'text_delta',
    timestamp: 0,
    sessionId: 's',
    source: 'stream',
    messageId,
    delta: 'x',
    blockIndex: 0,
  } as unknown as FlatStreamEventUnion;
}

function makeToolStart(
  id: string,
  messageId: string,
  toolCallId: string,
): FlatStreamEventUnion {
  return {
    id,
    eventType: 'tool_start',
    timestamp: 0,
    sessionId: 's',
    source: 'stream',
    messageId,
    toolCallId,
    toolName: 'Bash',
    isTaskTool: false,
  } as unknown as FlatStreamEventUnion;
}

function makeAgentStart(
  id: string,
  messageId: string,
  agentId: string,
): FlatStreamEventUnion {
  return {
    id,
    eventType: 'agent_start',
    timestamp: 0,
    sessionId: 's',
    source: 'stream',
    messageId,
    toolCallId: 'tool-a',
    agentType: 'Explore',
    agentId,
  } as unknown as FlatStreamEventUnion;
}

describe('setStreamingEventCapped — cascade-clean on FIFO eviction (Batch B)', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('removes the evicted event from eventsByMessage and deletes empty buckets', () => {
    const state = createEmptyStreamingState();
    const victim = makeTextDelta('victim-0', 'm-victim');
    setStreamingEventCapped(state, victim);
    state.eventsByMessage.set('m-victim', [victim]);
    state.textAccumulators.set(`m-victim-block-0`, 'text');

    for (let i = 1; i < STREAMING_EVENT_CAP; i++) {
      const evt = makeTextDelta(`fill-${i}`, `m-fill-${i}`);
      setStreamingEventCapped(state, evt);
      state.eventsByMessage.set(`m-fill-${i}`, [evt]);
    }

    const trigger = makeTextDelta('trigger', 'm-trigger');
    setStreamingEventCapped(state, trigger);
    state.eventsByMessage.set('m-trigger', [trigger]);

    expect(state.events.has('victim-0')).toBe(false);
    expect(state.eventsByMessage.has('m-victim')).toBe(false);
    expect(state.textAccumulators.has('m-victim-block-0')).toBe(false);
  });

  it('cascade-clean removes toolCallId entries when toolCallMap bucket goes empty', () => {
    const state = createEmptyStreamingState();
    const victim = makeToolStart('tool-victim', 'm0', 'tc-victim');
    setStreamingEventCapped(state, victim);
    state.toolCallMap.set('tc-victim', [victim.id]);
    state.toolInputAccumulators.set('tc-victim-input', '{"x":1}');

    for (let i = 1; i < STREAMING_EVENT_CAP; i++) {
      const e = makeTextDelta(`pad-${i}`, `mpad-${i}`);
      setStreamingEventCapped(state, e);
    }
    setStreamingEventCapped(state, makeTextDelta('after', 'm-after'));

    expect(state.events.has('tool-victim')).toBe(false);
    expect(state.toolCallMap.has('tc-victim')).toBe(false);
    expect(state.toolInputAccumulators.has('tc-victim-input')).toBe(false);
  });

  it('cascade-clean removes agentContentBlocksMap and agentSummaryAccumulators for evicted agent_start', () => {
    const state = createEmptyStreamingState();
    const victim = makeAgentStart('agent-victim', 'm0', 'agent-X');
    setStreamingEventCapped(state, victim);
    state.agentContentBlocksMap.set('agent-X', [{ type: 'text', text: 'x' }]);
    state.agentSummaryAccumulators.set('agent-X', 'sum');

    for (let i = 1; i < STREAMING_EVENT_CAP; i++) {
      setStreamingEventCapped(state, makeTextDelta(`pad-${i}`, `mp-${i}`));
    }
    setStreamingEventCapped(state, makeTextDelta('trail', 'm-trail'));

    expect(state.events.has('agent-victim')).toBe(false);
    expect(state.agentContentBlocksMap.has('agent-X')).toBe(false);
    expect(state.agentSummaryAccumulators.has('agent-X')).toBe(false);
  });

  it('updating an existing event id is in-place; no eviction occurs', () => {
    const state = createEmptyStreamingState();
    const first = makeTextDelta('same-id', 'm-same');
    setStreamingEventCapped(state, first);

    const updated = {
      ...first,
      delta: 'updated',
    } as unknown as FlatStreamEventUnion;
    setStreamingEventCapped(state, updated);

    expect(state.events.size).toBe(1);
    expect(state.events.get('same-id')).toBe(updated);
  });

  it('preserves the parent bucket when other events still reference it', () => {
    const state = createEmptyStreamingState();
    const victim = makeTextDelta('victim-multi', 'm-shared');
    const sibling = makeTextDelta('sibling-multi', 'm-shared');
    setStreamingEventCapped(state, victim);
    setStreamingEventCapped(state, sibling);
    state.eventsByMessage.set('m-shared', [victim, sibling]);

    for (let i = 0; i < STREAMING_EVENT_CAP - 1; i++) {
      setStreamingEventCapped(state, makeTextDelta(`pad-${i}`, `mp-${i}`));
    }

    expect(state.events.has('victim-multi')).toBe(false);
    expect(state.eventsByMessage.has('m-shared')).toBe(true);
    const bucket = state.eventsByMessage.get('m-shared');
    expect(bucket?.some((e) => e.id === 'sibling-multi')).toBe(true);
    expect(bucket?.some((e) => e.id === 'victim-multi')).toBe(false);
  });
});
