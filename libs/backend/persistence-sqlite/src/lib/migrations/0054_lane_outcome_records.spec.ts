/**
 * Migration 0054 — lane outcome records, report receipts and held reports
 * (TASK_2026_646, SC-1 / SC-7 / SC-10). Real schema lineage on isolated
 * in-memory databases; fails instead of skipping when neither SQLite binding
 * loads.
 */
import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import { sql } from './0054_lane_outcome_records';
import { MIGRATIONS } from './index';
import { SqliteMigrationRunner } from '../migration-runner';
import type { SqliteDatabase } from '../sqlite-connection.service';

interface DatabaseShape {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  close(): void;
}

type DbOpener = () => DatabaseShape;

function resolveOpener(): DbOpener | null {
  try {
    const Database = require('better-sqlite3') as new (
      file: string,
    ) => DatabaseShape;
    new Database(':memory:').close();
    return () => new Database(':memory:');
  } catch {
    // Electron's native ABI may not load in Jest; fall through to node:sqlite.
  }
  try {
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (file: string) => DatabaseShape;
    };
    new DatabaseSync(':memory:').close();
    return () => new DatabaseSync(':memory:');
  } catch {
    return null;
  }
}

const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as unknown as Logger;

/** [name, type, notnull, dflt_value, pk] per PRAGMA table_info row. */
type ColumnRow = [string, string, number, string | null, number];

function tableColumns(db: DatabaseShape, pragma: string): ColumnRow[] {
  const rows = db.prepare(pragma).all() as Array<{
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
    pk: number;
  }>;
  return rows.map((r): ColumnRow => [r.name, r.type, r.notnull, r.dflt_value, r.pk]);
}

/** The SC-1 record row, exactly as part B §2 declares it. */
const RECORD_COLUMNS: ColumnRow[] = [
  ['run_id', 'TEXT', 1, null, 1],
  ['executor_kind', 'TEXT', 1, null, 0],
  ['lane_id', 'TEXT', 1, null, 0],
  ['agent_id', 'TEXT', 1, null, 0],
  ['family', 'TEXT', 0, null, 0],
  ['provider', 'TEXT', 0, null, 0],
  ['model', 'TEXT', 1, null, 0],
  ['role', 'TEXT', 0, null, 0],
  ['task_kind', 'TEXT', 0, null, 0],
  ['task_id', 'TEXT', 0, null, 0],
  ['verdict', 'TEXT', 1, null, 0],
  ['failure_class', 'TEXT', 0, null, 0],
  ['budget_stopped', 'INTEGER', 1, '0', 0],
  ['started_at', 'INTEGER', 0, null, 0],
  ['ended_at', 'INTEGER', 1, null, 0],
  ['duration_ms', 'INTEGER', 0, null, 0],
  ['input_tokens', 'INTEGER', 0, null, 0],
  ['output_tokens', 'INTEGER', 0, null, 0],
  ['cost_usd', 'REAL', 0, null, 0],
  ['routing_source', 'TEXT', 1, "'not-routed'", 0],
  ['revise_rounds', 'INTEGER', 1, '0', 0],
  ['final_review', 'TEXT', 0, null, 0],
  ['deliverables_declared_at', 'INTEGER', 0, null, 0],
  ['subagent_session_id', 'TEXT', 0, null, 0],
  ['parent_session_id', 'TEXT', 0, null, 0],
  ['workspace_root', 'TEXT', 0, null, 0],
  ['created_at', 'INTEGER', 1, null, 0],
  ['updated_at', 'INTEGER', 1, null, 0],
];

/** The SC-10 receipt key, exactly as the plan's key table declares it. */
const RECEIPT_COLUMNS: ColumnRow[] = [
  ['report_id', 'TEXT', 1, null, 1],
  ['run_id', 'TEXT', 1, null, 0],
  ['kind', 'TEXT', 1, null, 0],
  ['applied_at', 'INTEGER', 1, null, 0],
];

/** The SC-7 report hold, exactly as the plan's report-hold section declares it. */
const HELD_COLUMNS: ColumnRow[] = [
  ['report_id', 'TEXT', 1, null, 1],
  ['run_id', 'TEXT', 1, null, 0],
  ['kind', 'TEXT', 1, null, 0],
  ['payload', 'TEXT', 1, null, 0],
  ['held_at', 'INTEGER', 1, null, 0],
  ['expires_at', 'INTEGER', 1, null, 0],
];

describe('migration 0054_lane_outcome_records — registry and static SQL', () => {
  it('is registered once as version 54, plain static SQL', () => {
    expect(MIGRATIONS.filter((m) => m.version === 54)).toEqual([
      { version: 54, name: '0054_lane_outcome_records', sql },
    ]);
    expect(sql).not.toContain('${');
    expect(sql).not.toMatch(/\b(DELETE|UPDATE|INSERT|DROP TABLE)\b/i);
  });

  it('keeps the bundled-version ratchet current', () => {
    expect(Math.max(...MIGRATIONS.map((m) => m.version))).toBe(61);
  });
});

