import { AgentId, type AgentMessageOutcome } from '@ptah-extension/shared';
import { AgentInterruptedDeliveryError, AgentMessageRouter } from '../agent-message-router.service';
import type { SdkHandle } from '../cli-adapters/cli-adapter.interface';
import { LaneAccountResumeError } from '../lane-resume-gate';
import { AgentLaneResumeService } from './agent-lane-resume.service';
import { AgentMessageCoordinator, CAPABILITY_METADATA_UNAVAILABLE } from './agent-message-coordinator.service';
import { AGENT_MESSAGE_BODY_PREFIX } from './envelope/agent-message-envelope.schema';
import {
  createDetection,
  createLogger,
  harness,
  idOf,
  indexHasState,
  settleEvents,
} from './__fixtures__/agent-message-harness';

const parentA = { kind: 'parent', sessionId: 'parent-1' } as const;

/** Lane `h.agentId` stops; a cold send resumes it into the returned id. */
function stopLane(h: ReturnType<typeof harness>): AgentId {
  h.setInfo({ status: 'completed' });
  h.tracked.subprocessReleased = true;
  const spawned = AgentId.create();
  h.resume.resume.mockImplementationOnce(async () => {
    h.addLane(spawned, { turnSeq: 1 });
    return { agentId: spawned, cliSessionId: 'session-2' };
  });
  return spawned;
}

/** Fail every index write from the first `dispatching` write on (a storage outage). */
function outageOnDispatch(h: ReturnType<typeof harness>): void {
  let down = false;
  h.storage.failWhen = (key, value) => {
    if (indexHasState(key, value, 'dispatching')) down = true;
    return down && !key.startsWith(AGENT_MESSAGE_BODY_PREFIX);
  };
}

