import { AgentId, type IAgentAdapter } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import { FakeStateStorage } from '../parent-delivery/__fixtures__/fake-state-storage';
import { ParentDeliveryDrainerService } from '../parent-delivery/parent-delivery-drainer.service';
import { ParentEnvelopeStoreService } from '../parent-delivery/parent-envelope-store.service';
import {
  PARENT_COMPLETION_OUTBOX_PREFIX,
  PARENT_TOMBSTONE_KEY,
  type ParentTombstoneRecord,
} from '../parent-delivery/parent-envelope.schema';
import { AGENT_MESSAGE_BODY_PREFIX } from './envelope/agent-message-envelope.schema';
import { AgentMessageEnvelopeStore } from './envelope/agent-message-envelope.store';
import {
  PARENT_PURGE_RETRY_MS,
  ParentSessionPurgeService,
  type ParentSessionExistence,
  type PurgeEnvelopeStore,
  type PurgeParentStore,
} from './parent-session-purge.service';

const PARENT = '11111111-2222-4333-8444-555555555555';
const LANE = AgentId.from('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
const REPORT_KEY = `report:${LANE}:1:hash1`;

function logger(): Logger {
  const log: Pick<Logger, 'info' | 'warn' | 'error' | 'debug'> = {
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
  };
  return log as Logger;
}

function existence(answer: boolean | Error): jest.Mocked<ParentSessionExistence> {
  return {
    exists: jest.fn((sessionId: string) => {
      void sessionId;
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    }),
  };
}

/** Records every store call by name, in order, over in-memory tombstones. */
class SpyStores implements PurgeParentStore, PurgeEnvelopeStore {
  readonly calls: string[] = [];
  readonly tombstones = new Map<string, ParentTombstoneRecord>();
  readonly failures = new Map<string, Error>();

  private record(name: string): void {
    this.calls.push(name);
    const failure = this.failures.get(name);
    if (failure) throw failure;
  }

  private set(sessionId: string, phase: ParentTombstoneRecord['phase']): void {
    this.tombstones.set(sessionId, {
      sessionId, phase, markedAt: 1, updatedAt: 1, ...(phase === 'purged' ? { purgedAt: 1 } : {}),
    });
  }

  async markIntent(sessionId: string): Promise<void> {
    this.record('markIntent');
    this.set(sessionId, 'intent');
  }
  async markMetadataDeleted(sessionId: string): Promise<void> {
    this.record('markMetadataDeleted');
    this.set(sessionId, 'metadata-deleted');
  }
  async markPurged(sessionId: string): Promise<void> {
    this.record('markPurged');
    this.set(sessionId, 'purged');
  }
  async clearTombstone(sessionId: string): Promise<void> {
    this.record('clearTombstone');
    this.tombstones.delete(sessionId);
  }
  listPendingPurges(): readonly ParentTombstoneRecord[] {
    this.calls.push('listPendingPurges');
    return [...this.tombstones.values()].filter((entry) => entry.phase !== 'purged');
  }
  isParentFrozen(sessionId: string): boolean {
    this.calls.push('isParentFrozen');
    return this.tombstones.has(sessionId);
  }
  async purgeUndeliveredForParent(): Promise<number> {
    this.record('purgeUndeliveredForParent');
    return 1;
  }
  async purgeByParent(): Promise<number> {
    this.record('purgeByParent');
    return 1;
  }

  /** Store calls that write or purge, without the read-only queries. */
  writes(): string[] {
    return this.calls.filter((name) => name !== 'isParentFrozen' && name !== 'listPendingPurges');
  }
}

describe('ParentSessionPurgeService (spy stores)', () => {
  afterEach(() => jest.useRealTimers());

  it('calls only the P1-B tombstone methods, in phase order', async () => {
    const stores = new SpyStores();
    const purge = new ParentSessionPurgeService(stores, stores, existence(false), logger());

    await purge.beginDelete(PARENT);
    await purge.markMetadataDeleted(PARENT);
    await purge.completeDelete(PARENT);

    expect(stores.writes()).toEqual([
      'markIntent', 'markMetadataDeleted', 'purgeByParent', 'purgeUndeliveredForParent', 'markPurged',
    ]);
    const allowed = new Set([
      'markIntent', 'markMetadataDeleted', 'markPurged', 'clearTombstone', 'listPendingPurges',
      'isParentFrozen', 'purgeUndeliveredForParent', 'purgeByParent',
    ]);
    expect(stores.calls.every((name) => allowed.has(name))).toBe(true);
  });

  it('throws from beginDelete when the intent cannot be persisted, and nothing else runs', async () => {
    const stores = new SpyStores();
    stores.failures.set('markIntent', new Error('tombstone write failed'));
    const purge = new ParentSessionPurgeService(stores, stores, existence(false), logger());

    await expect(purge.beginDelete(PARENT)).rejects.toThrow('tombstone write failed');
    expect(stores.writes()).toEqual(['markIntent']);
    expect(stores.tombstones.has(PARENT)).toBe(false);
  });

  it('logs a failed metadata-deleted write and re-attempts it before purging', async () => {
    const stores = new SpyStores();
    const log = logger();
    const purge = new ParentSessionPurgeService(stores, stores, existence(false), log);
    await purge.beginDelete(PARENT);
    stores.failures.set('markMetadataDeleted', new Error('write failed'));

    await expect(purge.markMetadataDeleted(PARENT)).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalled();

    stores.failures.delete('markMetadataDeleted');
    await purge.completeDelete(PARENT);
    expect(stores.writes()).toEqual([
      'markIntent', 'markMetadataDeleted', 'markMetadataDeleted', 'purgeByParent',
      'purgeUndeliveredForParent', 'markPurged',
    ]);
  });

  it('keeps the parent frozen when clearTombstone fails in abortDelete', async () => {
    jest.useFakeTimers();
    const stores = new SpyStores();
    const purge = new ParentSessionPurgeService(stores, stores, existence(true), logger());
    await purge.beginDelete(PARENT);
    stores.failures.set('clearTombstone', new Error('write failed'));

    await expect(purge.abortDelete(PARENT)).resolves.toBeUndefined();

    expect(stores.tombstones.get(PARENT)?.phase).toBe('intent');
    expect(stores.writes()).not.toContain('purgeByParent');
    expect(jest.getTimerCount()).toBe(1);

    stores.failures.delete('clearTombstone');
    await jest.advanceTimersByTimeAsync(PARENT_PURGE_RETRY_MS);
    expect(stores.tombstones.has(PARENT)).toBe(false);
    expect(stores.writes()).not.toContain('purgeByParent');
    expect(jest.getTimerCount()).toBe(0);
    purge.dispose();
  });

  it('logs a failed purge without throwing, stays frozen and retries on one timer', async () => {
    jest.useFakeTimers();
    const stores = new SpyStores();
    const purge = new ParentSessionPurgeService(stores, stores, existence(false), logger());
    await purge.beginDelete(PARENT);
    await purge.markMetadataDeleted(PARENT);
    stores.failures.set('purgeUndeliveredForParent', new Error('read failed'));

    await expect(purge.completeDelete(PARENT)).resolves.toBe('pending-retry');
    await expect(purge.completeDelete(PARENT)).resolves.toBe('pending-retry');
    expect(stores.tombstones.get(PARENT)?.phase).toBe('metadata-deleted');
    expect(jest.getTimerCount()).toBe(1);

    stores.failures.delete('purgeUndeliveredForParent');
    await jest.advanceTimersByTimeAsync(PARENT_PURGE_RETRY_MS);
    expect(stores.tombstones.get(PARENT)?.phase).toBe('purged');
    expect(jest.getTimerCount()).toBe(0);
    purge.dispose();
  });

  it('reports purged when the purge finishes', async () => {
    const stores = new SpyStores();
    const purge = new ParentSessionPurgeService(stores, stores, existence(false), logger());
    await purge.beginDelete(PARENT);
    await purge.markMetadataDeleted(PARENT);

    await expect(purge.completeDelete(PARENT)).resolves.toBe('purged');
    purge.dispose();
  });

  it('never purges a session without a delete intent', async () => {
    const stores = new SpyStores();
    const purge = new ParentSessionPurgeService(stores, stores, existence(false), logger());

    await purge.completeDelete(PARENT);

    expect(stores.writes()).toEqual([]);
  });
});

describe('ParentSessionPurgeService (real stores, simulated restarts)', () => {
  const drainers: ParentDeliveryDrainerService[] = [];
  const purges: ParentSessionPurgeService[] = [];

  afterEach(() => {
    for (const drainer of drainers.splice(0)) drainer.dispose();
    for (const purge of purges.splice(0)) purge.dispose();
    jest.useRealTimers();
  });

  interface Host {
    readonly parentStore: ParentEnvelopeStoreService;
    readonly envelopes: AgentMessageEnvelopeStore;
    readonly drainer: ParentDeliveryDrainerService;
    readonly send: jest.Mock<Promise<void>, Parameters<IAgentAdapter['sendMessageToSession']>>;
    readonly purge: ParentSessionPurgeService;
    readonly log: Logger;
    /** Whether the parent session is active; inactive parents are never sent to. */
    readonly parent: { active: boolean };
  }

  /** One host run over `storage`; a second call over the same storage is a restart. */
  async function host(storage: FakeStateStorage, exists: ParentSessionExistence = existence(true)): Promise<Host> {
    const log = logger();
    const parentStore = new ParentEnvelopeStoreService(log, storage);
    await parentStore.ready;
    const envelopes = new AgentMessageEnvelopeStore(storage, undefined, Date.now, log);
    await envelopes.ready;
    const send = jest.fn<Promise<void>, Parameters<IAgentAdapter['sendMessageToSession']>>(
      async () => undefined);
    const parent = { active: false };
    const adapter: Pick<IAgentAdapter, 'isSessionActive' | 'sendMessageToSession'> = {
      isSessionActive: () => parent.active,
      sendMessageToSession: send,
    };
    const drainer = new ParentDeliveryDrainerService(log, parentStore, adapter as IAgentAdapter, null, null);
    drainers.push(drainer);
    const purge = new ParentSessionPurgeService(parentStore, envelopes, exists, log);
    purges.push(purge);
    return { parentStore, envelopes, drainer, send, purge, log, parent };
  }

  interface Seeded { readonly pendingLane: string; readonly settledLane: string }

  /** Undelivered + settled lane envelopes, a queued parent report and a completion outbox entry. */
  async function seed(h: Host): Promise<Seeded> {
    const base = {
      targetAgentId: LANE, laneLineageId: LANE, parentSessionId: PARENT,
      sender: { kind: 'user' as const }, senderKey: 'user',
      mode: 'queue-next-turn' as const, delivery: 'queue' as const,
    };
    const pending = await h.envelopes.put(base, 'undelivered body');
    const settled = await h.envelopes.put(base, 'delivered body');
    await h.envelopes.transition(settled.envelope.id, { state: 'started', turnSeq: 1 });
    await h.envelopes.transition(settled.envelope.id, { state: 'settled', turnSeq: 1, turnOutcome: 'completed' });
    await h.parentStore.enqueue({
      id: `lane-delivery:${REPORT_KEY}`, dedupeKey: REPORT_KEY, agentId: LANE,
      parentSessionId: PARENT, kind: 'report', body: '<agent-report>r</agent-report>',
      createdAt: Date.now(),
    });
    await h.parentStore.putCompletionOutbox({
      dedupeKey: `${LANE}:2026-11-07T00:00:00.000Z`, agentId: LANE, parentSessionId: PARENT,
      completedAt: '2026-11-07T00:00:00.000Z', body: 'completion body', verdict: 'delivered',
      originName: 'codex · lane', createdAt: Date.now(),
    });
    return { pendingLane: pending.envelope.id, settledLane: settled.envelope.id };
  }

  async function expectPurged(h: Host, storage: FakeStateStorage, seeded: Seeded): Promise<void> {
    expect(await h.envelopes.get(seeded.pendingLane))
      .toMatchObject({ state: 'cancelled', reason: 'parent-session-deleted' });
    expect(storage.values.has(`${AGENT_MESSAGE_BODY_PREFIX}${seeded.pendingLane}`)).toBe(false);
    expect(await h.envelopes.get(seeded.settledLane)).toMatchObject({ state: 'settled' });
    expect(h.parentStore.find(REPORT_KEY)?.state).toBe('cancelled');
    expect(storage.values.has(`${PARENT_COMPLETION_OUTBOX_PREFIX}${PARENT}`)).toBe(false);
    expect(h.parentStore.listPendingPurges()).toEqual([]);
    expect(h.send).not.toHaveBeenCalled();
  }

  async function expectIntact(h: Host, seeded: Seeded): Promise<void> {
    // Same host run: still `not-started`; after a restart the store holds it as `awaiting-resume`.
    expect(['not-started', 'blocked-retryable']).toContain((await h.envelopes.get(seeded.pendingLane))?.state);
    expect(await h.envelopes.getBody(seeded.pendingLane)).toBe('undelivered body');
    expect(h.parentStore.find(REPORT_KEY)?.state).not.toBe('cancelled');
    expect(h.parentStore.isParentFrozen(PARENT)).toBe(false);
  }

  it('refuses the delete when the intent cannot be persisted', async () => {
    const storage = new FakeStateStorage();
    const h = await host(storage);
    const seeded = await seed(h);
    storage.failWrites = (key) => key === PARENT_TOMBSTONE_KEY;

    await expect(h.purge.beginDelete(PARENT)).rejects.toThrow();

    await expectIntact(h, seeded);
  });

  it('freezes delivery from the intent write: a drain sends nothing', async () => {
    const storage = new FakeStateStorage();
    const h = await host(storage);
    await seed(h);
    const live = await host(storage);

    await live.purge.beginDelete(PARENT);
    live.parent.active = true;
    await live.drainer.drain(PARENT);

    expect(live.parentStore.isParentFrozen(PARENT)).toBe(true);
    expect(live.send).not.toHaveBeenCalled();
    expect(live.parentStore.find(REPORT_KEY)?.state).toBe('pending');
  });

  it('purges both stores after the metadata delete and keeps settled records', async () => {
    const storage = new FakeStateStorage();
    const h = await host(storage);
    const seeded = await seed(h);

    await h.purge.beginDelete(PARENT);
    await h.purge.markMetadataDeleted(PARENT);
    await h.purge.completeDelete(PARENT);

    await expectPurged(h, storage, seeded);
  });

  it('restores delivery with abortDelete after a metadata delete failure', async () => {
    const storage = new FakeStateStorage();
    const h = await host(storage);
    const seeded = await seed(h);

    await h.purge.beginDelete(PARENT);
    await h.purge.abortDelete(PARENT);

    await expectIntact(h, seeded);
  });

  it('crash after intent, metadata still present → abortDelete at startup, nothing purged', async () => {
    const storage = new FakeStateStorage();
    const before = await host(storage);
    const seeded = await seed(before);
    await before.purge.beginDelete(PARENT);

    const exists = existence(true);
    const after = await host(storage, exists);
    await after.purge.resumePendingPurges();

    expect(exists.exists).toHaveBeenCalledWith(PARENT);
    await expectIntact(after, seeded);
    after.parent.active = true;
    await after.drainer.drain(PARENT);
    expect(after.send).toHaveBeenCalledTimes(1);
  });

  it('crash after the metadata delete, before metadata-deleted → purge completes at startup', async () => {
    const storage = new FakeStateStorage();
    const before = await host(storage);
    const seeded = await seed(before);
    await before.purge.beginDelete(PARENT);

    const after = await host(storage, existence(false));
    await after.purge.resumePendingPurges();

    await expectPurged(after, storage, seeded);
  });

  it('crash after metadata-deleted, before the purge → purge completes without an existence check', async () => {
    const storage = new FakeStateStorage();
    const before = await host(storage);
    const seeded = await seed(before);
    await before.purge.beginDelete(PARENT);
    await before.purge.markMetadataDeleted(PARENT);

    const exists = existence(true);
    const after = await host(storage, exists);
    await after.purge.resumePendingPurges();

    expect(exists.exists).not.toHaveBeenCalled();
    await expectPurged(after, storage, seeded);
  });

  it('an existence-check failure keeps the parent frozen and retries on the timer', async () => {
    const storage = new FakeStateStorage();
    const before = await host(storage);
    const seeded = await seed(before);
    await before.purge.beginDelete(PARENT);

    jest.useFakeTimers({ doNotFake: ['setImmediate', 'queueMicrotask'] });
    const exists = existence(new Error('metadata store unavailable'));
    const after = await host(storage, exists);
    await after.purge.resumePendingPurges();

    expect(after.parentStore.isParentFrozen(PARENT)).toBe(true);
    expect(await after.envelopes.get(seeded.pendingLane))
      .toMatchObject({ state: 'blocked-retryable', reason: 'awaiting-resume' });
    expect(after.log.error).toHaveBeenCalled();

    exists.exists.mockResolvedValue(false);
    await jest.advanceTimersByTimeAsync(PARENT_PURGE_RETRY_MS);

    expect(exists.exists).toHaveBeenCalledTimes(2);
    expect(after.parentStore.listPendingPurges()).toEqual([]);
    expect(await after.envelopes.get(seeded.pendingLane)).toMatchObject({ state: 'cancelled' });
  });
});
