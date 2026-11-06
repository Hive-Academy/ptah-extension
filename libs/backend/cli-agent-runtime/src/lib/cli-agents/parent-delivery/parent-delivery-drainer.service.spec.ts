import type { Logger } from '@ptah-extension/vscode-core';
import type { IAgentAdapter } from '@ptah-extension/shared';
import { SessionActivityRegistry } from '@ptah-extension/agent-sdk';
import { ParentEnvelopeStoreService } from './parent-envelope-store.service';
import { ParentDeliveryDrainerService } from './parent-delivery-drainer.service';

const parent = '11111111-2222-4333-8444-555555555555';
const logger = { warn: jest.fn(), error: jest.fn() } as Partial<Logger> as Logger;

describe('ParentDeliveryDrainerService', () => {
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
    const send = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const adapter = { isSessionActive: () => true, sendMessageToSession: send } as Partial<IAgentAdapter> as IAgentAdapter;
    const drainer = new ParentDeliveryDrainerService(logger, store, adapter, activity, null);
    drainer.enqueue({ id: 'lane-delivery:completion-1', dedupeKey: 'completion-1',
      parentSessionId: parent, agentId: 'lane', kind: 'completion', body: 'done', createdAt: Date.now(),
    });
    await drainer.drain(parent);
    expect(store.find('completion-1')?.state).toBe('pending');
    await drainer.drain(parent);
    expect(send).toHaveBeenCalledTimes(2);
    expect(store.find('completion-1')?.state).toBe('delivered');
  });
});
