/**
 * ChatFollowUpQueueService (TASK_2026_884) — the chat side of the
 * backend-owned follow-up queue: item → tab bindings, the
 * `CHAT_QUEUED_MESSAGE_STATE` push (hidden tabs included), ownership, and
 * delegation to the adapter's optional queue operations.
 */

import 'reflect-metadata';

import {
  MESSAGE_TYPES,
  type FlatStreamEventUnion,
  type FollowUpQueueOperations,
  type IAgentAdapter,
  type QueuedFollowUpSnapshot,
  type QueuedFollowUpStateChange,
  type SessionId,
  type SteerQueuedFollowUpResult,
} from '@ptah-extension/shared';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { RpcUserError, type Logger } from '@ptah-extension/vscode-core';

import { ChatFollowUpQueueService } from './chat-follow-up-queue.service';
import { ChatStreamDeliveryCoordinator } from '../streaming/chat-stream-delivery-coordinator.service';
import type { WebviewManager } from '../streaming/chat-stream-broadcaster.service';

const SESSION = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const TAB_A = '11111111-2222-4333-8444-555555555555';
const TAB_B = '22222222-3333-4444-8555-666666666666';
const ID_1 = '33333333-4444-4555-8666-777777777777';
const ID_2 = '44444444-5555-4666-8777-888888888888';

interface Sent {
  readonly type: string;
  readonly payload: unknown;
}

/** In-memory provider queue implementing the optional operations. */
class FakeQueueAdapter implements Required<FollowUpQueueOperations> {
  readonly held: QueuedFollowUpSnapshot[] = [];
  private listener: ((change: QueuedFollowUpStateChange) => void) | null = null;
  unsubscribed = false;
  steerResult: SteerQueuedFollowUpResult = { ok: true };

  onQueuedFollowUpState(
    listener: (change: QueuedFollowUpStateChange) => void,
  ): () => void {
    this.listener = listener;
    return () => {
      this.unsubscribed = true;
      this.listener = null;
    };
  }

  async withdrawQueuedFollowUp(
    sessionId: SessionId,
    clientMessageId: string,
  ): Promise<boolean> {
    const index = this.held.findIndex(
      (item) => item.clientMessageId === clientMessageId,
    );
    if (index < 0) return false;
    this.held.splice(index, 1);
    this.emit({ sessionId, clientMessageId, state: 'withdrawn' });
    return true;
  }

  listQueuedFollowUps(): readonly QueuedFollowUpSnapshot[] {
    return this.held;
  }

  async steerQueuedFollowUp(): Promise<SteerQueuedFollowUpResult> {
    return this.steerResult;
  }

  hold(clientMessageId: string, content = 'follow-up'): void {
    this.held.push({ clientMessageId, content });
    this.emit({
      sessionId: SESSION as SessionId,
      clientMessageId,
      state: 'queued',
    });
  }

  emit(change: QueuedFollowUpStateChange): void {
    this.listener?.(change);
  }
}

function build(
  options: {
    adapter?: Partial<FollowUpQueueOperations>;
    registeredTab?: string;
  } = {},
) {
  const sent: Sent[] = [];
  const webviewManager: WebviewManager = {
    sendMessage: jest.fn().mockResolvedValue(undefined),
    broadcastMessage: jest.fn(async (type: string, payload: unknown) => {
      sent.push({ type, payload });
    }),
  };
  const fake = new FakeQueueAdapter();
  const adapter = (options.adapter ?? fake) as IAgentAdapter;
  const registrations = {
    find: jest.fn((id: string) =>
      options.registeredTab !== undefined && id === SESSION
        ? { tabId: options.registeredTab, realSessionId: SESSION }
        : undefined,
    ),
  };
  const logger = createMockLogger();
  const service = new ChatFollowUpQueueService(
    logger as unknown as Logger,
    webviewManager,
    adapter,
    registrations as never,
  );
  const states = () =>
    sent.filter((entry) => entry.type === MESSAGE_TYPES.CHAT_QUEUED_MESSAGE_STATE);
  return { service, fake, sent, states, logger, webviewManager };
}

