/**
 * Memory retention — integration proof on real SQLite with a fake clock
 * (TASK_2026_440, reachability item 4): rows actually leave the table.
 *
 * Real `ObservationRetentionStore`, real `SqlitePageReclaimer`, real
 * `MemoryRetentionService`, on a temp-file database created with
 * `auto_vacuum = INCREMENTAL` before its schema and migrations 0016 + 0043
 * applied. Runs on better-sqlite3 when it loads, `node:sqlite` otherwise, and
 * FAILS — never skips — when neither loads.
 *
 * The clock is a fixed `NOW` far in the future of the real clock, so the
 * service's construction time is always more than 10 minutes before `NOW` and
 * the boot-deferral gate is open. Battery and foreground gates are open too.
 */
import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { SqlitePageReclaimer } from '@ptah-extension/persistence-sqlite';
import { MemoryRetentionService } from './memory-retention.service';
import {
  MEMORY_RETENTION_LIMITS,
  type MemoryRetentionLimits,
} from './memory-retention-config';
import type {
  MemoryRetentionReport,
  MemoryRetentionRunReport,
} from './memory-retention.types';
import {
  ObservationRetentionStore,
  RetentionStepError,
} from './observation-retention.store';
import {
  openRetentionTestDb,
  pragmaNumber,
  removeRetentionTempDirs,
  requireSqliteOpener,
  seedObservations,
  type RetentionTestDb,
  type SeedRow,
} from './retention-sqlite.test-support';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** 2030-03-17 — deliberately far after the real clock. */
const NOW = 1_900_000_000_000;
const PAYLOAD_8KB = 'r'.repeat(8 * 1024);

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function makeWorkspace(settings: Record<string, unknown>): IWorkspaceProvider {
  return {
    getConfiguration: (_section: string, key: string, def?: unknown) =>
      key in settings ? settings[key] : def,
  } as unknown as IWorkspaceProvider;
}

interface Harness {
  readonly t: RetentionTestDb;
  readonly store: ObservationRetentionStore;
  readonly service: MemoryRetentionService;
  readonly settings: Record<string, unknown>;
  run(at: number): Promise<MemoryRetentionReport>;
}

const openDbs: RetentionTestDb[] = [];

function makeHarness(
  limits: Partial<MemoryRetentionLimits> = {},
  wrapStore?: (store: ObservationRetentionStore) => void,
): Harness {
  const t = openRetentionTestDb();
  openDbs.push(t);
  const logger = makeLogger();
  const store = new ObservationRetentionStore(logger, t.connection);
  wrapStore?.(store);
  const settings: Record<string, unknown> = {
    'memory.retention.batchSize': 100,
  };
  const service = new MemoryRetentionService(
    logger,
    makeWorkspace(settings),
    t.connection,
    new SqlitePageReclaimer(logger, t.connection),
    store,
    { ...MEMORY_RETENTION_LIMITS, ...limits },
  );
  return {
    t,
    store,
    service,
    settings,
    run: (at: number) =>
      service.run({
        signal: new AbortController().signal,
        isOnBattery: () => false,
        msSinceForegroundActivity: () => Number.POSITIVE_INFINITY,
        now: () => at,
      }),
  };
}

function seedGroup(count: number, make: (i: number) => SeedRow): SeedRow[] {
  return Array.from({ length: count }, (_, i) => make(i));
}

type RowSnapshot = Map<
  number,
  {
    session_id: string;
    kind: string;
    captured_at: number;
    processed_at: number | null;
  }
>;

function snapshot(t: RetentionTestDb): RowSnapshot {
  const rows = t.raw
    .prepare(
      'SELECT id, session_id, kind, captured_at, processed_at FROM observation_queue ORDER BY id',
    )
    .all() as Array<{
    id: number;
    session_id: string;
    kind: string;
    captured_at: number;
    processed_at: number | null;
  }>;
  return new Map(
    rows.map((r) => [
      Number(r.id),
      {
        session_id: r.session_id,
        kind: r.kind,
        captured_at: Number(r.captured_at),
        processed_at: r.processed_at === null ? null : Number(r.processed_at),
      },
    ]),
  );
}

