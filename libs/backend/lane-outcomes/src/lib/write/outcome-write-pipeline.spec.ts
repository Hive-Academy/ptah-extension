import type { IStateStorage } from '@ptah-extension/platform-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryLaneOutcomeStore } from '../store/in-memory-lane-outcome.store';
import { KeyValueLaneOutcomeStore } from '../store/key-value-lane-outcome.store';
import { heldReport, outcomeRow } from '../store/store.test-support';
import type { HeldOutcomeReport } from '../store/lane-outcome.store';
import type { LaneOutcomeLogger } from '../lane-outcome-logger';
import { KeyValueOutcomeJournal } from './key-value-outcome-journal';
import {
  OutcomeWritePipeline,
  type OutcomeWriteOp,
} from './outcome-write-pipeline';
import { Availability, reportOp, sqliteFixture } from './pipeline.test-support';

class MemoryState implements IStateStorage {
  readonly values = new Map<string, unknown>();
  get<T>(key: string, fallback?: T): T | undefined {
    return (this.values.get(key) as T | undefined) ?? fallback;
  }
  async update(key: string, value: unknown): Promise<void> {
    this.values.set(key, structuredClone(value));
  }
  keys(): readonly string[] {
    return [...this.values.keys()];
  }
}

const logger: LaneOutcomeLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

class SeededStore extends InMemoryLaneOutcomeStore {
  seed(report: HeldOutcomeReport): void {
    this.held.set(report.reportId, report);
  }
  heldRows(): readonly HeldOutcomeReport[] {
    return [...this.held.values()];
  }
}

function report(
  runId: string,
  i: number,
  kind: 'deliverables' | 'review' = 'deliverables',
): Extract<OutcomeWriteOp, { kind: 'deliverables' | 'review' }> {
  const held = {
    ...heldReport(i, Date.now()),
    runId,
    kind,
    expiresAt: Date.now() + 86400000,
    payload:
      kind === 'review'
        ? JSON.stringify({ verdict: 'revise' })
        : heldReport(i, Date.now()).payload,
  };
  return { kind, report: held };
}

const pipelines: OutcomeWritePipeline[] = [];

function trackedPipeline(
  ...args: ConstructorParameters<typeof OutcomeWritePipeline>
): OutcomeWritePipeline {
  const pipeline = new OutcomeWritePipeline(...args);
  pipelines.push(pipeline);
  return pipeline;
}