describe('migration 0054_lane_outcome_records — behaviour', () => {
  const opener = resolveOpener();

  it('has a SQLite binding to run against (fails instead of skipping)', () => {
    expect(opener).not.toBeNull();
  });

  function openAtVersion53(): DatabaseShape {
    if (!opener) throw new Error('No SQLite binding loaded');
    const db = opener();
    for (const migration of MIGRATIONS.filter((m) => m.version < 54)) {
      if (migration.sql) db.exec(migration.sql);
    }
    const insertApplied = db.prepare(
      'INSERT INTO schema_migrations (version, applied_at) VALUES (?, 0)',
    );
    for (const m of MIGRATIONS.filter((x) => x.version < 54)) {
      insertApplied.run(m.version);
    }
    return db;
  }

  it('applies through the runner on an existing database without touching its data', async () => {
    const db = openAtVersion53();
    try {
      db.prepare(
        `INSERT INTO skill_invocation_events
           (id, skill_slug, session_id, source, succeeded, is_error, invoked_at)
         VALUES ('e1', 'deep-research', 's1', 'tool-use', 1, 0, 1000)`,
      ).run();

      const result = await new SqliteMigrationRunner(
        db as unknown as SqliteDatabase,
        logger,
      ).applyAll(MIGRATIONS.filter((m) => m.version <= 54));
      expect(result.appliedVersions).toEqual([54]);

      expect(
        db.prepare('SELECT COUNT(*) AS n FROM skill_invocation_events').get(),
      ).toEqual({ n: 1 });
      expect(
        db.prepare('SELECT COUNT(*) AS n FROM lane_outcome_records').get(),
      ).toEqual({ n: 0 });
      expect(
        db
          .prepare('SELECT COUNT(*) AS n FROM lane_outcome_report_receipts')
          .get(),
      ).toEqual({ n: 0 });
      expect(
        db.prepare('SELECT COUNT(*) AS n FROM lane_outcome_held_reports').get(),
      ).toEqual({ n: 0 });
    } finally {
      db.close();
    }
  });

  it('declares the plan column sets exactly', () => {
    const db = openAtVersion53();
    try {
      db.exec(sql);
      expect(
        tableColumns(db, 'PRAGMA table_info(lane_outcome_records)'),
      ).toEqual(RECORD_COLUMNS);
      expect(
        tableColumns(db, 'PRAGMA table_info(lane_outcome_report_receipts)'),
      ).toEqual(RECEIPT_COLUMNS);
      expect(
        tableColumns(db, 'PRAGMA table_info(lane_outcome_held_reports)'),
      ).toEqual(HELD_COLUMNS);
    } finally {
      db.close();
    }
  });

  it('rejects a NULL primary key insert on all three tables', () => {
    const db = openAtVersion53();
    try {
      db.exec(sql);
      // A NULL TEXT PRIMARY KEY would silently defeat the SC-10 dedup, so
      // every key column is NOT NULL and SQLite rejects the insert
      // (decision TL-B4-1).
      const nullKeyInserts = [
        `INSERT INTO lane_outcome_records
           (run_id, executor_kind, lane_id, agent_id, model, verdict, ended_at,
            created_at, updated_at)
         VALUES (NULL, 'subagent', 'subagent', 'agent-1', 'm1', 'approved',
                 5000, 5000, 5000)`,
        `INSERT INTO lane_outcome_report_receipts (report_id, run_id, kind, applied_at)
         VALUES (NULL, 'subagent:a1', 'deliverables', 5000)`,
        `INSERT INTO lane_outcome_held_reports (report_id, run_id, kind, payload, held_at, expires_at)
         VALUES (NULL, 'subagent:a2', 'deliverables', '{"checks":[]}', 1000, 86401000)`,
      ] as const;
      for (const insertSql of nullKeyInserts) {
        expect(() => db.prepare(insertSql).run()).toThrow(/NOT NULL/i);
      }
    } finally {
      db.close();
    }
  });

  it('is idempotent — running twice does not throw (IF NOT EXISTS)', () => {
    const db = openAtVersion53();
    try {
      db.exec(sql);
      expect(() => db.exec(sql)).not.toThrow();
    } finally {
      db.close();
    }
  });

  it('writes rows with the plan defaults and enforces the receipt keys', () => {
    const db = openAtVersion53();
    try {
      db.exec(sql);
      db.prepare(
        `INSERT INTO lane_outcome_records
           (run_id, executor_kind, lane_id, agent_id, model, verdict, ended_at,
            created_at, updated_at)
         VALUES ('subagent:a1', 'subagent', 'subagent', 'agent-1', 'm1',
                 'approved', 5000, 5000, 5000)`,
      ).run();
      expect(
        db
          .prepare(
            'SELECT budget_stopped, routing_source, revise_rounds, deliverables_declared_at FROM lane_outcome_records WHERE run_id = ?',
          )
          .get('subagent:a1'),
      ).toEqual({
        budget_stopped: 0,
        routing_source: 'not-routed',
        revise_rounds: 0,
        deliverables_declared_at: null,
      });

      db.prepare(
        `INSERT INTO lane_outcome_report_receipts (report_id, run_id, kind, applied_at)
         VALUES ('r1', 'subagent:a1', 'deliverables', 5000)`,
      ).run();
      // The receipt primary key is what makes a replayed report a no-op.
      expect(() =>
        db
          .prepare(
            `INSERT INTO lane_outcome_report_receipts (report_id, run_id, kind, applied_at)
             VALUES ('r1', 'subagent:a1', 'review', 5001)`,
          )
          .run(),
      ).toThrow(/UNIQUE/i);

      db.prepare(
        `INSERT INTO lane_outcome_held_reports (report_id, run_id, kind, payload, held_at, expires_at)
         VALUES ('r2', 'subagent:a2', 'deliverables', '{"checks":[]}', 1000, 86401000)`,
      ).run();
      expect(
        db
          .prepare('SELECT run_id, kind, payload FROM lane_outcome_held_reports')
          .all(),
      ).toEqual([
        { run_id: 'subagent:a2', kind: 'deliverables', payload: '{"checks":[]}' },
      ]);
    } finally {
      db.close();
    }
  });

  it('serves the SC-7 / SC-10 queries from the declared indexes', () => {
    const db = openAtVersion53();
    try {
      db.exec(sql);
      // A little data, so the planner chooses among real alternatives.
      db.prepare(
        `INSERT INTO lane_outcome_records
           (run_id, executor_kind, lane_id, agent_id, model, verdict, role, ended_at,
            created_at, updated_at)
         VALUES ('subagent:a1', 'subagent', 'subagent', 'agent-1', 'm1', 'approved',
                 'backend-developer', 5000, 5000, 5000)`,
      ).run();
      db.prepare(
        `INSERT INTO lane_outcome_held_reports (report_id, run_id, kind, payload, held_at, expires_at)
         VALUES ('r2', 'subagent:a2', 'deliverables', '{"checks":[]}', 1000, 86401000)`,
      ).run();

      const planOf = (query: string, ...params: unknown[]): string =>
        (
          db
            .prepare('EXPLAIN QUERY PLAN ' + query)
            .all(...params) as Array<{ detail: string }>
        )
          .map((r) => r.detail)
          .join('|');

      // R6-1 (decision #52): the capacity count sees only unexpired holds.
      const countPlan = planOf(
        'SELECT COUNT(*) FROM lane_outcome_held_reports WHERE expires_at > ?',
        0,
      );
      expect(countPlan).toContain('idx_lane_outcome_held_reports_expires_at');
      expect(countPlan).not.toMatch(/TEMP B-TREE/);

      // The expiry sweep deletes expired holds through the same index.
      expect(
        planOf(
          'DELETE FROM lane_outcome_held_reports WHERE expires_at <= ?',
          0,
        ),
      ).toContain('idx_lane_outcome_held_reports_expires_at');

      // The stop-op join reads one run's holds by run_id.
      expect(
        planOf(
          'SELECT report_id, kind, payload FROM lane_outcome_held_reports WHERE run_id = ? ORDER BY held_at',
          'subagent:a2',
        ),
      ).toContain('idx_lane_outcome_held_reports_run_id (run_id=?)');

      // Receipts are evicted with their row, by run.
      expect(
        planOf(
          'DELETE FROM lane_outcome_report_receipts WHERE run_id = ?',
          'subagent:a1',
        ),
      ).toContain('idx_lane_outcome_report_receipts_run_id');

      // recentOutcomes / agentSignals stay single indexed queries (part B §3):
      // each (key, ended_at DESC) index serves filter and order together.
      for (const [query, index] of [
        [
          'SELECT run_id FROM lane_outcome_records WHERE lane_id = ? ORDER BY ended_at DESC LIMIT ?',
          'idx_lane_outcome_records_lane_ended',
        ],
        [
          'SELECT run_id FROM lane_outcome_records WHERE role = ? ORDER BY ended_at DESC LIMIT ?',
          'idx_lane_outcome_records_role_ended',
        ],
        [
          'SELECT run_id FROM lane_outcome_records WHERE agent_id = ? ORDER BY ended_at DESC LIMIT ?',
          'idx_lane_outcome_records_agent_ended',
        ],
      ] as const) {
        const plan = planOf(query, 'subagent', 10);
        expect(plan).toContain(index);
        expect(plan).not.toMatch(/TEMP B-TREE/);
      }
    } finally {
      db.close();
    }
  });
});