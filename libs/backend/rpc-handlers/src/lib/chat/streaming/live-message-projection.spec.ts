import type { FlatStreamEventUnion } from '@ptah-extension/shared';

import { LiveMessageProjection } from './live-message-projection';

const start = (messageId: string, parentToolUseId?: string): FlatStreamEventUnion => ({
  id: `start-${messageId}`, eventType: 'message_start', timestamp: 1,
  messageId, role: 'assistant', source: 'stream', parentToolUseId,
});
const text = (
  messageId: string,
  source: 'stream' | 'complete' = 'stream',
  delta = 'x',
  parentToolUseId?: string,
): FlatStreamEventUnion => ({
  id: `text-${messageId}-${source}`, eventType: 'text_delta', timestamp: 2,
  messageId, blockIndex: 0, delta, source, parentToolUseId,
});
const complete = (
  messageId: string,
  source: 'stream' | 'complete',
  parentToolUseId?: string,
): FlatStreamEventUnion => ({
  id: `complete-${messageId}-${source}`, eventType: 'message_complete',
  timestamp: 3, messageId, source, parentToolUseId,
});
const turn = (phase: 'generating' | 'idle' | 'awaiting-background'): FlatStreamEventUnion => ({
  id: `turn-${phase}`, eventType: 'turn_state', timestamp: 4,
  messageId: 'turn-state', phase, revision: 1,
  backgroundTasks: [], sessionCrons: [], terminalReason: null,
});

describe('LiveMessageProjection', () => {
  it('keeps the real turn state when an identity-only retirement arrives', () => {
    const projection = new LiveMessageProjection();
    const real = turn('generating');
    projection.observe(real, 1);
    const retirement = { ...turn('idle'), retirementOnly: true, consumedClientMessageId: 'P' };
    projection.observe(retirement, 2);
    expect(projection.buildSeed().events).toEqual([real]);
  });
  it('seeds a pre-hide anchor and merged visible and hidden suffix in sequence order', () => {
    const projection = new LiveMessageProjection();
    projection.observe(turn('generating'), 1);
    projection.observe(start('m'), 2);
    for (let index = 0; index < 300; index++) {
      projection.observe(text('m', 'stream', String(index)), index + 3);
    }
    const seed = projection.buildSeed();
    expect(seed.events.map(({ eventType }) => eventType)).toEqual([
      'turn_state', 'message_start', 'text_delta',
    ]);
    expect(seed.events[2]).toMatchObject({ delta: Array.from({ length: 300 }, (_, i) => String(i)).join('') });
    expect(seed.blockCounts).toEqual({ m: 0 });
  });

  it('counts complete blocks, clears the suffix, and closes after stream end', () => {
    const projection = new LiveMessageProjection();
    projection.observe(start('m'), 1);
    projection.observe(text('m'), 2);
    projection.observe(text('m', 'complete'), 3);
    projection.observe({
      id: 'think', eventType: 'thinking_delta', timestamp: 4,
      messageId: 'm', blockIndex: 1, delta: 'thought', source: 'complete',
    }, 4);
    projection.observe({
      id: 'tool', eventType: 'tool_start', timestamp: 5,
      messageId: 'm', toolCallId: 'task', toolName: 'Task', isTaskTool: true,
      source: 'complete',
    }, 5);
    projection.observe(complete('m', 'complete'), 6);
    expect(projection.buildSeed()).toMatchObject({
      events: [], blockCounts: { m: 3 }, deferredAnchors: [{ event: start('m') }],
    });
    projection.observe(complete('m', 'stream'), 7);
    expect(projection.isEmpty()).toBe(true);
    projection.observe(start('m'), 8);
    expect(projection.buildSeed().blockCounts).toEqual({ m: 0 });
  });

  it('keeps root content through background wait until its complete boundary', () => {
    const projection = new LiveMessageProjection();
    projection.observe(start('root'), 1);
    projection.observe(text('root'), 2);
    projection.observe(start('sub', 'task'), 3);
    projection.observe(text('sub', 'stream', 'sub', 'task'), 4);
    projection.observe(turn('awaiting-background'), 5);
    expect(projection.buildSeed().blockCounts).toEqual({ root: 0, sub: 0 });
    projection.observe(complete('root', 'complete'), 6);
    expect(projection.buildSeed().blockCounts).toEqual({ sub: 0 });
    projection.observe({
      id: 'result', eventType: 'tool_result', timestamp: 7,
      messageId: 'other', toolCallId: 'task', output: '', isError: false,
    }, 7);
    expect(projection.buildSeed().blockCounts).toEqual({});
  });

  it('does not count subagent thinking, and clears contexts on compaction or idle', () => {
    const projection = new LiveMessageProjection();
    projection.observe(start('sub', 'task'), 1);
    projection.observe({
      id: 'think', eventType: 'thinking_delta', timestamp: 2,
      messageId: 'sub', parentToolUseId: 'task', blockIndex: 0,
      delta: 'thought', source: 'complete',
    }, 2);
    projection.observe(text('sub', 'complete', 'x', 'task'), 3);
    expect(projection.buildSeed().blockCounts).toEqual({ sub: 1 });
    projection.observe({
      id: 'compact', eventType: 'compaction_complete', timestamp: 4,
      messageId: 'compact', trigger: 'auto',
    }, 4);
    expect(projection.buildSeed().blockCounts).toEqual({});
    projection.observe(start('new'), 5);
    projection.observe(turn('idle'), 6);
    expect(projection.isEmpty()).toBe(true);
  });

  it('truncates the suffix at the byte cap but keeps counts and deferred anchors', () => {
    const projection = new LiveMessageProjection(300);
    projection.observe(start('m'), 1);
    projection.observe(text('m', 'complete'), 2);
    expect(projection.observe(text('m', 'stream', 'x'.repeat(500)), 3)).toBe(true);
    expect(projection.buildSeed().blockCounts).toEqual({ m: 1 });
    expect(projection.buildSeed().deferredAnchors).toHaveLength(1);
    projection.observe(complete('m', 'stream'), 4);
    expect(projection.buildSeed().blockCounts).toEqual({ m: 1 });
    projection.observe(complete('m', 'complete'), 5);
    expect(projection.buildSeed().blockCounts).toEqual({});
  });

  it('returns one block count for every context, including 300 deferred anchors', () => {
    const projection = new LiveMessageProjection();
    for (let index = 0; index < 300; index++) {
      projection.observe(start(`m-${index}`, `task-${index}`), index + 1);
    }
    expect(Object.keys(projection.buildSeed().blockCounts)).toHaveLength(300);
    expect(projection.buildSeed().deferredAnchors).toHaveLength(300);
  });

  it('keeps stream deltas on opposite sides of a turn state in seed order', () => {
    const projection = new LiveMessageProjection();
    projection.observe(start('m'), 1);
    projection.observe(text('m', 'stream', 'before'), 2);
    projection.observe(turn('generating'), 3);
    projection.observe(text('m', 'stream', 'after'), 4);

    expect(projection.buildSeed().events.map(({ eventType }) => eventType)).toEqual([
      'message_start', 'text_delta', 'turn_state', 'text_delta',
    ]);
    expect(projection.buildSeed().events.filter((event) => event.eventType === 'text_delta'))
      .toMatchObject([{ delta: 'before' }, { delta: 'after' }]);
  });
});
