import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ClaudeRpcService, LoggingService, WallClockService } from '@ptah-extension/core';
import { createMockRpcService, rpcError, rpcSuccess } from '@ptah-extension/core/testing';
import {
  AgentId,
  type AgentDeliveryReceipt,
  type ParentDeliveryState,
  type ParentDeliveryView,
} from '@ptah-extension/shared';
import { AgentDeliveryStore } from './agent-delivery.store';
import { AgentMonitorStore } from './agent-monitor.store';

const NOW = 1_800_000_000_000;
const lane = AgentId.from('00000000-0000-4000-8000-000000000001');
const resumed = AgentId.from('00000000-0000-4000-8000-000000000002');
const deliveryId = `lane-delivery:${lane}:2026-11-07T12:00:00.000Z` as const;

function receipt(overrides: Partial<AgentDeliveryReceipt> = {}): AgentDeliveryReceipt {
  return {
    id: 'message-1', agentId: lane, sender: 'user', state: 'accepted', mode: 'queue-next-turn',
    delivery: 'queue', createdAt: NOW - 5 * 60_000, updatedAt: NOW - 5 * 60_000, ...overrides,
  };
}

function parentView(state: ParentDeliveryState, overrides: Partial<ParentDeliveryView> = {}): ParentDeliveryView {
  return {
    deliveryId, agentId: lane, parentSessionId: 'parent-1', kind: 'completion', state,
    createdAt: NOW - 5 * 60_000, updatedAt: NOW - 5 * 60_000, attempts: 0, ...overrides,
  };
}

