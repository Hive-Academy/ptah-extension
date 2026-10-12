/**
 * SessionStreamPump — one-message-per-turn spec (TASK_2026_294).
 *
 * The regression these tests pin: a follow-up sent while a turn was generating
 * used to be yielded into the live SDK query immediately. The SDK classifies a
 * prompt arriving mid-turn as a queued command — it enqueues it, removes it,
 * writes it as a `queued_command` transcript attachment, and never materialises
 * it as a user turn. The message is silently lost.
 *
 * The pump now claims the turn before every yield and holds later messages
 * until `markTurnEnded` fires on the turn's `result`.
 */

import type { Logger } from '@ptah-extension/vscode-core';
import type { AISessionConfig, SessionId } from '@ptah-extension/shared';

import { SdkError, SessionAdmissionRefusedError } from '../../errors';
import { SessionRegistry } from './session-registry.service';
import { SessionStreamPump } from './session-stream-pump.service';
import type { SdkMessageFactory } from '../sdk-message-factory';
import type { SDKUserMessage } from '../../types/sdk-types/claude-sdk.types';

const TAB = 'tab_pump' as SessionId;

function makeLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
}

function makeMessageFactory(): SdkMessageFactory {
  return {
    createUserMessage: jest.fn(async ({ content }: { content: string }) => ({
      type: 'user',
      message: { role: 'user', content },
    })),
  } as unknown as SdkMessageFactory;
}

function textOf(message: SDKUserMessage): unknown {
  return (message as unknown as { message: { content: unknown } }).message
    .content;
}

interface Harness {
  registry: SessionRegistry;
  pump: SessionStreamPump;
  abortController: AbortController;
  iterator: AsyncIterator<SDKUserMessage>;
}

function makeHarness(): Harness {
  const logger = makeLogger();
  const registry = new SessionRegistry(logger);
  const pump = new SessionStreamPump(logger, registry, makeMessageFactory());
  const abortController = new AbortController();
  registry.register(TAB as string, {} as AISessionConfig, abortController);
  const stream = pump.createUserMessageStream(TAB, abortController);
  const iterator = stream[Symbol.asyncIterator]();
  return { registry, pump, abortController, iterator };
}

/**
 * Resolve to PENDING when `p` has not settled by the end of the macrotask
 * queue. Used to assert that the iterator is genuinely parked rather than
 * about to yield.
 */
const PENDING = Symbol('pending');
function settle<T>(p: Promise<T>): Promise<T | typeof PENDING> {
  return Promise.race([
    p,
    new Promise<typeof PENDING>((resolve) =>
      setImmediate(() => resolve(PENDING)),
    ),
  ]);
}

describe('SessionStreamPump — one message per turn (TASK_2026_294)', () => {
  it('holds a message sent while a turn is in flight, then yields it on turn end', async () => {
    const h = makeHarness();

    await h.pump.sendMessage(TAB, 'first');
    const first = await h.iterator.next();
    expect(textOf(first.value as SDKUserMessage)).toBe('first');
    expect(h.registry.find(TAB as string)?.turnInFlight).toBe(true);

    // The follow-up arrives mid-turn — exactly the incident shape.
    await h.pump.sendMessage(TAB, 'follow-up');
    const pending = h.iterator.next();
    expect(await settle(pending)).toBe(PENDING);
    expect(h.registry.find(TAB as string)?.messageQueue).toHaveLength(1);

    // The turn's `result` releases it.
    expect(h.registry.markTurnEnded(TAB as string)).toBe(true);
    expect(textOf((await pending).value as SDKUserMessage)).toBe('follow-up');
  });

  it('yields only one of several messages queued before the turn starts', async () => {
    const h = makeHarness();

    await h.pump.sendMessage(TAB, 'a');
    await h.pump.sendMessage(TAB, 'b');

    const first = await h.iterator.next();
    expect(textOf(first.value as SDKUserMessage)).toBe('a');
    expect(h.registry.find(TAB as string)?.messageQueue).toHaveLength(1);

    expect(await settle(h.iterator.next())).toBe(PENDING);
  });

  it('does not hot-spin while a message is held (parks instead of re-looping)', async () => {
    const h = makeHarness();

    await h.pump.sendMessage(TAB, 'first');
    await h.iterator.next();
    await h.pump.sendMessage(TAB, 'held');

    const pending = h.iterator.next();
    expect(await settle(pending)).toBe(PENDING);
    // Parked, not spinning: the iterator installed a wake-up callback.
    expect(h.registry.find(TAB as string)?.resolveNext).toBeInstanceOf(
      Function,
    );

    h.registry.markTurnEnded(TAB as string);
    expect(textOf((await pending).value as SDKUserMessage)).toBe('held');
  });

  it('ends the stream when the session aborts while a message is held', async () => {
    const h = makeHarness();

    await h.pump.sendMessage(TAB, 'first');
    await h.iterator.next();
    await h.pump.sendMessage(TAB, 'held');

    const pending = h.iterator.next();
    expect(await settle(pending)).toBe(PENDING);

    h.abortController.abort();
    expect((await pending).done).toBe(true);
  });

  it('markTurnEnded on an unknown session is a no-op', () => {
    const h = makeHarness();
    expect(h.registry.markTurnEnded('nope')).toBe(false);
  });

  it('sends normally once the previous turn ended (steady state)', async () => {
    const h = makeHarness();

    await h.pump.sendMessage(TAB, 'turn-1');
    expect(textOf((await h.iterator.next()).value as SDKUserMessage)).toBe(
      'turn-1',
    );
    h.registry.markTurnEnded(TAB as string);

    await h.pump.sendMessage(TAB, 'turn-2');
    expect(textOf((await h.iterator.next()).value as SDKUserMessage)).toBe(
      'turn-2',
    );
    expect(h.registry.find(TAB as string)?.turnInFlight).toBe(true);
  });
});

