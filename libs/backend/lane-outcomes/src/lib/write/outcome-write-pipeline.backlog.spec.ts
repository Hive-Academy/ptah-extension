import { InMemoryLaneOutcomeStore } from '../store/in-memory-lane-outcome.store';
import { outcomeRow } from '../store/store.test-support';
import {
  KeyValueOutcomeJournal,
  OUTCOME_JOURNAL_KEY,
  OUTCOME_REJECTED_KEY,
} from './key-value-outcome-journal';
import {
  OutcomeWritePipeline,
  type OutcomeWriteOp,
} from './outcome-write-pipeline';
import {
  Availability,
  MemoryState,
  drainTurns,
  reportOp,
  sqliteFixture,
  testLogger,
} from './pipeline.test-support';

describe('OutcomeWritePipeline backlog decisions', () => {
  it('rejects an unknown lane review while an open store has SQLITE_BUSY writes', async () => {
    const storage = new MemoryState();
    const availability = new Availability();
    availability.open = true;
    class BusyStore extends InMemoryLaneOutcomeStore {
      override async insertIfAbsent(): Promise<boolean> {
        throw Object.assign(new Error('busy'), { code: 'SQLITE_BUSY' });
      }
    }
    const store = new BusyStore();
    const pipeline = new OutcomeWritePipeline(
      store,
      testLogger(),
      storage,
      availability,
    );
    pipeline.enqueue({ kind: 'lane-completion', row: outcomeRow('lane:L1') });
    await pipeline.flush();
    const before = new KeyValueOutcomeJournal<OutcomeWriteOp>(
      storage,
    ).snapshot();
    const writes = storage.writes.length;
    expect(await pipeline.submit(reportOp('L9', 101, 'review'))).toEqual({
      ok: false,
      error: 'run L9 not found',
    });
    expect(
      new KeyValueOutcomeJournal<OutcomeWriteOp>(storage).snapshot(),
    ).toEqual(before);
    expect(storage.writes).toHaveLength(writes);
    expect(await store.get('L9')).toBeNull();
    expect(await store.hasReceipt('report-101')).toBe(false);
    expect(await store.listHeldReports(Date.now())).toHaveLength(0);
    await pipeline.dispose();
  });

  it('retains an acknowledged hold across a closed-store process restart and joins its review', async () => {
    const storage = new MemoryState();
    const availability = new Availability();
    availability.open = true;
    const store = new InMemoryLaneOutcomeStore();
    const first = new OutcomeWritePipeline(
      store,
      testLogger(),
      storage,
      availability,
    );
    expect(await first.submit(reportOp('subagent:z', 102))).toMatchObject({
      ok: true,
      state: 'held',
    });
    expect(
      new KeyValueOutcomeJournal<OutcomeWriteOp>(storage).snapshot().heldRuns,
    ).toHaveLength(1);
    availability.open = false;
    await first.dispose();
    const second = new OutcomeWritePipeline(
      store,
      testLogger(),
      storage,
      availability,
    );
    expect(
      await second.submit(reportOp('subagent:z', 103, 'review')),
    ).toMatchObject({ ok: true, state: 'held' });
    availability.reopen();
    await second.flush();
    second.enqueue({ kind: 'subagent-stop', row: outcomeRow('subagent:z') });
    await drainTurns(second, 2);
    expect((await store.get('subagent:z'))?.reviseRounds).toBe(1);
    expect(await store.hasReceipt('report-102')).toBe(true);
    expect(await store.hasReceipt('report-103')).toBe(true);
    expect(await store.listHeldReports(Date.now())).toHaveLength(0);
    expect(
      new KeyValueOutcomeJournal<OutcomeWriteOp>(storage).snapshot().heldRuns,
    ).toHaveLength(0);
    await second.dispose();
  });

  it('rejects a never-held review during an outage without touching the journal', async () => {
    const storage = new MemoryState();
    const availability = new Availability();
    const pipeline = new OutcomeWritePipeline(
      new InMemoryLaneOutcomeStore(),
      testLogger(),
      storage,
      availability,
    );
    const before = new KeyValueOutcomeJournal<OutcomeWriteOp>(
      storage,
    ).snapshot();
    const writes = storage.writes.length;
    expect(
      await pipeline.submit(reportOp('subagent:w', 104, 'review')),
    ).toEqual({ ok: false, error: expect.stringContaining('subagent:w') });
    expect(
      new KeyValueOutcomeJournal<OutcomeWriteOp>(storage).snapshot(),
    ).toEqual(before);
    expect(storage.writes).toHaveLength(writes);
    await pipeline.dispose();
  });

  it('lets a readable store reject a stale held-run index and rebuilds it', async () => {
    const storage = new MemoryState();
    const expiresAt = Date.now() + 60_000;
    storage.values.set(OUTCOME_JOURNAL_KEY, {
      nextSeq: 1,
      entries: [],
      droppedAtCapacity: 0,
      heldRuns: [{ runId: 'subagent:v', expiresAt, holdExpiries: [expiresAt] }],
    });
    const availability = new Availability();
    availability.open = true;
    const pipeline = new OutcomeWritePipeline(
      new InMemoryLaneOutcomeStore(),
      testLogger(),
      storage,
      availability,
    );
    expect(
      await pipeline.submit(reportOp('subagent:v', 105, 'review')),
    ).toEqual({ ok: false, error: 'run subagent:v not found' });
    await pipeline.flush();
    expect(
      new KeyValueOutcomeJournal<OutcomeWriteOp>(storage).snapshot().heldRuns,
    ).toEqual([]);
    await pipeline.dispose();
  });

  it('rejects a review after its indexed hold expires while closed', async () => {
    const storage = new MemoryState();
    const availability = new Availability();
    const now = Date.now();
    storage.values.set(OUTCOME_JOURNAL_KEY, {
      nextSeq: 1,
      entries: [],
      droppedAtCapacity: 0,
      heldRuns: [
        {
          runId: 'subagent:expired',
          expiresAt: now - 1,
          holdExpiries: [now - 1],
        },
      ],
    });
    const pipeline = new OutcomeWritePipeline(
      new InMemoryLaneOutcomeStore(),
      testLogger(),
      storage,
      availability,
    );
    const before = new KeyValueOutcomeJournal<OutcomeWriteOp>(
      storage,
    ).snapshot();
    expect(
      await pipeline.submit(reportOp('subagent:expired', 106, 'review')),
    ).toEqual({
      ok: false,
      error: expect.stringContaining('subagent:expired'),
    });
    expect(
      new KeyValueOutcomeJournal<OutcomeWriteOp>(storage).snapshot(),
    ).toEqual(before);
    await pipeline.dispose();
  });
  it.each(['lane:L9', 'subagent:x'])(
    'rejects unknown review %s with unchanged journal',
    async (id) => {
      const storage = new MemoryState();
      const availability = new Availability();
      const store = new InMemoryLaneOutcomeStore();
      const pipeline = new OutcomeWritePipeline(
        store,
        testLogger(),
        storage,
        availability,
      );
      pipeline.enqueue({ kind: 'lane-completion', row: outcomeRow('lane:L1') });
      await pipeline.flush();
      const before = new KeyValueOutcomeJournal<OutcomeWriteOp>(
        storage,
      ).snapshot();
      const writes = storage.writes.length;
      expect(await pipeline.submit(reportOp(id, 1, 'review'))).toEqual({
        ok: false,
        error: expect.stringContaining(id),
      });
      expect(
        new KeyValueOutcomeJournal<OutcomeWriteOp>(storage).snapshot(),
      ).toEqual(before);
      expect(storage.writes).toHaveLength(writes);
      availability.reopen();
      await pipeline.flush();
      expect(await store.get('lane:L1')).not.toBeNull();
      expect(await store.hasReceipt('report-1')).toBe(false);
      expect(await store.listHeldReports(Date.now())).toHaveLength(0);
      await pipeline.dispose();
    },
  );

  it('holds an unknown subagent deliverables report and joins after stop', async () => {
    const storage = new MemoryState();
    const availability = new Availability();
    const store = new InMemoryLaneOutcomeStore();
    const pipeline = new OutcomeWritePipeline(
      store,
      testLogger(),
      storage,
      availability,
    );
    pipeline.enqueue({ kind: 'lane-completion', row: outcomeRow('lane:L1') });
    await pipeline.flush();
    const before = new KeyValueOutcomeJournal<OutcomeWriteOp>(
      storage,
    ).snapshot();
    expect(await pipeline.submit(reportOp('subagent:y', 2))).toMatchObject({
      ok: true,
      state: 'held',
    });
    expect(
      new KeyValueOutcomeJournal<OutcomeWriteOp>(storage).snapshot().entries,
    ).toHaveLength(before.entries.length + 1);
    availability.reopen();
    await pipeline.flush();
    expect(await store.get('subagent:y')).toBeNull();
    expect(await store.listHeldReports(Date.now())).toEqual([
      expect.objectContaining({ reportId: 'report-2' }),
    ]);
    pipeline.enqueue({ kind: 'subagent-stop', row: outcomeRow('subagent:y') });
    await pipeline.flush();
    expect((await store.get('subagent:y'))?.verdict).toBe('delivered');
    expect(await store.hasReceipt('report-2')).toBe(true);
    await pipeline.dispose();
  });

  it('queues a review behind its pending insert', async () => {
    const storage = new MemoryState();
    const availability = new Availability();
    const store = new InMemoryLaneOutcomeStore();
    const pipeline = new OutcomeWritePipeline(
      store,
      testLogger(),
      storage,
      availability,
    );
    pipeline.enqueue({ kind: 'lane-completion', row: outcomeRow('lane:L1') });
    expect(
      await pipeline.submit(reportOp('lane:L1', 3, 'review')),
    ).toMatchObject({ ok: true, state: 'queued' });
    availability.reopen();
    await pipeline.flush();
    expect((await store.get('lane:L1'))?.reviseRounds).toBe(1);
    await pipeline.dispose();
  });

  it('recognizes a held deliverables report across an outage', async () => {
    const storage = new MemoryState();
    const availability = new Availability();
    availability.open = true;
    class ReceiptStore extends InMemoryLaneOutcomeStore {
      receiptIds(): readonly string[] {
        return [...this.receipts.keys()];
      }
    }
    const store = new ReceiptStore();
    const pipeline = new OutcomeWritePipeline(
      store,
      testLogger(),
      storage,
      availability,
    );
    expect(await pipeline.submit(reportOp('subagent:z', 4))).toMatchObject({
      ok: true,
      state: 'held',
    });
    expect(await store.listHeldReports(Date.now())).toHaveLength(1);
    expect(
      new KeyValueOutcomeJournal<OutcomeWriteOp>(storage)
        .snapshot()
        .heldRuns.map((run) => run.runId),
    ).toContain('subagent:z');
    availability.open = false;
    const before = new KeyValueOutcomeJournal<OutcomeWriteOp>(
      storage,
    ).snapshot();
    expect(
      await pipeline.submit(reportOp('subagent:z', 5, 'review')),
    ).toMatchObject({ ok: true, state: 'held' });
    expect(
      new KeyValueOutcomeJournal<OutcomeWriteOp>(storage).snapshot().entries,
    ).toHaveLength(before.entries.length + 1);
    availability.reopen();
    pipeline.enqueue({ kind: 'subagent-stop', row: outcomeRow('subagent:z') });
    await pipeline.flush();
    expect((await store.get('subagent:z'))?.reviseRounds).toBe(1);
    expect((await store.get('subagent:z'))?.verdict).toBe('delivered');
    expect(await store.hasReceipt('report-4')).toBe(true);
    expect(await store.hasReceipt('report-5')).toBe(true);
    expect([...store.receiptIds()].sort()).toEqual(['report-4', 'report-5']);
    expect(await store.listHeldReports(Date.now())).toHaveLength(0);
    expect(
      new KeyValueOutcomeJournal<OutcomeWriteOp>(storage)
        .snapshot()
        .heldRuns.map((run) => run.runId),
    ).not.toContain('subagent:z');
    await pipeline.dispose();
  });

  it('counts 500 held reports globally and refuses the next one', async () => {
    const store = new InMemoryLaneOutcomeStore();
    const storage = new MemoryState();
    const now = Date.now();
    for (let i = 0; i < 500; i++)
      await store.holdReport(reportOp('subagent:m', i).report);
    const availability = new Availability();
    availability.open = true;
    const pipeline = new OutcomeWritePipeline(
      store,
      testLogger(),
      storage,
      availability,
    );
    await pipeline.flush();
    availability.open = false;
    const before = new KeyValueOutcomeJournal<OutcomeWriteOp>(
      storage,
    ).snapshot();
    expect(await pipeline.submit(reportOp('subagent:m', 501))).toEqual({
      ok: false,
      error: 'too many held reports',
    });
    expect(
      new KeyValueOutcomeJournal<OutcomeWriteOp>(storage).snapshot(),
    ).toEqual(before);
    expect(await store.countHeldReports(now)).toBe(500);
    await pipeline.dispose();
  });

  it('refuses a review when 500 deliverables are held', async () => {
    const store = new InMemoryLaneOutcomeStore();
    for (let i = 0; i < 500; i++)
      await store.holdReport(reportOp('subagent:m', i).report);
    const storage = new MemoryState();
    const availability = new Availability();
    availability.open = true;
    const pipeline = new OutcomeWritePipeline(
      store,
      testLogger(),
      storage,
      availability,
    );
    await pipeline.flush();
    availability.open = false;
    const before = new KeyValueOutcomeJournal<OutcomeWriteOp>(
      storage,
    ).snapshot();
    const writes = storage.writes.length;
    expect(
      await pipeline.submit(reportOp('subagent:m', 502, 'review')),
    ).toEqual({ ok: false, error: 'too many held reports' });
    expect(
      new KeyValueOutcomeJournal<OutcomeWriteOp>(storage).snapshot(),
    ).toEqual(before);
    expect(storage.writes).toHaveLength(writes);
    expect(await store.hasReceipt('report-502')).toBe(false);
    await pipeline.dispose();
  });

  it('counts a held review as the 500th report', async () => {
    const store = new InMemoryLaneOutcomeStore();
    for (let i = 0; i < 499; i++)
      await store.holdReport(reportOp('subagent:m', i).report);
    await store.holdReport(reportOp('subagent:m', 499, 'review').report);
    const storage = new MemoryState();
    const availability = new Availability();
    availability.open = true;
    const pipeline = new OutcomeWritePipeline(
      store,
      testLogger(),
      storage,
      availability,
    );
    await pipeline.flush();
    availability.open = false;
    const before = new KeyValueOutcomeJournal<OutcomeWriteOp>(
      storage,
    ).snapshot();
    expect(before.heldRuns[0].holdExpiries).toHaveLength(500);
    expect(await pipeline.submit(reportOp('subagent:m', 503))).toEqual({
      ok: false,
      error: 'too many held reports',
    });
    expect(
      new KeyValueOutcomeJournal<OutcomeWriteOp>(storage).snapshot(),
    ).toEqual(before);
    expect(await store.countHeldReports(Date.now())).toBe(500);
    await pipeline.dispose();
  });

  it('preserves the 500 report cap across a closed-store restart', async () => {
    const store = new InMemoryLaneOutcomeStore();
    for (let i = 0; i < 500; i++)
      await store.holdReport(reportOp('subagent:m', i).report);
    const storage = new MemoryState();
    const availability = new Availability();
    availability.open = true;
    const first = new OutcomeWritePipeline(
      store,
      testLogger(),
      storage,
      availability,
    );
    await first.flush();
    availability.open = false;
    await first.dispose();
    const second = new OutcomeWritePipeline(
      store,
      testLogger(),
      storage,
      availability,
    );
    const before = new KeyValueOutcomeJournal<OutcomeWriteOp>(
      storage,
    ).snapshot();
    expect(await second.submit(reportOp('subagent:m', 504))).toEqual({
      ok: false,
      error: 'too many held reports',
    });
    expect(
      new KeyValueOutcomeJournal<OutcomeWriteOp>(storage).snapshot(),
    ).toEqual(before);
    await second.dispose();
  });

  it('accepts a new hold when one of 500 indexed reports expires', async () => {
    const storage = new MemoryState();
    const now = Date.now();
    const expiries = [
      now - 1,
      ...Array.from({ length: 499 }, () => now + 60_000),
    ];
    storage.values.set(OUTCOME_JOURNAL_KEY, {
      nextSeq: 1,
      entries: [],
      droppedAtCapacity: 0,
      heldRuns: [
        {
          runId: 'subagent:m',
          expiresAt: now + 60_000,
          holdExpiries: expiries,
        },
      ],
    });
    const pipeline = new OutcomeWritePipeline(
      new InMemoryLaneOutcomeStore(),
      testLogger(),
      storage,
      new Availability(),
    );
    const before = new KeyValueOutcomeJournal<OutcomeWriteOp>(
      storage,
    ).snapshot();
    expect(before.heldRuns[0].holdExpiries).toHaveLength(499);
    expect(await pipeline.submit(reportOp('subagent:m', 505))).toMatchObject({
      ok: true,
      state: 'held',
    });
    const after = new KeyValueOutcomeJournal<OutcomeWriteOp>(
      storage,
    ).snapshot();
    expect(after.entries).toHaveLength(1);
    expect(after.nextSeq).toBe(before.nextSeq + 1);
    await pipeline.dispose();
  });

  it('accepts the next report after only the first of 500 timed holds expires', async () => {
    const wall = Date.now();
    jest.useFakeTimers();
    try {
      const store = new InMemoryLaneOutcomeStore();
      jest.setSystemTime(wall - 86_460_000);
      await store.holdReport(reportOp('subagent:timed', 0).report);
      jest.setSystemTime(wall - 86_400_000);
      for (let i = 1; i < 500; i++)
        await store.holdReport(reportOp('subagent:timed', i).report);
      jest.setSystemTime(wall - 30_000);
      const storage = new MemoryState();
      const availability = new Availability();
      availability.open = true;
      const pipeline = new OutcomeWritePipeline(
        store,
        testLogger(),
        storage,
        availability,
      );
      await pipeline.flush();
      expect(await store.countHeldReports(Date.now())).toBe(499);
      availability.open = false;
      const before = new KeyValueOutcomeJournal<OutcomeWriteOp>(
        storage,
      ).snapshot();
      expect(
        await pipeline.submit(reportOp('subagent:timed', 506)),
      ).toMatchObject({ ok: true, state: 'held' });
      const after = new KeyValueOutcomeJournal<OutcomeWriteOp>(
        storage,
      ).snapshot();
      expect(after.entries).toHaveLength(1);
      expect(after.nextSeq).toBe(before.nextSeq + 1);
      await pipeline.dispose();
    } finally {
      jest.useRealTimers();
    }
  });

  it('rebuilds a 499-report index after one stored hold is deleted', async () => {
    class DeletableStore extends InMemoryLaneOutcomeStore {
      deleteHold(id: string): void {
        this.held.delete(id);
      }
    }
    const store = new DeletableStore();
    for (let i = 0; i < 500; i++)
      await store.holdReport(reportOp('subagent:m', i).report);
    const storage = new MemoryState();
    const availability = new Availability();
    availability.open = true;
    const pipeline = new OutcomeWritePipeline(
      store,
      testLogger(),
      storage,
      availability,
    );
    await pipeline.flush();
    availability.open = false;
    store.deleteHold('report-0');
    availability.reopen();
    await pipeline.flush();
    expect(
      new KeyValueOutcomeJournal<OutcomeWriteOp>(storage).snapshot().heldRuns[0]
        .holdExpiries,
    ).toHaveLength(499);
    expect(await store.countHeldReports(Date.now())).toBe(499);
    await pipeline.dispose();
  });

  it('rebuilds the held-run index from SQLite after a held row is deleted', async () => {
    const { db, store } = sqliteFixture(':memory:');
    try {
      for (let i = 0; i < 500; i++)
        await store.holdReport(reportOp('subagent:sqlite', i).report);
      const storage = new MemoryState();
      const availability = new Availability();
      availability.open = true;
      const pipeline = new OutcomeWritePipeline(
        store,
        testLogger(),
        storage,
        availability,
      );
      await pipeline.flush();
      expect(
        new KeyValueOutcomeJournal<OutcomeWriteOp>(storage).snapshot()
          .heldRuns[0].holdExpiries,
      ).toHaveLength(500);
      availability.open = false;
      db.exec(
        "DELETE FROM lane_outcome_held_reports WHERE report_id = 'report-0'",
      );
      availability.reopen();
      await pipeline.flush();
      expect(
        new KeyValueOutcomeJournal<OutcomeWriteOp>(storage).snapshot()
          .heldRuns[0].holdExpiries,
      ).toHaveLength(499);
      expect(await store.countHeldReports(Date.now())).toBe(499);
      await pipeline.dispose();
    } finally {
      db.close();
    }
  });

  it('dead letters a missing report target once', async () => {
    const storage = new MemoryState();
    const store = new InMemoryLaneOutcomeStore();
    const pipeline = new OutcomeWritePipeline(store, testLogger(), storage);
    pipeline.enqueue(reportOp('lane:missing', 70, 'review'));
    await pipeline.flush();
    expect(
      storage.get<{ entries: readonly { reason: string }[] }>(
        OUTCOME_REJECTED_KEY,
      )?.entries,
    ).toEqual([expect.objectContaining({ reason: 'target-missing' })]);
    await pipeline.dispose();
  });
});
