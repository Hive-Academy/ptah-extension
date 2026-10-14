import type { FlatStreamEventUnion } from '@ptah-extension/shared';

import { StreamDeltaCoalescer } from './stream-delta-coalescer';

const delta = (
  id: string,
  messageId = 'message-1',
  source: 'stream' | undefined = 'stream',
  blockIndex = 0,
): FlatStreamEventUnion => ({
  id,
  eventType: 'text_delta',
  timestamp: Number(id.slice(-1)) || 1,
  messageId,
  blockIndex,
  delta: id,
  source,
});

describe('StreamDeltaCoalescer', () => {
  it('joins only stream deltas of one message, type and block', () => {
    const coalescer = new StreamDeltaCoalescer();
    coalescer.append(delta('a1'), 1);
    coalescer.append(delta('b1', 'message-2'), 2);
    expect(coalescer.append(delta('a2'), 3)).toBe(true);
    coalescer.append(delta('a3', 'message-1', 'stream', 1), 4);
    coalescer.append({ ...delta('a4', 'message-1', 'stream', 1), source: undefined }, 5);
    expect(coalescer.events.map(({ event }) => event.id)).toEqual([
      'a2', 'b1', 'a3', 'a4',
    ]);
    expect(coalescer.events[0].event).toMatchObject({
      delta: 'a1a2', timestamp: 2,
    });
  });

  it('closes an aggregate at same-message events and global barriers', () => {
    const coalescer = new StreamDeltaCoalescer();
    coalescer.append(delta('a1'), 1);
    coalescer.append({
      id: 'start', eventType: 'thinking_start', timestamp: 2,
      messageId: 'message-1', blockIndex: 0,
    }, 2);
    expect(coalescer.append(delta('a2'), 3)).toBe(false);
    coalescer.append({
      id: 'barrier', eventType: 'compaction_start', timestamp: 4,
      messageId: 'compaction', trigger: 'auto', preTokens: 0,
    }, 4);
    expect(coalescer.append(delta('a3'), 5)).toBe(false);
    expect(coalescer.events).toHaveLength(5);
  });

  it('preserves the latest thinking signature when a later chunk has none', () => {
    const coalescer = new StreamDeltaCoalescer();
    coalescer.append({
      id: 'first', eventType: 'thinking_delta', timestamp: 1,
      messageId: 'm', blockIndex: 0, delta: 'one', signature: 'sig', source: 'stream',
    }, 1);
    coalescer.append({
      id: 'last', eventType: 'thinking_delta', timestamp: 2,
      messageId: 'm', blockIndex: 0, delta: 'two', source: 'stream',
    }, 2);
    expect(coalescer.events[0].event).toMatchObject({
      id: 'last', timestamp: 2, delta: 'onetwo', signature: 'sig',
    });
  });
});