/**
 * A message factory whose `createUserMessage` calls stay pending until the
 * test releases them, so a race can be staged inside the pump's await.
 */
function makeDeferredMessageFactory(): {
  factory: SdkMessageFactory;
  createUserMessage: jest.Mock;
  release: (index: number) => void;
} {
  const releases: Array<() => void> = [];
  const createUserMessage = jest.fn(
    ({ content }: { content: string }) =>
      new Promise<SDKUserMessage>((resolve) => {
        releases.push(() =>
          resolve({
            type: 'user',
            message: { role: 'user', content },
          } as unknown as SDKUserMessage),
        );
      }),
  );
  return {
    factory: { createUserMessage } as unknown as SdkMessageFactory,
    createUserMessage,
    release: (index: number) => releases[index](),
  };
}

function makeDeferredHarness(): Harness & {
  createUserMessage: jest.Mock;
  release: (index: number) => void;
} {
  const logger = makeLogger();
  const registry = new SessionRegistry(logger);
  const deferred = makeDeferredMessageFactory();
  const pump = new SessionStreamPump(logger, registry, deferred.factory);
  const abortController = new AbortController();
  registry.register(TAB as string, {} as AISessionConfig, abortController);
  const stream = pump.createUserMessageStream(TAB, abortController);
  const iterator = stream[Symbol.asyncIterator]();
  return {
    registry,
    pump,
    abortController,
    iterator,
    createUserMessage: deferred.createUserMessage,
    release: deferred.release,
  };
}

/** Let pending microtasks (the pump's post-await continuation) run. */
const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