describe('OutcomeWritePipeline', () => {
  afterEach(async () => {
    await Promise.all(
      pipelines.splice(0).map((pipeline) => pipeline.dispose()),
    );
  });
  it('calls insert callback once for a new lane row and skips duplicates', async () => {
    const store = new InMemoryLaneOutcomeStore();
    const inserted = jest.fn();
    const pipeline = trackedPipeline(
      store,
      logger,
      undefined,
      undefined,
      inserted,
    );
    const row = outcomeRow('lane:once');
    pipeline.enqueue({ kind: 'lane-completion', row });
    pipeline.enqueue({ kind: 'lane-completion', row });
    await pipeline.flush();
    expect(inserted).toHaveBeenCalledTimes(1);
    expect(inserted).toHaveBeenCalledWith(row);
    await pipeline.dispose();
  });

  it('logs a throwing insert callback and keeps draining', async () => {
    const store = new InMemoryLaneOutcomeStore();
    const warn = jest.fn();
    const pipeline = trackedPipeline(
      store,
      { ...logger, warn },
      undefined,
      undefined,
      () => {
        throw new Error('callback failure');
      },
    );
    pipeline.enqueue({
      kind: 'lane-completion',
      row: outcomeRow('lane:first'),
    });
    pipeline.enqueue({
      kind: 'lane-completion',
      row: outcomeRow('lane:second'),
    });
    await pipeline.flush();
    expect(await store.get('lane:first')).not.toBeNull();
    expect(await store.get('lane:second')).not.toBeNull();
    expect(warn).toHaveBeenCalledWith(
      'Outcome insert callback failed',
      expect.objectContaining({ runId: 'lane:first' }),
    );
    await pipeline.dispose();
  });

  it('joins reports submitted by runId and agentId before either stop', async () => {
    const store = new InMemoryLaneOutcomeStore();
    const pipeline = trackedPipeline(store, logger);
    expect(await pipeline.submit(reportOp('subagent:A', 601))).toMatchObject({
      ok: true,
      state: 'held',
    });
    expect(await pipeline.submit(reportOp('subagent:B', 602))).toMatchObject({
      ok: true,
      state: 'held',
    });
    expect(
      await pipeline.submit(reportOp('subagent:A', 603, 'review')),
    ).toMatchObject({ ok: true, state: 'held' });
    pipeline.enqueue({
      kind: 'subagent-stop',
      row: { ...outcomeRow('subagent:B'), agentId: 'agent-B' },
    });
    pipeline.enqueue({
      kind: 'subagent-stop',
      row: { ...outcomeRow('subagent:A'), agentId: 'agent-A' },
    });
    await pipeline.flush();
    expect((await store.get('subagent:A'))?.reviseRounds).toBe(1);
    expect((await store.get('subagent:B'))?.verdict).toBe('delivered');
    expect(await store.hasReceipt('report-601')).toBe(true);
    expect(await store.hasReceipt('report-602')).toBe(true);
    expect(await store.hasReceipt('report-603')).toBe(true);
    expect(await store.listHeldReports(Date.now())).toHaveLength(0);
    await pipeline.dispose();
  });

  it('keeps concurrent same-slug held and applied reports on their own runs', async () => {
    const store = new InMemoryLaneOutcomeStore();
    const pipeline = trackedPipeline(store, logger);
    await store.insertStopWithHeldReports(
      { ...outcomeRow('subagent:A'), role: 'shared' },
      Date.now(),
      () => null,
    );
    expect(await pipeline.submit(reportOp('subagent:A', 604))).toMatchObject({
      ok: true,
      state: 'applied',
    });
    expect(await pipeline.submit(reportOp('subagent:B', 605))).toMatchObject({
      ok: true,
      state: 'held',
    });
    pipeline.enqueue({
      kind: 'subagent-stop',
      row: { ...outcomeRow('subagent:B'), role: 'shared' },
    });
    await pipeline.flush();
    expect((await store.get('subagent:A'))?.verdict).toBe('delivered');
    expect((await store.get('subagent:B'))?.verdict).toBe('delivered');
    expect(await store.hasReceipt('report-604')).toBe(true);
    expect(await store.hasReceipt('report-605')).toBe(true);
    expect(await store.listHeldReports(Date.now())).toHaveLength(0);
    await pipeline.dispose();
  });

  it('joins a held report after a KV store and pipeline reopen', async () => {
    const storage = new MemoryState();
    const availability = new Availability();
    const first = trackedPipeline(
      new KeyValueLaneOutcomeStore(storage),
      logger,
      storage,
      availability,
    );
    availability.reopen();
    expect(await first.submit(reportOp('subagent:kv', 606))).toMatchObject({
      ok: true,
      state: 'held',
    });
    availability.open = false;
    await first.dispose();
    const reopened = new KeyValueLaneOutcomeStore(storage);
    const second = trackedPipeline(reopened, logger, storage, availability);
    availability.reopen();
    second.enqueue({ kind: 'subagent-stop', row: outcomeRow('subagent:kv') });
    await second.flush();
    expect((await reopened.get('subagent:kv'))?.verdict).toBe('delivered');
    expect(await reopened.hasReceipt('report-606')).toBe(true);
    expect(await reopened.listHeldReports(Date.now())).toHaveLength(0);
    await second.dispose();
  });

  it('joins a held report after the SQLite file is reopened', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ptah-pipeline-'));
    const file = join(dir, 'outcomes.sqlite');
    try {
      const first = sqliteFixture(file);
      const initial = trackedPipeline(first.store, logger);
      expect(
        await initial.submit(reportOp('subagent:sqlite', 607)),
      ).toMatchObject({ ok: true, state: 'held' });
      expect(await first.store.listHeldReports(Date.now())).toHaveLength(1);
      await initial.dispose();
      first.db.close();
      const reopened = sqliteFixture(file);
      try {
        const pipeline = trackedPipeline(reopened.store, logger);
        pipeline.enqueue({
          kind: 'subagent-stop',
          row: outcomeRow('subagent:sqlite'),
        });
        await pipeline.flush();
        expect((await reopened.store.get('subagent:sqlite'))?.verdict).toBe(
          'delivered',
        );
        expect(await reopened.store.hasReceipt('report-607')).toBe(true);
        expect(await reopened.store.listHeldReports(Date.now())).toHaveLength(
          0,
        );
        await pipeline.dispose();
      } finally {
        reopened.db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('expires each old held report with one warning per report', async () => {
    jest.useFakeTimers();
    const now = Date.now();
    jest.setSystemTime(now);
    try {
      const store = new SeededStore();
      store.seed({
        ...reportOp('subagent:old', 608).report,
        expiresAt: now - 1,
      });
      store.seed({
        ...reportOp('subagent:old', 609).report,
        expiresAt: now - 1,
      });
      const warnings = { ...logger, warn: jest.fn() };
      const pipeline = trackedPipeline(store, warnings);
      await pipeline.flush();
      expect(await store.listHeldReports(now - 2)).toHaveLength(0);
      expect(warnings.warn).toHaveBeenCalledTimes(2);
      expect(warnings.warn).toHaveBeenCalledWith(
        'Outcome hold expired',
        expect.objectContaining({
          reportId: 'report-608',
          reason: 'held-report-expired',
        }),
      );
      expect(warnings.warn).toHaveBeenCalledWith(
        'Outcome hold expired',
        expect.objectContaining({
          reportId: 'report-609',
          reason: 'held-report-expired',
        }),
      );
      await pipeline.dispose();
    } finally {
      jest.useRealTimers();
    }
  });
  it('warns when applying a report clears an expired hold', async () => {
    const store = new SeededStore();
    const now = Date.now();
    const warnings = { ...logger, warn: jest.fn() };
    const availability = new Availability();
    availability.open = true;
    const pipeline = trackedPipeline(store, warnings, undefined, availability);
    await pipeline.flush();
    store.seed({ ...reportOp('subagent:old', 610).report, expiresAt: now - 1 });
    expect(await pipeline.submit(reportOp('subagent:new', 611))).toMatchObject({
      ok: true,
      state: 'held',
    });
    expect(warnings.warn).toHaveBeenCalledWith(
      'Outcome hold expired',
      expect.objectContaining({ reportId: 'report-610' }),
    );
    await pipeline.dispose();
  });
  it('rejects an unknown lane target without changing the journal', async () => {
    const storage = new MemoryState();
    const pipeline = trackedPipeline(
      new InMemoryLaneOutcomeStore(),
      logger,
      storage,
      { isOpen: () => false },
    );
    const before = new KeyValueOutcomeJournal<OutcomeWriteOp>(
      storage,
    ).snapshot();
    expect(await pipeline.submit(report('lane:missing', 1))).toEqual({
      ok: false,
      error: expect.stringContaining('lane:missing'),
    });
    expect(
      new KeyValueOutcomeJournal<OutcomeWriteOp>(storage).snapshot(),
    ).toEqual(before);
    await pipeline.dispose();
  });

  it('rejects an unknown review even when the store is closed', async () => {
    const storage = new MemoryState();
    const pipeline = trackedPipeline(
      new InMemoryLaneOutcomeStore(),
      logger,
      storage,
      { isOpen: () => false },
    );
    const before = new KeyValueOutcomeJournal<OutcomeWriteOp>(
      storage,
    ).snapshot();
    expect(
      await pipeline.submit(report('subagent:missing', 2, 'review')),
    ).toEqual({
      ok: false,
      error: expect.stringContaining('subagent:missing'),
    });
    expect(
      new KeyValueOutcomeJournal<OutcomeWriteOp>(storage).snapshot(),
    ).toEqual(before);
    await pipeline.dispose();
  });

  it('uses unexpired rows for the readable-store capacity check', async () => {
    const store = new SeededStore();
    const pipeline = trackedPipeline(store, logger, new MemoryState(), {
      isOpen: () => true,
    });
    await pipeline.flush();
    const now = Date.now();
    for (let i = 0; i < 500; i++) {
      store.seed({
        ...heldReport(i, now),
        runId: 'subagent:r',
        expiresAt: i < 3 ? now - 1 : now + 86400000,
      });
    }
    expect(await pipeline.submit(report('subagent:r', 501))).toMatchObject({
      ok: true,
      state: 'held',
    });
    await pipeline.flush();
    expect(await store.countHeldReports(Date.now())).toBe(498);
    expect(store.heldRows()).toHaveLength(498);
    expect(store.heldRows().every((item) => item.expiresAt > Date.now())).toBe(
      true,
    );
    await pipeline.dispose();
  });

  it('refuses the 501st unexpired hold without a journal write', async () => {
    const store = new InMemoryLaneOutcomeStore();
    const storage = new MemoryState();
    const now = Date.now();
    for (let i = 0; i < 500; i++)
      await store.holdReport({
        ...heldReport(i, now),
        expiresAt: now + 86400000,
      });
    const pipeline = trackedPipeline(store, logger, storage, {
      isOpen: () => true,
    });
    const before = new KeyValueOutcomeJournal<OutcomeWriteOp>(
      storage,
    ).snapshot();
    expect(await pipeline.submit(report('subagent:a', 501))).toEqual({
      ok: false,
      error: 'too many held reports',
    });
    expect(
      new KeyValueOutcomeJournal<OutcomeWriteOp>(storage).snapshot(),
    ).toEqual(before);
    await pipeline.dispose();
  });

  it('applies an insert before its following report', async () => {
    const store = new InMemoryLaneOutcomeStore();
    const pipeline = trackedPipeline(store, logger);
    pipeline.enqueue({ kind: 'subagent-stop', row: outcomeRow('subagent:z') });
    expect(await pipeline.submit(report('subagent:z', 1))).toMatchObject({
      ok: true,
      state: 'applied',
    });
    await pipeline.flush();
    expect((await store.get('subagent:z'))?.verdict).toBe('delivered');
    await pipeline.dispose();
  });

  it('recognizes an acknowledged hold during an outage and joins its review after reopen', async () => {
    const store = new SeededStore();
    const storage = new MemoryState();
    let open = true;
    const pipeline = trackedPipeline(store, logger, storage, {
      isOpen: () => open,
    });
    expect(await pipeline.submit(report('subagent:z', 10))).toMatchObject({
      ok: true,
      state: 'held',
    });
    expect(store.heldRows()).toHaveLength(1);
    open = false;
    expect(
      await pipeline.submit(report('subagent:z', 11, 'review')),
    ).toMatchObject({ ok: true, state: 'held' });
    open = true;
    pipeline.enqueue({ kind: 'subagent-stop', row: outcomeRow('subagent:z') });
    await pipeline.flush();
    expect(store.heldRows()).toHaveLength(0);
    expect((await store.get('subagent:z'))?.reviseRounds).toBe(1);
    await pipeline.dispose();
  });
});
