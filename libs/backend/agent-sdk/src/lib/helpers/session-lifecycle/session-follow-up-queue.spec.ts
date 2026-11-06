import { randomUUID } from 'node:crypto';
import type { AISessionConfig, SessionId } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import type { SdkMessageFactory } from '../sdk-message-factory';
import type { SDKUserMessage } from '../../types/sdk-types/claude-sdk.types';
import { SessionRegistry } from './session-registry.service';
import { SessionStreamPump } from './session-stream-pump.service';

const sessionId = 'follow-up-test' as SessionId;

function setup() {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
  const registry = new SessionRegistry(logger);
  const factory = {
    createUserMessage: jest.fn(
      async ({ content }: { content: string }): Promise<SDKUserMessage> => ({
        type: 'user',
        uuid: randomUUID(),
        session_id: sessionId,
        parent_tool_use_id: null,
        message: { role: 'user', content },
      }),
    ),
  } as unknown as SdkMessageFactory;
  const pump = new SessionStreamPump(logger, registry, factory);
  const abort = new AbortController();
  registry.register(sessionId, {} as AISessionConfig, abort);
  const stream = pump.createUserMessageStream(sessionId, abort);
  const iterator = stream[Symbol.asyncIterator]();
  const states: string[] = [];
  pump.onQueuedFollowUpState((change) =>
    states.push(`${change.clientMessageId}:${change.state}`),
  );
  const send = (id: string) =>
    pump.sendMessage(sessionId, id, undefined, undefined, {
      queueIntent: 'next-turn',
      clientMessageId: id,
    });
  return { registry, pump, iterator, abort, states, send, factory };
}

describe('Claude queued follow-ups', () => {
  it('holds the promoted item until result and delivers it before other held items', async () => {
    const h = setup();
    await h.send('first');
    expect((await h.iterator.next()).value?.message.content).toBe('first');
    await h.send('older');
    await h.send('selected');
    const interrupt = jest.fn().mockResolvedValue(true);
    expect(await h.pump.steerQueuedFollowUp(sessionId, 'selected', interrupt))
      .toEqual({ ok: true, mode: 'interrupt' });
    expect(interrupt).toHaveBeenCalledTimes(1);
    expect(h.pump.listQueuedFollowUps(sessionId).map((item) => item.clientMessageId))
      .toEqual(['selected', 'older']);
    h.registry.markTurnEnded(sessionId);
    expect((await h.iterator.next()).value?.message.content).toBe('selected');
    h.registry.markTurnEnded(sessionId);
    expect((await h.iterator.next()).value?.message.content).toBe('older');
    expect(h.states.filter((state) => state.endsWith(':delivered')))
      .toEqual(['first:delivered', 'selected:delivered', 'older:delivered']);
    h.abort.abort();
  });

  it('keeps the item queued in its original position when interrupt fails', async () => {
    const h = setup();
    await h.send('first');
    await h.iterator.next();
    await h.send('older');
    await h.send('selected');
    expect(await h.pump.steerQueuedFollowUp(sessionId, 'selected', async () => false))
      .toEqual({ ok: false, code: 'INTERRUPT_FAILED' });
    expect(h.pump.listQueuedFollowUps(sessionId).map((item) => item.clientMessageId))
      .toEqual(['older', 'selected']);
    h.abort.abort();
  });

  it('delivers a selected item normally while idle', async () => {
    const h = setup();
    await h.send('older');
    await h.send('selected');
    const interrupt = jest.fn();
    expect(await h.pump.steerQueuedFollowUp(sessionId, 'selected', interrupt))
      .toEqual({ ok: true, mode: 'admitted' });
    expect(interrupt).not.toHaveBeenCalled();
    expect((await h.iterator.next()).value?.message.content).toBe('selected');
    h.abort.abort();
  });
  it('holds FIFO while a turn runs and reports delivered only when claimed', async () => {
    const h = setup();
    await h.send('a');
    expect((await h.iterator.next()).value?.message.content).toBe('a');
    await h.send('b');
    await h.send('c');
    const pending = h.iterator.next();
    const marker = Symbol('still waiting');
    expect(
      await Promise.race([
        pending,
        new Promise<typeof marker>((resolve) =>
          setImmediate(() => resolve(marker)),
        ),
      ]),
    ).toBe(marker);
    expect(
      h.pump.listQueuedFollowUps(sessionId).map((item) => item.clientMessageId),
    ).toEqual(['b', 'c']);
    expect(h.registry.find(sessionId)?.turnInFlight).toBe(true);
    expect(h.states).toEqual([
      'a:queued',
      'a:delivered',
      'b:queued',
      'c:queued',
    ]);
    h.registry.markTurnEnded(sessionId);
    expect((await pending).value?.message.content).toBe('b');
    h.registry.markTurnEnded(sessionId);
    expect((await h.iterator.next()).value?.message.content).toBe('c');
    expect(h.states).toEqual([
      'a:queued',
      'a:delivered',
      'b:queued',
      'c:queued',
      'b:delivered',
      'c:delivered',
    ]);
    h.abort.abort();
  });

  it('withdraws only before claim and deduplicates an accepted ID', async () => {
    const h = setup();
    await h.send('a');
    await h.send('a');
    expect(h.pump.listQueuedFollowUps(sessionId)).toHaveLength(1);
    expect(h.pump.withdrawQueuedFollowUp(sessionId, 'a')).toBe(true);
    expect(h.pump.withdrawQueuedFollowUp(sessionId, 'a')).toBe(false);
    await h.send('b');
    await h.iterator.next();
    expect(h.pump.withdrawQueuedFollowUp(sessionId, 'b')).toBe(false);
    expect(h.states).toEqual([
      'a:queued',
      'a:withdrawn',
      'b:queued',
      'b:delivered',
    ]);
    h.abort.abort();
  });

  it('fails held items on replacement and session end', async () => {
    const h = setup();
    await h.send('old');
    h.registry.register(
      sessionId,
      {} as AISessionConfig,
      new AbortController(),
    );
    expect(h.states).toEqual(['old:queued', 'old:failed']);
    expect(h.pump.listQueuedFollowUps(sessionId)).toEqual([]);
    await h.send('new');
    const replacement = h.registry.find(sessionId);
    if (!replacement) throw new Error('missing replacement');
    h.registry.remove(replacement);
    expect(h.states).toEqual([
      'old:queued',
      'old:failed',
      'new:queued',
      'new:failed',
    ]);
  });
});
