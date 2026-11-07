import { AgentId } from '@ptah-extension/shared';
import { agentMessageAckLine } from './agent-message-delivery-text';
import { AgentMessageAckService, normalizeAckNote } from './agent-message-ack.service';
import { AGENT_MESSAGE_ENVELOPE_INDEX_KEY } from './envelope/agent-message-envelope.schema';
import {
  MemoryPersistence, harness, idOf, indexHasState, manifest, settleEvents,
} from './__fixtures__/agent-message-harness';

const user = { kind: 'user' } as const;
const noMcp = { ...manifest, mcp: { state: 'unsupported' } as const };

type Harness = ReturnType<typeof harness>;

/** A steered message: `started` in the lane's current turn. */
async function delivered(h: Harness, message = 'please rebase'): Promise<string> {
  h.sendToAgent.mockResolvedValueOnce({ mode: 'steer' });
  return idOf(await h.coordinator.send({ agentId: h.agentId, message, delivery: 'now' }, user));
}

function sentText(h: Harness): string {
  const call = h.sendToAgent.mock.calls.at(-1);
  if (!call) throw new Error('Expected a routed message.');
  return call[1];
}

describe('AgentMessageAckService', () => {
  it('records the own lane ack without changing the transport state', async () => {
    const h = harness();
    const id = await delivered(h);
    expect(await h.store.get(id)).toMatchObject({ state: 'started', ackState: 'pending' });
    const result = await h.coordinator.acknowledge({ messageId: id, state: 'read', note: '  on   it ' }, { agentId: h.agentId });
    expect(result).toMatchObject({ ok: true, ackState: 'read', changed: true, receipt: { state: 'started', ackState: 'read', ackNote: 'on it' } });
    expect(await h.store.get(id)).toMatchObject({ state: 'started', ackState: 'read', ackNote: 'on it' });
  });

  it('refuses an ack from a lane the message was not delivered to', async () => {
    const h = harness();
    const id = await delivered(h);
    const other = AgentId.create();
    h.addLane(other);
    expect(await h.ack.acknowledge({ messageId: id, state: 'acted' }, { agentId: other }))
      .toEqual({ ok: false, messageId: id, code: 'ack-forbidden' });
    expect(await h.store.get(id)).toMatchObject({ ackState: 'pending' });
  });

  it('answers not_found for an unknown message id', async () => {
    const h = harness();
    const messageId = '11111111-2222-4333-8444-555555555555';
    expect(await h.ack.acknowledge({ messageId, state: 'read' }, { agentId: h.agentId }))
      .toEqual({ ok: false, messageId, code: 'not_found' });
  });

  it('treats a repeated state as idempotent', async () => {
    const h = harness();
    const id = await delivered(h);
    await h.ack.acknowledge({ messageId: id, state: 'read' }, { agentId: h.agentId });
    const first = await h.store.get(id);
    const again = await h.ack.acknowledge({ messageId: id, state: 'read', note: 'later note' }, { agentId: h.agentId });
    expect(again).toMatchObject({ ok: true, ackState: 'read', changed: false });
    expect(await h.store.get(id)).toEqual(first);
  });

  it('ignores a regression in rank order: read < acted, and rejected is final', async () => {
    const h = harness();
    const forward = await delivered(h, 'one');
    expect(await h.ack.acknowledge({ messageId: forward, state: 'acted' }, { agentId: h.agentId })).toMatchObject({ ok: true });
    for (const state of ['read', 'rejected'] as const)
      expect(await h.ack.acknowledge({ messageId: forward, state }, { agentId: h.agentId }))
        .toEqual({ ok: false, messageId: forward, code: 'ack-regression', ackState: 'acted' });
    const rejected = await delivered(h, 'two');
    await h.ack.acknowledge({ messageId: rejected, state: 'read' }, { agentId: h.agentId });
    expect(await h.ack.acknowledge({ messageId: rejected, state: 'rejected' }, { agentId: h.agentId })).toMatchObject({ ok: true });
    expect(await h.ack.acknowledge({ messageId: rejected, state: 'acted' }, { agentId: h.agentId }))
      .toMatchObject({ ok: false, code: 'ack-regression', ackState: 'rejected' });
    expect(await h.store.get(forward)).toMatchObject({ ackState: 'acted' });
    expect(await h.store.get(rejected)).toMatchObject({ ackState: 'rejected' });
  });

  it('refuses an ack before the message reached the lane', async () => {
    const h = harness();
    const parked = idOf(await h.coordinator.send({ agentId: h.agentId, message: 'later' }, user));
    expect(await h.store.get(parked)).toMatchObject({ state: 'not-started' });
    expect(await h.ack.acknowledge({ messageId: parked, state: 'read' }, { agentId: h.agentId }))
      .toEqual({ ok: false, messageId: parked, code: 'ack-before-delivery' });
    expect((await h.store.get(parked))?.ackState).toBeUndefined();
  });

  it('accepts the ack from the lane the target was resumed into', async () => {
    const h = harness();
    const id = await delivered(h);
    const resumed = AgentId.create();
    await h.aliases.record(h.agentId, resumed);
    expect(await h.ack.acknowledge({ messageId: id, state: 'acted' }, { agentId: resumed }))
      .toMatchObject({ ok: true, ackState: 'acted' });
  });

  it('acks a settled message and keeps its settled state and terminal time', async () => {
    const h = harness();
    const id = await delivered(h);
    h.events.emit('agent:turn-settled', { ...h.tracked.info, status: 'completed', turnSeq: 1 });
    await settleEvents();
    const settled = await h.store.get(id);
    expect(settled).toMatchObject({ state: 'settled', turnOutcome: 'completed' });
    expect(await h.ack.acknowledge({ messageId: id, state: 'acted' }, { agentId: h.agentId })).toMatchObject({ ok: true });
    expect(await h.store.get(id)).toMatchObject({
      state: 'settled', turnOutcome: 'completed', terminalAt: settled?.terminalAt, ackState: 'acted',
    });
  });

  it('does not claim an ack whose write failed', async () => {
    const h = harness();
    const id = await delivered(h);
    h.storage.failWhen = (key, value) => indexHasState(key, value, 'started') &&
      JSON.stringify(value).includes('"ackState":"read"');
    expect(await h.ack.acknowledge({ messageId: id, state: 'read' }, { agentId: h.agentId }))
      .toEqual({ ok: false, messageId: id, code: 'storage-unavailable' });
    expect(await h.store.get(id)).toMatchObject({ ackState: 'pending' });
    expect(h.logger.error).toHaveBeenCalled();
  });

  it('asks for an ack only when the lane can call Ptah MCP tools', async () => {
    const h = harness();
    const id = await delivered(h);
    expect(sentText(h)).toContain(agentMessageAckLine(id));
    h.setInfo({ potentialCapabilities: noMcp });
    const plain = await delivered(h, 'no tools');
    expect(sentText(h)).not.toContain('ptah_agent_message_ack');
    expect(await h.store.get(plain)).toMatchObject({ state: 'started', ackState: 'unavailable' });
  });

  it('sets the ack state at a queued turn start from the lane capability', async () => {
    const h = harness();
    h.setInfo({ potentialCapabilities: noMcp });
    const id = idOf(await h.coordinator.send({ agentId: h.agentId, message: 'later' }, user));
    h.tracked.pendingMessages.splice(0);
    await h.store.markDispatching(id);
    h.events.emit('agent:turn-started', { ...h.tracked.info, messageId: id, turnSeq: 2 });
    await settleEvents();
    expect(await h.store.get(id)).toMatchObject({ state: 'started', turnSeq: 2, ackState: 'unavailable' });
  });

  it('refuses an ack after a restart right after the dispatch journal, before any adapter call', async () => {
    const h = harness();
    const id = idOf(await h.coordinator.send({ agentId: h.agentId, message: 'later' }, user));
    h.tracked.pendingMessages.splice(0);
    await h.store.markDispatching(id);
    const next = h.restart();
    expect(await next.store.get(id)).toMatchObject({ state: 'outcome-unknown', everDispatched: true });
    expect((await next.store.get(id))?.maybeDelivered).toBeUndefined();
    expect(await next.ack.acknowledge({ messageId: id, state: 'read' }, { agentId: h.agentId }))
      .toEqual({ ok: false, messageId: id, code: 'ack-before-delivery' });
  });

  it('allows an ack after a restart that followed a real delivery', async () => {
    const h = harness();
    const id = await delivered(h);
    const next = h.restart();
    expect(await next.store.get(id)).toMatchObject({ state: 'outcome-unknown', maybeDelivered: true });
    expect(await next.ack.acknowledge({ messageId: id, state: 'read' }, { agentId: h.agentId }))
      .toMatchObject({ ok: true, ackState: 'read' });
  });

  it('allows an ack after an adapter call that threw once it began', async () => {
    const h = harness();
    h.sendToAgent.mockRejectedValueOnce(new Error('socket closed'));
    const id = idOf(await h.coordinator.send({ agentId: h.agentId, message: 'now', delivery: 'now' }, user));
    expect(await h.store.get(id)).toMatchObject({ state: 'outcome-unknown', maybeDelivered: true });
    expect(await h.ack.acknowledge({ messageId: id, state: 'read' }, { agentId: h.agentId })).toMatchObject({ ok: true });
  });

  it('decides ownership on the record it writes, so a re-delivery to another lane meanwhile is refused', async () => {
    const h = harness();
    const id = await delivered(h);
    const other = AgentId.create();
    // The owner changes after the caller's lanes are resolved and before the locked write.
    const ack = new AgentMessageAckService({
      store: h.store, logger: h.logger,
      aliases: {
        aliasesOf: async (agentId) => {
          const lanes = await h.aliases.aliasesOf(agentId);
          await h.store.transition(id, { actualAgentId: other }, ['started']);
          return lanes;
        },
      },
    });
    expect(await ack.acknowledge({ messageId: id, state: 'acted' }, { agentId: h.agentId }))
      .toEqual({ ok: false, messageId: id, code: 'ack-forbidden' });
    expect(await h.store.get(id)).toMatchObject({ actualAgentId: other, ackState: 'pending' });
  });

  it('keeps pre-ack records across restores and acks them once delivery is proven', async () => {
    const storage = new MemoryPersistence();
    const target = AgentId.create();
    const now = Date.now();
    const legacy = (id: string, state: string, extra: Record<string, unknown> = {}) => ({
      id, targetAgentId: target, laneLineageId: target, sender: { kind: 'user' }, senderKey: 'user',
      state, mode: 'steer', delivery: 'now', createdAt: now, updatedAt: now, attemptCount: 1,
      everDispatched: true, turnSeq: 1, ...extra,
    });
    const settled = '11111111-2222-4333-8444-000000000001';
    const started = '11111111-2222-4333-8444-000000000002';
    const journaled = '11111111-2222-4333-8444-000000000003';
    storage.values.set(AGENT_MESSAGE_ENVELOPE_INDEX_KEY, { version: 1, records: [
      legacy(settled, 'settled', { turnOutcome: 'completed', terminalAt: now }),
      legacy(started, 'started'),
      legacy(journaled, 'dispatching', { turnSeq: undefined }),
    ] });
    const first = harness(storage);
    for (const id of [settled, started, journaled]) expect(await first.store.get(id)).toBeDefined();
    expect((await first.store.get(settled))?.ackState).toBeUndefined();
    const caller = { agentId: target };
    expect(await first.ack.acknowledge({ messageId: settled, state: 'acted' }, caller)).toMatchObject({ ok: true });
    expect(await first.ack.acknowledge({ messageId: started, state: 'read' }, caller)).toMatchObject({ ok: true });
    expect(await first.ack.acknowledge({ messageId: journaled, state: 'read' }, caller))
      .toMatchObject({ ok: false, code: 'ack-before-delivery' });
    const second = first.restart();
    expect(await second.store.get(settled)).toMatchObject({ state: 'settled', ackState: 'acted' });
    expect(await second.store.get(started)).toMatchObject({ state: 'outcome-unknown', ackState: 'read' });
    expect((await second.store.get(journaled))?.ackState).toBeUndefined();
  });

  it('collapses whitespace and caps the note', () => {
    expect(normalizeAckNote(' a \n\t b ')).toBe('a b');
    expect(normalizeAckNote('   ')).toBeUndefined();
    expect(normalizeAckNote('x'.repeat(600))).toHaveLength(500);
  });
});
