/**
 * SurfaceSubmitTurnService — the dispatch deadline (TASK_2026_538, batch 11
 * review F1).
 *
 * A send that never settles must not hold the per-record guard forever: at
 * the deadline the dispatch resolves `indeterminate` (never an invented
 * failure), the guard is released, and a late settlement of the stalled send
 * is logged only. It cannot change the returned outcome or release the guard
 * of a newer dispatch. The runtime's `require-idle` admission, not this
 * guard, is what keeps two live sends from both starting a turn.
 */

import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import type { SessionLifecycleManager } from '@ptah-extension/agent-sdk';
import type { IAgentAdapter } from '@ptah-extension/shared';

import {
  SURFACE_SUBMIT_DEADLINE_DETAIL,
  SURFACE_SUBMIT_DISPATCH_DEADLINE_MS,
  SurfaceSubmitTurnService,
  type SurfaceSubmitTurnOptions,
} from './surface-submit-turn.service';
import type { ChatStreamBroadcaster } from '../streaming/chat-stream-broadcaster.service';

const TAB = 'tab-1';

interface Deferred {
  readonly promise: Promise<void>;
  resolve(): void;
  reject(error: unknown): void;
}
function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(options?: SurfaceSubmitTurnOptions) {
  const record = {
    tabId: TAB,
    realSessionId: null,
    turnInFlight: false,
    messageQueue: [] as unknown[],
  };
  const sendMessageToSession = jest.fn(
    async (_id: string, _content: string, _options?: unknown): Promise<void> =>
      undefined,
  );
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const service = new SurfaceSubmitTurnService(
    logger as unknown as Logger,
    {
      isSessionActive: jest.fn(() => true),
      sendMessageToSession,
    } as unknown as IAgentAdapter,
    {
      find: jest.fn((id: string) => (id === TAB ? record : undefined)),
    } as unknown as SessionLifecycleManager,
    {
      isStreaming: jest.fn((id: string) => id === TAB),
    } as unknown as ChatStreamBroadcaster,
    options,
  );
  const stall = () => {
    const gate = deferred();
    sendMessageToSession.mockImplementationOnce(async () => gate.promise);
    return gate;
  };
  return { service, sendMessageToSession, logger, stall };
}

describe('SurfaceSubmitTurnService — dispatch deadline (review F1)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('uses a two-minute default deadline', () => {
    expect(SURFACE_SUBMIT_DISPATCH_DEADLINE_MS).toBe(120_000);
  });

  it('stays pending before the deadline and resolves indeterminate at it', async () => {
    const t = setup();
    t.stall();
    let outcome: unknown;
    void t.service.dispatch(TAB, 'content').then((value) => {
      outcome = value;
    });
    await jest.advanceTimersByTimeAsync(
      SURFACE_SUBMIT_DISPATCH_DEADLINE_MS - 1,
    );
    expect(outcome).toBeUndefined();
    await jest.advanceTimersByTimeAsync(1);
    expect(outcome).toEqual({
      status: 'indeterminate',
      detail: SURFACE_SUBMIT_DEADLINE_DETAIL,
    });
    expect(t.sendMessageToSession).toHaveBeenCalledTimes(1);
  });

  it('releases the per-record guard at the deadline, so the next submit is sent', async () => {
    const t = setup({ dispatchDeadlineMs: 1_000 });
    t.stall();
    const first = t.service.dispatch(TAB, 'first');
    await jest.advanceTimersByTimeAsync(1_000);
    expect((await first).status).toBe('indeterminate');
    await expect(t.service.dispatch(TAB, 'second')).resolves.toEqual({
      status: 'applied',
    });
    expect(t.sendMessageToSession).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['resolves', (gate: Deferred) => gate.resolve()],
    ['rejects', (gate: Deferred) => gate.reject(new Error('late failure'))],
  ])(
    'logs a send that %s after the deadline and changes nothing',
    async (_label, settle) => {
      const t = setup({ dispatchDeadlineMs: 1_000 });
      const gate = t.stall();
      const first = t.service.dispatch(TAB, 'first');
      await jest.advanceTimersByTimeAsync(1_000);
      const outcome = await first;
      settle(gate);
      await jest.advanceTimersByTimeAsync(0);
      expect(outcome).toEqual({
        status: 'indeterminate',
        detail: SURFACE_SUBMIT_DEADLINE_DETAIL,
      });
      expect(t.logger.info).toHaveBeenCalledWith(
        '[SurfaceSubmitTurn] late submit outcome ignored after the deadline',
        expect.objectContaining({ routingId: TAB }),
      );
      expect(t.sendMessageToSession).toHaveBeenCalledTimes(1);
    },
  );

  it('never lets a late settlement release a newer dispatch guard', async () => {
    const t = setup({ dispatchDeadlineMs: 1_000 });
    const stalled = t.stall();
    const first = t.service.dispatch(TAB, 'first');
    await jest.advanceTimersByTimeAsync(1_000);
    await first;
    const second = t.stall();
    const inFlight = t.service.dispatch(TAB, 'second');
    await jest.advanceTimersByTimeAsync(0);
    // The first send settles late; the second still holds the guard.
    stalled.resolve();
    await jest.advanceTimersByTimeAsync(0);
    await expect(t.service.dispatch(TAB, 'third')).resolves.toMatchObject({
      status: 'rejected',
      reason: 'busy',
    });
    expect(t.sendMessageToSession).toHaveBeenCalledTimes(2);
    second.resolve();
    await expect(inFlight).resolves.toEqual({ status: 'applied' });
  });

  it('clears the timer when the send settles first', async () => {
    const t = setup();
    await expect(t.service.dispatch(TAB, 'content')).resolves.toEqual({
      status: 'applied',
    });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('falls back to the default for a non-positive or non-finite deadline', async () => {
    for (const dispatchDeadlineMs of [0, -1, Number.NaN, Infinity]) {
      const t = setup({ dispatchDeadlineMs });
      t.stall();
      let settled = false;
      void t.service.dispatch(TAB, 'content').then(() => {
        settled = true;
      });
      await jest.advanceTimersByTimeAsync(
        SURFACE_SUBMIT_DISPATCH_DEADLINE_MS - 1,
      );
      expect(settled).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      expect(settled).toBe(true);
    }
  });
});
