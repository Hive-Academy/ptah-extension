/**
 * StreamCoalescer — structured-routing unit tests (TASK_2026_139 D6).
 *
 * Locks the OutboundRoute contract: buffers are keyed on
 * `route.conversationKey`, and every FlushPayload carries the full route
 * (`platform` / `externalChatId` / `conversationId?`) so no consumer ever
 * re-parses the key positionally.
 */
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
