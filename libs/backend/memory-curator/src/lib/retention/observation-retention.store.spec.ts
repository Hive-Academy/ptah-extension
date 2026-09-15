/**
 * ObservationRetentionStore — real SQLite, temp files only (TASK_2026_440).
 *
 * Runs on better-sqlite3 when it loads and on `node:sqlite` otherwise, and
 * FAILS (never skips) when neither loads — see `retention-sqlite.test-support.ts`.
 * That is also assumption A3: `json_each(?)` with a bound JSON id list behaves
 * the same on whichever binding runs.
 */
import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type { SqliteConnectionService } from '@ptah-extension/persistence-sqlite';
import {
  OBSERVATION_RETENTION_SQL,
  ObservationRetentionStore,
  PENDING_BYTES_MAX_ROWS,
  RetentionStepError,
} from './observation-retention.store';
import {
  openRetentionTestDb,
  removeRetentionTempDirs,
  requireSqliteOpener,
  seedObservations,
  type RetentionTestDb,
  type SeedRow,
} from './retention-sqlite.test-support';

const DAY = 86_400_000;
const NOW = 1_900_000_000_000;

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function rows(
  count: number,
  base: Omit<SeedRow, 'sessionId'> & {
    sessionId: string | ((i: number) => string);
  },
): SeedRow[] {
  return Array.from({ length: count }, (_, i) => ({
    ...base,
    sessionId:
      typeof base.sessionId === 'function' ? base.sessionId(i) : base.sessionId,
  }));
}

function count(t: RetentionTestDb, sql: string, ...params: unknown[]): number {
  const row = t.raw.prepare(sql).get(...params) as { n: number };
  return Number(row.n);
}

