import {
  StreamCoalescer,
  type FlushPayload,
  type OutboundRoute,
} from './stream-coalescer';
import { ConversationKey } from './types';

function threadRoute(overrides?: Partial<OutboundRoute>): OutboundRoute {
  return {
    conversationKey: ConversationKey.for('discord', 'chan-1', 'thread-9'),
    platform: 'discord',
    externalChatId: 'chan-1',
    conversationId: 'thread-9',
    ...overrides,
  };
}

function baseRoute(): OutboundRoute {
  return {
    conversationKey: ConversationKey.for('telegram', 'chat-1'),
    platform: 'telegram',
    externalChatId: 'chat-1',
  };
}

describe('StreamCoalescer (structured routing)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('flushes with full route fields after the idle window', () => {
    const flush = jest.fn().mockResolvedValue(undefined);
    const coalescer = new StreamCoalescer(flush);

    coalescer.append(threadRoute(), 'hello');
    jest.advanceTimersByTime(800);

    expect(flush).toHaveBeenCalledTimes(1);
    const payload = flush.mock.calls[0][0] as FlushPayload;
    expect(payload).toEqual({
      conversationKey: 'discord:chan-1:thread-9',
      platform: 'discord',
      externalChatId: 'chan-1',
      conversationId: 'thread-9',
      body: 'hello',
      isFirstFlush: true,
    });
  });

  it('omits conversationId on 2-segment routes and keeps the byte-identical key', () => {
    const flush = jest.fn().mockResolvedValue(undefined);
    const coalescer = new StreamCoalescer(flush);

    coalescer.append(baseRoute(), 'hi');
    jest.advanceTimersByTime(800);

    expect(flush).toHaveBeenCalledTimes(1);
    const payload = flush.mock.calls[0][0] as FlushPayload;
    expect(payload.conversationKey).toBe('telegram:chat-1');
    expect(payload.platform).toBe('telegram');
    expect(payload.externalChatId).toBe('chat-1');
    expect(payload.conversationId).toBeUndefined();
  });

  it('keys buffers on route.conversationKey — same-key chunks concatenate, distinct keys stay separate', () => {
    const flush = jest.fn().mockResolvedValue(undefined);
    const coalescer = new StreamCoalescer(flush);

    coalescer.append(threadRoute(), 'a');
    coalescer.append(threadRoute(), 'b');
    coalescer.append(baseRoute(), 'x');
    jest.advanceTimersByTime(800);

    expect(flush).toHaveBeenCalledTimes(2);
    const bodies = new Map(
      (flush.mock.calls as Array<[FlushPayload]>).map(([p]) => [
        p.conversationKey as string,
        p.body,
      ]),
    );
    expect(bodies.get('discord:chan-1:thread-9')).toBe('ab');
    expect(bodies.get('telegram:chat-1')).toBe('x');
  });

  it('discard drops pending chunks without flushing', () => {
    const flush = jest.fn().mockResolvedValue(undefined);
    const coalescer = new StreamCoalescer(flush);
    const route = threadRoute();

    coalescer.append(route, 'doomed');
    coalescer.discard(route.conversationKey);
    jest.advanceTimersByTime(10_000);

    expect(flush).not.toHaveBeenCalled();
  });
});

describe('StreamCoalescer (complete mode)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does NOT auto-flush on idle/age/token thresholds — only an explicit drain flushes', async () => {
    const flush = jest.fn().mockResolvedValue(undefined);
    const coalescer = new StreamCoalescer(flush, { mode: 'complete' });
    const route = threadRoute();

    // Many appends, including enough chars to cross the streaming maxTokens
    // threshold (~200 tokens ≈ 800 chars). None of this should flush.
    coalescer.append(route, 'a'.repeat(500));
    coalescer.append(route, 'b'.repeat(500));
    jest.advanceTimersByTime(60_000); // far past idle (800ms) and max-age (5000ms)
    coalescer.append(route, 'c');

    expect(flush).not.toHaveBeenCalled();

    await coalescer.drain(route.conversationKey);

    expect(flush).toHaveBeenCalledTimes(1);
    const payload = flush.mock.calls[0][0] as FlushPayload;
    expect(payload.conversationKey).toBe('discord:chan-1:thread-9');
    expect(payload.body).toBe('a'.repeat(500) + 'b'.repeat(500) + 'c');
    expect(payload.isFirstFlush).toBe(true);
  });

  it('flushes the full cumulative body exactly ONCE on drain', async () => {
    const flush = jest.fn().mockResolvedValue(undefined);
    const coalescer = new StreamCoalescer(flush, { mode: 'complete' });
    const route = baseRoute();

    coalescer.append(route, 'hello ');
    coalescer.append(route, 'world');
    await coalescer.drain(route.conversationKey);

    // A second drain after the buffer is empty must not double-send.
    await coalescer.drain(route.conversationKey);

    expect(flush).toHaveBeenCalledTimes(1);
    const payload = flush.mock.calls[0][0] as FlushPayload;
    expect(payload.body).toBe('hello world');
    expect(payload.isFirstFlush).toBe(true);
  });

  it('discard drops the buffer without flushing in complete mode', () => {
    const flush = jest.fn().mockResolvedValue(undefined);
    const coalescer = new StreamCoalescer(flush, { mode: 'complete' });
    const route = threadRoute();

    coalescer.append(route, 'doomed');
    coalescer.discard(route.conversationKey);
    jest.advanceTimersByTime(60_000);

    expect(flush).not.toHaveBeenCalled();
  });
});
