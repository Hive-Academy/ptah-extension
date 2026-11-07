import type { Logger } from '@ptah-extension/vscode-core';
import type { IAgentAdapter, ParentDeliveryView } from '@ptah-extension/shared';
import { SdkError, SessionActivityRegistry } from '@ptah-extension/agent-sdk';
import { FakeStateStorage } from './__fixtures__/fake-state-storage';
import {
  ParentEnvelopeStoreService,
  type NewParentDeliveryEnvelope,
} from './parent-envelope-store.service';
import { ParentDeliveryDrainerService, type ParentDeliveryEvent } from './parent-delivery-drainer.service';
import { PARENT_ENVELOPE_INDEX_KEY } from './parent-envelope.schema';

const parent = '11111111-2222-4333-8444-555555555555';
const other = '99999999-2222-4333-8444-555555555555';

function logger(): Logger {
  const log: Pick<Logger, 'info' | 'warn' | 'error' | 'debug'> = {
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
  };
  return log as Logger;
}

function report(key: string, parentSessionId = parent): NewParentDeliveryEnvelope {
  return { id: `lane-delivery:${key}`, dedupeKey: key, parentSessionId, agentId: 'lane',
    kind: 'report', body: `body ${key}`, createdAt: Date.now() };
}

interface Harness {
  readonly storage: FakeStateStorage;
  readonly store: ParentEnvelopeStoreService;
  readonly drainer: ParentDeliveryDrainerService;
  readonly send: jest.Mock<Promise<void>, Parameters<IAgentAdapter['sendMessageToSession']>>;
  readonly events: ParentDeliveryEvent[];
  readonly log: Logger;
  readonly state: { active: boolean };
}

const drainers: ParentDeliveryDrainerService[] = [];

async function harness(
  storage = new FakeStateStorage(),
  activity: SessionActivityRegistry | null = null,
): Promise<Harness> {
  const log = logger();
  const store = new ParentEnvelopeStoreService(log, storage);
  await store.ready;
  const send = jest.fn<Promise<void>, Parameters<IAgentAdapter['sendMessageToSession']>>(
    async () => undefined);
  const events: ParentDeliveryEvent[] = [];
  const state = { active: true };
  const adapter: Pick<IAgentAdapter, 'isSessionActive' | 'sendMessageToSession'> = {
    isSessionActive: () => state.active,
    sendMessageToSession: send,
  };
  const drainer = new ParentDeliveryDrainerService(log, store, adapter as IAgentAdapter, activity,
    { emit: (event) => events.push(event) });
  drainers.push(drainer);
  return { storage, store, send, events, log, state, drainer };
}

afterEach(() => {
  for (const drainer of drainers.splice(0)) drainer.dispose();
  jest.useRealTimers();
});

