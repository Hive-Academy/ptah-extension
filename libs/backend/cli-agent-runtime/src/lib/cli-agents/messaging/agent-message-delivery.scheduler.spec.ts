import { AgentId, type AgentProcessInfo } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import { FakeStateStorage } from '../parent-delivery/__fixtures__/fake-state-storage';
import type { NewEnvelope } from './envelope/agent-message-envelope.schema';
import {
  AgentMessageBodyUnavailableError,
  AgentMessageEnvelopeStore,
} from './envelope/agent-message-envelope.store';
import {
  AgentMessageDeliveryScheduler,
  SCHEDULER_MIN_DELAY_MS,
  type AgentMessageDeliveryTarget,
} from './agent-message-delivery.scheduler';
import {
  LANE_LIMIT_GATE_DEADLINE_MS,
  LANE_LIMIT_RESET_RETRY_DELAY_MS,
  LaneDeliveryLimitGate,
  type LimitGateDecision,
} from './lane-delivery-limit.gate';

const LANE_A = AgentId.from('aaaaaaaa-bbbb-4ccc-8ddd-000000000001');
const LANE_B = AgentId.from('aaaaaaaa-bbbb-4ccc-8ddd-000000000002');
const START = Date.UTC(2026, 10, 7);

let now = START;
const clock = (): number => now;

function logger(): Logger {
  const log: Pick<Logger, 'info' | 'warn' | 'error' | 'debug'> = {
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
  };
  return log as Logger;
}

function input(overrides: Partial<NewEnvelope> = {}): NewEnvelope {
  return {
    targetAgentId: LANE_A, laneLineageId: LANE_A, sender: { kind: 'user' }, senderKey: 'user',
    mode: 'queue-next-turn', delivery: 'queue', ...overrides,
  };
}

async function open(storage: FakeStateStorage): Promise<AgentMessageEnvelopeStore> {
  const store = new AgentMessageEnvelopeStore(storage, undefined, clock, logger());
  await store.ready;
  return store;
}

async function put(store: AgentMessageEnvelopeStore, overrides: Partial<NewEnvelope> = {}): Promise<string> {
  const { envelope } = await store.put(input(overrides), 'hello');
  return envelope.id;
}