/**
 * Pointer-map pages in `(low, high]`. With auto-vacuum on, SQLite keeps one
 * pointer-map page every `usable/5 + 1` pages starting at page 2
 * (`ptrmapPageno` in btree.c; no reserved bytes here, so usable = page size).
 */
function ptrmapPagesBetween(
  low: number,
  high: number,
  pageSize: number,
): number {
  const interval = Math.floor(pageSize / 5) + 1;
  let n = 0;
  for (let page = 2; page <= high; page += interval) {
    if (page > low) n++;
  }
  return n;
}

function ledger(t: RetentionTestDb): Array<Record<string, unknown>> {
  return t.raw
    .prepare('SELECT * FROM observation_quarantine ORDER BY session_id, kind')
    .all() as Array<Record<string, unknown>>;
}

function ledgerSum(t: RetentionTestDb): number {
  return ledger(t).reduce((sum, row) => sum + Number(row['row_count']), 0);
}

afterEach(() => {
  for (const t of openDbs.splice(0)) t.close();
});
afterAll(() => removeRetentionTempDirs());

describe('memory retention — integration (real SQLite, fake clock)', () => {
  it('has a real SQLite binding (fails, never skips, without one)', () => {
    expect(() => requireSqliteOpener()).not.toThrow();
  });

  it('purges, quarantines, reclaims and records; run 2 is not due; run 3 slides the default windows; run 4 is idempotent', async () => {
    const h = makeHarness();
    const { t } = h;

    const pOld = seedObservations(
      t.raw,
      seedGroup(1200, (i) => ({
        sessionId: `p-${i % 3}`,
        kind: 'tool-use',
        capturedAt: NOW - 9 * DAY,
        processedAt: NOW - 8 * DAY,
        toolResponseText: PAYLOAD_8KB,
      })),
    );
    const pNew = seedObservations(
      t.raw,
      seedGroup(50, (i) => ({
        sessionId: `p-${i % 3}`,
        kind: 'tool-use',
        capturedAt: NOW - 7 * DAY,
        processedAt: NOW - 6 * DAY,
      })),
    );
    // R7: keyed on processed_at, not captured_at.
    const pOldCapturedNewProcessed = seedObservations(
      t.raw,
      seedGroup(10, () => ({
        sessionId: 'p-0',
        kind: 'assistant-turn',
        capturedAt: NOW - 30 * DAY,
        processedAt: NOW - DAY,
      })),
    );
    const uGrace = seedObservations(
      t.raw,
      seedGroup(40, (i) => ({
        sessionId: `u-${i % 2}`,
        kind: 'tool-use',
        capturedAt: NOW - 13 * DAY,
        processedAt: null,
      })),
    );
    const stuckSeed = seedGroup(300, (i) => ({
      sessionId: `u-${i % 2}`,
      kind: i % 4 < 2 ? 'tool-use' : 'user-prompt',
      capturedAt: NOW - 15 * DAY - i * 1000,
      processedAt: null,
      toolResponseText: 'stuck',
    }));
    const uStuck = seedObservations(t.raw, stuckSeed);

    const expectedLedger = new Map<
      string,
      { count: number; oldest: number; newest: number }
    >();
    for (const row of stuckSeed) {
      const key = `${row.sessionId}|${row.kind}`;
      const e = expectedLedger.get(key) ?? {
        count: 0,
        oldest: Infinity,
        newest: -Infinity,
      };
      e.count++;
      e.oldest = Math.min(e.oldest, row.capturedAt);
      e.newest = Math.max(e.newest, row.capturedAt);
      expectedLedger.set(key, e);
    }
    expect(expectedLedger.size).toBe(4);

    const before = snapshot(t);
    const pageCountBefore = pragmaNumber(t.raw, 'page_count');
    const freelistBefore = pragmaNumber(t.raw, 'freelist_count');

    // ---- Run 1 ----
    const run1 = (await h.run(NOW)) as MemoryRetentionRunReport;
    expect(run1.status).toBe('completed');
    expect(run1.reason).toBeNull();
    expect(run1.processedPurged).toBe(1200);
    expect(run1.stuckQuarantined).toBe(300);
    expect(run1.backlogRemaining).toBe(false);
    expect(run1.error).toBeNull();
    expect(run1.freedBytes).toBeGreaterThan(1200 * 4096);
    expect(run1.pagesReclaimed).toBeGreaterThan(0);

    const after = snapshot(t);
    for (const id of [...pOld, ...uStuck]) expect(after.has(id)).toBe(false);
    for (const id of [...pNew, ...pOldCapturedNewProcessed, ...uGrace]) {
      expect(after.get(id)).toEqual(before.get(id));
    }
    // No row anywhere had processed_at written: every survivor is unchanged.
    expect(after.size).toBe(
      pNew.length + pOldCapturedNewProcessed.length + uGrace.length,
    );
    for (const [id, row] of after) expect(row).toEqual(before.get(id));

    const ledgerRows = ledger(t);
    expect(ledgerRows).toHaveLength(4);
    expect(ledgerSum(t)).toBe(300);
    for (const row of ledgerRows) {
      const expected = expectedLedger.get(
        `${row['session_id']}|${row['kind']}`,
      );
      expect(expected).toBeDefined();
      expect(row['reason']).toBe('stuck-unprocessed');
      expect(Number(row['row_count'])).toBe(expected?.count);
      expect(Number(row['oldest_captured_at'])).toBe(expected?.oldest);
      expect(Number(row['newest_captured_at'])).toBe(expected?.newest);
      expect(Number(row['last_quarantined_at'])).toBe(NOW);
    }

    const freelistAfter = pragmaNumber(t.raw, 'freelist_count');
    expect(freelistAfter === 0 || freelistAfter < freelistBefore).toBe(true);
    // `page_count` drops by exactly the freelist pages handed back, plus any
    // pointer-map pages (auto-vacuum bookkeeping, never on the freelist) that
    // fell off the truncated tail of the file.
    const pageCountAfter = pragmaNumber(t.raw, 'page_count');
    expect(pageCountBefore - pageCountAfter).toBe(
      run1.pagesReclaimed +
        ptrmapPagesBetween(
          pageCountAfter,
          pageCountBefore,
          pragmaNumber(t.raw, 'page_size'),
        ),
    );

    const state1 = h.store.readState();
    expect(state1?.lastCompletedAt).toBe(NOW);
    expect(state1?.lastOutcome).toBe('completed');
    expect(state1?.backlogRemaining).toBe(false);
    expect(state1?.processedPurged).toBe(1200);
    expect(state1?.processedRowsAfter).toBe(
      pNew.length + pOldCapturedNewProcessed.length,
    );

    const health = h.service.storageHealth();
    expect(health.observations.pendingRows).toBe(40);
    expect(health.observations.quarantineLedgerRows).toBe(4);
    expect(health.retention.lastRun?.outcome).toBe('completed');
    expect(health.retention.nextDueAt).toBe(NOW + DAY);
    expect(health.readErrors).toBeUndefined();

    // ---- Run 2: one hour later, nothing is due and nothing is written ----
    const stateBeforeRun2 = h.store.readState();
    await expect(h.run(NOW + HOUR)).resolves.toEqual({
      status: 'skipped',
      reason: 'not-due',
    });
    expect(h.store.readState()).toEqual(stateBeforeRun2);

    // ---- Run 3: 25 h later, DEFAULT 7/14-day windows. The cutoffs slide with
    // the run clock: P-new (processed NOW-6d) is now older than 7 days and
    // U-grace (captured NOW-13d) older than 14 days, so both go.
    const ledgerBeforeRun3 = new Map(
      ledger(t).map((row) => [`${row['session_id']}|${row['kind']}`, row]),
    );
    const run3 = (await h.run(NOW + 25 * HOUR)) as MemoryRetentionRunReport;
    expect(run3).toMatchObject({
      status: 'completed',
      reason: null,
      processedPurged: 50,
      stuckQuarantined: 40,
      ledgerPruned: 0,
      backlogRemaining: false,
      error: null,
    });

    const afterRun3 = snapshot(t);
    for (const id of [...pNew, ...uGrace])
      expect(afterRun3.has(id)).toBe(false);
    // R7 again: processed NOW-1d, still inside the slid window, untouched.
    expect(afterRun3.size).toBe(pOldCapturedNewProcessed.length);
    for (const id of pOldCapturedNewProcessed) {
      expect(afterRun3.get(id)).toEqual(before.get(id));
      expect(afterRun3.get(id)?.processed_at).toBe(NOW - DAY);
    }

    // U-grace is 20 × u-0|tool-use and 20 × u-1|tool-use (no payload), which
    // share their keys with two run-1 ledger rows; the two user-prompt rows
    // share nothing with it and must not change at all.
    expect(ledgerSum(t)).toBe(340);
    const ledgerAfterRun3 = ledger(t);
    expect(ledgerAfterRun3).toHaveLength(4);
    const byKey = new Map(
      ledgerAfterRun3.map((row) => [
        `${row['session_id']}|${row['kind']}`,
        row,
      ]),
    );
    for (const session of ['u-0', 'u-1']) {
      const grown = byKey.get(`${session}|tool-use`);
      const prior = ledgerBeforeRun3.get(`${session}|tool-use`);
      expect(Number(prior?.['row_count'])).toBe(75);
      expect(Number(grown?.['row_count'])).toBe(95);
      expect(Number(grown?.['payload_bytes'])).toBe(
        Number(prior?.['payload_bytes']),
      );
      expect(Number(grown?.['oldest_captured_at'])).toBe(
        Number(prior?.['oldest_captured_at']),
      );
      expect(Number(grown?.['newest_captured_at'])).toBe(NOW - 13 * DAY);
      expect(Number(grown?.['first_quarantined_at'])).toBe(NOW);
      expect(Number(grown?.['last_quarantined_at'])).toBe(NOW + 25 * HOUR);

      const untouched = byKey.get(`${session}|user-prompt`);
      expect(Number(untouched?.['row_count'])).toBe(75);
      expect(untouched).toEqual(ledgerBeforeRun3.get(`${session}|user-prompt`));
    }

    const state3 = h.store.readState();
    expect(state3?.lastCompletedAt).toBe(NOW + 25 * HOUR);
    expect(state3?.lastOutcome).toBe('completed');
    expect(state3?.backlogRemaining).toBe(false);
    expect(state3?.processedPurged).toBe(50);
    expect(state3?.stuckQuarantined).toBe(40);
    expect(state3?.processedRowsAfter).toBe(pOldCapturedNewProcessed.length);

    // ---- Run 4: due again 25 h after run 3, defaults, over a clean cohort:
    // nothing is eligible, every counter is zero, the ledger is unchanged.
    const run4 = (await h.run(NOW + 50 * HOUR)) as MemoryRetentionRunReport;
    expect(run4).toEqual({
      status: 'completed',
      reason: null,
      processedPurged: 0,
      stuckQuarantined: 0,
      ledgerPruned: 0,
      freedBytes: 0,
      pagesReclaimed: 0,
      backlogRemaining: false,
      durationMs: 0,
      error: null,
    });
    expect(ledgerSum(t)).toBe(340);
    expect(ledger(t)).toEqual(ledgerAfterRun3);
    expect(snapshot(t)).toEqual(afterRun3);
    expect(h.store.readState()?.lastCompletedAt).toBe(NOW + 50 * HOUR);
  });

  it('the row cap is shared across purge and quarantine; a row-budget stop still prunes the ledger and reclaims', async () => {
    const quarantineLimits: number[] = [];
    const h = makeHarness({ maxRowsPerRun: 250 }, (store) => {
      const real = store.quarantineStuckBatch.bind(store);
      store.quarantineStuckBatch = (cutoff, limit, now) => {
        quarantineLimits.push(limit);
        return real(cutoff, limit, now);
      };
    });
    const { t } = h;
    // Batch size above the cap, so each step's limit is the remaining allowance.
    h.settings['memory.retention.batchSize'] = 500;

    // 100 eligible processed rows: fewer than the 250 cap.
    const processed = seedObservations(
      t.raw,
      seedGroup(100, (i) => ({
        sessionId: `p-${i % 2}`,
        kind: 'tool-use',
        capturedAt: NOW - 9 * DAY,
        processedAt: NOW - 8 * DAY,
        toolResponseText: PAYLOAD_8KB,
      })),
    );
    // 200 stuck rows: more than the 150 the purge leaves.
    const stuck = seedObservations(
      t.raw,
      seedGroup(200, (i) => ({
        sessionId: 'u-0',
        kind: 'tool-use',
        capturedAt: NOW - 20 * DAY + i * 1000,
        processedAt: null,
        toolResponseText: PAYLOAD_8KB,
      })),
    );

    const insertLedger = t.raw.prepare(
      `INSERT INTO observation_quarantine
         (session_id, kind, reason, row_count, payload_bytes, oldest_captured_at,
          newest_captured_at, first_quarantined_at, last_quarantined_at)
       VALUES (?, 'user-prompt', 'stuck-unprocessed', 3, 30, ?, ?, ?, ?)`,
    );
    // Older than the 90-day bound → pruned.
    insertLedger.run(
      'old-s',
      NOW - 200 * DAY,
      NOW - 190 * DAY,
      NOW - 100 * DAY,
      NOW - 91 * DAY,
    );
    // Inside the bound → kept.
    insertLedger.run(
      'recent-s',
      NOW - 120 * DAY,
      NOW - 110 * DAY,
      NOW - 89 * DAY,
      NOW - 89 * DAY,
    );

    const run1 = (await h.run(NOW)) as MemoryRetentionRunReport;
    expect(run1).toMatchObject({
      status: 'partial',
      reason: 'row-budget',
      processedPurged: 100,
      stuckQuarantined: 150,
      ledgerPruned: 1,
      backlogRemaining: true,
      error: null,
    });
    expect(run1.processedPurged + run1.stuckQuarantined).toBe(250);
    // The quarantine step was handed the allowance the purge left, not a fresh one.
    expect(quarantineLimits).toEqual([150]);

    const left = snapshot(t);
    for (const id of processed) expect(left.has(id)).toBe(false);
    expect(left.size).toBe(50);
    for (const id of stuck.slice(0, 150)) expect(left.has(id)).toBe(false);
    for (const id of stuck.slice(150)) expect(left.has(id)).toBe(true);

    const sessions = ledger(t).map((row) => row['session_id']);
    expect(sessions).not.toContain('old-s');
    expect(sessions).toEqual(['recent-s', 'u-0']);
    const u0 = ledger(t).find((row) => row['session_id'] === 'u-0');
    expect(Number(u0?.['row_count'])).toBe(150);

    // Reclaim ran after the row-budget stop and emptied the freelist.
    expect(run1.pagesReclaimed).toBeGreaterThan(0);
    expect(pragmaNumber(t.raw, 'freelist_count')).toBe(0);

    const stateRow = t.raw
      .prepare(
        'SELECT last_outcome, last_reason, backlog_remaining, ledger_pruned, last_completed_at FROM memory_retention_state WHERE id = 1',
      )
      .get() as Record<string, unknown>;
    expect(stateRow['last_outcome']).toBe('partial');
    expect(stateRow['last_reason']).toBe('row-budget');
    expect(Number(stateRow['backlog_remaining'])).toBe(1);
    expect(Number(stateRow['ledger_pruned'])).toBe(1);
    expect(stateRow['last_completed_at']).toBeNull();
  });

  it('a row budget stops run 1 partial with committed deletes; the next hour is due and finishes', async () => {
    const h = makeHarness({ maxRowsPerRun: 250 });
    const { t } = h;
    seedObservations(
      t.raw,
      seedGroup(300, (i) => ({
        sessionId: `p-${i % 2}`,
        kind: 'tool-use',
        capturedAt: NOW - 9 * DAY,
        processedAt: NOW - 8 * DAY,
        toolResponseText: 'x'.repeat(512),
      })),
    );
    seedObservations(
      t.raw,
      seedGroup(100, () => ({
        sessionId: 'u-0',
        kind: 'tool-use',
        capturedAt: NOW - 20 * DAY,
        processedAt: null,
      })),
    );

    const run1 = (await h.run(NOW)) as MemoryRetentionRunReport;
    expect(run1).toMatchObject({
      status: 'partial',
      reason: 'row-budget',
      processedPurged: 250,
      stuckQuarantined: 0,
      backlogRemaining: true,
    });
    const processedLeft = t.raw
      .prepare(
        'SELECT COUNT(*) AS n FROM observation_queue WHERE processed_at IS NOT NULL',
      )
      .get() as { n: number };
    expect(Number(processedLeft.n)).toBe(50);
    const state1 = h.store.readState();
    expect(state1?.backlogRemaining).toBe(true);
    expect(state1?.lastCompletedAt).toBeNull();
    expect(h.service.storageHealth().retention.nextDueAt).toBe(NOW);

    const run2 = (await h.run(NOW + HOUR)) as MemoryRetentionRunReport;
    expect(run2).toMatchObject({
      status: 'completed',
      processedPurged: 50,
      stuckQuarantined: 100,
      backlogRemaining: false,
    });
    const left = t.raw
      .prepare('SELECT COUNT(*) AS n FROM observation_queue')
      .get() as { n: number };
    expect(Number(left.n)).toBe(0);
    expect(ledgerSum(t)).toBe(100);
    expect(h.store.readState()?.lastCompletedAt).toBe(NOW + HOUR);
  });

  it('a failure in the third purge batch fails the run, keeps batches 1-2, records the error and releases the flag', async () => {
    let failThirdBatch = true;
    const h = makeHarness({}, (store) => {
      const real = store.purgeProcessedBatch.bind(store);
      let calls = 0;
      store.purgeProcessedBatch = (cutoff, limit, cursor) => {
        calls++;
        if (failThirdBatch && calls === 3) {
          throw new RetentionStepError(
            'sql-error',
            'purge-processed',
            new Error(
              'disk I/O error writing /home/someone/.ptah/state/ptah.sqlite',
            ),
          );
        }
        return real(cutoff, limit, cursor);
      };
    });
    const { t } = h;
    const ids = seedObservations(
      t.raw,
      seedGroup(350, () => ({
        sessionId: 'p-0',
        kind: 'tool-use',
        capturedAt: NOW - 9 * DAY,
        processedAt: NOW - 8 * DAY,
      })),
    );

    const run1 = (await h.run(NOW)) as MemoryRetentionRunReport;
    expect(run1).toMatchObject({
      status: 'failed',
      reason: 'sql-error',
      processedPurged: 200,
      backlogRemaining: true,
    });
    expect(run1.error).toContain('[path redacted]');
    expect(run1.error).not.toContain('someone');

    const survivors = snapshot(t);
    expect(survivors.size).toBe(150);
    // The purge drains a session in id order through the index; batches 1-2
    // took the first 200 ids and batch 3's rows are all still present.
    for (const id of ids.slice(0, 200)) expect(survivors.has(id)).toBe(false);
    for (const id of ids.slice(200)) expect(survivors.has(id)).toBe(true);

    const state1 = h.store.readState();
    expect(state1?.lastOutcome).toBe('failed');
    expect(state1?.lastReason).toBe('sql-error');
    expect(state1?.lastError).toContain('disk I/O error');
    expect(state1?.lastError).not.toContain('someone');
    expect(state1?.backlogRemaining).toBe(true);
    expect(state1?.lastCompletedAt).toBeNull();

    failThirdBatch = false;
    const run2 = (await h.run(NOW + HOUR)) as MemoryRetentionRunReport;
    expect(run2.status).toBe('completed');
    expect(run2.processedPurged).toBe(150);
    expect(snapshot(t).size).toBe(0);
  });
});