describe('AgentDeliveryStore', () => {
  let store: AgentDeliveryStore;
  let rpc: ReturnType<typeof createMockRpcService>;
  const agentsById = signal(new Map<string, { displayName?: string; cli?: string; cliSessionId?: string }>());
  const clockNow = signal(NOW);
  let acquire: jest.Mock;
  let release: jest.Mock;

  beforeEach(() => {
    rpc = createMockRpcService();
    agentsById.set(new Map());
    clockNow.set(NOW);
    release = jest.fn();
    acquire = jest.fn(() => release);
    TestBed.configureTestingModule({
      providers: [
        { provide: ClaudeRpcService, useValue: rpc },
        { provide: AgentMonitorStore, useValue: { agentsById } },
        { provide: WallClockService, useValue: { now: () => clockNow.asReadonly(), acquire } },
      ],
    });
    store = TestBed.inject(AgentDeliveryStore);
  });

  afterEach(() => TestBed.resetTestingModule());

  /** Wire data is untyped until the store validates it. */
  function hydrateWith(receipts: readonly object[], deliveries: readonly object[]): Promise<void> {
    rpc.call.mockImplementation(async (method: string) => {
      if (method === 'agent:listMessageReceipts') return rpcSuccess({ receipts });
      if (method === 'agent:listParentDeliveries') return rpcSuccess({ deliveries });
      return rpcSuccess(undefined);
    });
    return store.hydrate('parent-1');
  }

  describe('lane-to-lane sender filter', () => {
    const other = AgentId.from('00000000-0000-4000-8000-000000000003');

    beforeEach(() => {
      store.onMessageReceipt(receipt({ id: 'from-user' }));
      store.onMessageReceipt(receipt({ id: 'from-parent', sender: 'parent' }));
      store.onMessageReceipt(receipt({ id: 'lane-in-late', sender: 'lane', senderAgentId: other, createdAt: NOW - 1_000 }));
      store.onMessageReceipt(receipt({ id: 'lane-in-early', sender: 'lane', senderAgentId: other, createdAt: NOW - 2_000 }));
      store.onMessageReceipt(receipt({ id: 'lane-out', agentId: other, sender: 'lane', senderAgentId: lane }));
    });

    it('returns only lane-sent messages addressed to the lane, oldest first', () => {
      expect(store.laneMessages(lane, 'received').map(item => item.id)).toEqual(['lane-in-early', 'lane-in-late']);
    });

    it('returns the messages the lane sent to other lanes', () => {
      expect(store.laneMessages(lane, 'sent').map(item => item.id)).toEqual(['lane-out']);
      expect(store.laneMessages(other, 'received').map(item => item.id)).toEqual(['lane-out']);
    });

    it('matches a received message on the resolved lane after a cold resume', () => {
      store.onMessageReceipt(receipt({ id: 'resumed-in', sender: 'lane', senderAgentId: other, actualAgentId: resumed }));
      expect(store.laneMessages(resumed, 'received').map(item => item.id)).toEqual(['resumed-in']);
    });
  });

  describe('hydration', () => {
    it('restores queued, failed and pending-parent items after a reload with age and actions', async () => {
      await hydrateWith(
        [receipt(), receipt({ id: 'message-2', state: 'failed', reason: 'agent_stopped', hasRecoverableBody: true })],
        [parentView('pending', { kind: 'report' })],
      );
      expect(rpc.call).toHaveBeenCalledWith('agent:listMessageReceipts', { parentSessionId: 'parent-1' });
      expect(rpc.call).toHaveBeenCalledWith('agent:listParentDeliveries', { parentSessionId: 'parent-1' });
      const [queued, failed] = store.receipts().get(lane) ?? [];
      expect(store.receiptStatus(queued)).toMatchObject({ text: 'Queued · 5m', since: queued.createdAt });
      expect(store.receiptStatus(queued).actions.map((action) => action.label)).toEqual(['Cancel']);
      expect(store.receiptStatus(failed).text).toBe('Not delivered: lane stopped · 5m');
      expect(store.receiptStatus(failed).actions.map((action) => action.label)).toEqual(['Retry', 'Recover text', 'Cancel']);
      const parent = store.latestParentDelivery(lane, 'report');
      expect(parent && store.parentStatus(parent)).toMatchObject({ text: 'Waiting for parent · 5m' });
      expect(parent && store.parentStatus(parent).actions.map((action) => action.label)).toEqual(['Cancel']);
    });

    it('hydrates every session when none is selected', async () => {
      await store.hydrate();
      expect(rpc.call).toHaveBeenCalledWith('agent:listMessageReceipts', {});
      expect(rpc.call).toHaveBeenCalledWith('agent:listParentDeliveries', {});
    });

    it('does not let a stale push regress hydrated state', async () => {
      await hydrateWith([receipt({ state: 'started', updatedAt: NOW })], [parentView('delivered', { updatedAt: NOW })]);
      store.onMessageReceipt(receipt({ state: 'accepted', updatedAt: NOW - 1_000 }));
      store.onMessageReceipt(receipt({ state: 'dispatching', updatedAt: NOW }));
      expect(store.receipt(lane, 'message-1')?.state).toBe('started');
      store.onParentDelivery({ ...parentView('pending'), agentId: lane, updatedAt: NOW - 1_000 });
      expect(store.latestParentDelivery(lane, 'completion')?.state).toBe('delivered');
    });

    it('keeps a newer settled receipt when an older accepted RPC response arrives', () => {
      store.onMessageReceipt(receipt({ state: 'settled', updatedAt: 3 }));
      store.onMessageReceipt(receipt({ state: 'accepted', updatedAt: 2 }));
      expect(store.receipt(lane, 'message-1')?.state).toBe('settled');
      store.onMessageReceipt(receipt({ state: 'started', updatedAt: 3 }));
      expect(store.receipt(lane, 'message-1')?.state).toBe('settled');
    });

    it('lets a retried item move forward again with a newer timestamp', () => {
      store.onMessageReceipt(receipt({ state: 'failed', updatedAt: 2 }));
      store.onMessageReceipt(receipt({ state: 'dispatching', updatedAt: 3, attemptCount: 2 }));
      expect(store.receipt(lane, 'message-1')?.state).toBe('dispatching');
    });

    it('keeps push-only state and logs when hydration fails', async () => {
      const warn = jest.spyOn(TestBed.inject(LoggingService), 'warn').mockImplementation(() => undefined);
      store.onMessageReceipt(receipt());
      rpc.call.mockResolvedValue(rpcError('offline'));
      await store.hydrate('parent-1');
      expect(store.receipt(lane, 'message-1')?.state).toBe('accepted');
      expect(warn).toHaveBeenCalledWith('AgentDeliveryStore', expect.stringContaining('hydration failed'), 'offline');
    });

    it('refuses a hydrated receipt that fails validation', async () => {
      jest.spyOn(TestBed.inject(LoggingService), 'warn').mockImplementation(() => undefined);
      await hydrateWith([{ ...receipt(), state: 'bogus' }], []);
      expect(store.receipts().size).toBe(0);
    });
  });

  it('shows the resolved lane after a cold resume and files the receipt under both lanes', () => {
    agentsById.set(new Map([[resumed, { displayName: 'Kimi' }]]));
    store.onMessageReceipt(receipt({ state: 'started', actualAgentId: resumed }));
    expect(store.receipts().get(resumed)?.[0].id).toBe('message-1');
    expect(store.receipts().get(lane)?.[0].id).toBe('message-1');
    expect(store.receiptLabel(receipt({ state: 'started', actualAgentId: resumed }))).toBe('Delivered to lane · resumed as Kimi');
  });

  it('recovers queued text from the backend and hands it to the composer', async () => {
    rpc.call.mockResolvedValueOnce(rpcSuccess({ text: 'queued body' }));
    await store.recoverIntoComposer(resumed, lane, 'message-1');
    expect(rpc.call).toHaveBeenCalledWith('agent:getQueuedMessageBody', { agentId: lane, messageId: 'message-1' });
    expect(store.takeRecovered(resumed)).toBe('queued body');
    expect(store.takeRecovered(resumed)).toBeNull();
  });

  describe('actions', () => {
    it('cancels and retries through the RPCs', async () => {
      rpc.call.mockResolvedValueOnce(rpcSuccess(receipt({ state: 'cancelled', reason: 'cancelled-by-user', updatedAt: NOW })));
      await store.runReceiptAction(receipt(), 'cancel');
      expect(rpc.call).toHaveBeenCalledWith('agent:cancelMessage', { agentId: lane, messageId: 'message-1' });
      rpc.call.mockResolvedValueOnce(rpcSuccess({ mode: 'queue-next-turn' }));
      await store.runReceiptAction(receipt({ id: 'message-2', state: 'blocked-retryable', reason: 'awaiting-resume' }), 'retry');
      expect(rpc.call).toHaveBeenCalledWith('agent:retryMessage', { agentId: lane, messageId: 'message-2' });
    });

    it.each([
      ['outcome-unknown', receipt({ state: 'outcome-unknown' })],
      ['ever-dispatched failed', receipt({ state: 'failed', everDispatched: true })],
    ])('requires a duplicate-risk confirmation before retrying an %s item', async (_label, item) => {
      await expect(store.runReceiptAction(item, 'retry')).rejects.toThrow('Confirm the duplicate risk');
      expect(rpc.call).not.toHaveBeenCalled();
      rpc.call.mockResolvedValueOnce(rpcSuccess({ mode: 'queue-next-turn' }));
      await store.runReceiptAction(item, 'retry', true);
      expect(rpc.call).toHaveBeenCalledWith('agent:retryMessage', { agentId: lane, messageId: 'message-1', confirmDuplicateRisk: true });
    });

    it('requires confirmation for an uncertain parent delivery and then retries it', async () => {
      store.onParentDelivery({ ...parentView('outcome-unknown', { everDispatched: true }), agentId: lane });
      const item = store.latestParentDelivery(lane, 'completion');
      if (!item) throw new Error('missing parent delivery');
      await expect(store.runParentAction(item, 'retry')).rejects.toThrow('Confirm the duplicate risk');
      expect(rpc.call).not.toHaveBeenCalled();
      rpc.call.mockResolvedValueOnce(rpcSuccess(parentView('sending', { updatedAt: NOW })));
      await store.runParentAction(item, 'retry', true);
      expect(rpc.call).toHaveBeenCalledWith('agent:retryParentDelivery', { deliveryId, confirmDuplicateRisk: true });
      expect(store.latestParentDelivery(lane, 'completion')?.state).toBe('sending');
      rpc.call.mockResolvedValueOnce(rpcSuccess(parentView('cancelled', { updatedAt: NOW + 1 })));
      await store.runParentAction({ ...item, state: 'pending' }, 'cancel');
      expect(rpc.call).toHaveBeenCalledWith('agent:cancelParentDelivery', { deliveryId });
    });

    it('sends an idempotency key and reuses a supplied one', async () => {
      rpc.call.mockResolvedValue(rpcSuccess({ mode: 'queue-next-turn', receipt: receipt() }));
      await store.sendMessage(lane, 'hello');
      const first = rpc.call.mock.calls[0][1] as { idempotencyKey?: string };
      expect(first.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
      await store.sendMessage(lane, 'hello', 'queue', undefined, 'same-key');
      expect(rpc.call).toHaveBeenLastCalledWith('agent:sendMessage', {
        agentId: lane, message: 'hello', delivery: 'queue', allowPartialTurnLoss: undefined, idempotencyKey: 'same-key',
      });
      expect(store.receipt(lane, 'message-1')?.state).toBe('accepted');
    });
  });

  describe('labels', () => {
    it.each([
      [receipt({ state: 'failed', reason: 'host-restarted' }), 'Not delivered: host restarted · 5m'],
      [receipt({ state: 'expired' }), 'Lane gone — not delivered · 5m'],
    ])('shows age, Recover text and Cancel for %#', (item, text) => {
      const status = store.receiptStatus(item);
      expect(status.text).toBe(text);
      expect(status.age).toBe('5m');
      expect(status.actions.map((action) => action.label)).toEqual(expect.arrayContaining(['Recover text', 'Cancel']));
    });

    it('offers Retry for a gone lane only when a session can be resumed', () => {
      expect(store.receiptStatus(receipt({ state: 'expired' })).actions.some((action) => action.kind === 'retry')).toBe(false);
      agentsById.set(new Map([[lane, { cliSessionId: 'cli-1' }]]));
      expect(store.receiptStatus(receipt({ state: 'expired' })).actions.some((action) => action.kind === 'retry')).toBe(true);
    });

    it('labels limit and retry states', () => {
      expect(store.receiptLabel(receipt({ state: 'blocked-retryable', reason: 'lane-at-limit' }))).toBe('Lane at limit · 5m');
      expect(store.receiptLabel(receipt({ state: 'blocked-retryable', reason: 'continuation_transient', attemptCount: 3 })))
        .toBe('Retrying · attempt 3');
      expect(store.receiptStatus(receipt({ state: 'blocked-retryable', attemptCount: 3 })).actions.map((action) => action.label))
        .toEqual(['Retry now', 'Cancel']);
      expect(store.receiptLabel(receipt({ state: 'settled', turnOutcome: 'completed' }))).toBe('Turn ended · completed');
    });

    it('never overclaims with "Done" or "Sent to parent"', () => {
      const states: AgentDeliveryReceipt['state'][] = ['accepted', 'dispatching', 'started', 'settled', 'failed', 'expired',
        'interrupted-undelivered', 'blocked-retryable', 'outcome-unknown', 'cancelled'];
      const parentStates: ParentDeliveryState[] = ['pending', 'sending', 'delivered', 'blocked-retryable', 'outcome-unknown',
        'cancelled', 'not-saved'];
      const labels = [
        ...states.map((state) => store.receiptLabel(receipt({ state, turnOutcome: 'completed' }))),
        ...parentStates.map((state) => store.parentStatus({ ...parentView(state), agentId: lane }).text),
      ];
      expect(labels.join('\n')).not.toMatch(/\bDone\b|Sent to parent/);
      expect(store.parentStatus({ ...parentView('delivered'), agentId: lane }).text).toBe('Accepted by parent session');
    });

    it('shows a not-saved completion with Retry and drops it on a removed push', () => {
      store.onParentDelivery({ ...parentView('not-saved'), agentId: lane });
      const item = store.latestParentDelivery(lane, 'completion');
      expect(item && store.parentStatus(item)).toMatchObject({
        text: 'Completion not delivered — not saved · 5m',
        actions: [{ kind: 'retry', label: 'Retry', confirmDuplicateRisk: false }],
      });
      store.onParentDelivery({ ...parentView('not-saved'), agentId: lane, removed: true });
      expect(store.latestParentDelivery(lane, 'completion')).toBeUndefined();
    });

    it('keeps the acknowledgment monotonic on its own rank and ignores regressive ack pushes', () => {
      store.onMessageReceipt(receipt({ state: 'started', ackState: 'read', ackAt: 20, updatedAt: 2 }));
      store.onMessageReceipt(receipt({ state: 'settled', ackState: 'pending', updatedAt: 3 }));
      expect(store.receipt(lane, 'message-1')).toMatchObject({ state: 'settled', ackState: 'read', ackAt: 20 });

      store.onMessageReceipt(receipt({ state: 'settled', ackState: 'unavailable', updatedAt: 10 }));
      expect(store.receipt(lane, 'message-1')?.ackState).toBe('read');

      store.onMessageReceipt(receipt({ state: 'settled', ackState: 'acted', ackAt: 30, updatedAt: 11 }));
      expect(store.receipt(lane, 'message-1')).toMatchObject({ ackState: 'acted', ackAt: 30 });

      store.onMessageReceipt(receipt({ state: 'settled', ackState: 'read', ackAt: 40, updatedAt: 99 }));
      store.onMessageReceipt(receipt({ state: 'settled', ackState: 'pending', updatedAt: 100 }));
      store.onMessageReceipt(receipt({ state: 'settled', ackState: 'rejected', ackNote: 'late', updatedAt: 101 }));
      expect(store.receipt(lane, 'message-1')).toMatchObject({
        state: 'settled',
        ackState: 'acted',
        ackAt: 30,
        ackNote: undefined,
        updatedAt: 101,
      });
    });

    it('updates limit, lastError, hasRecoverableBody, and everDispatched on a newer receipt while preserving a higher-rank ack', () => {
      const resetAt = NOW + 10 * 60_000;
      store.onMessageReceipt(
        receipt({
          state: 'blocked-retryable',
          reason: 'lane-at-limit',
          limit: { known: false },
          ackState: 'read',
          ackAt: 20,
          updatedAt: 10,
        }),
      );
      store.onMessageReceipt(
        receipt({
          state: 'blocked-retryable',
          reason: 'lane-at-limit',
          limit: { known: true, resetAt },
          lastError: 'rate limited until reset',
          hasRecoverableBody: false,
          everDispatched: true,
          ackState: 'pending',
          updatedAt: 11,
        }),
      );
      expect(store.receipt(lane, 'message-1')).toMatchObject({
        limit: { known: true, resetAt },
        lastError: 'rate limited until reset',
        hasRecoverableBody: false,
        everDispatched: true,
        ackState: 'read',
        ackAt: 20,
        updatedAt: 11,
      });
    });

    it('allows newer receipts to transition between pending and unavailable at rank 0 without regressing from read', () => {
      store.onMessageReceipt(receipt({ state: 'started', ackState: 'pending', updatedAt: 10 }));
      expect(store.receipt(lane, 'message-1')?.ackState).toBe('pending');

      store.onMessageReceipt(receipt({ state: 'started', ackState: 'unavailable', updatedAt: 11 }));
      expect(store.receipt(lane, 'message-1')?.ackState).toBe('unavailable');

      store.onMessageReceipt(receipt({ state: 'started', ackState: 'pending', updatedAt: 12 }));
      expect(store.receipt(lane, 'message-1')?.ackState).toBe('pending');
    });

    it.each([
      ['pending', undefined, 'Awaiting lane ack'],
      ['read', undefined, 'Read by lane'],
      ['acted', undefined, 'Lane reports acted'],
      ['rejected', 'Needs schema migration first', 'Lane rejected: Needs schema migration first'],
      ['unavailable', undefined, 'Ack unavailable (no MCP)'],
    ] as const)('maps ackState %s to exact label "%s"', (ackState, ackNote, expected) => {
      const item = receipt({ state: 'settled', ackState, ackNote });
      expect(AgentDeliveryStore.ackLabel(item)).toBe(expected);
      expect(AgentDeliveryStore.ackLabel(ackState, ackNote)).toBe(expected);
      expect(store.receiptStatus(item).ackLabel).toBe(expected);
    });

    it('distinguishes known vs unknown limit reset times and keeps transport, turn outcome, and ack separate', () => {
      const resetAt = NOW + 15 * 60_000;
      const knownLimit = store.receiptStatus(
        receipt({ state: 'blocked-retryable', reason: 'lane-at-limit', limit: { known: true, resetAt } }),
      );
      expect(knownLimit.label).toBe('Waiting for limit reset');
      expect(knownLimit.resetAt).toBe(resetAt);
      expect(knownLimit.resetTime).toBeDefined();
      expect(knownLimit.text).toBe(`Waiting for limit reset · ${knownLimit.resetTime}`);
      expect(knownLimit.actions.map((action) => action.kind)).toEqual(['cancel']);

      const unknownLimit = store.receiptStatus(
        receipt({ state: 'blocked-retryable', reason: 'lane-at-limit', limit: { known: false } }),
      );
      expect(unknownLimit.label).toBe('Lane at limit');
      expect(unknownLimit.resetAt).toBeUndefined();
      expect(unknownLimit.resetTime).toBeUndefined();
      expect(unknownLimit.text).toBe('Lane at limit · 5m');

      const settledPending = store.receiptStatus(
        receipt({ state: 'settled', turnOutcome: 'completed', ackState: 'pending' }),
      );
      expect(settledPending.transportLabel).toBe('Delivered to lane');
      expect(settledPending.turnOutcomeLabel).toBe('Turn ended · completed');
      expect(settledPending.ackLabel).toBe('Awaiting lane ack');
      expect(settledPending.text).not.toContain('acted');
    });
  });

  it('holds the shared clock only while an item shows an age', () => {
    store.onMessageReceipt(receipt());
    TestBed.tick();
    expect(acquire).toHaveBeenCalledWith('coarse');
    clockNow.set(NOW + 60 * 60_000);
    expect(store.receiptLabel(store.receipt(lane, 'message-1') ?? receipt())).toBe('Queued · 1h');
    store.onMessageReceipt(receipt({ state: 'cancelled', updatedAt: NOW }));
    TestBed.tick();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('prunes composer previews of agents the monitor no longer holds', async () => {
    agentsById.set(new Map([[lane, {}]]));
    rpc.call.mockResolvedValueOnce(rpcSuccess({ agentId: lane, delivery: 'queue', mode: 'queue-next-turn', supported: true, usesResume: false }));
    await store.previewMessage(lane, 'queue');
    expect(store.composerState(lane).queue?.supported).toBe(true);
    agentsById.set(new Map());
    expect(store.composerState(lane).queue).toBeUndefined();
  });
});
