import { EventEmitter } from 'eventemitter3';
import { AgentId, type AgentMessageOutcome, type AgentProcessInfo, type CliAdapterManifest } from '@ptah-extension/shared';
import type { AgentProcessManager } from '../agent-process-manager.service';
import type { CliDetectionService } from '../cli-detection.service';
import type { MessageRoutableAgent } from '../agent-message-router.service';
import { AgentInterruptedDeliveryError } from '../agent-message-router.service';
import type { SdkHandle } from '../cli-adapters/cli-adapter.interface';
import { AgentDeliveryReceiptStore } from './agent-delivery-receipt-store.service';
import { AgentLaneResumeService } from './agent-lane-resume.service';
import { AgentMessageCoordinator, CAPABILITY_METADATA_UNAVAILABLE } from './agent-message-coordinator.service';
import type { Logger } from '@ptah-extension/vscode-core';
import { LaneAccountResumeError } from '../lane-resume-gate';

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
  return { agentId, handle, tracked, events, sendToAgent, getAgentMessageStatus, receipts, resume, coordinator, manager, detection,
    setInfo: (patch: Partial<AgentProcessInfo>) => { info = { ...info, ...patch }; tracked.info = info; },
    getInfo: () => info };
}

const settleEvents = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const receiptId = (outcome: AgentMessageOutcome): string => {
  if (!outcome.receipt) throw new Error('Expected a receipt.');
  return outcome.receipt.id;
};

