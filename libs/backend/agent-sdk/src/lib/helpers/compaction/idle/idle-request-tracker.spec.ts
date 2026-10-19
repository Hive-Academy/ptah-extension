import 'reflect-metadata';
import { classifyCacheTtl, MainRequestTracker } from './idle-request-tracker';

const assistant = (
  id: string,
  cacheCreation?: {
    ephemeral_1h_input_tokens: number;
    ephemeral_5m_input_tokens: number;
  },
  cacheRead = 0,
  model = 'claude',
) => ({
  type: 'assistant',
  parent_tool_use_id: null,
  message: {
    id,
    model,
    usage: {
      input_tokens: 10,
      output_tokens: 2,
      cache_read_input_tokens: cacheRead,
      cache_creation_input_tokens: cacheCreation
        ? cacheCreation.ephemeral_1h_input_tokens +
          cacheCreation.ephemeral_5m_input_tokens
        : 0,
      ...(cacheCreation ? { cache_creation: cacheCreation } : {}),
    },
  },
});

describe('classifyCacheTtl', () => {
  const base = {
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
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
    expect(
      tracker.observe(
        assistant('first', {
          ephemeral_1h_input_tokens: 20,
          ephemeral_5m_input_tokens: 0,
        }),
        420_000,
      ),
    ).toBe('request-started');
    expect(tracker.endTurn(421_000)).toMatchObject({
      requestKey: 'first',
      anchorAt: 0,
      ttl: '1h',
      cacheAnchorAt: 415_000,
      cacheWriteTokens: 20,
      cacheWriteTtl: '1h',
    });
  });

  it('anchors the first cache request of turn two near its frame after a long gap', () => {
    const tracker = new MainRequestTracker(0);
    tracker.observe(assistant('first'), 100);
    tracker.endTurn(1_000);
    tracker.observe(assistant('second', undefined, 8), 1_000_000);
    expect(tracker.endTurn(1_001_000)).toMatchObject({
      anchorAt: 1_000,
      cacheAnchorAt: 995_000,
      cacheReadTokens: 8,
    });
  });

  it('anchors the first real request after a synthetic frame near its frame', () => {
    const tracker = new MainRequestTracker(0);
    tracker.observe(assistant('previous'), 100);
    tracker.endTurn(1_000);
    tracker.observe(assistant('synthetic', undefined, 0, '<synthetic>'), 1_001);
    tracker.observe(assistant('real', undefined, 8), 1_000_000);

    expect(tracker.endTurn(1_001_000)).toMatchObject({
      requestKey: 'real',
      anchorAt: 1_000,
      cacheAnchorAt: 995_000,
      cacheReadTokens: 8,
    });
  });

  it('takes the last request, even when an earlier request wrote 1h cache', () => {
    const tracker = new MainRequestTracker(0);
    tracker.observe(
      assistant('first', {
        ephemeral_1h_input_tokens: 20,
        ephemeral_5m_input_tokens: 0,
      }),
      100,
    );
    tracker.observe({ type: 'user' }, 10_000);
    expect(tracker.observe(assistant('second'), 12_000)).toBe(
      'request-started',
    );
    expect(tracker.endTurn(13_000)).toMatchObject({
      requestKey: 'second',
      anchorAt: 5_000,
      ttl: 'not-1h',
      cacheAnchorAt: 5_000,
      cacheWriteTokens: 0,
    });
  });

  it('deduplicates partial and assistant frames for the same request', () => {
    const tracker = new MainRequestTracker(0);
    expect(
      tracker.observe(
        {
          type: 'stream_event',
          parent_tool_use_id: null,
          event: { type: 'message_start', message: { id: 'a' } },
        },
        1,
      ),
    ).toBe('request-started');
    expect(
      tracker.observe(
        assistant('a', {
          ephemeral_1h_input_tokens: 2,
          ephemeral_5m_input_tokens: 0,
        }),
        2,
      ),
    ).toBeNull();
    expect(tracker.endTurn(3)?.ttl).toBe('1h');
    expect(tracker.endTurn(4)).toBeNull();
  });

  it('ignores subagent frames and tolerates malformed frames', () => {
    const tracker = new MainRequestTracker(0);
    expect(
      tracker.observe({ ...assistant('sub'), parent_tool_use_id: 'tool' }, 1),
    ).toBeNull();
    expect(tracker.observe({ type: 'assistant', message: null }, 2)).toBeNull();
    expect(tracker.observe(null, 3)).toBeNull();
    expect(tracker.endTurn(4)).toBeNull();
  });

  it('reports the last real request cache read and a mixed write as 5m', () => {
    const tracker = new MainRequestTracker(100);
    tracker.observe(assistant('first', { ephemeral_1h_input_tokens: 3, ephemeral_5m_input_tokens: 2 }), 200);
    tracker.observe({ type: 'user' }, 8_000);
    tracker.observe(assistant('second', undefined, 8), 10_000);
    expect(tracker.endTurn(11_000)).toMatchObject({
      cacheAnchorAt: 3_000,
      cacheReadTokens: 8,
      cacheWriteTokens: 0,
      cacheWriteTtl: null,
    });

    const mixed = new MainRequestTracker(0);
    mixed.observe(assistant('mixed', { ephemeral_1h_input_tokens: 3, ephemeral_5m_input_tokens: 2 }), 1);
    expect(mixed.endTurn(2)).toMatchObject({ cacheWriteTtl: '5m', ttl: 'not-1h' });
  });

  it('preserves the real cache candidate when a synthetic assistant follows', () => {
    const tracker = new MainRequestTracker(0);
    tracker.observe(assistant('real', { ephemeral_1h_input_tokens: 2, ephemeral_5m_input_tokens: 0 }), 1);
    tracker.observe(assistant('synthetic', undefined, 0, '<synthetic>'), 2);
    expect(tracker.endTurn(3)).toMatchObject({
      requestKey: 'synthetic',
      cacheAnchorAt: 0,
      cacheWriteTtl: '1h',
    });
  });

  it('does not confirm TTL from a positive write without a split', () => {
    const tracker = new MainRequestTracker(0);
    tracker.observe({
      ...assistant('unknown'),
      message: {
        ...assistant('unknown').message,
        usage: {
          ...assistant('unknown').message.usage,
          cache_creation_input_tokens: 10,
        },
      },
    }, 1);
    expect(tracker.endTurn(2)).toMatchObject({ cacheWriteTokens: 10, cacheWriteTtl: null });
  });
});
