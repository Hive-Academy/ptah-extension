import 'reflect-metadata';
import { classifyCacheTtl, MainRequestTracker } from './idle-request-tracker';

const assistant = (id: string, cacheCreation?: { ephemeral_1h_input_tokens: number; ephemeral_5m_input_tokens: number }) => ({
  type: 'assistant',
  parent_tool_use_id: null,
  message: {
    id,
    usage: {
      input_tokens: 10,
      output_tokens: 2,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: cacheCreation ? cacheCreation.ephemeral_1h_input_tokens + cacheCreation.ephemeral_5m_input_tokens : 0,
      ...(cacheCreation ? { cache_creation: cacheCreation } : {}),
    },
  },
});

describe('classifyCacheTtl', () => {
  const base = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 };
  it.each([
    [undefined, 'not-1h'],
    [{ ...base, cacheWriteByTtl: { '1h': 5, '5m': 0 } }, '1h'],
    [{ ...base, cacheWriteByTtl: { '1h': 5, '5m': 1 } }, 'not-1h'],
    [{ ...base, cacheWriteByTtl: { '1h': 0, '5m': 0 } }, 'not-1h'],
    [base, 'not-1h'],
  ] as const)('classifies %p as %s', (usage, expected) => {
    expect(classifyCacheTtl(usage)).toBe(expected);
  });
});

describe('MainRequestTracker', () => {
  it('uses construction time to anchor a delayed first response (AC 1.2)', () => {
    const tracker = new MainRequestTracker(0);
    expect(tracker.observe(assistant('first', { ephemeral_1h_input_tokens: 20, ephemeral_5m_input_tokens: 0 }), 420_000)).toBe('request-started');
    expect(tracker.endTurn(421_000)).toEqual({ requestKey: 'first', anchorAt: 0, ttl: '1h' });
  });

  it('takes the last request, even when an earlier request wrote 1h cache', () => {
    const tracker = new MainRequestTracker(0);
    tracker.observe(assistant('first', { ephemeral_1h_input_tokens: 20, ephemeral_5m_input_tokens: 0 }), 100);
    tracker.observe({ type: 'user' }, 10_000);
    expect(tracker.observe(assistant('second'), 12_000)).toBe('request-started');
    expect(tracker.endTurn(13_000)).toEqual({ requestKey: 'second', anchorAt: 5_000, ttl: 'not-1h' });
  });

  it('deduplicates partial and assistant frames for the same request', () => {
    const tracker = new MainRequestTracker(0);
    expect(tracker.observe({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'message_start', message: { id: 'a' } } }, 1)).toBe('request-started');
    expect(tracker.observe(assistant('a', { ephemeral_1h_input_tokens: 2, ephemeral_5m_input_tokens: 0 }), 2)).toBeNull();
    expect(tracker.endTurn(3)?.ttl).toBe('1h');
    expect(tracker.endTurn(4)).toBeNull();
  });

  it('ignores subagent frames and tolerates malformed frames', () => {
    const tracker = new MainRequestTracker(0);
    expect(tracker.observe({ ...assistant('sub'), parent_tool_use_id: 'tool' }, 1)).toBeNull();
    expect(tracker.observe({ type: 'assistant', message: null }, 2)).toBeNull();
    expect(tracker.observe(null, 3)).toBeNull();
    expect(tracker.endTurn(4)).toBeNull();
  });
});