describe('ChatFollowUpQueueService', () => {
  it('never infers admission from an absent held item without delivery', () => {
    const h = build();
    h.service.bind(SESSION, TAB_A, ID_1);
    expect(() => h.service.settleAccepted(SESSION, ID_1)).toThrow(RpcUserError);
    h.fake.emit({ sessionId: SESSION as SessionId, clientMessageId: ID_1, state: 'delivered' });
    expect(h.service.settleAccepted(SESSION, ID_1)).toBe('admitted');
  });

  it('advances the Stop fence before another send may enter the provider queue', () => {
    const h = build();
    const captured = h.service.stopGeneration(SESSION);
    h.service.advanceStopGeneration(SESSION);
    expect(h.service.stopGeneration(SESSION)).not.toBe(captured);
  });
  it('pushes every state change to the queuing tab', () => {
    const h = build();
    h.service.bind(SESSION, TAB_A, ID_1);
    h.fake.hold(ID_1);
    h.fake.emit({
      sessionId: SESSION as SessionId,
      clientMessageId: ID_1,
      state: 'failed',
      reason: 'The session ended.',
    });

    expect(h.states().map((entry) => entry.payload)).toEqual([
      { sessionId: SESSION, tabId: TAB_A, clientMessageId: ID_1, state: 'queued' },
      {
        sessionId: SESSION,
        tabId: TAB_A,
        clientMessageId: ID_1,
        state: 'failed',
        reason: 'The session ended.',
      },
    ]);
  });

  it('delivers the state event for a HIDDEN tab with no reveal (regression)', async () => {
    // The pre-queue bug: a hidden tab got only a statusOnly terminal copy and
    // its follow-up waited for a reveal. The state push must reach it anyway.
    const h = build();
    const streams = new ChatStreamDeliveryCoordinator(
      { warn: jest.fn() } as unknown as Logger,
      h.webviewManager,
    );
    await streams.updateViewport({ protocolVersion: 2, visibleTabIds: [TAB_B] });

    h.service.bind(SESSION, TAB_A, ID_1);
    h.fake.hold(ID_1);
    const terminal: FlatStreamEventUnion = {
      id: 'terminal-1',
      eventType: 'turn_state',
      sessionId: SESSION,
      timestamp: 2,
      messageId: `turn-state-${SESSION}`,
      phase: 'idle',
      revision: 2,
      backgroundTasks: [],
      sessionCrons: [],
      terminalReason: 'completed',
    };
    streams.publish(TAB_A, SESSION, terminal);
    await streams.flushBeforeTerminal(TAB_A);
    // The provider admits the held item as the next turn.
    h.fake.held.splice(0, 1);
    h.fake.emit({
      sessionId: SESSION as SessionId,
      clientMessageId: ID_1,
      state: 'delivered',
    });

    expect(h.states().map((entry) => entry.payload)).toEqual([
      { sessionId: SESSION, tabId: TAB_A, clientMessageId: ID_1, state: 'queued' },
      { sessionId: SESSION, tabId: TAB_A, clientMessageId: ID_1, state: 'delivered' },
    ]);
    expect(
      h.sent.some((entry) => entry.type === MESSAGE_TYPES.CHAT_STREAM_SNAPSHOT),
    ).toBe(false);
  });

  it('routes an unbound change to the live registration tab, never the active tab', () => {
    const h = build({ registeredTab: TAB_B });
    h.fake.emit({
      sessionId: SESSION as SessionId,
      clientMessageId: ID_1,
      state: 'delivered',
    });
    expect(h.states()).toEqual([
      expect.objectContaining({ payload: expect.objectContaining({ tabId: TAB_B }) }),
    ]);
  });

  it('drops a change with no binding and no registration', () => {
    const h = build();
    h.fake.emit({
      sessionId: SESSION as SessionId,
      clientMessageId: ID_1,
      state: 'delivered',
    });
    expect(h.states()).toEqual([]);
  });

  it('reports queued while held and admitted after delivery', () => {
    const h = build();
    h.service.bind(SESSION, TAB_A, ID_1);
    h.fake.hold(ID_1);
    expect(h.service.settleAccepted(SESSION, ID_1)).toBe('queued');

    h.service.bind(SESSION, TAB_A, ID_2);
    h.fake.emit({ sessionId: SESSION as SessionId, clientMessageId: ID_2, state: 'delivered' });
    expect(h.service.settleAccepted(SESSION, ID_2)).toBe('admitted');
    expect(h.service.list(SESSION, TAB_A).map((i) => i.clientMessageId)).toEqual([
      ID_1,
    ]);
  });

  it('refuses another tab: registration or held items owned elsewhere', () => {
    const registered = build({ registeredTab: TAB_A });
    expect(() => registered.service.assertTabOwnsSession(SESSION, TAB_B)).toThrow(
      RpcUserError,
    );
    expect(() => registered.service.list(SESSION, TAB_B)).toThrow(RpcUserError);

    const held = build();
    held.service.bind(SESSION, TAB_A, ID_1);
    held.fake.hold(ID_1);
    expect(() => held.service.assertTabOwnsSession(SESSION, TAB_B)).toThrow(
      RpcUserError,
    );
    expect(() => held.service.assertTabOwnsSession(SESSION, TAB_A)).not.toThrow();
  });

  it('accepts an unowned session from any tab', () => {
    const h = build();
    expect(() => h.service.assertTabOwnsSession(SESSION, TAB_B)).not.toThrow();
    expect(h.service.list(SESSION, TAB_B)).toEqual([]);
  });

  it('withdraws only the tab’s own held item', async () => {
    const h = build();
    h.service.bind(SESSION, TAB_A, ID_1);
    h.fake.hold(ID_1);

    await expect(h.service.withdraw(SESSION, TAB_A, ID_2)).resolves.toBe(false);
    await expect(h.service.withdraw(SESSION, TAB_A, ID_1)).resolves.toBe(true);
    expect(h.fake.held).toEqual([]);
    const pushed = h.states();
    expect(pushed[pushed.length - 1]?.payload).toMatchObject({
      state: 'withdrawn',
    });
  });

  it('delegates steer and unbinds a steered item', async () => {
    const h = build();
    h.service.bind(SESSION, TAB_A, ID_1);
    h.fake.hold(ID_1);
    h.fake.steerResult = { ok: false, code: 'TURN_CHANGED' };
    await expect(h.service.steer(SESSION, TAB_A, ID_1)).resolves.toEqual({
      ok: false,
      code: 'TURN_CHANGED',
    });
    h.fake.steerResult = { ok: true };
    await expect(h.service.steer(SESSION, TAB_A, ID_1)).resolves.toEqual({
      ok: true,
    });
    await expect(h.service.steer(SESSION, TAB_A, ID_1)).resolves.toEqual({
      ok: false,
      code: 'NOT_QUEUED',
    });
  });

  it('answers empty / false / UNSUPPORTED when the adapter lacks the queue', async () => {
    const h = build({ adapter: {} });
    h.service.bind(SESSION, TAB_A, ID_1);
    expect(() => h.service.settleAccepted(SESSION, ID_1)).toThrow(RpcUserError);
    h.service.bind(SESSION, TAB_A, ID_1);
    expect(h.service.list(SESSION, TAB_A)).toEqual([]);
    await expect(h.service.withdraw(SESSION, TAB_A, ID_1)).resolves.toBe(false);
    await expect(h.service.steer(SESSION, TAB_A, ID_1)).resolves.toEqual({
      ok: false,
      code: 'UNSUPPORTED',
    });
    await expect(h.service.withdrawAllForStop(SESSION)).resolves.toEqual([]);
  });

  it('withdraws every held item FIFO and skips a raced claim', async () => {
    const h = build();
    h.service.bind(SESSION, TAB_A, ID_1);
    h.fake.hold(ID_1, 'first');
    h.service.bind(SESSION, TAB_A, ID_2);
    h.fake.hold(ID_2, 'second');
    const raced = jest
      .spyOn(h.fake, 'withdrawQueuedFollowUp')
      .mockImplementationOnce(async () => false);

    await expect(h.service.withdrawAllForStop(SESSION)).resolves.toEqual([
      { clientMessageId: ID_2, content: 'second' },
    ]);
    expect(raced.mock.calls.map((call) => call[1])).toEqual([ID_1, ID_2]);
  });

  it('keeps stopping when one withdrawal throws', async () => {
    const h = build();
    h.service.bind(SESSION, TAB_A, ID_1);
    h.fake.hold(ID_1, 'first');
    h.service.bind(SESSION, TAB_A, ID_2);
    h.fake.hold(ID_2, 'second');
    jest
      .spyOn(h.fake, 'withdrawQueuedFollowUp')
      .mockRejectedValueOnce(new Error('transport closed'));

    await expect(h.service.withdrawAllForStop(SESSION)).resolves.toEqual([
      { clientMessageId: ID_2, content: 'second' },
    ]);
    expect(h.logger.warn).toHaveBeenCalled();
  });

  it('never logs message text and releases the subscription on dispose', () => {
    const h = build();
    h.service.bind(SESSION, TAB_A, ID_1);
    h.fake.hold(ID_1, 'secret follow-up text');
    h.service.dispose();
    expect(h.fake.unsubscribed).toBe(true);
    const logged = JSON.stringify([
      h.logger.debug.mock.calls,
      h.logger.info.mock.calls,
      h.logger.warn.mock.calls,
    ]);
    expect(logged).not.toContain('secret follow-up text');
  });
});
