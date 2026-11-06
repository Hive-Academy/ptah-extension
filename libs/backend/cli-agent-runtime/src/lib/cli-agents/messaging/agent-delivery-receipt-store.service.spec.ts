import { AgentId } from '@ptah-extension/shared';
import { AgentDeliveryReceiptStore, type AgentDeliveryReceiptPersistence } from './agent-delivery-receipt-store.service';

describe('AgentDeliveryReceiptStore', () => {
  const agentId = AgentId.create();
  let state: unknown;
  const storage: AgentDeliveryReceiptPersistence = {
    get: <T>() => state as T | undefined,
    update: async (_key, value) => { state = value; },
  };

  beforeEach(() => { state = undefined; });

  it('persists metadata, binds the turn and settles it', async () => {
    const store = new AgentDeliveryReceiptStore(storage);
    const accepted = await store.accept(agentId, 'queue-next-turn', 'queue');
    expect(JSON.stringify(state)).not.toContain('secret message');
    await store.transition(accepted.id, { state: 'started', turnSeq: 2 });
    await store.transition(accepted.id, { state: 'settled', turnSeq: 2, turnOutcome: 'completed' });
    expect(await store.get(agentId, accepted.id)).toMatchObject({ state: 'settled', turnSeq: 2 });
  });

  it('keeps the collapsed preview in memory and excludes it from persisted metadata', async () => {
    const store = new AgentDeliveryReceiptStore(storage);
    const accepted = await store.accept(agentId, 'queue-next-turn', 'queue', undefined, 'parent', 'secret\n  message');
    expect(accepted).toMatchObject({ sender: 'parent', preview: 'secret message' });
    expect(JSON.stringify(state)).not.toContain('secret message');
    expect(JSON.stringify(state)).not.toContain('preview');
  });

  it('marks unfinished receipts failed after restart and expires unknown IDs', async () => {
    const first = new AgentDeliveryReceiptStore(storage);
    const accepted = await first.accept(agentId, 'queue-next-turn', 'queue');
    const restored = new AgentDeliveryReceiptStore(storage);
    expect(await restored.get(agentId, accepted.id)).toMatchObject({ state: 'failed', reason: 'host-restarted' });
    expect((await restored.get(agentId, 'missing')).state).toBe('expired');
  });

  it('does not revive a terminal receipt after a late turn-start event', async () => {
    const store = new AgentDeliveryReceiptStore(storage);
    const accepted = await store.accept(agentId, 'queue-next-turn', 'queue');
    await store.transition(accepted.id, { state: 'failed', reason: 'agent_stopped' });
    expect(await store.transition(accepted.id, { state: 'started', turnSeq: 2 }))
      .toMatchObject({ state: 'failed', reason: 'agent_stopped' });
  });

  it('bounds terminal history and expires receipts after the TTL', async () => {
    let now = 1_000;
    const store = new AgentDeliveryReceiptStore(storage, undefined, () => now);
    const ids: string[] = [];
    for (let index = 0; index < 65; index += 1) {
      const accepted = await store.accept(agentId, 'queue-next-turn', 'queue');
      ids.push(accepted.id);
      await store.transition(accepted.id, { state: 'failed', reason: 'test' });
      now += 1;
    }
    expect((await store.get(agentId, ids[0])).state).toBe('expired');
    expect((await store.get(agentId, ids[64])).state).toBe('failed');
    now += 7 * 24 * 60 * 60 * 1_000;
    expect((await store.get(agentId, ids[64])).state).toBe('expired');
  });
});
