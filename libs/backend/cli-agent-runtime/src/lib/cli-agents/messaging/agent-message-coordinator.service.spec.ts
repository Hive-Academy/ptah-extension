import { EventEmitter } from 'eventemitter3';
import { AgentId, type AgentMessageOutcome, type AgentProcessInfo, type CliAdapterManifest } from '@ptah-extension/shared';
import type { AgentProcessManager } from '../agent-process-manager.service';
import type { CliDetectionService } from '../cli-detection.service';
import type { MessageRoutableAgent } from '../agent-message-router.service';
import { AgentInterruptedDeliveryError } from '../agent-message-router.service';
import type { SdkHandle } from '../cli-adapters/cli-adapter.interface';
import { AgentDeliveryReceiptStore } from './agent-delivery-receipt-store.service';
import { AgentLaneResumeService } from './agent-lane-resume.service';
import { AgentMessageCoordinator } from './agent-message-coordinator.service';

const yes = { state: 'supported' } as const;
const no = { state: 'unsupported' } as const;
const manifest: CliAdapterManifest = {
  messaging: { steer: yes, interrupt: yes, continuation: yes, resume: yes },
  roleChannel: 'task-prompt', permissionModes: {},
  networkModes: { allow: yes, deny: no },
  limitReader: { state: 'no-reliable-source' }, mcp: yes,
};

function setup() {
  const agentId = AgentId.create();
  let info = { agentId, cli: 'pi', status: 'running', cliSessionId: 'session',
    task: 'work', workingDirectory: '.', startedAt: new Date().toISOString(),
    potentialCapabilities: manifest, turnSeq: 1 } as AgentProcessInfo;
  const handle: SdkHandle = { abort: new AbortController(), done: Promise.resolve(0), onOutput: jest.fn(),
    steer: jest.fn(), interrupt: jest.fn(), supportsInterrupt: () => true,
    continue: jest.fn(), supportsContinuation: () => true };
  const tracked = { info, sdkHandle: handle, subprocessReleased: false, pendingMessages: [] } as MessageRoutableAgent;
  const events = new EventEmitter();
  const sendToAgent = jest.fn().mockResolvedValue({ mode: 'queue-next-turn' });
  const getAgentMessageStatus = jest.fn().mockReturnValue({ status: 'pending' });
  const manager: Pick<AgentProcessManager, 'events' | 'findAgentInfo' | 'getMessageRoutableAgent' | 'sendToAgent' | 'getAgentMessageStatus'> = {
    events, findAgentInfo: () => info, getMessageRoutableAgent: () => tracked,
    sendToAgent, getAgentMessageStatus,
  };
  const detection: Pick<CliDetectionService, 'getAdapter'> = { getAdapter: jest.fn() };
  let persisted: unknown;
  const receipts = new AgentDeliveryReceiptStore({
    get: <T>() => persisted as T | undefined,
    update: async (_key, value) => { persisted = value; },
  });
  const resume: Pick<AgentLaneResumeService, 'resume'> = { resume: jest.fn().mockResolvedValue({ agentId: AgentId.create() }) };
  const coordinator = new AgentMessageCoordinator(manager, detection, receipts, resume);
  return { agentId, handle, tracked, events, sendToAgent, getAgentMessageStatus, receipts, resume, coordinator,
    setInfo: (patch: Partial<AgentProcessInfo>) => { info = { ...info, ...patch }; tracked.info = info; },
    getInfo: () => info };
}

const settleEvents = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const receiptId = (outcome: AgentMessageOutcome): string => {
  if (!outcome.receipt) throw new Error('Expected a receipt.');
  return outcome.receipt.id;
};