describe('SessionStreamPump — require-idle admission (TASK_2026_538)', () => {
  it('admits a message onto a live, idle session and yields it', async () => {
    const h = makeHarness();

    await h.pump.sendMessage(TAB, 'submit', undefined, undefined, {
      admission: 'require-idle',
    });

    expect(textOf((await h.iterator.next()).value as SDKUserMessage)).toBe(
      'submit',
    );
    expect(h.registry.find(TAB as string)?.turnInFlight).toBe(true);
  });

  it('refuses a missing session with reason session-ended', async () => {
    const h = makeHarness();

    const sent = h.pump.sendMessage(
      'tab_missing' as SessionId,
      'x',
      undefined,
      undefined,
      { admission: 'require-idle' },
    );

    await expect(sent).rejects.toBeInstanceOf(SessionAdmissionRefusedError);
    await expect(sent).rejects.toMatchObject({ reason: 'session-ended' });
  });

  it('keeps the generic SdkError for a missing session without admission', async () => {
    const h = makeHarness();

    const sent = h.pump.sendMessage('tab_missing' as SessionId, 'x');

    await expect(sent).rejects.toBeInstanceOf(SdkError);
    await expect(sent).rejects.not.toBeInstanceOf(
      SessionAdmissionRefusedError,
    );
  });

  it('refuses busy up front while a turn is in flight, without building a message', async () => {
    const h = makeDeferredHarness();

    const first = h.pump.sendMessage(TAB, 'first');
    h.release(0);
    await first;
    await h.iterator.next();

    await expect(
      h.pump.sendMessage(TAB, 'submit', undefined, undefined, {
        admission: 'require-idle',
      }),
    ).rejects.toMatchObject({ reason: 'busy' });
    expect(h.createUserMessage).toHaveBeenCalledTimes(1);
    expect(h.registry.find(TAB as string)?.messageQueue).toHaveLength(0);
  });

  it('refuses session-ended when the record is removed during the await, queue untouched', async () => {
    const h = makeDeferredHarness();
    const record = h.registry.find(TAB as string);
    if (!record) throw new Error('record not registered');

    const sent = h.pump.sendMessage(TAB, 'submit', undefined, undefined, {
      admission: 'require-idle',
    });
    await flush();
    h.registry.remove(record);
    h.release(0);

    await expect(sent).rejects.toBeInstanceOf(SessionAdmissionRefusedError);
    await expect(sent).rejects.toMatchObject({ reason: 'session-ended' });
    expect(record.messageQueue).toHaveLength(0);
  });

  it('refuses session-ended when the record is displaced by a re-registration during the await', async () => {
    const h = makeDeferredHarness();
    const record = h.registry.find(TAB as string);
    if (!record) throw new Error('record not registered');

    const sent = h.pump.sendMessage(TAB, 'submit', undefined, undefined, {
      admission: 'require-idle',
    });
    await flush();
    const replacement = h.registry.register(
      TAB as string,
      {} as AISessionConfig,
      new AbortController(),
    );
    h.release(0);

    await expect(sent).rejects.toMatchObject({ reason: 'session-ended' });
    expect(record.messageQueue).toHaveLength(0);
    expect(replacement.messageQueue).toHaveLength(0);
  });

  it('refuses busy when a competing message is pushed during the await', async () => {
    const h = makeDeferredHarness();

    const submit = h.pump.sendMessage(TAB, 'submit', undefined, undefined, {
      admission: 'require-idle',
    });
    const competing = h.pump.sendMessage(TAB, 'competing');
    await flush();
    h.release(1);
    await competing;
    h.release(0);

    await expect(submit).rejects.toBeInstanceOf(SessionAdmissionRefusedError);
    await expect(submit).rejects.toMatchObject({ reason: 'busy' });
    const queue = h.registry.find(TAB as string)?.messageQueue ?? [];
    expect(queue.map(textOf)).toEqual(['competing']);
  });

  it('refuses busy when a competing message starts a turn during the await', async () => {
    const h = makeDeferredHarness();

    const submit = h.pump.sendMessage(TAB, 'submit', undefined, undefined, {
      admission: 'require-idle',
    });
    const competing = h.pump.sendMessage(TAB, 'competing');
    await flush();
    h.release(1);
    await competing;
    // The iterator drains the competing message and claims the turn, so the
    // queue is empty again but a turn is in flight.
    expect(textOf((await h.iterator.next()).value as SDKUserMessage)).toBe(
      'competing',
    );
    h.release(0);

    await expect(submit).rejects.toMatchObject({ reason: 'busy' });
    expect(h.registry.find(TAB as string)?.messageQueue).toHaveLength(0);
  });

  it('refuses when the session aborts during the await, pushing nothing', async () => {
    const h = makeDeferredHarness();
    const record = h.registry.find(TAB as string);
    if (!record) throw new Error('record not registered');

    const sent = h.pump.sendMessage(TAB, 'submit', undefined, undefined, {
      admission: 'require-idle',
    });
    await flush();
    h.abortController.abort();
    h.release(0);

    await expect(sent).rejects.toBeInstanceOf(SessionAdmissionRefusedError);
    await expect(sent).rejects.toMatchObject({ reason: 'session-ended' });
    expect(record.messageQueue).toHaveLength(0);
  });

  it('without admission, holds a message sent mid-turn as before', async () => {
    const h = makeDeferredHarness();

    const first = h.pump.sendMessage(TAB, 'first');
    h.release(0);
    await first;
    await h.iterator.next();

    const followUp = h.pump.sendMessage(TAB, 'follow-up');
    await flush();
    h.release(1);
    await expect(followUp).resolves.toBeUndefined();

    const record = h.registry.find(TAB as string);
    expect(record?.turnInFlight).toBe(true);
    expect(record?.messageQueue.map(textOf)).toEqual(['follow-up']);
  });
});
