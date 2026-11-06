import type { Logger } from '@ptah-extension/vscode-core';
import type { IAgentAdapter } from '@ptah-extension/shared';
import { SessionActivityRegistry } from '@ptah-extension/agent-sdk';
import { ParentEnvelopeStoreService } from './parent-envelope-store.service';
import { ParentDeliveryDrainerService } from './parent-delivery-drainer.service';

const parent = '11111111-2222-4333-8444-555555555555';
const logger = { warn: jest.fn(), error: jest.fn() } as Partial<Logger> as Logger;

describe('ParentDeliveryDrainerService', () => {
  it('logs a rejected fire-and-forget enqueue drain', async () => {
    const store = new ParentEnvelopeStoreService(logger);
    jest.spyOn(store, 'pending').mockImplementation(() => { throw new Error('lookup failed'); });
    const adapter = { isSessionActive: () => true,
      sendMessageToSession: jest.fn() } as Partial<IAgentAdapter> as IAgentAdapter;
    const drainer = new ParentDeliveryDrainerService(logger, store, adapter, null, null);
    drainer.enqueue({ id: 'lane-delivery:rejected', dedupeKey: 'rejected',
      parentSessionId: parent, agentId: 'lane', kind: 'report', body: 'report',
      createdAt: Date.now(),
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(logger.error).toHaveBeenCalledWith(
      '[ParentDeliveryDrainer] Delivery callback failed', expect.any(Error));
  });

  it('runs another pass for an envelope enqueued while a send is in flight', async () => {
    const store = new ParentEnvelopeStoreService(logger);
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const send = jest.fn().mockImplementationOnce(() => gate).mockResolvedValue(undefined);
    const adapter = { isSessionActive: () => true, sendMessageToSession: send } as Partial<IAgentAdapter> as IAgentAdapter;
    const drainer = new ParentDeliveryDrainerService(logger, store, adapter, null, null);
    drainer.enqueue({ id: 'lane-delivery:first', dedupeKey: 'first', parentSessionId: parent,
      agentId: 'lane', kind: 'report', body: 'first', createdAt: Date.now() });
    await Promise.resolve();
    drainer.enqueue({ id: 'lane-delivery:second', dedupeKey: 'second', parentSessionId: parent,
      agentId: 'lane', kind: 'completion', body: 'second', createdAt: Date.now() });
    release?.();
    await drainer.drain(parent);
    expect(send).toHaveBeenCalledTimes(2);
    expect(store.find('second')?.state).toBe('delivered');
  });

  it('continues after a post-send callback and sink throw', async () => {
    const store = new ParentEnvelopeStoreService(logger);
    const send = jest.fn().mockResolvedValue(undefined);
    const adapter = { isSessionActive: () => true, sendMessageToSession: send } as Partial<IAgentAdapter> as IAgentAdapter;
    const drainer = new ParentDeliveryDrainerService(logger, store, adapter, null,
      { emit: jest.fn(() => { throw new Error('sink failed'); }) });
    drainer.enqueue({ id: 'lane-delivery:first', dedupeKey: 'first', parentSessionId: parent,
      agentId: 'lane', kind: 'report', body: 'first', createdAt: Date.now() },
    () => { throw new Error('callback failed'); });
    drainer.enqueue({ id: 'lane-delivery:second', dedupeKey: 'second', parentSessionId: parent,
      agentId: 'lane', kind: 'report', body: 'second', createdAt: Date.now() });
    await drainer.drain(parent);
    expect(send).toHaveBeenCalledTimes(2);
    expect(store.find('first')?.state).toBe('delivered');
    expect(store.find('second')?.state).toBe('delivered');
  });

  it('emits an expired state on queue eviction', () => {
    const store = new ParentEnvelopeStoreService(logger);
    const sink = { emit: jest.fn() };
    const drainer = new ParentDeliveryDrainerService(logger, store, null, null, sink);
    for (let i = 0; i < 33; i++) drainer.enqueue({
      id: `lane-delivery:${i}`, dedupeKey: String(i), parentSessionId: parent,
      agentId: 'lane', kind: 'report', body: String(i), createdAt: Date.now() + i,
    });
    expect(store.find('0')?.state).toBe('expired');
    expect(sink.emit).toHaveBeenCalledWith(expect.objectContaining({ dedupeKey: '0', state: 'expired' }));
  });
  it('emits an expired state for an aged pending envelope', () => {
    const store = new ParentEnvelopeStoreService(logger);
    const sink = { emit: jest.fn() };
    const drainer = new ParentDeliveryDrainerService(logger, store, null, null, sink);
    drainer.enqueue({ id: 'lane-delivery:aged', dedupeKey: 'aged',
      parentSessionId: parent, agentId: 'lane', kind: 'completion', body: 'done',
      createdAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
    });
    expect(store.find('aged')).toEqual(expect.objectContaining({
      state: 'expired', lastError: 'delivery-expired',
    }));
    expect(sink.emit).toHaveBeenCalledWith(expect.objectContaining({
      dedupeKey: 'aged', state: 'expired',
    }));
  });

  it('drains a pending tab envelope after the real parent session resolves', async () => {
    const activity = new SessionActivityRegistry(logger);
    const store = new ParentEnvelopeStoreService(logger);
    const send = jest.fn().mockResolvedValue(undefined);
    const adapter = { isSessionActive: () => true, sendMessageToSession: send } as Partial<IAgentAdapter> as IAgentAdapter;
    const drainer = new ParentDeliveryDrainerService(logger, store, adapter, activity, null);
    drainer.enqueue({ id: 'lane-delivery:tab-completion', dedupeKey: 'tab-completion',
      parentSessionId: 'tab-1', agentId: 'lane', kind: 'completion', body: 'done', createdAt: Date.now(),
    });
    await drainer.resolveParentSessionId('tab-1', parent);
    expect(store.find('tab-completion')).toEqual(expect.objectContaining({
      parentSessionId: parent, state: 'delivered',
    }));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('holds an inactive report and drains once on later parent activity', async () => {
    const activity = new SessionActivityRegistry(logger);
    const store = new ParentEnvelopeStoreService(logger);
    let active = false;
    const send = jest.fn(async () => {
      activity.notifyAll({ sessionId: parent, workspaceRoot: '/ws', role: 'user', timestamp: Date.now() });
    });
    const adapter = { isSessionActive: () => active, sendMessageToSession: send } as Partial<IAgentAdapter> as IAgentAdapter;
    const sink = { emit: jest.fn() };
    const drainer = new ParentDeliveryDrainerService(logger, store, adapter, activity, sink);
    const accepted = jest.fn();
    const saved = drainer.enqueue({ id: 'lane-delivery:report-1', dedupeKey: 'report-1',
      parentSessionId: parent, agentId: 'lane', kind: 'report', body: 'report', createdAt: Date.now(),
    }, accepted);
    await drainer.drain(parent);
    expect(saved?.state).toBe('pending');
    expect(send).not.toHaveBeenCalled();
    active = true;
    activity.notifyAll({ sessionId: parent, workspaceRoot: '/ws', role: 'user', timestamp: Date.now() });
    await drainer.drain(parent);
    expect(send).toHaveBeenCalledTimes(1);
    expect(accepted).toHaveBeenCalledTimes(1);
    expect(store.find('report-1')?.state).toBe('delivered');
    expect(sink.emit).toHaveBeenCalledWith(expect.objectContaining({ state: 'delivered' }));
  });

  it('keeps a failed send pending for the next activity', async () => {
    const activity = new SessionActivityRegistry(logger);
    const store = new ParentEnvelopeStoreService(logger);
    const send = jest.fn().mockRejectedValueOnce(new Error('offline with token secret-123')).mockResolvedValue(undefined);
    const adapter = { isSessionActive: () => true, sendMessageToSession: send } as Partial<IAgentAdapter> as IAgentAdapter;
    const drainer = new ParentDeliveryDrainerService(logger, store, adapter, activity, null);
    drainer.enqueue({ id: 'lane-delivery:completion-1', dedupeKey: 'completion-1',
      parentSessionId: parent, agentId: 'lane', kind: 'completion', body: 'done', createdAt: Date.now(),
    });
    await drainer.drain(parent);
    expect(store.find('completion-1')?.state).toBe('pending');
    expect(store.find('completion-1')?.lastError).toBe('delivery-failed');
    expect(JSON.stringify(store.find('completion-1'))).not.toContain('secret-123');
    await drainer.drain(parent);
    expect(send).toHaveBeenCalledTimes(2);
    expect(store.find('completion-1')?.state).toBe('delivered');
  });
  it('runs another pass when an envelope arrives in the final drain microtask', async () => {
    const store = new ParentEnvelopeStoreService(logger);
    const send = jest.fn().mockResolvedValue(undefined);
    const adapter = { isSessionActive: () => true, sendMessageToSession: send } as Partial<IAgentAdapter> as IAgentAdapter;
    const second = { id: 'lane-delivery:late' as const, dedupeKey: 'late',
      parentSessionId: parent, agentId: 'lane', kind: 'report' as const,
      body: 'late', createdAt: Date.now() };
    const sink = { emit: jest.fn((item: { dedupeKey: string; state: string }) => {
      if (item.dedupeKey === 'first' && item.state === 'delivered') {
        void Promise.resolve().then(() => Promise.resolve().then(() => drainer.enqueue(second)));
      }
    }) };
    const drainer = new ParentDeliveryDrainerService(logger, store, adapter, null, sink);
    drainer.enqueue({ ...second, id: 'lane-delivery:first', dedupeKey: 'first', body: 'first' });
    await drainer.drain(parent);
    await Promise.resolve();
    await Promise.resolve();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(store.find('late')?.state).toBe('delivered');
    expect(send).toHaveBeenCalledTimes(2);
  });
});