describe('AgentMessageCoordinator', () => {
  it('defaults a running lane to queue and replans now against the current handle', async () => {
    const h = setup();
    expect(h.coordinator.preview({ agentId: h.agentId }).mode).toBe('queue-next-turn');
    expect(h.coordinator.preview({ agentId: h.agentId, delivery: 'now' }).mode).toBe('steer');
    h.tracked.sdkHandle = { ...h.handle, steer: undefined } as SdkHandle;
    const refused = await h.coordinator.send({ agentId: h.agentId, message: 'change', delivery: 'now' });
    expect(refused.receipt?.state).toBe('failed');
    expect(h.sendToAgent).not.toHaveBeenCalled();
    expect(h.handle.interrupt).not.toHaveBeenCalled();
  });

  it('records an interrupted turn whose continuation failed', async () => {
    const h = setup();
    h.tracked.sdkHandle = { ...h.handle, steer: undefined } as SdkHandle;
    h.sendToAgent.mockRejectedValueOnce(new AgentInterruptedDeliveryError('continuation failed'));
    const result = await h.coordinator.send({ agentId: h.agentId, message: 'change', delivery: 'now', allowPartialTurnLoss: true });
    expect(result.receipt).toMatchObject({ state: 'interrupted-undelivered', partialTurnLost: true });
  });

  it('cancels only accepted queued messages and marks failed queue delivery', async () => {
    const h = setup();
    const queued = await h.coordinator.send({ agentId: h.agentId, message: 'later' });
    h.tracked.pendingMessages.push({ messageId: receiptId(queued), cliSessionId: 'session', text: 'later' });
    const cancelled = await h.coordinator.cancel(h.agentId, receiptId(queued));
    expect(cancelled).toMatchObject({ state: 'failed', reason: 'cancelled-by-user' });
    expect(h.tracked.pendingMessages).toHaveLength(0);
    await expect(h.coordinator.cancel(h.agentId, receiptId(queued))).rejects.toThrow('Only accepted');
    const another = await h.coordinator.send({ agentId: h.agentId, message: 'later again' });
    h.getAgentMessageStatus.mockReturnValue({ status: 'failed', reason: 'continuation_rejected' });
    h.events.emit('agent:queue-updated', { agentId: h.agentId });
    await settleEvents();
    expect(await h.coordinator.getReceipt(h.agentId, receiptId(another))).toMatchObject({ state: 'failed', reason: 'continuation_rejected' });
  });

  it('fails accepted messages on Stop and settles a started stopped turn', async () => {
    const h = setup();
    const started = await h.coordinator.send({ agentId: h.agentId, message: 'next' });
    h.events.emit('agent:turn-started', { ...h.getInfo(), turnSeq: 2, messageId: receiptId(started) });
    await settleEvents();
    expect(await h.coordinator.getReceipt(h.agentId, receiptId(started))).toMatchObject({ state: 'started', turnSeq: 2 });
    const accepted = await h.coordinator.send({ agentId: h.agentId, message: 'after' });
    h.setInfo({ status: 'stopped', turnSeq: 2 });
    h.getAgentMessageStatus.mockReturnValue({ status: 'failed', reason: 'agent_stopped' });
    h.events.emit('agent:turn-settled', h.getInfo());
    h.events.emit('agent:queue-updated', { agentId: h.agentId });
    await settleEvents();
    expect(await h.coordinator.getReceipt(h.agentId, receiptId(started))).toMatchObject({ state: 'settled', turnOutcome: 'stopped' });
    expect(await h.coordinator.getReceipt(h.agentId, receiptId(accepted))).toMatchObject({ state: 'failed', reason: 'agent_stopped' });
  });

  it('keeps the original receipt id through cold resume', async () => {
    const h = setup();
    h.setInfo({ status: 'completed' });
    h.tracked.subprocessReleased = true;
    const result = await h.coordinator.send({ agentId: h.agentId, message: 'resume' });
    expect(h.resume.resume).toHaveBeenCalledWith(h.getInfo(), 'resume');
    expect(result.messageId).toBe(result.receipt?.id);
    expect(result.receipt).toMatchObject({ state: 'started', turnSeq: 1 });
  });
});