describe('AgentMessageCoordinator', () => {
  describe('durable delivery', () => {
    it('writes dispatching durably before a live send and records the started turn', async () => {
      const h = harness();
      h.sendToAgent.mockImplementationOnce(async (_id, _text, _delivery, messageId) => {
        expect(h.storage.states().get(messageId ?? '')).toBe('dispatching');
        return { mode: 'steer' };
      });
      const outcome = await h.coordinator.send({ agentId: h.agentId, message: 'change', delivery: 'now' }, parentA);
      expect(outcome).toMatchObject({ mode: 'steer', requestedAgentId: h.agentId, agentId: h.agentId });
      expect(outcome.receipt).toMatchObject({ state: 'started', turnSeq: 1, everDispatched: true, hasRecoverableBody: true });
      expect(h.sendToAgent).toHaveBeenCalledWith(h.agentId,
        `[Ptah message ${idOf(outcome)} from the parent session]\n\nchange`, 'now', idOf(outcome), false);
    });

    it('keeps a parked queued message not-started with the parking attempt undone', async () => {
      const h = harness();
      const outcome = await h.coordinator.send({ agentId: h.agentId, message: 'later' });
      expect(outcome.receipt).toMatchObject({ state: 'accepted', mode: 'queue-next-turn', everDispatched: false, attemptCount: 0 });
      expect(h.tracked.pendingMessages.map((entry) => entry.messageId)).toEqual([idOf(outcome)]);
    });

    it('journals dispatching before a cold spawn, returns both ids and records an alias', async () => {
      const h = harness();
      const spawned = stopLane(h);
      h.resume.resume.mockImplementationOnce(async () => {
        expect([...h.storage.states().values()]).toEqual(['dispatching']);
        h.addLane(spawned, { turnSeq: 1 });
        return { agentId: spawned, cliSessionId: 'session-2' };
      });
      const outcome = await h.coordinator.send({ agentId: h.agentId, message: 'resume' });
      expect(outcome).toMatchObject({ mode: 'start-turn', requestedAgentId: h.agentId, agentId: spawned });
      expect(outcome.receipt).toMatchObject({ state: 'started', agentId: h.agentId, actualAgentId: spawned, cliSessionId: 'session-2' });
      expect(h.resume.resume).toHaveBeenCalledWith(expect.objectContaining({ agentId: h.agentId }),
        `[Ptah message ${idOf(outcome)} from the parent session]\n\nresume`);
      expect(await h.aliases.resolve(h.agentId)).toEqual({ requestedAgentId: h.agentId, agentId: spawned });
    });

    it('sends a repeated message to the old id to the resumed lane', async () => {
      const h = harness();
      const spawned = stopLane(h);
      await h.coordinator.send({ agentId: h.agentId, message: 'resume' });
      const second = await h.coordinator.send({ agentId: h.agentId, message: 'again' });
      expect(h.resume.resume).toHaveBeenCalledTimes(1);
      expect(h.sendToAgent).toHaveBeenCalledWith(spawned, expect.any(String), 'queue', idOf(second), false);
      expect(second).toMatchObject({ requestedAgentId: h.agentId, agentId: spawned });
    });

    it('refuses with storage-unavailable and routes nothing when the initial put fails', async () => {
      const h = harness();
      h.storage.failWhen = (key) => key.startsWith(AGENT_MESSAGE_BODY_PREFIX);
      const outcome = await h.coordinator.send({ agentId: h.agentId, message: 'hello' });
      expect(outcome).toMatchObject({ mode: 'unsupported', reasonCode: 'storage-unavailable' });
      expect(outcome.messageId).toBeUndefined();
      expect(h.sendToAgent).not.toHaveBeenCalled();
    });
  });

  describe('fail-closed dispatching write', () => {
    it('makes no live send, holds the body and restarts as awaiting-resume', async () => {
      const h = harness();
      outageOnDispatch(h);
      const outcome = await h.coordinator.send({ agentId: h.agentId, message: 'change', delivery: 'now' });
      expect(h.sendToAgent).not.toHaveBeenCalled();
      expect(outcome).toMatchObject({ mode: 'unsupported', reasonCode: 'storage-unavailable' });
      expect(outcome.receipt).toMatchObject({ state: 'blocked-retryable', reason: 'storage-unavailable' });
      h.storage.failWhen = undefined;
      const next = h.restart();
      expect(await next.store.get(idOf(outcome))).toMatchObject({ state: 'blocked-retryable', reason: 'awaiting-resume' });
      expect(await next.coordinator.getBody(h.agentId, idOf(outcome))).toBe('change');
    });

    it('makes no cold spawn and restarts as awaiting-resume', async () => {
      const h = harness();
      stopLane(h);
      outageOnDispatch(h);
      const outcome = await h.coordinator.send({ agentId: h.agentId, message: 'resume' });
      expect(h.resume.resume).not.toHaveBeenCalled();
      expect(outcome.reasonCode).toBe('storage-unavailable');
      h.storage.failWhen = undefined;
      const next = h.restart();
      expect(await next.store.get(idOf(outcome))).toMatchObject({ state: 'blocked-retryable', reason: 'awaiting-resume' });
      expect(await next.store.getBody(idOf(outcome))).toBe('resume');
    });

    it('makes no continueConversation for a router flush and restarts as awaiting-resume', async () => {
      const h = harness();
      const outcome = await h.coordinator.send({ agentId: h.agentId, message: 'later' });
      outageOnDispatch(h);
      const journal = { markDispatching: async (id: string) => { await h.store.markDispatching(id); } };
      const router = new AgentMessageRouter(createLogger(), createDetection(), journal);
      const continueConversation = jest.fn(async () => undefined);
      h.setInfo({ status: 'completed' });
      await router.flushPending(h.agentId, h.tracked, { continueConversation });
      expect(continueConversation).not.toHaveBeenCalled();
      h.storage.failWhen = undefined;
      const next = h.restart();
      expect(await next.store.get(idOf(outcome))).toMatchObject({ state: 'blocked-retryable', reason: 'awaiting-resume' });
      expect(await next.store.getBody(idOf(outcome))).toBe('later');
      expect(h.tracked.pendingMessages.map((entry) => entry.messageId)).toEqual([idOf(outcome)]);
    });
  });

  describe('restart', () => {
    it('reclassifies a crash after dispatching and before started (live and cold) as outcome-unknown', async () => {
      const live = harness();
      live.sendToAgent.mockImplementationOnce(() => new Promise<AgentMessageOutcome>(() => undefined));
      void live.coordinator.send({ agentId: live.agentId, message: 'change', delivery: 'now' });
      const cold = harness();
      stopLane(cold);
      cold.resume.resume.mockReset();
      cold.resume.resume.mockImplementationOnce(() => new Promise(() => undefined));
      void cold.coordinator.send({ agentId: cold.agentId, message: 'resume' });
      await settleEvents();
      for (const h of [live, cold]) {
        const [envelope] = await h.restart().store.list({});
        expect(envelope).toMatchObject({ state: 'outcome-unknown', reason: 'dispatch-interrupted', everDispatched: true });
      }
    });

    it('reclassifies a started turn as outcome-unknown and refuses a retry without confirmation', async () => {
      const h = harness();
      h.sendToAgent.mockResolvedValueOnce({ mode: 'steer' });
      const sent = await h.coordinator.send({ agentId: h.agentId, message: 'change', delivery: 'now' });
      const next = h.restart();
      expect(await next.coordinator.getReceipt(h.agentId, idOf(sent))).toMatchObject({ state: 'outcome-unknown', reason: 'host-restarted' });
      const refused = await next.coordinator.retry(h.agentId, idOf(sent));
      expect(refused).toMatchObject({ mode: 'unsupported', reasonCode: 'confirmation-required' });
      expect(h.sendToAgent).toHaveBeenCalledTimes(1);
      h.sendToAgent.mockResolvedValueOnce({ mode: 'steer' });
      const retried = await next.coordinator.retry(h.agentId, idOf(sent), 'user', { confirmDuplicateRisk: true });
      expect(retried.receipt).toMatchObject({ state: 'started', id: idOf(sent) });
      expect(h.sendToAgent).toHaveBeenCalledTimes(2);
    });

    it('reconciles an in-flight envelope from a previous run on start, before the scheduler', async () => {
      const h = harness();
      const sent = await h.coordinator.send({ agentId: h.agentId, message: 'later' });
      const order: string[] = [];
      const purge = { resumePendingPurges: jest.fn(async () => { order.push('purge'); }) };
      h.scheduler.start.mockImplementation(async () => { order.push('scheduler'); });
      await new Promise((resolve) => setTimeout(resolve, 2));
      const coordinator = new AgentMessageCoordinator({
        manager: h.manager, detection: h.detection, store: h.store, aliases: h.aliases, resume: h.resume,
        scheduler: h.scheduler, logger: h.logger, purge,
      });
      await coordinator.start();
      await coordinator.start();
      expect(order).toEqual(['purge', 'scheduler']);
      expect(await h.store.get(idOf(sent))).toMatchObject({ state: 'blocked-retryable', reason: 'awaiting-resume' });
    });
  });

  describe('idempotency', () => {
    it('returns the same receipt for a key, also to the old id after a cold resume, with one envelope', async () => {
      const h = harness();
      const spawned = stopLane(h);
      const first = await h.coordinator.send({ agentId: h.agentId, message: 'resume', idempotencyKey: 'k-1' }, parentA);
      const again = await h.coordinator.send({ agentId: h.agentId, message: 'resume', idempotencyKey: 'k-1' }, parentA);
      const viaNew = await h.coordinator.send({ agentId: spawned, message: 'resume', idempotencyKey: 'k-1' }, parentA);
      expect(again).toMatchObject({ deduplicated: true, messageId: idOf(first), agentId: spawned });
      expect(viaNew).toMatchObject({ deduplicated: true, messageId: idOf(first) });
      expect(h.resume.resume).toHaveBeenCalledTimes(1);
      expect(h.sendToAgent).not.toHaveBeenCalled();
      expect(await h.store.list({})).toHaveLength(1);
    });

    it('routes concurrent duplicate sends once', async () => {
      const h = harness();
      const [a, b] = await Promise.all([
        h.coordinator.send({ agentId: h.agentId, message: 'x', idempotencyKey: 'k' }, parentA),
        h.coordinator.send({ agentId: h.agentId, message: 'x', idempotencyKey: 'k' }, parentA),
      ]);
      expect(h.sendToAgent).toHaveBeenCalledTimes(1);
      expect(b).toMatchObject({ deduplicated: true, messageId: idOf(a) });
    });

    it('keeps keys per sender and refuses a key from an anonymous parent', async () => {
      const h = harness();
      await h.coordinator.send({ agentId: h.agentId, message: 'x', idempotencyKey: 'k' }, parentA);
      const other = await h.coordinator.send({ agentId: h.agentId, message: 'x', idempotencyKey: 'k' }, 'user');
      expect(other.deduplicated).toBeUndefined();
      const anonymous = await h.coordinator.send({ agentId: h.agentId, message: 'x', idempotencyKey: 'k' }, 'parent');
      expect(anonymous).toMatchObject({ mode: 'unsupported', reasonCode: 'idempotency-key-requires-identity' });
      expect(anonymous.receipt).toMatchObject({ state: 'failed', hasRecoverableBody: false });
      expect(h.sendToAgent).toHaveBeenCalledTimes(2);
    });
  });

  describe('retry and cancel', () => {
    it('cancels a parked message, removes it from the live queue and deletes its body', async () => {
      const h = harness();
      const queued = await h.coordinator.send({ agentId: h.agentId, message: 'later' });
      const cancelled = await h.coordinator.cancel(h.agentId, idOf(queued));
      expect(cancelled).toMatchObject({ state: 'cancelled', reason: 'cancelled-by-user', hasRecoverableBody: false });
      expect(h.tracked.pendingMessages).toHaveLength(0);
      await expect(h.coordinator.cancel(h.agentId, idOf(queued))).rejects.toThrow('no longer cancellable');
    });

    it('refuses to cancel a dispatching or started message', async () => {
      const h = harness();
      const queued = await h.coordinator.send({ agentId: h.agentId, message: 'later' });
      await h.store.markDispatching(idOf(queued));
      await expect(h.coordinator.cancel(h.agentId, idOf(queued))).rejects.toThrow('no longer cancellable');
    });

    it('lets a parent act only on messages it sent', async () => {
      const h = harness();
      const queued = await h.coordinator.send({ agentId: h.agentId, message: 'later' }, parentA);
      await expect(h.coordinator.cancel(h.agentId, idOf(queued), { kind: 'parent', sessionId: 'other' }))
        .rejects.toThrow('not found');
      await expect(h.coordinator.getBody(h.agentId, idOf(queued), parentA)).resolves.toBe('later');
    });

    it('retries a never-dispatched hold without confirmation', async () => {
      const h = harness();
      h.sendToAgent.mockResolvedValueOnce({ mode: 'unsupported', reasonCode: 'start-turn-failed' });
      const failed = await h.coordinator.send({ agentId: h.agentId, message: 'x' });
      expect(failed.receipt).toMatchObject({ state: 'failed', everDispatched: false });
      const retried = await h.coordinator.retry(h.agentId, idOf(failed));
      expect(retried).toMatchObject({ mode: 'queue-next-turn', messageId: idOf(failed) });
      expect(retried.receipt).toMatchObject({ state: 'accepted', attemptCount: 1 });
    });
  });

  describe('preserved refusals', () => {
    it('refuses explicit steer without a steerable turn and never interrupts', async () => {
      const h = harness();
      h.tracked.sdkHandle = { ...h.tracked.sdkHandle, steer: undefined } as SdkHandle;
      const refused = await h.coordinator.send({ agentId: h.agentId, message: 'change', delivery: 'steer' });
      expect(refused).toMatchObject({ mode: 'unsupported', reasonCode: 'steer-unavailable' });
      expect(refused.receipt).toMatchObject({ state: 'failed', hasRecoverableBody: false });
      expect(h.sendToAgent).not.toHaveBeenCalled();
    });

    it('requires partial-turn-loss confirmation before interrupt-resume', async () => {
      const h = harness();
      h.tracked.sdkHandle = { ...h.tracked.sdkHandle, steer: undefined } as SdkHandle;
      const refused = await h.coordinator.send({ agentId: h.agentId, message: 'change', delivery: 'now' });
      expect(refused.reasonCode).toBe('confirmation-required');
      expect(h.sendToAgent).not.toHaveBeenCalled();
    });

    it('records an interrupted turn whose continuation failed, with the body kept', async () => {
      const h = harness();
      h.tracked.sdkHandle = { ...h.tracked.sdkHandle, steer: undefined } as SdkHandle;
      h.sendToAgent.mockRejectedValueOnce(new AgentInterruptedDeliveryError('continuation failed'));
      const result = await h.coordinator.send({ agentId: h.agentId, message: 'change', delivery: 'now', allowPartialTurnLoss: true });
      expect(result.receipt).toMatchObject({ state: 'interrupted-undelivered', partialTurnLost: true, hasRecoverableBody: true });
    });

    it('preserves the account refusal code through cold resume as a pre-acceptance failure', async () => {
      const h = harness();
      stopLane(h);
      h.resume.resume.mockReset();
      h.resume.resume.mockRejectedValueOnce(new LaneAccountResumeError('identity-unproved'));
      const outcome = await h.coordinator.send({ agentId: h.agentId, message: 'follow up' });
      expect(outcome.receipt).toMatchObject({ state: 'failed', reason: 'account_refused', everDispatched: false });
      expect(outcome.detail).toBe('account_refused');
    });

    it('marks an unclassified adapter throw outcome-unknown without leaking its text', async () => {
      const h = harness();
      h.sendToAgent.mockRejectedValueOnce(new Error('token secret-123 at C:/private/path'));
      const outcome = await h.coordinator.send({ agentId: h.agentId, message: 'hello' });
      expect(outcome.receipt).toMatchObject({ state: 'outcome-unknown', reason: 'delivery-failed' });
      expect(JSON.stringify(outcome)).not.toContain('secret-123');
      expect(JSON.stringify(outcome)).not.toContain('private/path');
    });

    it('refuses metadata-less and missing records with stable codes', () => {
      const h = harness();
      h.setInfo({ potentialCapabilities: undefined });
      expect(h.coordinator.preview({ agentId: h.agentId })).toMatchObject({ supported: false, reason: CAPABILITY_METADATA_UNAVAILABLE });
      expect(h.coordinator.preview({ agentId: AgentId.create() })).toMatchObject({ supported: false, reason: 'not_found' });
    });

    it('records the executed mode after the router changes the preview plan', async () => {
      const h = harness();
      h.sendToAgent.mockResolvedValueOnce({ mode: 'start-turn' });
      const outcome = await h.coordinator.send({ agentId: h.agentId, message: 'next' });
      expect(outcome.receipt).toMatchObject({ state: 'started', mode: 'start-turn' });
    });

    it('holds a router queue-full refusal for a re-offer instead of evicting', async () => {
      const h = harness();
      h.sendToAgent.mockResolvedValueOnce({ mode: 'unsupported', reasonCode: 'queue-full' });
      const outcome = await h.coordinator.send({ agentId: h.agentId, message: 'later' });
      expect(outcome.receipt).toMatchObject({ state: 'blocked-retryable', reason: 'queue-full', hasRecoverableBody: true });
      h.events.emit('agent:turn-settled', { ...h.tracked.info, turnSeq: 1, status: 'completed' });
      await settleEvents();
      expect(h.scheduler.onLaneSettled).toHaveBeenCalledWith(h.agentId);
    });

    it('refuses the 33rd undelivered message of a lane with queue-full and evicts nothing', async () => {
      const h = harness();
      for (let index = 0; index < 32; index++)
        await h.coordinator.send({ agentId: h.agentId, message: `m${index}` });
      const refused = await h.coordinator.send({ agentId: h.agentId, message: 'one more' });
      expect(refused).toMatchObject({ mode: 'unsupported', reasonCode: 'queue-full' });
      expect((await h.store.list({ states: ['not-started'] })).length).toBe(32);
    });
  });

  describe('serialisation', () => {
    it('never overlaps two routes for one lane', async () => {
      const h = harness();
      let release: (() => void) | undefined;
      h.sendToAgent.mockImplementationOnce(() => new Promise((resolve) => {
        release = () => resolve({ mode: 'steer' });
      }));
      const first = h.coordinator.send({ agentId: h.agentId, message: 'a', delivery: 'now' });
      const second = h.coordinator.send({ agentId: h.agentId, message: 'b' });
      await settleEvents();
      expect(h.sendToAgent).toHaveBeenCalledTimes(1);
      release?.();
      await Promise.all([first, second]);
      expect(h.sendToAgent).toHaveBeenCalledTimes(2);
    });

    it('keeps no memory-only id map: a second instance reconciles envelopes the first created', async () => {
      const h = harness();
      const sent = await h.coordinator.send({ agentId: h.agentId, message: 'later' });
      h.coordinator.dispose();
      const fresh = new AgentMessageCoordinator({
        manager: h.manager, detection: h.detection, store: h.store, aliases: h.aliases,
        resume: h.resume, scheduler: h.scheduler, logger: h.logger,
      });
      h.events.emit('agent:turn-started', { ...h.tracked.info, turnSeq: 2, messageId: idOf(sent) });
      await settleEvents();
      expect(await fresh.getReceipt(h.agentId, idOf(sent))).toMatchObject({ state: 'started', turnSeq: 2 });
    });
  });

  it('settles a cold-resume receipt when the new lane fails before registration', async () => {
    const h = harness();
    h.setInfo({ status: 'completed' });
    h.tracked.subprocessReleased = true;
    const spawned = AgentId.create();
    h.resume.resume.mockImplementationOnce(async () => {
      h.addLane(spawned, { status: 'failed', turnSeq: 1 });
      h.events.emit('agent:turn-settled', { ...h.tracked.info, agentId: spawned, status: 'failed', turnSeq: 1 });
      return { agentId: spawned };
    });
    const outcome = await h.coordinator.send({ agentId: h.agentId, message: 'resume' });
    expect(outcome.receipt).toMatchObject({ state: 'settled', turnOutcome: 'failed' });
  });

  it('keeps the system resumer path for a cold send through the real resume service', async () => {
    const h = harness();
    h.setInfo({ status: 'completed' });
    h.tracked.subprocessReleased = true;
    const spawnedId = AgentId.create();
    const spawn = jest.fn(async () => {
      h.addLane(spawnedId);
      return { agentId: spawnedId, cli: 'pi' as const, status: 'running' as const, startedAt: new Date().toISOString() };
    });
    const resume = new AgentLaneResumeService(
      { spawn, prepareSdkHandleSpawn: jest.fn(), releaseIdleForResume: jest.fn(async () => undefined) },
      { resume: jest.fn(), resumePtahCli: jest.fn() },
    );
    const coordinator = new AgentMessageCoordinator({
      manager: h.manager, detection: h.detection, store: h.store, aliases: h.aliases, resume,
      scheduler: h.scheduler, logger: h.logger,
    });
    const result = await coordinator.send({ agentId: h.agentId, message: 'resume' });
    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({ resumeSessionId: 'session', resumedFromAgentId: h.agentId }));
    expect(result).toMatchObject({ agentId: spawnedId, receipt: { state: 'started', actualAgentId: spawnedId } });
  });
});