function target(impl?: (id: string) => Promise<void>): jest.Mocked<AgentMessageDeliveryTarget> {
  return {
    deliver: jest.fn(impl ?? (() => Promise.resolve())) as
      jest.MockedFunction<AgentMessageDeliveryTarget['deliver']>,
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
}

describe('AgentMessageDeliveryScheduler', () => {
  let storage: FakeStateStorage;
  let scheduler: AgentMessageDeliveryScheduler | undefined;

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    now = START;
    storage = new FakeStateStorage();
  });

  afterEach(() => {
    scheduler?.dispose();
    scheduler = undefined;
    jest.useRealTimers();
  });

  describe('start (host restart)', () => {
    it('turns an envelope that was mid-turn into outcome-unknown and never re-sends it', async () => {
      const before = await open(storage);
      const id = await put(before);
      await before.transition(id, { state: 'started', turnSeq: 1 });

      const store = await open(storage);
      const deliver = target();
      scheduler = new AgentMessageDeliveryScheduler(store, logger(), { clock });
      await scheduler.start(deliver);

      expect(await store.get(id)).toMatchObject({ state: 'outcome-unknown', reason: 'host-restarted' });
      expect(deliver.deliver).not.toHaveBeenCalled();
    });

    it('turns a dispatching envelope into outcome-unknown, not rescheduled', async () => {
      const before = await open(storage);
      const id = await put(before);
      await before.markDispatching(id);

      const store = await open(storage);
      const deliver = target();
      scheduler = new AgentMessageDeliveryScheduler(store, logger(), { clock });
      await scheduler.start(deliver);

      expect(await store.get(id)).toMatchObject({
        state: 'outcome-unknown', reason: 'dispatch-interrupted', everDispatched: true,
      });
      expect(jest.getTimerCount()).toBe(0);
      expect(deliver.deliver).not.toHaveBeenCalled();
    });

    it('holds a not-started envelope as awaiting-resume with its body, without spawning', async () => {
      const before = await open(storage);
      const id = await put(before);

      const store = await open(storage);
      const deliver = target();
      scheduler = new AgentMessageDeliveryScheduler(store, logger(), { clock });
      await scheduler.start(deliver);

      expect(await store.get(id)).toMatchObject({ state: 'blocked-retryable', reason: 'awaiting-resume' });
      expect(await store.getBody(id)).toBe('hello');
      expect(deliver.deliver).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    });

    it('never schedules envelopes whose parent session is being deleted', async () => {
      const store = await open(storage);
      const id = await put(store, { parentSessionId: 'parent-deleting' });
      await store.transition(id, { state: 'blocked-retryable', reason: 'delivery-failed', nextRetryAt: START + 5_000 });
      const deliver = target();
      scheduler = new AgentMessageDeliveryScheduler(store, logger(), {
        clock, isParentFrozen: (sessionId) => sessionId === 'parent-deleting',
      });
      await scheduler.start(deliver);
      scheduler.enqueueCold(id);
      scheduler.onLaneSettled(LANE_A);
      await flush();

      expect(jest.getTimerCount()).toBe(0);
      expect(deliver.deliver).not.toHaveBeenCalled();
    });

    it('re-arms the stored retry time of a blocked envelope', async () => {
      const store = await open(storage);
      const id = await put(store);
      await store.transition(id, { state: 'blocked-retryable', reason: 'delivery-failed', nextRetryAt: START + 10_000 });
      const deliver = target();
      scheduler = new AgentMessageDeliveryScheduler(store, logger(), { clock });
      await scheduler.start(deliver);

      expect(jest.getTimerCount()).toBe(1);
      now = START + 10_000;
      await jest.advanceTimersByTimeAsync(10_000);
      expect(deliver.deliver).toHaveBeenCalledWith(id);
    });
  });

  describe('the retry timer', () => {
    async function blocked(store: AgentMessageEnvelopeStore, at: number): Promise<string> {
      const id = await put(store);
      await store.transition(id, { state: 'blocked-retryable', reason: 'delivery-failed', nextRetryAt: at });
      return id;
    }

    it('keeps one timer for N envelopes and fires the earliest due first', async () => {
      const store = await open(storage);
      const late = await blocked(store, START + 30_000);
      const early = await blocked(store, START + 5_000);
      const middle = await blocked(store, START + 20_000);
      const deliver = target();
      scheduler = new AgentMessageDeliveryScheduler(store, logger(), { clock });
      await scheduler.start(deliver);

      expect(jest.getTimerCount()).toBe(1);
      now = START + 5_000;
      await jest.advanceTimersByTimeAsync(5_000);
      expect(deliver.deliver.mock.calls).toEqual([[early]]);
      expect(jest.getTimerCount()).toBe(1);

      now = START + 30_000;
      await jest.advanceTimersByTimeAsync(25_000);
      expect(deliver.deliver.mock.calls.map(([id]) => id).sort()).toEqual([early, late, middle].sort());
    });

    it('never arms below the minimum delay', async () => {
      const store = await open(storage);
      const id = await blocked(store, START - 60_000);
      const deliver = target();
      scheduler = new AgentMessageDeliveryScheduler(store, logger(), { clock });
      await scheduler.start(deliver);

      await jest.advanceTimersByTimeAsync(SCHEDULER_MIN_DELAY_MS - 1);
      expect(deliver.deliver).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      expect(deliver.deliver).toHaveBeenCalledWith(id);
    });

    it('backs off a throwing delivery, counts the attempt and never tight-loops', async () => {
      const store = await open(storage);
      const id = await blocked(store, START + 1_000);
      const log = logger();
      const deliver = target(() => Promise.reject(new Error('lane unavailable')));
      scheduler = new AgentMessageDeliveryScheduler(store, log, { clock });
      await scheduler.start(deliver);

      now = START + 1_000;
      await jest.advanceTimersByTimeAsync(1_000);
      expect(deliver.deliver).toHaveBeenCalledTimes(1);
      expect(log.error).toHaveBeenCalled();
      const after = await store.get(id);
      expect(after).toMatchObject({ state: 'blocked-retryable', attemptCount: 1, nextRetryAt: START + 6_000 });

      await jest.advanceTimersByTimeAsync(4_000);
      expect(deliver.deliver).toHaveBeenCalledTimes(1);
      now = START + 6_000;
      await jest.advanceTimersByTimeAsync(1_000);
      expect(deliver.deliver).toHaveBeenCalledTimes(2);
    });

    it('does not back off a delivery whose body was unavailable and is already failed', async () => {
      const store = await open(storage);
      const id = await blocked(store, START + 1_000);
      const log = logger();
      const deliver = target(async (envelopeId) => {
        await store.transition(envelopeId, { state: 'failed', reason: 'body-unavailable', nextRetryAt: undefined });
        throw new AgentMessageBodyUnavailableError(envelopeId);
      });
      scheduler = new AgentMessageDeliveryScheduler(store, log, { clock });
      await scheduler.start(deliver);

      now = START + 1_000;
      await jest.advanceTimersByTimeAsync(1_000);
      expect(deliver.deliver).toHaveBeenCalledTimes(1);
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('body unavailable'), { envelopeId: id });
      expect(log.error).not.toHaveBeenCalled();
      const after = await store.get(id);
      expect(after).toMatchObject({ state: 'failed', reason: 'body-unavailable' });
      expect(after?.nextRetryAt).toBeUndefined();

      now = START + 200_000;
      await jest.advanceTimersByTimeAsync(200_000);
      expect(deliver.deliver).toHaveBeenCalledTimes(1);
    });

    it('stops at the last backoff step and leaves a manual hold', async () => {
      const store = await open(storage);
      const id = await blocked(store, START + 1_000);
      await store.transition(id, { attemptCount: 3 });
      const deliver = target(() => Promise.reject(new Error('lane unavailable')));
      scheduler = new AgentMessageDeliveryScheduler(store, logger(), { clock });
      await scheduler.start(deliver);

      now = START + 1_000;
      await jest.advanceTimersByTimeAsync(1_000);
      const after = await store.get(id);
      expect(after).toMatchObject({ state: 'blocked-retryable', attemptCount: 4 });
      expect(after?.nextRetryAt).toBeUndefined();
      expect(jest.getTimerCount()).toBe(0);
    });

    it('clears the timer on dispose', async () => {
      const store = await open(storage);
      await blocked(store, START + 5_000);
      const deliver = target();
      const disposable = new AgentMessageDeliveryScheduler(store, logger(), { clock });
      await disposable.start(deliver);
      expect(jest.getTimerCount()).toBe(1);

      disposable.dispose();
      expect(jest.getTimerCount()).toBe(0);
      now = START + 5_000;
      await jest.advanceTimersByTimeAsync(5_000);
      expect(deliver.deliver).not.toHaveBeenCalled();
    });
  });

  describe('cold inbox and queue-full holds', () => {
    it('delivers cold entries in creation order, one at a time per lane', async () => {
      const store = await open(storage);
      const second = await put(store, { createdAt: START + 2 });
      const first = await put(store, { createdAt: START + 1 });
      const other = await put(store, { targetAgentId: LANE_B, laneLineageId: LANE_B, createdAt: START + 3 });
      const order: string[] = [];
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const deliver = target(async (id) => {
        order.push(`start:${id}`);
        if (id === first) await gate;
        order.push(`end:${id}`);
      });
      scheduler = new AgentMessageDeliveryScheduler(store, logger(), { clock });
      await scheduler.start(deliver);

      scheduler.enqueueCold(second);
      scheduler.enqueueCold(first);
      scheduler.enqueueCold(other);
      await flush();
      expect(order).toContain(`start:${first}`);
      expect(order).toContain(`end:${other}`);
      expect(order).not.toContain(`start:${second}`);

      release();
      await flush();
      expect(order.indexOf(`end:${first}`)).toBeLessThan(order.indexOf(`start:${second}`));
    });

    it('holds cold entries enqueued before start until the coordinator is attached', async () => {
      const store = await open(storage);
      const id = await put(store);
      await store.transition(id, { route: 'cold' });
      const deliver = target();
      scheduler = new AgentMessageDeliveryScheduler(store, logger(), { clock });
      scheduler.enqueueCold(id);
      await flush();

      await scheduler.start(deliver);
      await flush();

      expect(deliver.deliver).toHaveBeenCalledWith(id);
    });

    it('re-offers queue-full holds when the lane settles', async () => {
      const store = await open(storage);
      const held = await put(store);
      await store.transition(held, { state: 'blocked-retryable', reason: 'queue-full' });
      const unrelated = await put(store);
      await store.transition(unrelated, { state: 'blocked-retryable', reason: 'awaiting-resume' });
      const deliver = target();
      scheduler = new AgentMessageDeliveryScheduler(store, logger(), { clock });
      await scheduler.start(deliver);

      scheduler.onLaneSettled(LANE_A);
      await flush();

      expect(deliver.deliver.mock.calls).toEqual([[held]]);
    });
  });

  describe('limit-aware delivery and reset retries', () => {
    it('blocks a live continuation offer when the limit gate blocks, schedules one retry at resetAt + 60s, and delivers when the reset fires', async () => {
      const store = await open(storage);
      const held = await put(store);
      await store.transition(held, { state: 'blocked-retryable', reason: 'queue-full', route: 'live' });
      const resetAt = START + 120_000;
      const limitGate: Pick<LaneDeliveryLimitGate, 'check'> = {
        check: jest
          .fn()
          .mockResolvedValueOnce({ kind: 'blocked', limitKnown: true, resetAt })
          .mockResolvedValueOnce({ kind: 'proceed' }),
      };
      const deliver = target();
      scheduler = new AgentMessageDeliveryScheduler(store, logger(), {
        clock,
        limitGate,
      });
      await scheduler.start(deliver);

      scheduler.onLaneSettled(LANE_A);
      await flush();

      expect(deliver.deliver).not.toHaveBeenCalled();
      expect(await store.get(held)).toMatchObject({
        state: 'blocked-retryable',
        reason: 'lane-at-limit',
        limit: { known: true, resetAt },
        nextRetryAt: resetAt + LANE_LIMIT_RESET_RETRY_DELAY_MS,
      });
      expect(jest.getTimerCount()).toBe(1);

      now = resetAt + LANE_LIMIT_RESET_RETRY_DELAY_MS;
      await jest.advanceTimersByTimeAsync(120_000 + LANE_LIMIT_RESET_RETRY_DELAY_MS);
      expect(deliver.deliver).toHaveBeenCalledWith(held);
    });

    it('makes the retry manual on a second limit hit with the same or no new resetAt so no tight loop occurs', async () => {
      const store = await open(storage);
      const held = await put(store);
      await store.transition(held, { state: 'blocked-retryable', reason: 'queue-full', route: 'live' });
      const resetAt = START + 60_000;
      const limitGate: Pick<LaneDeliveryLimitGate, 'check'> = {
        check: jest.fn().mockResolvedValue({ kind: 'blocked', limitKnown: true, resetAt }),
      };
      const deliver = target();
      scheduler = new AgentMessageDeliveryScheduler(store, logger(), {
        clock,
        limitGate,
      });
      await scheduler.start(deliver);

      scheduler.onLaneSettled(LANE_A);
      await flush();
      expect(jest.getTimerCount()).toBe(1);

      const retryDueAt = resetAt + LANE_LIMIT_RESET_RETRY_DELAY_MS;
      now = retryDueAt;
      await jest.advanceTimersByTimeAsync(retryDueAt - START);

      expect(deliver.deliver).not.toHaveBeenCalled();
      const afterSecondHit = await store.get(held);
      expect(afterSecondHit).toMatchObject({
        state: 'blocked-retryable',
        reason: 'lane-at-limit',
        attemptCount: 2,
        limit: { known: true, resetAt },
      });
      expect(afterSecondHit?.nextRetryAt).toBeUndefined();
      expect(jest.getTimerCount()).toBe(0);
    });

    it('shares the same single timer between reset retries and regular scheduled retries', async () => {
      const store = await open(storage);
      const resetAt = START + 30_000;
      const limitHeld = await put(store);
      await store.transition(limitHeld, {
        state: 'blocked-retryable',
        reason: 'lane-at-limit',
        limit: { known: true, resetAt },
        nextRetryAt: resetAt + LANE_LIMIT_RESET_RETRY_DELAY_MS,
      });
      const regularHeld = await put(store, { targetAgentId: LANE_B, laneLineageId: LANE_B });
      await store.transition(regularHeld, {
        state: 'blocked-retryable',
        reason: 'continuation_transient',
        nextRetryAt: START + 10_000,
      });
      const deliver = target();
      scheduler = new AgentMessageDeliveryScheduler(store, logger(), { clock });
      await scheduler.start(deliver);

      expect(jest.getTimerCount()).toBe(1);
    });

    it('delivers at resetAt + 60s using a real LaneDeliveryLimitGate and a retained usage-limit stop record across a host restart', async () => {
      const resetAt = START + 120_000;
      const stoppedInfo: AgentProcessInfo = {
        agentId: LANE_A,
        cli: 'claude',
        role: 'backend-developer',
        task: 'stopped at limit',
        workingDirectory: '/workspace',
        status: 'failed',
        startedAt: new Date(START - 10_000).toISOString(),
        stopReason: 'usage-limit',
        stopResetAt: resetAt,
      };
      const lookup = {
        lookup: jest.fn().mockResolvedValue([
          {
            row: stoppedInfo,
            lookup: 'ok' as const,
            state: { state: 'confirmed-room' as const, reasons: [], windows: [] },
          },
        ]),
      };
      const realGate = new LaneDeliveryLimitGate(lookup, logger(), LANE_LIMIT_GATE_DEADLINE_MS, clock);

      // First host run: cold offer before reset blocks on retained stopResetAt and schedules retry.
      const beforeRestartStore = await open(storage);
      const held = await put(beforeRestartStore, { route: 'cold' });
      const firstDeliver = target();
      const firstScheduler = new AgentMessageDeliveryScheduler(beforeRestartStore, logger(), {
        clock,
        limitGate: realGate,
        findAgentInfo: () => stoppedInfo,
      });
      await firstScheduler.start(firstDeliver);
      firstScheduler.enqueueCold(held);
      await flush();

      expect(firstDeliver.deliver).not.toHaveBeenCalled();
      expect(lookup.lookup).not.toHaveBeenCalled();
      expect(await beforeRestartStore.get(held)).toMatchObject({
        state: 'blocked-retryable',
        reason: 'lane-at-limit',
        limit: { known: true, resetAt },
        nextRetryAt: resetAt + LANE_LIMIT_RESET_RETRY_DELAY_MS,
      });
      firstScheduler.dispose();

      // Host restart: restore store and re-arm scheduler against the same retained stopped record.
      const afterRestartStore = await open(storage);
      const secondDeliver = target();
      scheduler = new AgentMessageDeliveryScheduler(afterRestartStore, logger(), {
        clock,
        limitGate: realGate,
        findAgentInfo: () => stoppedInfo,
      });
      await scheduler.start(secondDeliver);
      expect(jest.getTimerCount()).toBe(1);

      const dueAt = resetAt + LANE_LIMIT_RESET_RETRY_DELAY_MS;
      now = dueAt;
      await jest.advanceTimersByTimeAsync(dueAt - START);

      // At resetAt + 60s, stopResetAt is historical; real gate consults lookup and proceeds.
      expect(lookup.lookup).toHaveBeenCalledTimes(1);
      expect(secondDeliver.deliver).toHaveBeenCalledWith(held);
    });

    it('lets a concurrent user Cancel or Retry win when racing an in-flight timer gate check', async () => {
      const store = await open(storage);
      const resetAt = START + 60_000;
      const cancelledId = await put(store, { targetAgentId: LANE_A, laneLineageId: LANE_A });
      await store.transition(cancelledId, {
        state: 'blocked-retryable',
        reason: 'lane-at-limit',
        limit: { known: true, resetAt: START + 10_000 },
        nextRetryAt: START + 70_000,
      });
      const retriedId = await put(store, { targetAgentId: LANE_B, laneLineageId: LANE_B });
      await store.transition(retriedId, {
        state: 'blocked-retryable',
        reason: 'lane-at-limit',
        limit: { known: true, resetAt: START + 10_000 },
        nextRetryAt: START + 70_000,
      });

      const resolvers: Array<(decision: LimitGateDecision) => void> = [];
      const limitGate: Pick<LaneDeliveryLimitGate, 'check'> = {
        check: jest.fn(
          () =>
            new Promise<LimitGateDecision>((resolve) => {
              resolvers.push(resolve);
            }),
        ),
      };
      const deliver = target();
      scheduler = new AgentMessageDeliveryScheduler(store, logger(), {
        clock,
        limitGate,
      });
      await scheduler.start(deliver);

      now = START + 70_000;
      const timerAdvance = jest.advanceTimersByTimeAsync(70_000);
      await flush();
      expect(resolvers).toHaveLength(2);

      // User cancels the first envelope and retries (reopens) the second while both timer gate checks are in flight.
      scheduler.unschedule(cancelledId);
      await store.transition(cancelledId, {
        state: 'cancelled',
        reason: 'cancelled-by-user',
        nextRetryAt: undefined,
      });

      scheduler.unschedule(retriedId);
      await store.transition(retriedId, {
        state: 'not-started',
        reason: undefined,
        nextRetryAt: undefined,
      });

      // Timer gates finish after the user actions: neither may overwrite the user's state or dispatch.
      resolvers[0]({ kind: 'proceed' });
      resolvers[1]({ kind: 'blocked', limitKnown: true, resetAt: now + resetAt });
      await timerAdvance;
      await flush();

      expect(deliver.deliver).not.toHaveBeenCalled();
      expect(await store.get(cancelledId)).toMatchObject({
        state: 'cancelled',
        reason: 'cancelled-by-user',
      });
      expect(await store.get(retriedId)).toMatchObject({
        state: 'not-started',
      });
      expect(jest.getTimerCount()).toBe(0);
    });
  });
});
