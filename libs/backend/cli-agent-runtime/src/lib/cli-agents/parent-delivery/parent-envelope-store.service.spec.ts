import { AgentId } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import { FakeStateStorage } from './__fixtures__/fake-state-storage';
import {
  ParentEnvelopeStoreService,
  type NewParentDeliveryEnvelope,
  type ParentDeliveryEnvelope,
  type ParentEnqueueResult,
} from './parent-envelope-store.service';
import {
  PARENT_COMPLETION_KEYS_PREFIX,
  PARENT_COMPLETION_OUTBOX_PREFIX,
  PARENT_ENVELOPE_BODY_PREFIX,
  PARENT_ENVELOPE_INDEX_KEY,
  PARENT_TOMBSTONE_KEY,
  ParentTombstonePersistError,
  type ParentCompletionOutboxEntry,
} from './parent-envelope.schema';

const PARENT = 'parent-1';
const AGENT = AgentId.from('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
const DAY = 24 * 60 * 60 * 1000;
const COMPLETED_AT = '2026-11-07T00:00:00.000Z';
const COMPLETION_KEY = `${AGENT}:${COMPLETED_AT}`;

let now = Date.UTC(2026, 10, 7);
beforeEach(() => {
  now = Date.UTC(2026, 10, 7);
  jest.spyOn(Date, 'now').mockImplementation(() => now);
});
afterEach(() => jest.restoreAllMocks());

function logger(): Logger {
  const log: Pick<Logger, 'info' | 'warn' | 'error' | 'debug'> = {
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
  };
  return log as Logger;
}

function report(n: number, parentSessionId = PARENT): NewParentDeliveryEnvelope {
  const dedupeKey = `report:${AGENT}:${n}:hash${n}`;
  return { id: `lane-delivery:${dedupeKey}`, dedupeKey, agentId: AGENT, parentSessionId,
    kind: 'report', body: `<agent-report>body ${n}</agent-report>`, createdAt: now };
}

function outboxEntry(dedupeKey = COMPLETION_KEY): ParentCompletionOutboxEntry {
  return { dedupeKey, agentId: AGENT, parentSessionId: PARENT, completedAt: COMPLETED_AT,
    body: 'completion body', verdict: 'delivered', originName: 'codex · lane', createdAt: now };
}

function completion(dedupeKey = COMPLETION_KEY): NewParentDeliveryEnvelope {
  const entry = outboxEntry(dedupeKey);
  return { id: `lane-delivery:${dedupeKey}`, dedupeKey, agentId: AGENT,
    parentSessionId: PARENT, kind: 'completion', body: entry.body, verdict: entry.verdict,
    originName: entry.originName, createdAt: now };
}

async function open(storage: FakeStateStorage): Promise<ParentEnvelopeStoreService> {
  const store = new ParentEnvelopeStoreService(logger(), storage);
  await store.ready;
  return store;
}

function saved(result: ParentEnqueueResult): ParentDeliveryEnvelope {
  if ('refused' in result) throw new Error(`refused: ${result.refused}`);
  return result;
}

function shardKeys(storage: FakeStateStorage): unknown {
  return storage.values.get(`${PARENT_COMPLETION_KEYS_PREFIX}${PARENT}`);
}

describe('ParentEnvelopeStoreService persistence', () => {
  it('restores pending reports and completions and dedupes across a restart', async () => {
    const storage = new FakeStateStorage();
    const store = await open(storage);
    const first = saved(await store.enqueue(report(1)));
    saved(await store.enqueue(completion()));
    expect(saved(await store.enqueue(report(1))).id).toBe(first.id);

    const restarted = await open(storage);
    expect(restarted.pending(PARENT).map((entry) => entry.kind).sort())
      .toEqual(['completion', 'report']);
    expect(saved(await restarted.enqueue(report(1))).id).toBe(first.id);
    expect(restarted.list(PARENT)).toHaveLength(2);
    expect(await restarted.getBody(first.id)).toBe('<agent-report>body 1</agent-report>');
  });

  it('keeps the existing report and completion id formats', async () => {
    const store = await open(new FakeStateStorage());
    expect(saved(await store.enqueue(report(3))).id).toBe(`lane-delivery:report:${AGENT}:3:hash3`);
    expect(saved(await store.enqueue(completion())).id).toBe(`lane-delivery:${COMPLETION_KEY}`);
  });

  it('turns sending into outcome-unknown at restart', async () => {
    const storage = new FakeStateStorage();
    const store = await open(storage);
    const entry = saved(await store.enqueue(report(1)));
    await store.markSending(entry.id);
    const restarted = await open(storage);
    expect(restarted.findById(entry.id)).toMatchObject({
      state: 'outcome-unknown', lastError: 'host-restarted', everDispatched: true,
    });
  });

  it.each([
    ['body', PARENT_ENVELOPE_BODY_PREFIX],
    ['index', PARENT_ENVELOPE_INDEX_KEY],
  ])('fails closed when the %s write fails, for a report and a completion', async (_label, key) => {
    const storage = new FakeStateStorage();
    const store = await open(storage);
    storage.failWrites = (written) => written.startsWith(key);
    expect(await store.enqueue(report(1))).toEqual({ refused: 'storage-unavailable' });
    expect(await store.enqueue(completion())).toEqual({ refused: 'storage-unavailable' });
    expect(store.find(report(1).dedupeKey)).toBeUndefined();
    expect(store.find(COMPLETION_KEY)).toBeUndefined();
    expect(await store.getBody(report(1).id)).toBeUndefined();
  });

  it('re-indexes an orphan body instead of deleting it', async () => {
    const storage = new FakeStateStorage();
    const store = await open(storage);
    storage.failWrites = (key) => key === PARENT_ENVELOPE_INDEX_KEY;
    expect(await store.enqueue(report(1))).toEqual({ refused: 'storage-unavailable' });
    storage.failWrites = () => false;
    const restarted = await open(storage);
    expect(restarted.find(report(1).dedupeKey)).toMatchObject({
      state: 'pending', lastError: 'index-lost',
    });
    expect(storage.values.has(`${PARENT_ENVELOPE_BODY_PREFIX}${report(1).id}`)).toBe(true);
  });

  it('refuses outcome-unknown retry without a duplicate-risk confirmation', async () => {
    const store = await open(new FakeStateStorage());
    const entry = saved(await store.enqueue(report(1)));
    await store.markSending(entry.id);
    await store.markOutcomeUnknown(entry.id, 'timeout');
    expect(await store.retry(entry.id)).toEqual({ refused: 'confirmation-required' });
    expect(await store.retry(entry.id, { confirmDuplicateRisk: true }))
      .toMatchObject({ state: 'pending' });
  });
});

describe('ParentEnvelopeStoreService retention and capacity', () => {
  it('keeps a delivered report for 7 days across a restart, then drops body and index', async () => {
    const storage = new FakeStateStorage();
    const store = await open(storage);
    const entry = saved(await store.enqueue(report(1)));
    await store.markDelivered(entry.dedupeKey);
    now += 7 * DAY - 60 * 60 * 1000;
    const restarted = await open(storage);
    expect(await restarted.getBody(entry.id)).toBe('<agent-report>body 1</agent-report>');
    now += 60 * 60 * 1000;
    expect(await restarted.getBody(entry.id)).toBeUndefined();
    expect(restarted.find(entry.dedupeKey)).toBeUndefined();
    expect(storage.values.has(`${PARENT_ENVELOPE_BODY_PREFIX}${entry.id}`)).toBe(false);
  });

  it('never expires an undelivered report', async () => {
    const storage = new FakeStateStorage();
    const store = await open(storage);
    const entry = saved(await store.enqueue(report(1)));
    now += 60 * DAY;
    const restarted = await open(storage);
    expect(await restarted.getBody(entry.id)).toBe('<agent-report>body 1</agent-report>');
  });

  it('refuses the 65th pending report for one parent without evicting', async () => {
    const store = await open(new FakeStateStorage());
    for (let n = 0; n < 64; n++) saved(await store.enqueue(report(n)));
    expect(await store.enqueue(report(64))).toEqual({ refused: 'parent-inbox-full' });
    expect(store.pending(PARENT)).toHaveLength(64);
    expect(saved(await store.enqueue(completion())).state).toBe('pending');
  });

  it('refuses the 1,025th body-bearing report and keeps every unexpired delivered body', async () => {
    const storage = new FakeStateStorage();
    const records = Array.from({ length: 1_024 }, (_unused, n) => {
      const input = report(n, `parent-${n % 32}`);
      storage.values.set(`${PARENT_ENVELOPE_BODY_PREFIX}${input.id}`, {
        text: input.body, envelopeId: input.id, parentSessionId: input.parentSessionId,
        agentId: input.agentId, kind: 'report', dedupeKey: input.dedupeKey, createdAt: now,
      });
      return { id: input.id, parentSessionId: input.parentSessionId, agentId: input.agentId,
        kind: 'report', dedupeKey: input.dedupeKey, createdAt: now, updatedAt: now,
        state: 'delivered', attempts: 1, bodyBytes: input.body.length, deliveredAt: now };
    });
    storage.values.set(PARENT_ENVELOPE_INDEX_KEY, { version: 1, records });
    const store = await open(storage);
    expect(await store.enqueue(report(5_000, 'parent-new'))).toEqual({ refused: 'parent-inbox-full' });
    expect(store.list()).toHaveLength(1_024);
    expect(await store.getBody(records[0].id)).toBe('<agent-report>body 0</agent-report>');
  });
});

describe('ParentEnvelopeStoreService completion outbox and key shard', () => {
  it('round-trips the exact outbox entry through a new store, keyed by completion key', async () => {
    const storage = new FakeStateStorage();
    const store = await open(storage);
    await store.putCompletionOutbox(outboxEntry());
    await store.putCompletionOutbox({ ...outboxEntry(), body: 'replaced body' });
    const restarted = await open(storage);
    expect(await restarted.listCompletionOutbox(PARENT)).toEqual([
      { ...outboxEntry(), body: 'replaced body' },
    ]);
    expect(await restarted.listCompletionOutbox()).toHaveLength(1);
  });

  it('rejects a failed outbox put with no durable entry, and throws on an unreadable outbox', async () => {
    const storage = new FakeStateStorage();
    const store = await open(storage);
    storage.failWrites = (key) => key.startsWith(PARENT_COMPLETION_OUTBOX_PREFIX);
    await expect(store.putCompletionOutbox(outboxEntry())).rejects.toThrow('write failed');
    expect(await store.listCompletionOutbox(PARENT)).toEqual([]);
    storage.values.set(`${PARENT_COMPLETION_OUTBOX_PREFIX}${PARENT}`, {
      version: 1, entries: [{ dedupeKey: 'bad' }],
    });
    await expect(store.listCompletionOutbox(PARENT)).rejects.toThrow();
    await expect(store.listCompletionOutbox()).rejects.toThrow();
  });

  it('writes the shard key on acceptance, then removes the outbox entry', async () => {
    const storage = new FakeStateStorage();
    const store = await open(storage);
    await store.putCompletionOutbox(outboxEntry());
    saved(await store.enqueue(completion()));
    expect(shardKeys(storage)).toEqual({ version: 1,
      keys: [{ dedupeKey: COMPLETION_KEY, state: 'accepted', at: now }] });
    expect(await store.listCompletionOutbox(PARENT)).toEqual([]);
    const shardWrite = storage.writes.lastIndexOf(`${PARENT_COMPLETION_KEYS_PREFIX}${PARENT}`);
    const outboxWrite = storage.writes.lastIndexOf(`${PARENT_COMPLETION_OUTBOX_PREFIX}${PARENT}`);
    expect(shardWrite).toBeLessThan(outboxWrite);
  });

  it('writes the shard key on completion cancel and drops the body at once', async () => {
    const storage = new FakeStateStorage();
    const store = await open(storage);
    storage.failWrites = (key) => key.startsWith(PARENT_COMPLETION_KEYS_PREFIX);
    const entry = saved(await store.enqueue(completion()));
    storage.failWrites = () => false;
    expect(await store.cancel(entry.id)).toMatchObject({ state: 'cancelled', bodyBytes: 0 });
    expect(shardKeys(storage)).toEqual({ version: 1,
      keys: [{ dedupeKey: COMPLETION_KEY, state: 'cancelled', at: now }] });
    expect(await store.isCompletionSatisfied(PARENT, COMPLETION_KEY)).toBe(true);
  });

  it('answers satisfied from the index, or from the shard after the 7 day window', async () => {
    const storage = new FakeStateStorage();
    const store = await open(storage);
    expect(await store.isCompletionSatisfied(PARENT, COMPLETION_KEY)).toBe(false);
    saved(await store.enqueue(completion()));
    expect(await store.isCompletionSatisfied(PARENT, COMPLETION_KEY)).toBe(true);
    await store.markDelivered(COMPLETION_KEY);
    now += 8 * DAY;
    const restarted = await open(storage);
    expect(restarted.find(COMPLETION_KEY)).toBeUndefined();
    expect(await restarted.isCompletionSatisfied(PARENT, COMPLETION_KEY)).toBe(true);
  });

  it('throws instead of answering false when the shard is unreadable on an index miss', async () => {
    const storage = new FakeStateStorage();
    const store = await open(storage);
    storage.values.set(`${PARENT_COMPLETION_KEYS_PREFIX}${PARENT}`, {
      version: 1, keys: [{ dedupeKey: 'broken' }],
    });
    await expect(store.isCompletionSatisfied(PARENT, COMPLETION_KEY)).rejects.toThrow();
  });

  it('pins the index key and outbox through a shard outage longer than 7 days', async () => {
    const storage = new FakeStateStorage();
    const store = await open(storage);
    await store.putCompletionOutbox(outboxEntry());
    storage.failWrites = (key) => key.startsWith(PARENT_COMPLETION_KEYS_PREFIX);
    saved(await store.enqueue(completion()));
    await store.markDelivered(COMPLETION_KEY);
    now += 8 * DAY;
    const restarted = await open(storage);
    await restarted.backfillCompletionKeys();
    expect(restarted.find(COMPLETION_KEY)).toMatchObject({ state: 'delivered', bodyBytes: 0 });
    expect(await restarted.getBody(`lane-delivery:${COMPLETION_KEY}`)).toBeUndefined();
    expect(await restarted.listCompletionOutbox(PARENT)).toHaveLength(1);
    expect(await restarted.isCompletionSatisfied(PARENT, COMPLETION_KEY)).toBe(true);
  });

  it('on shard recovery writes the key before removing the outbox and pruning the index', async () => {
    const storage = new FakeStateStorage();
    const store = await open(storage);
    await store.putCompletionOutbox(outboxEntry());
    storage.failWrites = (key) => key.startsWith(PARENT_COMPLETION_KEYS_PREFIX);
    saved(await store.enqueue(completion()));
    await store.markDelivered(COMPLETION_KEY);
    now += 8 * DAY;
    storage.failWrites = () => false;
    storage.writes.length = 0;
    await store.backfillCompletionKeys();
    const shardWrite = storage.writes.indexOf(`${PARENT_COMPLETION_KEYS_PREFIX}${PARENT}`);
    const outboxWrite = storage.writes.indexOf(`${PARENT_COMPLETION_OUTBOX_PREFIX}${PARENT}`);
    const indexPrune = storage.writes.lastIndexOf(PARENT_ENVELOPE_INDEX_KEY);
    expect(shardWrite).toBeGreaterThanOrEqual(0);
    expect(shardWrite).toBeLessThan(outboxWrite);
    expect(outboxWrite).toBeLessThan(indexPrune);
    expect(store.find(COMPLETION_KEY)).toBeUndefined();
    expect(await store.listCompletionOutbox(PARENT)).toEqual([]);
    expect(await (await open(storage)).isCompletionSatisfied(PARENT, COMPLETION_KEY)).toBe(true);
  });

  it('removes an outbox entry whose key is already durable in the shard', async () => {
    const storage = new FakeStateStorage();
    storage.values.set(`${PARENT_COMPLETION_KEYS_PREFIX}${PARENT}`, {
      version: 1, keys: [{ dedupeKey: COMPLETION_KEY, state: 'accepted', at: now }],
    });
    const store = await open(storage);
    await store.putCompletionOutbox(outboxEntry());
    await store.backfillCompletionKeys(PARENT);
    expect(await store.listCompletionOutbox(PARENT)).toEqual([]);
  });
});

describe('ParentEnvelopeStoreService parent tombstone', () => {
  it('round-trips each phase through a new store instance', async () => {
    const storage = new FakeStateStorage();
    const store = await open(storage);
    await store.markIntent(PARENT);
    expect((await open(storage)).tombstonePhase(PARENT)).toBe('intent');
    await store.markMetadataDeleted(PARENT);
    const restarted = await open(storage);
    expect(restarted.tombstonePhase(PARENT)).toBe('metadata-deleted');
    expect(restarted.listPendingPurges().map((record) => record.sessionId)).toEqual([PARENT]);
    await store.markPurged(PARENT);
    const purged = await open(storage);
    expect(purged.tombstonePhase(PARENT)).toBe('purged');
    expect(purged.isParentFrozen(PARENT)).toBe(true);
    expect(purged.listPendingPurges()).toEqual([]);
    await store.clearTombstone(PARENT);
    expect((await open(storage)).isParentFrozen(PARENT)).toBe(false);
  });

  it('reverts the freeze when markIntent cannot persist', async () => {
    const storage = new FakeStateStorage();
    const store = await open(storage);
    storage.failWrites = (key) => key === PARENT_TOMBSTONE_KEY;
    await expect(store.markIntent(PARENT)).rejects.toBeInstanceOf(ParentTombstonePersistError);
    expect(store.isParentFrozen(PARENT)).toBe(false);
  });

  it('stays frozen when clearTombstone cannot persist', async () => {
    const storage = new FakeStateStorage();
    const store = await open(storage);
    await store.markIntent(PARENT);
    storage.failWrites = (key) => key === PARENT_TOMBSTONE_KEY;
    await expect(store.clearTombstone(PARENT)).rejects.toBeInstanceOf(ParentTombstonePersistError);
    expect(store.isParentFrozen(PARENT)).toBe(true);
  });

  it('keeps reads but refuses enqueue, cancel and retry while frozen', async () => {
    const store = await open(new FakeStateStorage());
    const entry = saved(await store.enqueue(report(1)));
    await store.markIntent(PARENT);
    expect(store.list(PARENT)).toHaveLength(1);
    expect(await store.getBody(entry.id)).toBe('<agent-report>body 1</agent-report>');
    expect(await store.enqueue(report(2))).toEqual({ refused: 'parent-session-deleted' });
    expect(await store.enqueue(completion())).toEqual({ refused: 'parent-session-deleted' });
    expect(await store.cancel(entry.id)).toEqual({ refused: 'parent-session-deleted' });
    expect(await store.retry(entry.id)).toEqual({ refused: 'parent-session-deleted' });
  });

  it('purges only at metadata-deleted, keeping delivered records and dropping outbox and shard', async () => {
    const storage = new FakeStateStorage();
    const store = await open(storage);
    const pending = saved(await store.enqueue(report(1)));
    const delivered = saved(await store.enqueue(report(2)));
    await store.markDelivered(delivered.dedupeKey);
    await store.putCompletionOutbox(outboxEntry('other:2026-11-07T00:00:00.000Z'));
    saved(await store.enqueue(completion()));
    await store.markIntent(PARENT);
    expect(await store.purgeUndeliveredForParent(PARENT)).toBe(0);
    await store.markMetadataDeleted(PARENT);
    expect(await store.purgeUndeliveredForParent(PARENT)).toBe(2);
    expect(store.findById(pending.id)).toMatchObject({ state: 'cancelled', bodyBytes: 0 });
    expect(store.findById(delivered.id)?.state).toBe('delivered');
    expect(storage.values.has(`${PARENT_COMPLETION_OUTBOX_PREFIX}${PARENT}`)).toBe(false);
    expect(storage.values.has(`${PARENT_COMPLETION_KEYS_PREFIX}${PARENT}`)).toBe(false);
  });

  it('drops a malformed tombstone record', async () => {
    const storage = new FakeStateStorage();
    storage.values.set(PARENT_TOMBSTONE_KEY, { version: 1, records: [
      { sessionId: PARENT, phase: 'purged', markedAt: now, updatedAt: now },
      { sessionId: 'kept', phase: 'intent', markedAt: now, updatedAt: now },
    ] });
    const store = await open(storage);
    expect(store.isParentFrozen(PARENT)).toBe(false);
    expect(store.tombstonePhase('kept')).toBe('intent');
  });

  it('stays not-ready while the tombstone read throws', async () => {
    const storage = new FakeStateStorage();
    storage.failReads = (key) => key === PARENT_TOMBSTONE_KEY;
    const store = new ParentEnvelopeStoreService(logger(), storage);
    await expect(store.ready).rejects.toThrow('read failed');
    expect(await store.enqueue(report(1))).toEqual({ refused: 'storage-unavailable' });
    storage.failReads = () => false;
    saved(await store.enqueue(report(1)));
  });
});
