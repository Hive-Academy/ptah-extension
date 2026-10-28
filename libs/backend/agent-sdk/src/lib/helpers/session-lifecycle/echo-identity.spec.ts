import { randomUUID } from 'node:crypto';
import type { SDKMessageOrigin } from '../../types/sdk-types/claude-sdk.types';
import type { QueuedUserTurn } from './session-registry.service';
import { firstQueuedClientMessageId, takeAwaitingEcho } from './echo-identity';

function turn(
  clientMessageId?: string,
  origin?: SDKMessageOrigin,
): QueuedUserTurn {
  return {
    clientMessageId,
    message: {
      type: 'user',
      uuid: randomUUID(),
      session_id: 'session',
      parent_tool_use_id: null,
      origin,
      message: { role: 'user', content: 'identical text' },
    },
  };
}

describe('takeAwaitingEcho', () => {
  it.each([
    undefined,
    { kind: 'human' } as const,
    { kind: 'peer', from: 'sender' } as const,
  ])('consumes the exact UUID once regardless of origin %p', (origin) => {
    const queued = turn('client', origin);
    const rec = { awaitingEcho: queued as QueuedUserTurn | null };
    expect(takeAwaitingEcho(rec, { uuid: queued.message.uuid })).toBe(queued);
    expect(rec.awaitingEcho).toBeNull();
    expect(takeAwaitingEcho(rec, queued.message)).toBeNull();
  });

  it('keeps the slot for same-text replay and matches the later real echo', () => {
    const queued = turn('client');
    const rec = { awaitingEcho: queued as QueuedUserTurn | null };
    const historical = turn('history');
    expect(historical.message.message.content).toBe(
      queued.message.message.content,
    );
    expect(takeAwaitingEcho(rec, historical.message)).toBeNull();
    expect(rec.awaitingEcho).toBe(queued);
    expect(takeAwaitingEcho(rec, queued.message)).toBe(queued);
  });

  it.each([{}, { uuid: '' }])('rejects missing or empty UUID %p', (echo) => {
    const queued = turn();
    const rec = { awaitingEcho: queued as QueuedUserTurn | null };
    expect(takeAwaitingEcho(rec, echo)).toBeNull();
    expect(rec.awaitingEcho).toBe(queued);
  });

  it('rejects even two absent UUIDs and tolerates absent records or slots', () => {
    const queued = turn();
    delete queued.message.uuid;
    const rec = { awaitingEcho: queued as QueuedUserTurn | null };
    expect(takeAwaitingEcho(rec, queued.message)).toBeNull();
    expect(rec.awaitingEcho).toBe(queued);
    expect(takeAwaitingEcho(undefined, {})).toBeNull();
    expect(takeAwaitingEcho(null, {})).toBeNull();
    expect(takeAwaitingEcho({ awaitingEcho: null }, {})).toBeNull();
  });

  it('does not match identical text with different attachments and a different UUID', () => {
    const queued = turn();
    const other = turn();
    other.message.message.content = [
      { type: 'text', text: 'identical text' },
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'AA==' },
      },
    ];
    const rec = { awaitingEcho: queued as QueuedUserTurn | null };
    expect(takeAwaitingEcho(rec, other.message)).toBeNull();
    expect(rec.awaitingEcho).toBe(queued);
  });
});

describe('firstQueuedClientMessageId', () => {
  it('skips peers, channels and humans without ids in queue order', () => {
    const rec = {
      messageQueue: [
        turn('peer', { kind: 'peer', from: 'sender' }),
        turn('channel', { kind: 'channel', server: 'server' }),
        turn(undefined, { kind: 'human' }),
        turn('first'),
        turn('second', { kind: 'human' }),
      ],
    };
    expect(firstQueuedClientMessageId(rec)).toBe('first');
    rec.messageQueue.splice(3, 1);
    expect(firstQueuedClientMessageId(rec)).toBe('second');
  });

  it('reads entries added after yield and returns no hint when no human id exists', () => {
    const rec = {
      awaitingEcho: turn('peer', { kind: 'peer', from: 'sender' }),
      messageQueue: [] as QueuedUserTurn[],
    };
    expect(firstQueuedClientMessageId(rec)).toBeUndefined();
    rec.messageQueue.push(turn('later', { kind: 'human' }));
    expect(firstQueuedClientMessageId(rec)).toBe('later');
    expect(firstQueuedClientMessageId(undefined)).toBeUndefined();
    expect(firstQueuedClientMessageId(null)).toBeUndefined();
  });
});
