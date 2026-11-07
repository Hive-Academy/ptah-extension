import { AgentId } from '@ptah-extension/shared';
import { SCHEDULER_BACKOFF_MS } from './agent-message-delivery.scheduler';
import { LANE_LIMIT_RESET_RETRY_DELAY_MS } from './lane-delivery-limit.gate';
import { harness, idOf, settleEvents } from './__fixtures__/agent-message-harness';

const user = { kind: 'user' } as const;
const anonymousParent = { kind: 'parent' } as const;

async function parked(h: ReturnType<typeof harness>, message = 'later'): Promise<string> {
  return idOf(await h.coordinator.send({ agentId: h.agentId, message }, anonymousParent));
}

/** What the router's flush does before `continueConversation`. */
async function flushTakes(h: ReturnType<typeof harness>, id: string): Promise<void> {
  h.tracked.pendingMessages.splice(0, h.tracked.pendingMessages.length);
  await h.store.markDispatching(id);
}

describe('AgentMessageReconciler', () => {
  it('moves a parked message to the cold inbox on an exit race instead of failing it', async () => {
    const h = harness();
    const id = await parked(h);
    h.events.emit('agent:queue-updated', { agentId: h.agentId, failures: [{ messageId: id, reason: 'agent_stopped' }] });
    await settleEvents();
    expect(await h.store.get(id)).toMatchObject({ state: 'not-started', route: 'cold', everDispatched: false });
    expect(h.scheduler.enqueueCold).toHaveBeenCalledWith(id);
  });

  it('cold-delivers an exit-race entry through the scheduler target, or lets it be cancelled first', async () => {
    const h = harness();
    const delivered = await parked(h, 'one');
    const cancelled = await parked(h, 'two');
    h.events.emit('agent:queue-updated', { agentId: h.agentId, failures: [
      { messageId: delivered, reason: 'subprocess_released' }, { messageId: cancelled, reason: 'subprocess_released' },
    ] });
    await settleEvents();
    h.tracked.pendingMessages.splice(0);
    h.setInfo({ status: 'completed' });
    h.tracked.subprocessReleased = true;
    const spawned = AgentId.create();
    h.resume.resume.mockImplementationOnce(async () => {
      h.addLane(spawned);
      return { agentId: spawned };
    });
    await h.coordinator.cancel(h.agentId, cancelled, user);
    await h.coordinator.deliver(cancelled);
    await h.coordinator.deliver(delivered);
    expect(h.resume.resume).toHaveBeenCalledTimes(1);
    expect(await h.store.get(delivered)).toMatchObject({ state: 'started', actualAgentId: spawned });
    expect(await h.store.get(cancelled)).toMatchObject({ state: 'cancelled' });
  });

  it('keeps a started message started after an exit, then settles it normally', async () => {
    const h = harness();
    h.sendToAgent.mockResolvedValueOnce({ mode: 'steer' });
    const id = idOf(await h.coordinator.send({ agentId: h.agentId, message: 'now', delivery: 'now' }, anonymousParent));
    h.events.emit('agent:queue-updated', { agentId: h.agentId, failures: [{ messageId: id, reason: 'agent_stopped' }] });
    await settleEvents();
    expect(await h.store.get(id)).toMatchObject({ state: 'started' });
    h.events.emit('agent:turn-settled', { ...h.tracked.info, status: 'stopped', turnSeq: 1 });
    await settleEvents();
    expect(await h.store.get(id)).toMatchObject({ state: 'settled', turnOutcome: 'stopped' });
  });

  it('treats a teardown after the journal write as outcome-unknown, never a blind re-dispatch', async () => {
    const h = harness();
    const id = await parked(h);
    await flushTakes(h, id);
    h.events.emit('agent:queue-updated', { agentId: h.agentId, failures: [{ messageId: id, reason: 'agent_stopped' }] });
    await settleEvents();
    expect(await h.store.get(id)).toMatchObject({ state: 'outcome-unknown', reason: 'dispatch-interrupted', everDispatched: true });
    expect(h.scheduler.enqueueCold).not.toHaveBeenCalled();
    expect((await h.coordinator.retry(h.agentId, id, user)).reasonCode).toBe('confirmation-required');
  });

  it('moves a flushed message to started on turn-started and to settled on its settle', async () => {
    const h = harness();
    const id = await parked(h);
    await flushTakes(h, id);
    h.events.emit('agent:turn-started', { ...h.tracked.info, turnSeq: 2, messageId: id });
    await settleEvents();
    expect(await h.store.get(id)).toMatchObject({ state: 'started', turnSeq: 2 });
    h.events.emit('agent:turn-settled', { ...h.tracked.info, status: 'completed', turnSeq: 2 });
    await settleEvents();
    expect(await h.store.get(id)).toMatchObject({ state: 'settled', turnOutcome: 'completed' });
  });

  it('keeps the body of a permanent continuation rejection and offers Retry and Cancel', async () => {
    const h = harness();
    const id = await parked(h, 'keep me');
    await flushTakes(h, id);
    h.events.emit('agent:queue-updated', { agentId: h.agentId, failures: [{ messageId: id, reason: 'continuation_rejected' }] });
    await settleEvents();
    expect(await h.coordinator.getReceipt(h.agentId, id))
      .toMatchObject({ state: 'failed', reason: 'continuation_rejected', everDispatched: true, hasRecoverableBody: true });
    expect(await h.coordinator.getBody(h.agentId, id, user)).toBe('keep me');
    expect((await h.coordinator.retry(h.agentId, id, user)).reasonCode).toBe('confirmation-required');
    expect(await h.coordinator.cancel(h.agentId, id, user)).toMatchObject({ state: 'cancelled' });
  });

  it('backs a transient continuation rejection off on the scheduler', async () => {
    const h = harness();
    const id = await parked(h);
    await flushTakes(h, id);
    const before = Date.now();
    h.events.emit('agent:queue-updated', { agentId: h.agentId, failures: [{ messageId: id, reason: 'continuation_transient' }] });
    await settleEvents();
    const held = await h.store.get(id);
    expect(held).toMatchObject({ state: 'blocked-retryable', reason: 'continuation_transient' });
    expect(held?.nextRetryAt).toBeGreaterThanOrEqual(before + SCHEDULER_BACKOFF_MS[0]);
    expect(h.scheduler.schedule).toHaveBeenCalledWith(id, held?.nextRetryAt);
  });

  it('reads a failed router status the event did not carry from the durable list', async () => {
    const h = harness();
    const id = await parked(h);
    await flushTakes(h, id);
    h.getAgentMessageStatus.mockReturnValue({ status: 'failed', reason: 'continuation_rejected' });
    h.events.emit('agent:queue-updated', { agentId: h.agentId });
    await settleEvents();
    expect(await h.store.get(id)).toMatchObject({ state: 'failed', reason: 'continuation_rejected' });
  });

  it('expires a held message of a lane without a CLI session, keeping the body', async () => {
    const h = harness();
    const id = await parked(h, 'expired text');
    await h.store.transition(id, { cliSessionId: undefined });
    h.events.emit('agent:expired', { agentId: h.agentId });
    await settleEvents();
    expect(await h.coordinator.getReceipt(h.agentId, id)).toMatchObject({ state: 'expired', reason: 'agent_expired', hasRecoverableBody: true });
    expect(await h.coordinator.getBody(h.agentId, id, user)).toBe('expired text');
    expect((await h.coordinator.retry(h.agentId, id, user)).reasonCode).toBe('not_found');
  });

  it('holds a resumable lane message in the cold inbox when its record expires', async () => {
    const h = harness();
    const id = await parked(h);
    h.events.emit('agent:expired', { agentId: h.agentId });
    await settleEvents();
    expect(await h.store.get(id)).toMatchObject({ state: 'blocked-retryable', reason: 'awaiting-resume', route: 'cold' });
    expect(await h.store.getBody(id)).toBe('later');
  });

  it('removes the parked router entry of an envelope that is already cancelled', async () => {
    const h = harness();
    const id = await parked(h);
    await h.store.transition(id, { state: 'cancelled', reason: 'cancelled-by-user' });
    h.events.emit('agent:queue-updated', { agentId: h.agentId, failures: [{ messageId: id, reason: 'storage-unavailable' }] });
    await settleEvents();
    expect(h.tracked.pendingMessages).toHaveLength(0);
  });

  it('logs a rejected event handler without rejecting the emitter', async () => {
    const h = harness();
    const id = await parked(h);
    jest.spyOn(h.store, 'transition').mockRejectedValueOnce(new Error('storage failed'));
    h.events.emit('agent:turn-started', { ...h.tracked.info, turnSeq: 2, messageId: id });
    await settleEvents();
    expect(h.logger.error).toHaveBeenCalledWith('[AgentMessageCoordinator] Receipt event failed', expect.any(Error));
  });

  it('moves remaining not-started envelopes to blocked-retryable (lane-at-limit) on a usage-limit exit and keeps their bodies', async () => {
    const h = harness();
    const id = await parked(h, 'queued behind limit');
    const resetAt = Date.now() + 180_000;
    h.setInfo({ status: 'failed', stopReason: 'usage-limit', stopResetAt: resetAt });
    h.events.emit('agent:turn-settled', {
      ...h.tracked.info,
      status: 'failed',
      turnSeq: 1,
      stopReason: 'usage-limit',
      stopResetAt: resetAt,
    });
    await settleEvents();

    expect(h.tracked.pendingMessages).toHaveLength(0);
    expect(await h.store.get(id)).toMatchObject({
      state: 'blocked-retryable',
      reason: 'lane-at-limit',
      limit: { known: true, resetAt },
      nextRetryAt: resetAt + LANE_LIMIT_RESET_RETRY_DELAY_MS,
    });
    expect(await h.coordinator.getBody(h.agentId, id, user)).toBe('queued behind limit');
    expect(h.scheduler.schedule).toHaveBeenCalledWith(id, resetAt + LANE_LIMIT_RESET_RETRY_DELAY_MS);
    expect(h.scheduler.onLaneSettled).not.toHaveBeenCalled();

    // Reopen and hit the same usage-limit resetAt a second time: becomes manual, not rescheduled.
    h.scheduler.schedule.mockClear();
    await h.store.transition(id, { state: 'not-started', reason: undefined, nextRetryAt: undefined });
    h.events.emit('agent:turn-settled', {
      ...h.tracked.info,
      status: 'failed',
      turnSeq: 2,
      stopReason: 'usage-limit',
      stopResetAt: resetAt,
    });
    await settleEvents();

    const afterSecond = await h.store.get(id);
    expect(afterSecond).toMatchObject({
      state: 'blocked-retryable',
      reason: 'lane-at-limit',
      limit: { known: true, resetAt },
    });
    expect(afterSecond?.nextRetryAt).toBeUndefined();
    expect(h.scheduler.schedule).not.toHaveBeenCalled();
  });
});