describe('ParentDeliveryDrainerService', () => {
  it('runs another pass for an envelope enqueued while a send is in flight', async () => {
    const h = await harness();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    h.send.mockImplementationOnce(() => gate);
    await h.drainer.enqueue(report('first'));
    await h.drainer.enqueue(report('second'));
    release();
    await h.drainer.drain(parent);
    expect(h.send).toHaveBeenCalledTimes(2);
    expect(h.store.find('second')?.state).toBe('delivered');
  });

  it('sends with a stable clientMessageId to the recorded parent only', async () => {
    const h = await harness();
    await h.drainer.enqueue(report('stable'));
    await h.drainer.drain(parent);
    expect(h.send).toHaveBeenCalledWith(parent, 'body stable',
      expect.objectContaining({ clientMessageId: 'lane-delivery:stable' }));
    expect(h.send.mock.calls.every(([session]) => session === parent)).toBe(true);
  });

  it('continues after a post-send callback and sink throw', async () => {
    const h = await harness();
    const drainer = new ParentDeliveryDrainerService(h.log, h.store,
      { isSessionActive: () => true, sendMessageToSession: h.send } as Pick<IAgentAdapter,
        'isSessionActive' | 'sendMessageToSession'> as IAgentAdapter, null,
      { emit: () => { throw new Error('sink failed'); } });
    await drainer.enqueue(report('first'), () => { throw new Error('callback failed'); });
    await drainer.enqueue(report('second'));
    await drainer.drain(parent);
    expect(h.store.find('first')?.state).toBe('delivered');
    expect(h.store.find('second')?.state).toBe('delivered');
  });

  it('holds an inactive parent as parent-offline and drains once on activity', async () => {
    const activity = new SessionActivityRegistry(logger());
    const h = await harness(new FakeStateStorage(), activity);
    h.state.active = false;
    const accepted = jest.fn();
    await h.drainer.enqueue(report('offline'), accepted);
    await h.drainer.drain(parent);
    expect(h.store.find('offline')).toMatchObject({ state: 'pending', waitingReason: 'parent-offline' });
    expect(h.send).not.toHaveBeenCalled();
    h.state.active = true;
    activity.notifyAll({ sessionId: parent, workspaceRoot: '/ws', role: 'user', timestamp: Date.now() });
    await h.drainer.drain(parent);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(accepted).toHaveBeenCalledTimes(1);
  });

  it('drains a tab envelope after the real parent session resolves', async () => {
    const h = await harness();
    await h.drainer.enqueue(report('tab', 'tab-1'));
    await h.drainer.drain('tab-1');
    expect(h.send).not.toHaveBeenCalled();
    await h.drainer.resolveParentSessionId('tab-1', parent);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.store.find('tab')?.parentSessionId).toBe(parent);
  });

  it('never calls the adapter when the sending write fails', async () => {
    const h = await harness();
    h.state.active = false;
    await h.drainer.enqueue(report('fail-closed'));
    await h.drainer.drain(parent);
    h.storage.failWrites = (key, value) => key === PARENT_ENVELOPE_INDEX_KEY &&
      JSON.stringify(value).includes('"sending"');
    h.state.active = true;
    await h.drainer.drain(parent);
    expect(h.send).not.toHaveBeenCalled();
    expect(h.store.find('fail-closed')?.state).toBe('pending');
  });

  it('retries a not-accepted failure with backoff on the drainer timer', async () => {
    jest.useFakeTimers();
    const h = await harness();
    h.send.mockRejectedValueOnce(new SdkError(`Session not found: ${parent}`));
    await h.drainer.enqueue(report('backoff'));
    await h.drainer.drain(parent);
    expect(h.store.find('backoff')).toMatchObject({ state: 'blocked-retryable' });
    await jest.advanceTimersByTimeAsync(4_000);
    expect(h.send).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1_500);
    expect(h.send).toHaveBeenCalledTimes(2);
    expect(h.send.mock.calls.map(([, , options]) => options?.clientMessageId))
      .toEqual(['lane-delivery:backoff', 'lane-delivery:backoff']);
    expect(h.store.find('backoff')?.state).toBe('delivered');
  });

  it('keeps a timeout uncertain when the parent ends after the send threw', async () => {
    jest.useFakeTimers();
    const h = await harness();
    h.send.mockImplementationOnce(async () => {
      h.state.active = false;
      throw new Error('timed out');
    });
    await h.drainer.enqueue(report('ended'));
    await h.drainer.drain(parent);
    expect(h.store.find('ended')?.state).toBe('outcome-unknown');
    h.state.active = true;
    await jest.advanceTimersByTimeAsync(15 * 60_000);
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it('marks an uncertain failure outcome-unknown and never retries it automatically', async () => {
    jest.useFakeTimers();
    const h = await harness();
    h.send.mockRejectedValueOnce(new Error('timed out'));
    await h.drainer.enqueue(report('uncertain'));
    await h.drainer.drain(parent);
    expect(h.store.find('uncertain')?.state).toBe('outcome-unknown');
    await jest.advanceTimersByTimeAsync(15 * 60_000);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(await h.drainer.retry('lane-delivery:uncertain')).toEqual({ refused: 'confirmation-required' });
    await h.drainer.retry('lane-delivery:uncertain', { confirmDuplicateRisk: true });
    await h.drainer.drain(parent);
    expect(h.send).toHaveBeenCalledTimes(2);
  });

  it('does not resend when the delivered write fails after adapter acceptance', async () => {
    const h = await harness();
    await h.drainer.enqueue(report('accepted'));
    h.storage.failWrites = (key, value) => key === PARENT_ENVELOPE_INDEX_KEY &&
      JSON.stringify(value).includes('"delivered"');
    await h.drainer.drain(parent);
    await h.drainer.drain(parent);
    expect(h.send).toHaveBeenCalledTimes(1);
    h.storage.failWrites = () => false;
    const restarted = await harness(h.storage);
    await restarted.drainer.drain(parent);
    expect(restarted.store.find('accepted')?.state).toBe('outcome-unknown');
    expect(restarted.send).not.toHaveBeenCalled();
  });

  it.each(['intent', 'metadata-deleted', 'purged'] as const)(
    'never drains a frozen parent (%s)', async (phase) => {
      const h = await harness();
      h.state.active = false;
      await h.drainer.enqueue(report('frozen'));
      await h.store.markIntent(parent);
      if (phase !== 'intent') await h.store.markMetadataDeleted(parent);
      if (phase === 'purged') await h.store.markPurged(parent);
      h.state.active = true;
      await h.drainer.drain(parent);
      expect(h.send).not.toHaveBeenCalled();
    });

  it('runs retry-tick listeners on its one timer until unregistered or disposed', async () => {
    jest.useFakeTimers();
    const h = await harness();
    const backfill = jest.spyOn(h.store, 'backfillCompletionKeys');
    const listener = jest.fn();
    const unregister = h.drainer.onRetryTick(listener);
    h.storage.failWrites = (key) => key === PARENT_ENVELOPE_INDEX_KEY;
    expect(await h.drainer.enqueue(report('tick'))).toEqual({ refused: 'storage-unavailable' });
    h.storage.failWrites = () => false;
    await jest.advanceTimersByTimeAsync(5_000);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(backfill).toHaveBeenCalled();
    unregister();
    h.storage.failWrites = (key) => key === PARENT_ENVELOPE_INDEX_KEY;
    await h.drainer.enqueue(report('tick-3'));
    h.storage.failWrites = () => false;
    await jest.advanceTimersByTimeAsync(5_000);
    expect(listener).toHaveBeenCalledTimes(1);
    h.drainer.onRetryTick(listener);
    h.drainer.dispose();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('reschedules the tick while a listener still has work', async () => {
    jest.useFakeTimers();
    const h = await harness();
    const listener = jest.fn().mockRejectedValueOnce(new Error('still unsaved'))
      .mockResolvedValue(undefined);
    h.drainer.onRetryTick(listener);
    h.storage.failWrites = (key) => key === PARENT_ENVELOPE_INDEX_KEY;
    await h.drainer.enqueue(report('tick'));
    h.storage.failWrites = () => false;
    await jest.advanceTimersByTimeAsync(5_000);
    await jest.advanceTimersByTimeAsync(5_000);
    expect(listener).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('publishes and clears a view-only unsaved delivery through the sink', async () => {
    const h = await harness();
    const view: ParentDeliveryView = {
      deliveryId: 'lane-delivery:unsaved', agentId: 'lane', parentSessionId: other,
      kind: 'completion', state: 'not-saved', createdAt: 1, updatedAt: 1, attempts: 0,
      lastError: 'storage-unavailable',
    };
    h.drainer.publishUnsaved(view);
    h.drainer.clearUnsaved('lane-delivery:unsaved');
    h.drainer.clearUnsaved('lane-delivery:unsaved');
    expect(h.events).toEqual([view, { ...view, removed: true }]);
    expect(h.store.list()).toEqual([]);
  });
});
