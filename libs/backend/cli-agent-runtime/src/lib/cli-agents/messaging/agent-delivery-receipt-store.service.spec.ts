import { AgentId } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
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

  it('keeps a delivered receipt in memory when persistence fails', async () => {
    const store = new AgentDeliveryReceiptStore({ get: () => undefined, update: async () => { throw new Error('disk full'); } });
    const accepted = await store.accept(agentId, 'start-turn', 'queue');
    await expect(store.transition(accepted.id, { state: 'started', turnSeq: 1 })).resolves.toMatchObject({ state: 'started' });
    expect(await store.get(agentId, accepted.id)).toMatchObject({ state: 'started' });
  });

  it('restores valid records beside malformed entries', async () => {
    const first = new AgentDeliveryReceiptStore(storage);
    const accepted = await first.accept(agentId, 'start-turn', 'queue');
    state = [...(state as object[]), { invalid: true }];
    const restored = new AgentDeliveryReceiptStore(storage);
    expect(await restored.get(agentId, accepted.id)).toMatchObject({ state: 'failed', reason: 'host-restarted' });
  });

  it('logs counts of malformed records dropped during restore', async () => {
    state = [{ invalid: true }, { also: 'invalid' }];
    const logger = { warn: jest.fn(), error: jest.fn() } as Partial<Logger> as Logger;
    const restored = new AgentDeliveryReceiptStore(storage, undefined, Date.now, logger);
    await restored.get(agentId, 'missing');
    expect(logger.warn).toHaveBeenCalledWith(
      '[AgentDeliveryReceiptStore] Dropped stored receipts',
      { malformed: 2, expired: 0, restored: 0 },
    );
  });

  it('logs persistence and sink failures while preserving the receipt', async () => {
    const logger = { warn: jest.fn(), error: jest.fn() } as Partial<Logger> as Logger;
    const store = new AgentDeliveryReceiptStore({
      get: () => undefined, update: async () => { throw new Error('disk full'); },
    }, { changed: () => { throw new Error('sink failed'); } }, Date.now, logger);
    const receipt = await store.accept(agentId, 'start-turn', 'queue');
    expect(await store.get(agentId, receipt.id)).toMatchObject({ state: 'accepted' });
    expect(logger.error).toHaveBeenCalledTimes(2);
  });

  it('continues live receipts when restore fails', async () => {
    const store = new AgentDeliveryReceiptStore({
      get: () => { throw new Error('locked'); }, update: async () => undefined,
    });
    await expect(store.accept(agentId, 'start-turn', 'queue')).resolves.toMatchObject({ state: 'accepted' });
  });

  it('keeps a committed transition when the notification sink throws', async () => {
    const store = new AgentDeliveryReceiptStore(storage, { changed: () => { throw new Error('sink unavailable'); } });
    const accepted = await store.accept(agentId, 'start-turn', 'queue');
    await expect(store.transition(accepted.id, { state: 'started', turnSeq: 1 })).resolves.toMatchObject({ state: 'started' });
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

  it('bounds terminal receipts globally across many ended agents', async () => {
    let now = 1_000;
    const store = new AgentDeliveryReceiptStore(storage, undefined, () => now);
    let oldest: { agentId: ReturnType<typeof AgentId.create>; id: string } | undefined;
    for (let index = 0; index < 257; index++) {
      const nextAgent = AgentId.create();
      const receipt = await store.accept(nextAgent, 'start-turn', 'queue');
      if (!oldest) oldest = { agentId: nextAgent, id: receipt.id };
      await store.transition(receipt.id, { state: 'failed', reason: 'test' });
      now++;
    }
    expect((await store.get(oldest!.agentId, oldest!.id)).state).toBe('expired');
    expect((state as unknown[]).length).toBeLessThanOrEqual(256);
  });
});