describe('ObservationRetentionStore (real SQLite)', () => {
  const open: RetentionTestDb[] = [];
  const fresh = (): {
    t: RetentionTestDb;
    store: ObservationRetentionStore;
  } => {
    const t = openRetentionTestDb();
    open.push(t);
    return {
      t,
      store: new ObservationRetentionStore(makeLogger(), t.connection),
    };
  };

  afterEach(() => {
    for (const t of open.splice(0)) t.close();
  });
  afterAll(() => removeRetentionTempDirs());

  it('has a real SQLite binding (fails, never skips, without one)', () => {
    expect(() => requireSqliteOpener()).not.toThrow();
  });

  describe('query plans on a database with no sqlite_stat1', () => {
    const planOf = (t: RetentionTestDb, sql: string): string[] => {
      const namedParameters = [
        ...sql.matchAll(/[@:$]([A-Za-z_][A-Za-z0-9_]*)/g),
      ].map((match) => match[1]);
      const positionalParameters = Array.from(
        { length: sql.match(/\?/g)?.length ?? 0 },
        () => 0,
      );
      const bindings: unknown[] = namedParameters.length
        ? [
            Object.fromEntries(
              [...new Set(namedParameters)].map((name) => [name, 0]),
            ),
            ...positionalParameters,
          ]
        : positionalParameters;
      return (
        t.raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...bindings) as Array<{
          detail: string;
        }>
      ).map((r) => r.detail);
    };

    it('never runs ANALYZE and never bare-scans observation_queue', () => {
      const { t } = fresh();
      seedObservations(
        t.raw,
        rows(20, {
          sessionId: (i) => `s-${i % 4}`,
          kind: 'tool-use',
          capturedAt: NOW,
          processedAt: NOW,
        }),
      );
      const stat = t.raw
        .prepare(
          `SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'sqlite_stat1'`,
        )
        .get() as { n: number };
      expect(Number(stat.n)).toBe(0);

      const planned = Object.entries(OBSERVATION_RETENTION_SQL).filter(
        ([name, sql]) =>
          // The unfiltered end-of-run count is a deliberate full index scan.
          name !== 'TOTAL_ROWS_SQL' && /observation_queue/.test(sql),
      );
      expect(planned.length).toBeGreaterThanOrEqual(10);
      const violations: string[] = [];
      for (const [name, sql] of planned) {
        for (const detail of planOf(t, sql)) {
          // Every step touching the queue must be an index SEARCH (a seek or a
          // rowid lookup), never a SCAN of the table or of a whole index.
          if (
            /\b(observation_queue|q)\b/.test(detail) &&
            !detail.startsWith('SEARCH')
          ) {
            violations.push(`${name}: ${detail}`);
          }
        }
      }
      expect(violations).toEqual([]);
    });

    it('seeks the session index, the drain index and rowids exactly as designed', () => {
      const { t } = fresh();
      const sql = OBSERVATION_RETENTION_SQL;
      expect(planOf(t, sql.NEXT_SESSION_SQL).join('|')).toContain(
        'USING COVERING INDEX idx_obs_queue_session (session_id>?)',
      );
      expect(planOf(t, sql.PROCESSED_IDS_FOR_SESSION_SQL).join('|')).toContain(
        'USING COVERING INDEX idx_obs_queue_session (session_id=? AND processed_at>? AND processed_at<?)',
      );
      expect(planOf(t, sql.STUCK_IDS_SQL).join('|')).toContain(
        'USING COVERING INDEX idx_obs_queue_drain (processed_at=? AND captured_at<?)',
      );
      expect(planOf(t, sql.STUCK_ELIGIBLE_COUNT_SQL).join('|')).toContain(
        'USING COVERING INDEX idx_obs_queue_drain',
      );
      expect(planOf(t, sql.PENDING_SUMMARY_SQL).join('|')).toContain(
        'USING COVERING INDEX idx_obs_queue_drain',
      );
      expect(planOf(t, sql.PENDING_BYTES_SQL).join('|')).toContain(
        'USING INDEX idx_obs_queue_drain',
      );
      for (const byId of [
        sql.DELETE_IDS_SQL,
        sql.QUARANTINE_UPSERT_SQL,
        sql.STUCK_PAYLOAD_BYTES_SQL,
      ]) {
        expect(planOf(t, byId).join('|')).toContain(
          'USING INTEGER PRIMARY KEY',
        );
      }
      // The stuck DELETE re-checks `processed_at IS NULL`; without statistics the
      // planner may drive it from the partial drain index (pending rows only)
      // instead of rowids. Both are bounded seeks — neither scans the table.
      expect(planOf(t, sql.DELETE_STUCK_SQL).join('|')).toMatch(
        /SEARCH observation_queue USING (INTEGER PRIMARY KEY|COVERING INDEX idx_obs_queue_drain)/,
      );
    });
  });

  it('no statement writes processed_at, and the store issues no UPDATE of observation_queue', () => {
    for (const sql of Object.values(OBSERVATION_RETENTION_SQL)) {
      expect(sql).not.toMatch(/processed_at\s*=/i);
      expect(sql).not.toMatch(/UPDATE\s+observation_queue/i);
      expect(sql).not.toMatch(/\bVACUUM\b/i);
    }
    const { t, store } = fresh();
    seedObservations(t.raw, [
      {
        sessionId: 'a',
        kind: 'tool-use',
        capturedAt: NOW - 20 * DAY,
        processedAt: NOW - 10 * DAY,
      },
      {
        sessionId: 'a',
        kind: 'tool-use',
        capturedAt: NOW - 20 * DAY,
        processedAt: null,
      },
    ]);
    store.purgeProcessedBatch(NOW - 7 * DAY, 100, '');
    store.quarantineStuckBatch(NOW - 14 * DAY, 100, NOW);
    store.pruneLedger(NOW - 90 * DAY, 5000);
    store.readLiveStorage(NOW - 14 * DAY);
    expect(t.issued.length).toBeGreaterThan(0);
    for (const sql of t.issued) {
      expect(sql).not.toMatch(/processed_at\s*=/i);
      expect(sql).not.toMatch(/UPDATE\s+observation_queue/i);
    }
    expect(t.issued.filter((s) => s === 'BEGIN IMMEDIATE')).toHaveLength(3);
  });

  describe('purgeProcessedBatch', () => {
    it('deletes by processed_at across sessions, keeps new, unprocessed and old-captured-new-processed rows', () => {
      const { t, store } = fresh();
      const oldIds = seedObservations(t.raw, [
        ...rows(5, {
          sessionId: 'a',
          kind: 'tool-use',
          capturedAt: NOW - 9 * DAY,
          processedAt: NOW - 8 * DAY,
        }),
        ...rows(5, {
          sessionId: 'b',
          kind: 'tool-use',
          capturedAt: NOW - 9 * DAY,
          processedAt: NOW - 8 * DAY,
        }),
      ]);
      const keptIds = seedObservations(t.raw, [
        ...rows(3, {
          sessionId: 'a',
          kind: 'tool-use',
          capturedAt: NOW - 7 * DAY,
          processedAt: NOW - 6 * DAY,
        }),
        ...rows(2, {
          sessionId: 'b',
          kind: 'tool-use',
          capturedAt: NOW - 30 * DAY,
          processedAt: NOW - DAY,
        }),
        ...rows(2, {
          sessionId: 'c',
          kind: 'tool-use',
          capturedAt: NOW - 30 * DAY,
          processedAt: null,
        }),
      ]);

      const result = store.purgeProcessedBatch(NOW - 7 * DAY, 100, '');
      expect(result).toEqual({ deleted: 10, nextCursor: 'c', exhausted: true });
      for (const id of oldIds) {
        expect(
          count(
            t,
            'SELECT COUNT(*) AS n FROM observation_queue WHERE id = ?',
            id,
          ),
        ).toBe(0);
      }
      for (const id of keptIds) {
        expect(
          count(
            t,
            'SELECT COUNT(*) AS n FROM observation_queue WHERE id = ?',
            id,
          ),
        ).toBe(1);
      }
    });

    it('stops at the limit, leaves the cursor before a partly drained session, and resumes', () => {
      const { t, store } = fresh();
      seedObservations(t.raw, [
        ...rows(4, {
          sessionId: 'a',
          kind: 'tool-use',
          capturedAt: NOW - 9 * DAY,
          processedAt: NOW - 8 * DAY,
        }),
        ...rows(4, {
          sessionId: 'b',
          kind: 'tool-use',
          capturedAt: NOW - 9 * DAY,
          processedAt: NOW - 8 * DAY,
        }),
      ]);
      const first = store.purgeProcessedBatch(NOW - 7 * DAY, 6, '');
      expect(first).toEqual({ deleted: 6, nextCursor: 'a', exhausted: false });

      const second = store.purgeProcessedBatch(
        NOW - 7 * DAY,
        6,
        first.nextCursor,
      );
      expect(second).toEqual({ deleted: 2, nextCursor: 'b', exhausted: true });
      expect(count(t, 'SELECT COUNT(*) AS n FROM observation_queue')).toBe(0);
    });

    it('visits at most `limit` sessions per batch when none has eligible rows', () => {
      const { t, store } = fresh();
      seedObservations(
        t.raw,
        rows(10, {
          sessionId: (i) => `s-${String(i).padStart(2, '0')}`,
          kind: 'tool-use',
          capturedAt: NOW,
          processedAt: null,
        }),
      );
      const result = store.purgeProcessedBatch(NOW - 7 * DAY, 3, '');
      expect(result).toEqual({
        deleted: 0,
        nextCursor: 's-02',
        exhausted: false,
      });
    });
  });

  describe('quarantineStuckBatch', () => {
    it('ledgers stuck rows per (session, kind), accumulates across batches, and deletes only them', () => {
      const { t, store } = fresh();
      const text = 'x'.repeat(100);
      seedObservations(t.raw, [
        ...rows(3, {
          sessionId: 'a',
          kind: 'tool-use',
          capturedAt: NOW - 20 * DAY,
          processedAt: null,
          toolResponseText: text,
        }),
        ...rows(3, {
          sessionId: 'a',
          kind: 'tool-use',
          capturedAt: NOW - 16 * DAY,
          processedAt: null,
          toolResponseText: text,
        }),
      ]);
      const grace = seedObservations(t.raw, [
        {
          sessionId: 'a',
          kind: 'tool-use',
          capturedAt: NOW - 13 * DAY,
          processedAt: null,
        },
      ]);
      const processed = seedObservations(t.raw, [
        {
          sessionId: 'a',
          kind: 'tool-use',
          capturedAt: NOW - 20 * DAY,
          processedAt: NOW - DAY,
        },
      ]);

      const b1 = store.quarantineStuckBatch(NOW - 14 * DAY, 4, NOW);
      expect(b1).toEqual({ quarantined: 4, payloadBytes: 400 });
      const b2 = store.quarantineStuckBatch(NOW - 14 * DAY, 4, NOW + 1000);
      expect(b2).toEqual({ quarantined: 2, payloadBytes: 200 });
      expect(store.quarantineStuckBatch(NOW - 14 * DAY, 4, NOW + 2000)).toEqual(
        {
          quarantined: 0,
          payloadBytes: 0,
        },
      );

      const ledger = t.raw
        .prepare('SELECT * FROM observation_quarantine')
        .all() as Array<Record<string, unknown>>;
      expect(ledger).toHaveLength(1);
      expect(ledger[0]).toMatchObject({
        session_id: 'a',
        kind: 'tool-use',
        reason: 'stuck-unprocessed',
        row_count: 6,
        payload_bytes: 600,
        oldest_captured_at: NOW - 20 * DAY,
        newest_captured_at: NOW - 16 * DAY,
        first_quarantined_at: NOW,
        last_quarantined_at: NOW + 1000,
      });
      expect(
        count(
          t,
          'SELECT COUNT(*) AS n FROM observation_queue WHERE id = ?',
          grace[0],
        ),
      ).toBe(1);
      const kept = t.raw
        .prepare('SELECT processed_at FROM observation_queue WHERE id = ?')
        .get(processed[0]) as { processed_at: number };
      expect(Number(kept.processed_at)).toBe(NOW - DAY);
    });
  });

  describe('pruneLedger', () => {
    const insertLedger = (
      t: RetentionTestDb,
      session: string,
      lastAt: number,
    ): void => {
      t.raw
        .prepare(
          `INSERT INTO observation_quarantine (session_id, kind, reason, row_count, payload_bytes,
             oldest_captured_at, newest_captured_at, first_quarantined_at, last_quarantined_at)
           VALUES (?, 'tool-use', 'stuck-unprocessed', 1, 1, 0, 0, ?, ?)`,
        )
        .run(session, lastAt, lastAt);
    };

    it('prunes by age', () => {
      const { t, store } = fresh();
      insertLedger(t, 'old', NOW - 91 * DAY);
      insertLedger(t, 'new', NOW - 89 * DAY);
      expect(store.pruneLedger(NOW - 90 * DAY, 5000)).toEqual({ pruned: 1 });
      expect(
        count(
          t,
          `SELECT COUNT(*) AS n FROM observation_quarantine WHERE session_id = 'new'`,
        ),
      ).toBe(1);
    });

    it('prunes by count, keeping the newest rows', () => {
      const { t, store } = fresh();
      for (let i = 0; i < 5; i++) insertLedger(t, `s${i}`, NOW - i * 1000);
      expect(store.pruneLedger(NOW - 90 * DAY, 2)).toEqual({ pruned: 3 });
      const left = (
        t.raw
          .prepare(
            'SELECT session_id FROM observation_quarantine ORDER BY session_id',
          )
          .all() as Array<{ session_id: string }>
      ).map((r) => r.session_id);
      expect(left).toEqual(['s0', 's1']);
    });
  });

  describe('run record', () => {
    const run = {
      startedAt: NOW,
      finishedAt: NOW + 5,
      outcome: 'completed' as const,
      reason: null,
      error: null,
      durationMs: 5,
      processedPurged: 10,
      stuckQuarantined: 2,
      ledgerPruned: 1,
      freedBytes: 4096,
      pagesReclaimed: 1,
      backlogRemaining: false,
      completedAt: NOW + 5,
      processedRowsAfter: 7,
      avgProcessedRowBytes: 409,
    };

    it('readState is null before anything is written', () => {
      const { store } = fresh();
      expect(store.readState()).toBeNull();
    });

    it('writeSkip preserves the last run fields', () => {
      const { store } = fresh();
      store.writeRun(run);
      store.writeSkip(NOW + 3600_000, 'foreground-active');
      expect(store.readState()).toEqual({
        lastStartedAt: NOW,
        lastFinishedAt: NOW + 5,
        lastOutcome: 'completed',
        lastReason: null,
        lastError: null,
        lastDurationMs: 5,
        processedPurged: 10,
        stuckQuarantined: 2,
        ledgerPruned: 1,
        freedBytes: 4096,
        pagesReclaimed: 1,
        backlogRemaining: false,
        lastCompletedAt: NOW + 5,
        processedRowsAfter: 7,
        avgProcessedRowBytes: 409,
        lastSkippedAt: NOW + 3600_000,
        lastSkipReason: 'foreground-active',
      });
    });

    it('a skip before any run leaves zero counters and null run fields', () => {
      const { store } = fresh();
      store.writeSkip(NOW, 'boot-deferred');
      expect(store.readState()).toMatchObject({
        lastOutcome: null,
        lastCompletedAt: null,
        processedPurged: 0,
        backlogRemaining: false,
        lastSkipReason: 'boot-deferred',
      });
    });

    it('a partial run keeps the previous last_completed_at and average row bytes', () => {
      const { store } = fresh();
      store.writeRun(run);
      store.writeRun({
        ...run,
        startedAt: NOW + DAY,
        finishedAt: NOW + DAY + 9,
        outcome: 'partial',
        reason: 'row-budget',
        backlogRemaining: true,
        completedAt: null,
        processedPurged: 0,
        avgProcessedRowBytes: null,
      });
      expect(store.readState()).toMatchObject({
        lastOutcome: 'partial',
        lastReason: 'row-budget',
        backlogRemaining: true,
        lastCompletedAt: NOW + 5,
        avgProcessedRowBytes: 409,
      });
    });
  });

  describe('readLiveStorage', () => {
    it('reads pending rows, bytes, oldest pending, stuck-eligible rows and ledger rows', () => {
      const { t, store } = fresh();
      seedObservations(t.raw, [
        {
          sessionId: 'a',
          kind: 'tool-use',
          capturedAt: NOW - 20 * DAY,
          processedAt: null,
          toolResponseText: 'abcd',
        },
        {
          sessionId: 'a',
          kind: 'tool-use',
          capturedAt: NOW - 2 * DAY,
          processedAt: null,
          toolResponseText: 'é',
        },
        {
          sessionId: 'a',
          kind: 'tool-use',
          capturedAt: NOW - 30 * DAY,
          processedAt: NOW,
          toolResponseText: 'zzzzzz',
        },
      ]);
      expect(store.readLiveStorage(NOW - 14 * DAY)).toEqual({
        pendingRows: 2,
        pendingBytes: 6,
        oldestPendingAt: NOW - 20 * DAY,
        stuckEligibleRows: 1,
        quarantineLedgerRows: 0,
        readErrors: [],
      });
    });

    it('does not measure pending bytes above 5000 pending rows', () => {
      const t = openRetentionTestDb();
      open.push(t);
      const logger = makeLogger();
      const store = new ObservationRetentionStore(logger, t.connection);
      seedObservations(
        t.raw,
        rows(PENDING_BYTES_MAX_ROWS + 1, {
          sessionId: 'large-backlog',
          kind: 'tool-use',
          capturedAt: NOW - 20 * DAY,
          processedAt: null,
          toolResponseText: 'x',
        }),
      );

      const reading = store.readLiveStorage(NOW - 14 * DAY);

      expect(reading.pendingRows).toBe(5001);
      expect(reading.pendingBytes).toBeNull();
      expect(reading.oldestPendingAt).toBe(NOW - 20 * DAY);
      expect(reading.stuckEligibleRows).toBe(5001);
      expect(reading.readErrors).toEqual([
        'pendingBytes: not measured above 5000 pending rows',
      ]);
      expect(t.issued.filter((sql) => /octet_length/i.test(sql))).toEqual([]);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('measures exact pending bytes at the 5000-row bound', () => {
      const { t, store } = fresh();
      seedObservations(
        t.raw,
        rows(PENDING_BYTES_MAX_ROWS, {
          sessionId: 'bounded-backlog',
          kind: 'tool-use',
          capturedAt: NOW - 2 * DAY,
          processedAt: null,
          toolResponseText: 'abc',
        }),
      );

      const reading = store.readLiveStorage(NOW - 14 * DAY);

      expect(reading.pendingRows).toBe(5000);
      expect(reading.pendingBytes).toBe(15_000);
      expect(reading.readErrors).not.toContain(
        'pendingBytes: not measured above 5000 pending rows',
      );
      expect(t.issued.filter((sql) => /octet_length/i.test(sql))).toHaveLength(
        1,
      );
    });

    it('does not report a backlog-bound skip when the pending summary fails', () => {
      const { t, store } = fresh();
      t.raw.exec('DROP INDEX idx_obs_queue_drain');

      const reading = store.readLiveStorage(NOW - 14 * DAY);

      expect(reading.pendingRows).toBeNull();
      expect(reading.pendingBytes).toBeNull();
      expect(reading.readErrors).toEqual(
        expect.arrayContaining([expect.stringMatching(/^pending: /)]),
      );
      expect(reading.readErrors).not.toContain(
        'pendingBytes: not measured above 5000 pending rows',
      );
      expect(t.issued.filter((sql) => /octet_length/i.test(sql))).toEqual([]);
    });

    it('never throws: a closed connection yields nulls and a read error', () => {
      const store = new ObservationRetentionStore(makeLogger(), {
        get db(): never {
          throw new Error('PERSISTENCE_UNAVAILABLE');
        },
      } as unknown as SqliteConnectionService);
      expect(store.readLiveStorage(NOW)).toEqual({
        pendingRows: null,
        pendingBytes: null,
        oldestPendingAt: null,
        stuckEligibleRows: null,
        quarantineLedgerRows: null,
        readErrors: ['connection: PERSISTENCE_UNAVAILABLE'],
      });
    });

    it('a failed individual read nulls only its field', () => {
      const { t, store } = fresh();
      t.raw.exec('DROP TABLE observation_quarantine');
      const reading = store.readLiveStorage(NOW);
      expect(reading.pendingRows).toBe(0);
      expect(reading.quarantineLedgerRows).toBeNull();
      expect(reading.readErrors).toHaveLength(1);
      expect(reading.readErrors[0]).toMatch(/^quarantineLedger: /);
    });
  });

  describe('failure tokens', () => {
    it('SQLITE_BUSY becomes database-busy and nothing is deleted', () => {
      const { t, store } = fresh();
      seedObservations(t.raw, [
        {
          sessionId: 'a',
          kind: 'tool-use',
          capturedAt: NOW - 9 * DAY,
          processedAt: NOW - 8 * DAY,
        },
      ]);
      t.raw.prepare('PRAGMA busy_timeout = 0').all();
      const other = t.openSecondHandle();
      other.exec('BEGIN IMMEDIATE');
      try {
        let thrown: unknown;
        try {
          store.purgeProcessedBatch(NOW - 7 * DAY, 10, '');
        } catch (error: unknown) {
          thrown = error;
        }
        expect(thrown).toBeInstanceOf(RetentionStepError);
        expect((thrown as RetentionStepError).reason).toBe('database-busy');
      } finally {
        other.exec('ROLLBACK');
        other.close();
      }
      expect(count(t, 'SELECT COUNT(*) AS n FROM observation_queue')).toBe(1);
      expect(t.db.inTransaction).toBe(false);
    });

    it('any other SQL error becomes sql-error and the transaction is rolled back', () => {
      const { t, store } = fresh();
      seedObservations(t.raw, [
        {
          sessionId: 'a',
          kind: 'tool-use',
          capturedAt: NOW - 20 * DAY,
          processedAt: null,
        },
      ]);
      t.raw.exec('DROP TABLE observation_quarantine');
      let thrown: unknown;
      try {
        store.quarantineStuckBatch(NOW - 14 * DAY, 10, NOW);
      } catch (error: unknown) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(RetentionStepError);
      expect((thrown as RetentionStepError).reason).toBe('sql-error');
      expect(t.db.inTransaction).toBe(false);
      expect(count(t, 'SELECT COUNT(*) AS n FROM observation_queue')).toBe(1);
    });
  });

  it('countTotalRows counts every row', () => {
    const { t, store } = fresh();
    seedObservations(t.raw, [
      { sessionId: 'a', kind: 'tool-use', capturedAt: NOW, processedAt: null },
      { sessionId: 'b', kind: 'tool-use', capturedAt: NOW, processedAt: NOW },
    ]);
    expect(store.countTotalRows()).toBe(2);
  });
});
