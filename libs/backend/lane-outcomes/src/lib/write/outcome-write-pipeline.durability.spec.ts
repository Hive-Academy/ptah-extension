import { InMemoryLaneOutcomeStore } from '../store/in-memory-lane-outcome.store';
import {
  KeyValueLaneOutcomeStore,
  LANE_OUTCOME_RECORDS_KEY,
} from '../store/key-value-lane-outcome.store';
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
  testLogger,
} from './pipeline.test-support';

describe('OutcomeWritePipeline durability', () => {
  it('keeps three completions journaled until delayed open and drains in order', async () => {
    const storage = new MemoryState();
    const store = new InMemoryLaneOutcomeStore();
    const availability = new Availability();
    const pipeline = new OutcomeWritePipeline(
      store,
      testLogger(),
      storage,
      availability,
    );
    pipeline.enqueue({ kind: 'lane-completion', row: outcomeRow('lane:1') });
    pipeline.enqueue({ kind: 'lane-completion', row: outcomeRow('lane:2') });
    pipeline.enqueue({ kind: 'subagent-stop', row: outcomeRow('subagent:3') });
    await pipeline.flush();
    expect(
      new KeyValueOutcomeJournal<OutcomeWriteOp>(storage)
        .snapshot()
        .entries.map((entry) => entry.op.kind),
    ).toEqual(['lane-completion', 'lane-completion', 'subagent-stop']);
    expect(await store.get('lane:1')).toBeNull();
    availability.reopen();
    await pipeline.flush();
    expect(
      (await store.listByLane('subagent', 0)).map((row) => row.runId).sort(),
    ).toEqual(['lane:1', 'lane:2', 'subagent:3']);
    expect(
      new KeyValueOutcomeJournal<OutcomeWriteOp>(storage).snapshot().entries,
    ).toEqual([]);
    await pipeline.dispose();
  });

  it('restarts before delayed open and replays three journaled rows once', async () => {
    const storage = new MemoryState();
    const store = new InMemoryLaneOutcomeStore();
    const availability = new Availability();
    const first = new OutcomeWritePipeline(
      store,
      testLogger(),
      storage,
      availability,
    );
    for (const id of ['lane:1', 'lane:2', 'lane:3'])
      first.enqueue({ kind: 'lane-completion', row: outcomeRow(id) });
    await first.flush();
    await first.dispose();
    const second = new OutcomeWritePipeline(
      store,
      testLogger(),
      storage,
      availability,
    );
    availability.reopen();
    await second.flush();
    expect(
      (await store.listByLane('subagent', 0)).map((row) => row.runId).sort(),
    ).toEqual(['lane:1', 'lane:2', 'lane:3']);
    expect(
      new KeyValueOutcomeJournal<OutcomeWriteOp>(storage).snapshot().entries,
    ).toEqual([]);
    for (const id of ['lane:1', 'lane:2', 'lane:3'])
      second.enqueue({ kind: 'lane-completion', row: outcomeRow(id) });
    await second.flush();
    expect(await store.listByLane('subagent', 0)).toHaveLength(3);
    await second.dispose();
  });

  it('applies a report queued behind a stop before open', async () => {
    const storage = new MemoryState();
    const availability = new Availability();
    const store = new InMemoryLaneOutcomeStore();
    const pipeline = new OutcomeWritePipeline(
      store,
      testLogger(),
      storage,
      availability,
    );
    pipeline.enqueue({
      kind: 'subagent-stop',
      row: outcomeRow('subagent:queued'),
    });
    await pipeline.flush();
    expect(
      await pipeline.submit(reportOp('subagent:queued', 701)),
    ).toMatchObject({ ok: true, state: 'queued' });
    expect(
      new KeyValueOutcomeJournal<OutcomeWriteOp>(storage)
        .snapshot()
        .entries.map((entry) => entry.op.kind),
    ).toEqual(['subagent-stop', 'deliverables']);
    availability.reopen();
    await pipeline.flush();
    expect((await store.get('subagent:queued'))?.verdict).toBe('delivered');
    expect(await store.hasReceipt('report-701')).toBe(true);
    await pipeline.dispose();
  });

  it('retries a transient middle insert without overtaking it', async () => {
    const storage = new MemoryState();
    const availability = new Availability();
    const logger = testLogger();
    class OnceStore extends InMemoryLaneOutcomeStore {
      private failed = false;
      override async insertStopWithHeldReports(
        ...args: Parameters<
          InMemoryLaneOutcomeStore['insertStopWithHeldReports']
        >
      ): ReturnType<InMemoryLaneOutcomeStore['insertStopWithHeldReports']> {
        if (!this.failed) {
          this.failed = true;
          throw Object.assign(new Error('io'), { code: 'SQLITE_IOERR' });
        }
        return super.insertStopWithHeldReports(...args);
      }
    }
    const store = new OnceStore();
    const pipeline = new OutcomeWritePipeline(
      store,
      logger,
      storage,
      availability,
    );
    pipeline.enqueue({ kind: 'lane-completion', row: outcomeRow('lane:1') });
    pipeline.enqueue({ kind: 'subagent-stop', row: outcomeRow('subagent:1') });
    pipeline.enqueue({ kind: 'lane-completion', row: outcomeRow('lane:2') });
    await pipeline.flush();
    availability.reopen();
    await pipeline.flush();
    expect(await store.get('lane:1')).not.toBeNull();
    expect(await store.get('lane:2')).toBeNull();
    expect(
      new KeyValueOutcomeJournal<OutcomeWriteOp>(storage)
        .snapshot()
        .entries.map((entry) => ('row' in entry.op ? entry.op.row.runId : '')),
    ).toEqual(['subagent:1', 'lane:2']);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await pipeline.flush();
    expect(await store.get('subagent:1')).not.toBeNull();
    expect(await store.get('lane:2')).not.toBeNull();
    expect(
      new KeyValueOutcomeJournal<OutcomeWriteOp>(storage).snapshot().entries,
    ).toEqual([]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledTimes(1);
    await pipeline.dispose();
  });

  it('restarts during a transient streak and drains the ordered suffix', async () => {
    const storage = new MemoryState();
    const availability = new Availability();
    class FailingStore extends InMemoryLaneOutcomeStore {
      failing = true;
      override async insertStopWithHeldReports(
        ...args: Parameters<
          InMemoryLaneOutcomeStore['insertStopWithHeldReports']
        >
      ): ReturnType<InMemoryLaneOutcomeStore['insertStopWithHeldReports']> {
        if (this.failing)
          throw Object.assign(new Error('io'), { code: 'SQLITE_IOERR' });
        return super.insertStopWithHeldReports(...args);
      }
    }
    const firstStore = new FailingStore();
    const first = new OutcomeWritePipeline(
      firstStore,
      testLogger(),
      storage,
      availability,
    );
    first.enqueue({ kind: 'lane-completion', row: outcomeRow('lane:1') });
    first.enqueue({ kind: 'subagent-stop', row: outcomeRow('subagent:1') });
    first.enqueue({ kind: 'lane-completion', row: outcomeRow('lane:2') });
    await first.flush();
    availability.reopen();
    await first.flush();
    expect(
      new KeyValueOutcomeJournal<OutcomeWriteOp>(storage).snapshot().entries,
    ).toHaveLength(2);
    availability.open = false;
    await first.dispose();
    firstStore.failing = false;
    const second = new OutcomeWritePipeline(
      firstStore,
      testLogger(),
      storage,
      availability,
    );
    availability.reopen();
    await second.flush();
    expect(await firstStore.get('lane:1')).not.toBeNull();
    expect(await firstStore.get('subagent:1')).not.toBeNull();
    expect(await firstStore.get('lane:2')).not.toBeNull();
    expect(
      new KeyValueOutcomeJournal<OutcomeWriteOp>(storage).snapshot().entries,
    ).toEqual([]);
    await second.dispose();
  });

  it('keeps a new op behind a transient failure streak and recovers in order', async () => {
    const storage = new MemoryState();
    const availability = new Availability();
    availability.open = true;
    const order: string[] = [];
    class StreakStore extends InMemoryLaneOutcomeStore {
      failures = 2;
      override async insertIfAbsent(
        row: Parameters<InMemoryLaneOutcomeStore['insertIfAbsent']>[0],
      ): Promise<boolean> {
        if (row.runId === 'lane:2' && this.failures-- > 0)
          throw Object.assign(new Error('busy'), { code: 'SQLITE_BUSY' });
        const inserted = await super.insertIfAbsent(row);
        if (inserted) order.push(row.runId);
        return inserted;
      }
    }
    const store = new StreakStore();
    const pipeline = new OutcomeWritePipeline(
      store,
      testLogger(),
      storage,
      availability,
    );
    for (const id of ['lane:1', 'lane:2', 'lane:3'])
      pipeline.enqueue({ kind: 'lane-completion', row: outcomeRow(id) });
    await pipeline.flush();
    expect(order).toEqual(['lane:1']);
    pipeline.enqueue({ kind: 'lane-completion', row: outcomeRow('lane:4') });
    await pipeline.flush();
    expect(
      new KeyValueOutcomeJournal<OutcomeWriteOp>(storage)
        .snapshot()
        .entries.map((entry) => ('row' in entry.op ? entry.op.row.runId : '')),
    ).toEqual(['lane:2', 'lane:3', 'lane:4']);
    await new Promise((resolve) => setTimeout(resolve, 1350));
    await pipeline.flush();
    expect(order).toEqual(['lane:1', 'lane:2', 'lane:3', 'lane:4']);
    expect(
      new KeyValueOutcomeJournal<OutcomeWriteOp>(storage).snapshot().entries,
    ).toEqual([]);
    await pipeline.dispose();
  });

  it('dead letters a permanent Zod row and applies entries behind it', async () => {
    const storage = new MemoryState();
    const availability = new Availability();
    const logger = testLogger();
    const store = new InMemoryLaneOutcomeStore();
    const pipeline = new OutcomeWritePipeline(
      store,
      logger,
      storage,
      availability,
    );
    pipeline.enqueue({
      kind: 'subagent-stop',
      row: { ...outcomeRow('subagent:bad'), endedAt: Number.NaN },
    });
    pipeline.enqueue({ kind: 'lane-completion', row: outcomeRow('lane:good') });
    await pipeline.flush();
    availability.reopen();
    await pipeline.flush();
    expect(await store.get('subagent:bad')).toBeNull();
    expect(await store.get('lane:good')).not.toBeNull();
    expect(
      storage.get<{ entries: readonly { reason: string }[] }>(
        OUTCOME_REJECTED_KEY,
      )?.entries,
    ).toEqual([expect.objectContaining({ reason: 'ZOD_VALIDATION' })]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(
      new KeyValueOutcomeJournal<OutcomeWriteOp>(storage).snapshot().entries,
    ).toEqual([]);
    await pipeline.dispose();
  });

  it('dead letters a review after its pending stop fails validation', async () => {
    const storage = new MemoryState();
    const availability = new Availability();
    const store = new InMemoryLaneOutcomeStore();
    const logger = testLogger();
    const pipeline = new OutcomeWritePipeline(
      store,
      logger,
      storage,
      availability,
    );
    pipeline.enqueue({
      kind: 'subagent-stop',
      row: { ...outcomeRow('subagent:bad'), endedAt: Number.NaN },
    });
    expect(
      await pipeline.submit(reportOp('subagent:bad', 702, 'review')),
    ).toMatchObject({ ok: true, state: 'queued' });
    availability.reopen();
    await pipeline.flush();
    expect(await store.get('subagent:bad')).toBeNull();
    expect(await store.hasReceipt('report-702')).toBe(false);
    expect(await store.listHeldReports(Date.now())).toHaveLength(0);
    expect(
      storage.get<{ entries: readonly { reason: string }[] }>(
        OUTCOME_REJECTED_KEY,
      )?.entries,
    ).toEqual([
      expect.objectContaining({ reason: 'ZOD_VALIDATION' }),
      expect.objectContaining({
        reason: 'target-missing',
        reportId: 'report-702',
      }),
    ]);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    await pipeline.dispose();
  });

  it('handles 1500 pre-open completions in 25-op turns', async () => {
    const storage = new MemoryState();
    const entries = Array.from({ length: 1500 }, (_, i) => ({
      seq: i + 1,
      op: { kind: 'lane-completion' as const, row: outcomeRow(`lane:${i}`) },
    }));
    storage.values.set(OUTCOME_JOURNAL_KEY, {
      nextSeq: 1501,
      entries,
      droppedAtCapacity: 0,
      heldRuns: [],
    });
    const availability = new Availability();
    const store = new InMemoryLaneOutcomeStore();
    const pipeline = new OutcomeWritePipeline(
      store,
      testLogger(),
      storage,
      availability,
    );
    expect(
      new KeyValueOutcomeJournal<OutcomeWriteOp>(storage).snapshot().entries,
    ).toHaveLength(1500);
    expect(await store.listByLane('subagent', 0)).toHaveLength(0);
    availability.reopen();
    await pipeline.flush();
    expect(
      new KeyValueOutcomeJournal<OutcomeWriteOp>(storage).snapshot().entries,
    ).toHaveLength(1475);
    await drainTurns(pipeline, 59);
    expect(
      new KeyValueOutcomeJournal<OutcomeWriteOp>(storage).snapshot().entries,
    ).toHaveLength(0);
    expect(await store.listByLane('subagent', 0)).toHaveLength(1500);
    expect(
      storage.writes.filter((key) => key === OUTCOME_JOURNAL_KEY).length,
    ).toBeLessThanOrEqual(61);
    await pipeline.dispose();
  });

  it('refuses the 5001st journal entry and preserves its capacity count across restart', async () => {
    const storage = new MemoryState();
    const entries = Array.from({ length: 5000 }, (_, i) => ({
      seq: i + 1,
      op: { kind: 'lane-completion' as const, row: outcomeRow(`lane:${i}`) },
    }));
    storage.values.set(OUTCOME_JOURNAL_KEY, {
      nextSeq: 5001,
      entries,
      droppedAtCapacity: 0,
      heldRuns: [],
    });
    const availability = new Availability();
    const logger = testLogger();
    const first = new OutcomeWritePipeline(
      new InMemoryLaneOutcomeStore(),
      logger,
      storage,
      availability,
    );
    first.enqueue({
      kind: 'lane-completion',
      row: outcomeRow('lane:overflow'),
    });
    await first.flush();
    const full = new KeyValueOutcomeJournal<OutcomeWriteOp>(storage).snapshot();
    expect(full.entries).toHaveLength(5000);
    expect(full.droppedAtCapacity).toBe(1);
    expect(
      full.entries.some(
        (entry) => 'row' in entry.op && entry.op.row.runId === 'lane:overflow',
      ),
    ).toBe(false);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    await first.dispose();
    const store = new InMemoryLaneOutcomeStore();
    const second = new OutcomeWritePipeline(
      store,
      testLogger(),
      storage,
      availability,
    );
    expect(
      new KeyValueOutcomeJournal<OutcomeWriteOp>(storage).snapshot()
        .droppedAtCapacity,
    ).toBe(1);
    availability.reopen();
    await drainTurns(second, 200);
    expect(await store.listByLane('subagent', 0)).toHaveLength(2000);
    expect(await store.get('lane:4999')).not.toBeNull();
    expect(
      new KeyValueOutcomeJournal<OutcomeWriteOp>(storage).snapshot().entries,
    ).toHaveLength(0);
    await second.dispose();
  });

  it('retries a failed VS Code KV acknowledgement in FIFO order', async () => {
    const storage = new MemoryState();
    const store = new KeyValueLaneOutcomeStore(storage, testLogger());
    const pipeline = new OutcomeWritePipeline(store, testLogger());
    storage.rejectNext = (key) => key === LANE_OUTCOME_RECORDS_KEY;
    pipeline.enqueue({ kind: 'lane-completion', row: outcomeRow('lane:1') });
    pipeline.enqueue({ kind: 'lane-completion', row: outcomeRow('lane:2') });
    await pipeline.flush();
    expect(await store.get('lane:1')).toBeNull();
    expect(await store.get('lane:2')).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 300));
    await pipeline.flush();
    expect(await store.get('lane:1')).not.toBeNull();
    expect(await store.get('lane:2')).not.toBeNull();
    expect(
      storage.writes.filter((key) => key === LANE_OUTCOME_RECORDS_KEY),
    ).toHaveLength(3);
    await pipeline.dispose();
  });

  it('refuses the 1001st VS Code queue entry with one warning', async () => {
    const logger = testLogger();
    const store = new InMemoryLaneOutcomeStore();
    const pipeline = new OutcomeWritePipeline(store, logger);
    for (let i = 0; i < 1000; i++)
      pipeline.enqueue({
        kind: 'lane-completion',
        row: outcomeRow(`lane:${i}`),
      });
    pipeline.enqueue({
      kind: 'lane-completion',
      row: outcomeRow('lane:overflow'),
    });
    expect(logger.warn).toHaveBeenCalledWith('Outcome queue full', {
      runId: 'lane:overflow',
      reason: 'queue-full',
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    await drainTurns(pipeline, 40);
    expect(await store.get('lane:overflow')).toBeNull();
    expect(await store.get('lane:999')).not.toBeNull();
    await pipeline.dispose();
  });

  it('closes intake and journals the remainder when shutdown reaches its deadline', async () => {
    const storage = new MemoryState();
    const availability = new Availability();
    availability.open = true;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    class StalledStore extends InMemoryLaneOutcomeStore {
      override async insertIfAbsent(
        row: Parameters<InMemoryLaneOutcomeStore['insertIfAbsent']>[0],
      ): Promise<boolean> {
        await gate;
        return super.insertIfAbsent(row);
      }
    }
    const pipeline = new OutcomeWritePipeline(
      new StalledStore(),
      testLogger(),
      storage,
      availability,
    );
    pipeline.enqueue({ kind: 'lane-completion', row: outcomeRow('lane:1') });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const started = Date.now();
    const shutdown = pipeline.dispose();
    expect(await pipeline.submit(reportOp('subagent:closed', 703))).toEqual({
      ok: false,
      error: 'outcome pipeline closed',
    });
    pipeline.enqueue({ kind: 'lane-completion', row: outcomeRow('lane:late') });
    await shutdown;
    expect(Date.now() - started).toBeLessThan(3000);
    expect(
      new KeyValueOutcomeJournal<OutcomeWriteOp>(storage)
        .snapshot()
        .entries.map((entry) => ('row' in entry.op ? entry.op.row.runId : '')),
    ).toEqual(['lane:1']);
    release?.();
  });

  it('keeps every held report and the row absent when a stop join throws mid-join', async () => {
    class MidJoinFailureStore extends InMemoryLaneOutcomeStore {
      private failed = false;
      override async insertStopWithHeldReports(
        ...args: Parameters<
          InMemoryLaneOutcomeStore['insertStopWithHeldReports']
        >
      ): ReturnType<InMemoryLaneOutcomeStore['insertStopWithHeldReports']> {
        const [row, now, resolve] = args;
        let visited = 0;
        return super.insertStopWithHeldReports(row, now, (current, report) => {
          if (++visited === 2 && !this.failed) {
            this.failed = true;
            throw Object.assign(new Error('io'), { code: 'SQLITE_IOERR' });
          }
          return resolve(current, report);
        });
      }
    }
    const store = new MidJoinFailureStore();
    await store.holdReport(reportOp('subagent:atomic', 704).report);
    await store.holdReport(reportOp('subagent:atomic', 705, 'review').report);
    const storage = new MemoryState();
    const availability = new Availability();
    const pipeline = new OutcomeWritePipeline(
      store,
      testLogger(),
      storage,
      availability,
    );
    pipeline.enqueue({
      kind: 'subagent-stop',
      row: outcomeRow('subagent:atomic'),
    });
    await pipeline.flush();
    availability.reopen();
    await pipeline.flush();
    expect(await store.get('subagent:atomic')).toBeNull();
    expect(await store.hasReceipt('report-704')).toBe(false);
    expect(await store.hasReceipt('report-705')).toBe(false);
    expect(await store.listHeldReports(Date.now())).toHaveLength(2);
    expect(
      new KeyValueOutcomeJournal<OutcomeWriteOp>(storage).snapshot().entries,
    ).toHaveLength(1);
    await pipeline.flush();
    expect(await store.get('subagent:atomic')).toMatchObject({
      verdict: 'delivered',
      reviseRounds: 1,
    });
    expect(await store.hasReceipt('report-704')).toBe(true);
    expect(await store.hasReceipt('report-705')).toBe(true);
    expect(await store.listHeldReports(Date.now())).toHaveLength(0);
    expect(
      new KeyValueOutcomeJournal<OutcomeWriteOp>(storage).snapshot().entries,
    ).toHaveLength(0);
    availability.open = false;
    await pipeline.dispose();
  });
  it('replays an acknowledged row without duplication after an ack failure', async () => {
    const storage = new MemoryState();
    const store = new InMemoryLaneOutcomeStore();
    const availability = new Availability();
    const first = new OutcomeWritePipeline(
      store,
      testLogger(),
      storage,
      availability,
    );
    first.enqueue({ kind: 'lane-completion', row: outcomeRow('lane:L1') });
    await first.flush();
    storage.rejectNext = (key) => key === OUTCOME_JOURNAL_KEY;
    availability.reopen();
    await first.flush();
    expect(
      new KeyValueOutcomeJournal<OutcomeWriteOp>(storage).snapshot().entries,
    ).toHaveLength(1);
    availability.open = false;
    await first.dispose();
    const second = new OutcomeWritePipeline(store, testLogger(), storage);
    await second.flush();
    expect((await store.get('lane:L1'))?.runId).toBe('lane:L1');
    expect(
      new KeyValueOutcomeJournal<OutcomeWriteOp>(storage).snapshot().entries,
    ).toHaveLength(0);
    await second.dispose();
  });

  it('applies a revise report once across an ack crash', async () => {
    const storage = new MemoryState();
    const store = new InMemoryLaneOutcomeStore();
    await store.insertIfAbsent(outcomeRow('subagent:r'));
    const availability = new Availability();
    const first = new OutcomeWritePipeline(
      store,
      testLogger(),
      storage,
      availability,
    );
    first.enqueue(reportOp('subagent:r', 10, 'review'));
    await first.flush();
    storage.rejectNext = (key) => key === OUTCOME_JOURNAL_KEY;
    availability.reopen();
    await first.flush();
    expect((await store.get('subagent:r'))?.reviseRounds).toBe(1);
    availability.open = false;
    await first.dispose();
    const second = new OutcomeWritePipeline(store, testLogger(), storage);
    await second.flush();
    expect((await store.get('subagent:r'))?.reviseRounds).toBe(1);
    await second.dispose();
  });

  it('preserves an op appended while another op is applying', async () => {
    const storage = new MemoryState();
    const availability = new Availability();
    availability.open = true;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const applied: string[] = [];
    class PausedStore extends InMemoryLaneOutcomeStore {
      override async insertIfAbsent(
        row: Parameters<InMemoryLaneOutcomeStore['insertIfAbsent']>[0],
      ): Promise<boolean> {
        if (row.runId === 'lane:1') {
          entered?.();
          await gate;
        }
        applied.push(row.runId);
        return super.insertIfAbsent(row);
      }
      override async applyReportWithReceipt(
        ...args: Parameters<InMemoryLaneOutcomeStore['applyReportWithReceipt']>
      ): ReturnType<InMemoryLaneOutcomeStore['applyReportWithReceipt']> {
        applied.push(args[0].reportId);
        return super.applyReportWithReceipt(...args);
      }
    }
    const store = new PausedStore();
    const pipeline = new OutcomeWritePipeline(
      store,
      testLogger(),
      storage,
      availability,
    );
    pipeline.enqueue({ kind: 'lane-completion', row: outcomeRow('lane:1') });
    await started;
    pipeline.enqueue({ kind: 'lane-completion', row: outcomeRow('lane:2') });
    const submitted = pipeline.submit(reportOp('lane:1', 21, 'review'));
    await new Promise<void>((resolve) => setImmediate(resolve));
    release?.();
    expect(await submitted).toMatchObject({ ok: true });
    await pipeline.flush();
    await pipeline.flush();
    expect(await store.get('lane:2')).not.toBeNull();
    expect((await store.get('lane:1'))?.reviseRounds).toBe(1);
    expect(applied).toEqual(['lane:1', 'lane:2', 'report-21']);
    await pipeline.dispose();
  });

  it('does not duplicate a dead letter on replay', async () => {
    const storage = new MemoryState();
    const availability = new Availability();
    const store = new InMemoryLaneOutcomeStore();
    const first = new OutcomeWritePipeline(
      store,
      testLogger(),
      storage,
      availability,
    );
    first.enqueue(reportOp('lane:absent', 20, 'review'));
    await first.flush();
    storage.rejectNext = (key) => key === OUTCOME_JOURNAL_KEY;
    availability.reopen();
    await first.flush();
    availability.open = false;
    await first.dispose();
    const second = new OutcomeWritePipeline(store, testLogger(), storage);
    await second.flush();
    const rejected = storage.get<{
      entries: readonly unknown[];
      overflow: number;
    }>(OUTCOME_REJECTED_KEY);
    expect(rejected?.entries).toHaveLength(1);
    expect(rejected?.overflow).toBe(0);
    await second.dispose();
  });

  it('keeps budget stops separate from failure classification', async () => {
    const store = new InMemoryLaneOutcomeStore();
    const warnings = testLogger();
    const pipeline = new OutcomeWritePipeline(store, warnings);
    pipeline.enqueue({ kind: 'subagent-stop', row: outcomeRow('subagent:b') });
    await pipeline.flush();
    pipeline.enqueue({ kind: 'budget-stop', runId: 'subagent:b' });
    await pipeline.flush();
    expect(await store.get('subagent:b')).toMatchObject({
      budgetStopped: true,
      failureClass: null,
    });
    pipeline.enqueue({ kind: 'budget-stop', runId: 'subagent:b' });
    await pipeline.flush();
    expect(await store.get('subagent:b')).toMatchObject({
      budgetStopped: true,
      failureClass: null,
    });
    await pipeline.dispose();
    await store.markBudgetStopped('subagent:orphan', Date.now() - 86_400_001);
    const replay = new OutcomeWritePipeline(store, warnings);
    await replay.flush();
    expect(warnings.warn).toHaveBeenCalledWith(
      'Outcome hold expired',
      expect.objectContaining({
        runId: 'subagent:orphan',
        reason: 'budget-stop-expired',
      }),
    );
    expect(warnings.warn).toHaveBeenCalledTimes(1);
    await replay.dispose();
  });

  it('rejects invalid payloads before journal append', async () => {
    const storage = new MemoryState();
    const pipeline = new OutcomeWritePipeline(
      new InMemoryLaneOutcomeStore(),
      testLogger(),
      storage,
    );
    const op = reportOp('subagent:bad', 30);
    const before = new KeyValueOutcomeJournal<OutcomeWriteOp>(
      storage,
    ).snapshot();
    expect(
      await pipeline.submit({ ...op, report: { ...op.report, payload: '{' } }),
    ).toEqual({ ok: false, error: 'invalid report payload' });
    expect(
      new KeyValueOutcomeJournal<OutcomeWriteOp>(storage).snapshot(),
    ).toEqual(before);
    await pipeline.dispose();
  });
});
