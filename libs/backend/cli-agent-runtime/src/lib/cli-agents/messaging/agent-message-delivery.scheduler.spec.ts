import { AgentId } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import { FakeStateStorage } from '../parent-delivery/__fixtures__/fake-state-storage';
import type { NewEnvelope } from './envelope/agent-message-envelope.schema';
import { AgentMessageEnvelopeStore } from './envelope/agent-message-envelope.store';
import {
  AgentMessageDeliveryScheduler,
  SCHEDULER_MIN_DELAY_MS,
  type AgentMessageDeliveryTarget,
} from './agent-message-delivery.scheduler';

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
});