describe('AgentMessageCoordinator', () => {
  it('persists the router queue-full reason code', async () => {
    const h = setup();
    h.sendToAgent.mockResolvedValueOnce({ mode: 'unsupported', reasonCode: 'queue-full' });
    const outcome = await h.coordinator.send({ agentId: h.agentId, message: 'later' });
    expect(outcome.receipt).toMatchObject({ state: 'failed', reason: 'queue-full' });
  });
  it('keeps raw adapter failure text out of receipts and outcomes', async () => {
    const h = setup();
    h.sendToAgent.mockRejectedValueOnce(new Error('token secret-123 at C:/private/path'));
    const outcome = await h.coordinator.send({ agentId: h.agentId, message: 'hello' });
    expect(outcome.receipt).toMatchObject({ state: 'failed', reason: 'delivery-failed' });
    expect(JSON.stringify(outcome)).not.toContain('secret-123');
    expect(JSON.stringify(outcome)).not.toContain('private/path');
  });

  it('refuses an existing record without a capability manifest as metadata-unavailable, not not_found', () => {
    const h = setup();
    h.setInfo({ potentialCapabilities: undefined });
    (h.detection.getAdapter as jest.Mock).mockReturnValue(undefined);
    expect(h.coordinator.preview({ agentId: h.agentId })).toMatchObject({
      mode: 'unsupported', supported: false, reason: CAPABILITY_METADATA_UNAVAILABLE,
    });
  });
  it('refuses a missing agent record with not_found', () => {
    const h = setup();
    h.manager.findAgentInfo = () => undefined;
    expect(h.coordinator.preview({ agentId: h.agentId })).toMatchObject({ supported: false, reason: 'not_found' });
  });

  it('preserves the account refusal code through cold resume', async () => {
    const h = setup();
    h.setInfo({ status: 'completed' });
    h.tracked.subprocessReleased = true;
    (h.resume.resume as jest.Mock).mockRejectedValueOnce(new LaneAccountResumeError('identity-unproved'));
    const outcome = await h.coordinator.send({ agentId: h.agentId, message: 'follow up' });
    expect(outcome.receipt).toMatchObject({ state: 'failed', reason: 'account_refused' });
    expect(outcome.detail).toBe('account_refused');
  });
  it('uses queue event reasons after the router status has been evicted', async () => {
    const h = setup();
    const outcome = await h.coordinator.send({ agentId: h.agentId, message: 'queued' });
    h.getAgentMessageStatus.mockReturnValue({ status: 'unknown' });
    h.events.emit('agent:queue-updated', { agentId: h.agentId,
      failures: [{ messageId: receiptId(outcome), reason: 'continuation_rejected' }] });
    await settleEvents();
    expect(await h.coordinator.getReceipt(h.agentId, receiptId(outcome)))
      .toMatchObject({ state: 'failed', reason: 'continuation_rejected' });
  });

  it('evicts per-agent queue tracking when its record expires', async () => {
    const h = setup();
    const outcome = await h.coordinator.send({ agentId: h.agentId, message: 'queued' });
    h.events.emit('agent:expired', { agentId: h.agentId });
    h.events.emit('agent:queue-updated', { agentId: h.agentId,
      failures: [{ messageId: receiptId(outcome), reason: 'agent_stopped' }] });
    await settleEvents();
    expect(await h.coordinator.getReceipt(h.agentId, receiptId(outcome)))
      .toMatchObject({ state: 'failed', reason: 'agent_expired' });
  });

  it('logs a rejected asynchronous receipt event without rejecting the emitter', async () => {
    const h = setup();
    const logger = { error: jest.fn(), warn: jest.fn() } as Partial<Logger> as Logger;
    h.events.removeAllListeners();
    const coordinator = new AgentMessageCoordinator(h.manager, h.detection, h.receipts, h.resume, logger);
    const outcome = await coordinator.send({ agentId: h.agentId, message: 'queued' });
    jest.spyOn(h.receipts, 'transition').mockRejectedValueOnce(new Error('storage failed'));
    h.events.emit('agent:turn-started', { ...h.getInfo(), messageId: receiptId(outcome) });
    await settleEvents();
    expect(logger.error).toHaveBeenCalledWith(
      '[AgentMessageCoordinator] Receipt event failed', expect.any(Error));
  });
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

  it('refuses cancellation after the router has taken the queued message', async () => {
    const h = setup();
    const queued = await h.coordinator.send({ agentId: h.agentId, message: 'later' });
    await expect(h.coordinator.cancel(h.agentId, receiptId(queued))).rejects.toThrow('no longer cancellable');
    expect(await h.coordinator.getReceipt(h.agentId, receiptId(queued))).toMatchObject({ state: 'accepted' });
  });

  it('records the executed mode after the router changes the preview plan', async () => {
    const h = setup();
    h.sendToAgent.mockResolvedValueOnce({ mode: 'start-turn' });
    const outcome = await h.coordinator.send({ agentId: h.agentId, message: 'next' });
    expect(outcome.receipt).toMatchObject({ state: 'started', mode: 'start-turn' });
  });

  it('settles when the turn ends during the started receipt transition', async () => {
    const h = setup();
    const queued = await h.coordinator.send({ agentId: h.agentId, message: 'next' });
    const transition = h.receipts.transition.bind(h.receipts);
    jest.spyOn(h.receipts, 'transition').mockImplementation(async (id, patch) => {
      const result = await transition(id, patch);
      if (patch.state === 'started') h.events.emit('agent:turn-settled', { ...h.getInfo(), turnSeq: 2, status: 'completed' });
      return result;
    });
    h.events.emit('agent:turn-started', { ...h.getInfo(), turnSeq: 2, messageId: receiptId(queued) });
    await settleEvents();
    expect(await h.coordinator.getReceipt(h.agentId, receiptId(queued))).toMatchObject({ state: 'settled', turnSeq: 2 });
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
    const spawnedId = AgentId.create();
    const spawn = jest.fn().mockResolvedValue({ agentId: spawnedId, cli: 'pi', status: 'running', startedAt: new Date().toISOString() });
    const resume = new AgentLaneResumeService({ spawn, prepareSdkHandleSpawn: jest.fn(), releaseIdleForResume: jest.fn() });
    const coordinator = new AgentMessageCoordinator(h.manager, h.detection, h.receipts, resume);
    const result = await coordinator.send({ agentId: h.agentId, message: 'resume' });
    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({ resumeSessionId: 'session', task: 'resume' }));
    expect(result.messageId).toBe(result.receipt?.id);
    expect(result.receipt).toMatchObject({ state: 'started', turnSeq: 1 });
    h.events.emit('agent:turn-settled', { ...h.getInfo(), agentId: spawnedId, turnSeq: 1, status: 'completed' });
    await settleEvents();
    expect(await coordinator.getReceipt(h.agentId, receiptId(result))).toMatchObject({ state: 'settled' });
  });
  it('settles a cold-resume receipt when the new lane fails before registration', async () => {
    const h = setup();
    h.setInfo({ status: 'completed' });
    h.tracked.subprocessReleased = true;
    const spawnedId = AgentId.create();
    const settledInfo = { ...h.getInfo(), agentId: spawnedId, status: 'failed' as const, turnSeq: 1 };
    h.manager.findAgentInfo = jest.fn((id) => id === spawnedId ? settledInfo : h.getInfo());
    const resume = { resume: jest.fn(async () => {
      h.events.emit('agent:turn-settled', settledInfo);
      return { agentId: spawnedId, cli: 'pi' as const, status: 'running' as const, startedAt: new Date().toISOString() };
    }) };
    const coordinator = new AgentMessageCoordinator(h.manager, h.detection, h.receipts, resume);
    const outcome = await coordinator.send({ agentId: h.agentId, message: 'resume' });
    expect(outcome.receipt).toMatchObject({ state: 'settled', turnOutcome: 'failed' });
  });
});
