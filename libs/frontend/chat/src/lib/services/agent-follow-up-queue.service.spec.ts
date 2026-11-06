import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AgentMonitorStore, type MonitoredAgent } from '@ptah-extension/chat-streaming';
import type { AgentDeliveryReceipt } from '@ptah-extension/shared';
import { AgentFollowUpQueueService } from './agent-follow-up-queue.service';

const agent = { agentId: 'agent-1', status: 'running' } as MonitoredAgent;
const receipt = { id: 'message-1', agentId: 'agent-1', state: 'accepted', mode: 'queue-next-turn', delivery: 'queue', createdAt: 1, updatedAt: 1 } as const;

async function settle(): Promise<void> {
  TestBed.tick();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  TestBed.tick();
}

describe('AgentFollowUpQueueService', () => {
  const agents = signal<readonly MonitoredAgent[]>([agent]);
  const receipts = signal<ReadonlyMap<string, readonly AgentDeliveryReceipt[]>>(new Map());
  let sendMessage: jest.Mock;
  let cancelMessage: jest.Mock;
  let service: AgentFollowUpQueueService;

  beforeEach(() => {
    agents.set([agent]);
    receipts.set(new Map());
    sendMessage = jest.fn().mockResolvedValue({ mode: 'queue-next-turn', receipt });
    cancelMessage = jest.fn().mockResolvedValue({ ...receipt, state: 'failed', reason: 'cancelled-by-user' });
    TestBed.configureTestingModule({ providers: [{ provide: AgentMonitorStore, useValue: { agents, receipts, sendMessage, cancelMessage } }] });
    service = TestBed.inject(AgentFollowUpQueueService);
    TestBed.tick();
  });

  it('queues with the backend while a lane is running', async () => {
    service.enqueue('agent-1', 'follow up');
    await settle();
    expect(sendMessage).toHaveBeenCalledWith('agent-1', 'follow up', 'queue');
    expect(service.queued('agent-1')).toBe('follow up');
  });

  it('coalesces by cancelling an accepted message before sending the replacement', async () => {
    service.enqueue('agent-1', 'first');
    await settle();
    service.enqueue('agent-1', 'second');
    await settle();
    expect(cancelMessage).toHaveBeenCalledWith('agent-1', 'message-1');
    expect(sendMessage).toHaveBeenLastCalledWith('agent-1', 'first\nsecond', 'queue');
  });

  it('sends new text separately when an accepted message has already started', async () => {
    service.enqueue('agent-1', 'first');
    await settle();
    cancelMessage.mockResolvedValueOnce({ ...receipt, state: 'started', reason: 'already-started' });
    service.enqueue('agent-1', 'second');
    await settle();
    expect(sendMessage).toHaveBeenLastCalledWith('agent-1', 'second', 'queue');
    expect(service.error('agent-1')).toContain('already started');
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('takes queued text back for editing and cancels its receipt', async () => {
    service.enqueue('agent-1', 'draft');
    await settle();
    expect(service.unqueue('agent-1')).toBe('draft');
    await settle();
    expect(cancelMessage).toHaveBeenCalledWith('agent-1', 'message-1');
  });

  it('shows a friendly edit error when unqueue cancellation is refused', async () => {
    service.enqueue('agent-1', 'draft');
    await settle();
    cancelMessage.mockResolvedValueOnce({ ...receipt, state: 'started', reason: 'already-started' });
    expect(service.unqueue('agent-1')).toBe('draft');
    await settle();
    expect(service.error('agent-1')).toBe('Message already started and could not be edited.');
  });

  it('restores failed delivery text from a receipt', async () => {
    service.enqueue('agent-1', 'draft');
    await settle();
    receipts.set(new Map([['agent-1', [{ ...receipt, state: 'failed' as const, reason: 'lost' }]]]));
    await settle();
    expect(service.takeUndelivered('agent-1')).toBe('draft');
    expect(service.error('agent-1')).toBe('Could not send the follow-up. Try again.');
  });

  it('restores text when the backend refuses or RPC fails', async () => {
    sendMessage.mockResolvedValueOnce({ mode: 'unsupported', detail: 'unsupported' });
    await service.send(agent, 'direct');
    expect(service.takeUndelivered('agent-1')).toBe('direct');
    sendMessage.mockRejectedValueOnce(new Error('offline'));
    await service.send(agent, 'again');
    expect(service.takeUndelivered('agent-1')).toBe('again');
  });
});
