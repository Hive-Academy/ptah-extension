import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteConnectionService } from '@ptah-extension/persistence-sqlite';
import { reportEffectOf } from '../write/report-effect';
import { SqliteLaneOutcomeStore } from './sqlite-lane-outcome.store';
import { heldReport, outcomeRow } from './store.test-support';
import { testLogger } from '../write/pipeline.test-support';

type Database = {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): unknown;
  };
  close(): void;
};
const DatabaseConstructor = require('better-sqlite3') as new (
  file: string,
) => Database;

function fixture(file = ':memory:') {
  const db = new DatabaseConstructor(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS lane_outcome_records (
      run_id TEXT NOT NULL PRIMARY KEY, executor_kind TEXT NOT NULL,
      lane_id TEXT NOT NULL, agent_id TEXT NOT NULL, family TEXT,
      subagent_session_id TEXT, parent_session_id TEXT, workspace_root TEXT,
      provider TEXT, model TEXT NOT NULL, role TEXT, task_kind TEXT,
      task_id TEXT, verdict TEXT NOT NULL, failure_class TEXT,
      budget_stopped INTEGER NOT NULL DEFAULT 0, started_at INTEGER,
      ended_at INTEGER NOT NULL, duration_ms INTEGER, input_tokens INTEGER,
      output_tokens INTEGER, cost_usd REAL, routing_source TEXT NOT NULL,
      revise_rounds INTEGER NOT NULL DEFAULT 0, final_review TEXT,
      deliverables_declared_at INTEGER, created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS lane_outcome_report_receipts (
      report_id TEXT NOT NULL PRIMARY KEY, run_id TEXT NOT NULL,
      kind TEXT NOT NULL, applied_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS lane_outcome_held_reports (
      report_id TEXT NOT NULL PRIMARY KEY, run_id TEXT NOT NULL,
      kind TEXT NOT NULL, payload TEXT NOT NULL,
      held_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
    );
  `);
  const connection = Object.create(
    SqliteConnectionService.prototype,
  ) as SqliteConnectionService;
  Object.defineProperty(connection, 'db', { value: db });
  Object.defineProperty(connection, 'isOpen', { value: true });
  const logger = testLogger();
  return { db, store: new SqliteLaneOutcomeStore(connection, logger), logger };
}

describe('SqliteLaneOutcomeStore', () => {
  it('skips invalid rows in lane and role reads with one warning per read', async () => {
    const { db, store, logger } = fixture();
    try {
      const row = {
        ...outcomeRow('subagent:valid'),
        role: 'backend-developer',
      };
      await store.insertIfAbsent(row);
      db.prepare(
        'UPDATE lane_outcome_records SET verdict = ? WHERE run_id = ?',
      ).run('unknown-verdict', row.runId);
      await store.insertIfAbsent({
        ...outcomeRow('subagent:good'),
        role: 'backend-developer',
      });
      expect(
        (await store.listByLane('subagent', 0)).map((item) => item.runId),
      ).toEqual(['subagent:good']);
      expect(
        (await store.listByRoles(['backend-developer'], 0)).map(
          (item) => item.runId,
        ),
      ).toEqual(['subagent:good']);
      expect(logger.warn).toHaveBeenCalledTimes(2);
      expect(logger.warn).toHaveBeenCalledWith('Lane outcome rows skipped', {
        count: 1,
        code: 'ZOD_VALIDATION',
      });
    } finally {
      db.close();
    }
  });
  it('keeps a concurrent patch and revise receipt', async () => {
    const { db, store } = fixture();
    try {
      await store.insertIfAbsent(outcomeRow('subagent:atomic'));
      const report = {
        ...heldReport(301, Date.now()),
        runId: 'subagent:atomic',
        kind: 'review' as const,
        payload: '{"verdict":"revise"}',
      };
      await Promise.all([
        store.update('subagent:atomic', { failureClass: 'crash' }),
        store.applyReportWithReceipt(report, Date.now(), reportEffectOf),
      ]);
      expect(await store.get('subagent:atomic')).toMatchObject({
        failureClass: 'crash',
        reviseRounds: 1,
      });
      expect(await store.hasReceipt(report.reportId)).toBe(true);
    } finally {
      db.close();
    }
  });

  it('preserves failed lane verdict when deliverables arrive', async () => {
    const { db, store } = fixture();
    try {
      await store.insertIfAbsent({
        ...outcomeRow('lane:failed'),
        executorKind: 'cli',
        laneId: 'lane',
        verdict: 'failed',
        failureClass: 'crash',
      });
      const report = { ...heldReport(302, Date.now()), runId: 'lane:failed' };
      expect(
        await store.applyReportWithReceipt(report, Date.now(), reportEffectOf),
      ).toBe('applied');
      expect(await store.get('lane:failed')).toMatchObject({
        verdict: 'failed',
        failureClass: 'crash',
      });
      expect(await store.hasReceipt(report.reportId)).toBe(true);
    } finally {
      db.close();
    }
  });
  it('round-trips subagent session identifiers', async () => {
    const { db, store } = fixture();
    try {
      const row = {
        ...outcomeRow('subagent:session'),
        subagentSessionId: 'session',
        parentSessionId: 'parent',
        workspaceRoot: '/workspace',
      };
      await store.insertIfAbsent(row);
      expect(await store.get(row.runId)).toMatchObject({
        subagentSessionId: 'session',
        parentSessionId: 'parent',
        workspaceRoot: '/workspace',
      });
    } finally {
      db.close();
    }
  });
  it('joins in held order with receipts and replay no-op', async () => {
    const { db, store } = fixture();
    try {
      const now = Date.now();
      await store.holdReport({
        ...heldReport(2, now),
        kind: 'review',
        payload: '{"verdict":"revise"}',
        heldAt: now,
      });
      await store.holdReport(heldReport(1, now));
      await store.holdReport({
        ...heldReport(3, now),
        heldAt: now + 1,
        payload: '{',
      });
      const first = await store.insertStopWithHeldReports(
        { ...outcomeRow('subagent:a'), startedAt: now - 2000 },
        now,
        reportEffectOf,
      );
      expect(first.joined.map((r) => r.reportId)).toEqual([
        'report-1',
        'report-2',
      ]);
      expect(first.invalid.map((r) => r.reportId)).toEqual(['report-3']);
      expect(await store.get('subagent:a')).toMatchObject({
        verdict: 'delivered',
        reviseRounds: 1,
      });
      expect(await store.hasReceipt('report-1')).toBe(true);
      expect(await store.hasReceipt('report-2')).toBe(true);
      expect(
        (
          await store.insertStopWithHeldReports(
            outcomeRow('subagent:a'),
            now,
            reportEffectOf,
          )
        ).joined,
      ).toEqual([]);
      expect((await store.get('subagent:a'))?.reviseRounds).toBe(1);
    } finally {
      db.close();
    }
  });

  it('rolls back insert and held walk when resolver throws midway', async () => {
    const { db, store } = fixture();
    try {
      const now = Date.now();
      await store.holdReport(heldReport(1, now));
      await store.holdReport(heldReport(2, now));
      let calls = 0;
      await expect(
        store.insertStopWithHeldReports(
          outcomeRow('subagent:a'),
          now,
          (row, report) => {
            if (++calls === 2) throw new Error('fault');
            return reportEffectOf(row, report);
          },
        ),
      ).rejects.toThrow('fault');
      expect(await store.get('subagent:a')).toBeNull();
      expect(await store.listHeldReports(now)).toHaveLength(2);
      expect(await store.hasReceipt('report-1')).toBe(false);
    } finally {
      db.close();
    }
  });

  it('returns missing, invalid and duplicate without writes; revise once', async () => {
    const { db, store } = fixture();
    try {
      const now = Date.now();
      const review = {
        ...heldReport(3, now),
        kind: 'review' as const,
        payload: '{"verdict":"revise"}',
      };
      expect(
        await store.applyReportWithReceipt(review, now, reportEffectOf),
      ).toBe('missing');
      await store.insertIfAbsent(outcomeRow('subagent:a'));
      expect(
        await store.applyReportWithReceipt(
          { ...review, payload: '{' },
          now,
          reportEffectOf,
        ),
      ).toBe('invalid');
      expect(await store.hasReceipt('report-3')).toBe(false);
      expect(
        await store.applyReportWithReceipt(review, now, reportEffectOf),
      ).toBe('applied');
      expect(
        await store.applyReportWithReceipt(review, now, reportEffectOf),
      ).toBe('duplicate');
      expect((await store.get('subagent:a'))?.reviseRounds).toBe(1);
    } finally {
      db.close();
    }
  });

  it('applies budget marker before insert and flag after insert, excluding markers', async () => {
    const { db, store } = fixture();
    try {
      const now = Date.now();
      expect(await store.markBudgetStopped('subagent:a', now)).toBe('held');
      expect(await store.markBudgetStopped('subagent:a', now)).toBe(
        'duplicate',
      );
      expect(await store.countHeldReports(now)).toBe(0);
      expect(await store.hasHeldDeliverables('subagent:a', now)).toBe(false);
      expect(await store.listHeldReports(now)).toEqual([]);
      expect(
        (
          await store.insertStopWithHeldReports(
            outcomeRow('subagent:a'),
            now,
            reportEffectOf,
          )
        ).budgetStopped,
      ).toBe(true);
      expect((await store.get('subagent:a'))?.budgetStopped).toBe(true);
      await store.insertIfAbsent(outcomeRow('b'));
      expect(await store.markBudgetStopped('b', now)).toBe('applied');
      expect((await store.get('b'))?.budgetStopped).toBe(true);
    } finally {
      db.close();
    }
  });

  it('lists non-destructively, expires reports with markers and keeps 497 plus one', async () => {
    const { db, store } = fixture();
    try {
      const now = Date.now();
      for (let i = 0; i < 500; i++)
        await store.holdReport(heldReport(i, now, i < 3));
      expect(await store.countHeldReports(now)).toBe(497);
      await store.holdReport(heldReport(500, now));
      expect(await store.countHeldReports(now)).toBe(498);
      expect(
        (await store.listHeldReports(now)).some(
          (r) => r.reportId === 'report-0',
        ),
      ).toBe(false);
      expect(await store.listHeldReports(now)).toHaveLength(498);
      expect(await store.listHeldReports(now)).toHaveLength(498);
      await store.markBudgetStopped('marker', now);
      const expired = await store.expireHeldReports(now + 86_400_001);
      expect(expired).toHaveLength(499);
      expect(expired.some((r) => r.kind === 'budget-stop')).toBe(true);
    } finally {
      db.close();
    }
  });

  it('reopens a file with held reports and a budget marker', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lane-outcome-'));
    const file = join(dir, 'outcomes.sqlite');
    try {
      const now = Date.now();
      const first = fixture(file);
      await first.store.holdReport(heldReport(1, now));
      await first.store.markBudgetStopped('subagent:a', now);
      first.db.close();
      const reopened = fixture(file);
      try {
        expect(await reopened.store.listHeldReports(now)).toHaveLength(1);
        expect(
          (
            await reopened.store.insertStopWithHeldReports(
              outcomeRow('subagent:a'),
              now,
              reportEffectOf,
            )
          ).budgetStopped,
        ).toBe(true);
        expect(await reopened.store.hasReceipt('report-1')).toBe(true);
      } finally {
        reopened.db.close();
      }
      expect(existsSync(file)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
