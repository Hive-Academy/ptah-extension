/**
 * Migration 0032 — the queue schema for TASK_2026_180's skill-synthesis drain.
 *
 * The load-bearing assertions here are the two `CHECK` enum sets. SQLite has no
 * way to widen a CHECK constraint: adding a twelfth stage or an eighth status
 * later means rebuilding `skill_synthesis_queue` on every shipped database. So
 * `0032` enumerates every member all five phases will ever need, and this file
 * pins both sets member-for-member so a well-meaning trim of the "unused" ones
 * fails here instead of on a user's disk two phases from now.
 *
 * Those enum assertions are made TWICE, on purpose:
 *
 *  1. Against the static SQL text. This always runs, everywhere.
 *  2. Against a real database — insert every member, and prove a non-member is
 *     rejected. This is the assertion that proves the CHECK is actually wired,
 *     not merely typed.
 *
 * (2) needs a working SQLite binding, and `better-sqlite3` in this repo is
 * rebuilt against Electron's ABI by postinstall, so it cannot load in the
 * Jest/Node runner on a normal dev machine (the same reason every other
 * migration spec here carries a native probe and skips). Rather than let the
 * one assertion that R9 exists for be permanently skipped, the opener falls
 * back to Node's built-in `node:sqlite`, which is the same SQLite engine with a
 * different binding. Only if BOTH are unavailable do the behavioural tests skip.
 */
import 'reflect-metadata';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { sql as sql0032SkillSynthesisQueue } from './0032_skill_synthesis_queue';
import { MIGRATIONS } from './index';

/** Every stage member `0032` must accept. Phase 0 exercises only some of them. */
const ALL_STAGES = [
  'prefilter',
  'archaeology',
  'synthesis',
  'embedding',
  'clustering',
  'cluster-synthesis',
  'judge',
  'judge-panel',
  'replay',
  'trigger-eval',
  'digest',
] as const;

/** Every status member `0032` must accept. */
const ALL_STATUSES = [
  'queued',
  'claimed',
  'running',
  'done',
  'failed',
  'unscored',
  'skipped',
] as const;

describe('migration 0032_skill_synthesis_queue — registry entry', () => {
  it('is registered as version 32, plain sql, NOT vec-gated', () => {
    const entry = MIGRATIONS.find((m) => m.version === 32);
    expect(entry).toBeDefined();
    expect(entry?.name).toBe('0032_skill_synthesis_queue');
    expect(entry?.sql).toBe(sql0032SkillSynthesisQueue);
    expect(entry?.vecSql).toBeUndefined();
    expect(entry?.requiresVec).toBeUndefined();
    expect(entry?.run).toBeUndefined();
  });

  it('is registered exactly once, appended after 31, and is the tail', () => {
    expect(MIGRATIONS.filter((m) => m.version === 32)).toHaveLength(1);
    expect(MIGRATIONS.map((m) => m.version)).toContain(31);
    expect(Math.max(...MIGRATIONS.map((m) => m.version))).toBe(32);
  });
});

describe('migration 0032_skill_synthesis_queue — static SQL', () => {
  it('carries no template interpolation', () => {
    // The ESLint and Semgrep rules target the SOURCE; this asserts the shipped
    // string, which is what actually reaches the database.
    expect(sql0032SkillSynthesisQueue).not.toContain('${');
  });

  /**
   * Pulls the quoted members out of `CHECK (<column> IN ( ... ))`.
   *
   * String concatenation rather than a template literal: the migrations
   * directory bans `${...}` inside template literals outright (ESLint
   * no-restricted-syntax / Semgrep sql-injection-in-migration), and the ban is
   * a blunt syntactic one that does not care that this string is a regex.
   */
  function checkMembers(column: string): string[] {
    const match = new RegExp(
      'CHECK \\(' + column + ' IN \\(([^)]*)\\)\\)',
      'i',
    ).exec(sql0032SkillSynthesisQueue);
    expect(match).not.toBeNull();
    return Array.from((match as RegExpExecArray)[1].matchAll(/'([^']*)'/g)).map(
      (m) => m[1],
    );
  }

  it('enumerates exactly the eleven stages, with no duplicates', () => {
    const members = checkMembers('stage');
    expect(members).toHaveLength(ALL_STAGES.length);
    expect(new Set(members).size).toBe(ALL_STAGES.length);
    expect([...members].sort()).toEqual([...ALL_STAGES].sort());
  });

  it('enumerates exactly the seven statuses, with no duplicates', () => {
    const members = checkMembers('status');
    expect(members).toHaveLength(ALL_STATUSES.length);
    expect(new Set(members).size).toBe(ALL_STATUSES.length);
    expect([...members].sort()).toEqual([...ALL_STATUSES].sort());
  });
});

// ── Behavioural half ────────────────────────────────────────────────────────

interface DatabaseShape {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
  };
  close(): void;
}

type DbOpener = (file: string) => DatabaseShape;

function resolveOpener(): DbOpener | null {
  try {
    const Database = require('better-sqlite3') as new (
      file: string,
    ) => DatabaseShape;
    const probe = new Database(':memory:');
    probe.close();
    return (file) => new Database(file);
  } catch {
    // Falls through to the built-in binding.
  }
  try {
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (file: string) => DatabaseShape;
    };
    const probe = new DatabaseSync(':memory:');
    probe.close();
    return (file) => new DatabaseSync(file);
  } catch {
    return null;
  }
}

function makeTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-migr0032-test-'));
  return path.join(dir, 'ptah.db');
}

describe('migration 0032_skill_synthesis_queue — behaviour (skipped without any SQLite binding)', () => {
  const opener = resolveOpener();
  const maybe = opener ? it : it.skip;

  function openApplied(): DatabaseShape {
    const db = (opener as DbOpener)(makeTempDbPath());
    // The real connection service runs with FKs on; `depends_on` is a
    // self-reference, so the tests must match production.
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(sql0032SkillSynthesisQueue);
    return db;
  }

  /** Inserts a queue row, defaulting every column the tests do not care about. */
  function insertRow(
    db: DatabaseShape,
    row: {
      id: string;
      sessionId: string;
      stage: string;
      status: string;
      dependsOn?: string | null;
    },
  ): void {
    db.prepare(
      `INSERT INTO skill_synthesis_queue
         (id, session_id, source, stage, depends_on, status, enqueued_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.id,
      row.sessionId,
      'sessionEnd',
      row.stage,
      row.dependsOn ?? null,
      row.status,
      1_770_000_000_000,
    );
  }

  maybe('creates all three tables', () => {
    const db = openApplied();
    try {
      const names = (
        db
          .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
          .all() as Array<{ name: string }>
      ).map((r) => r.name);
      expect(names).toEqual(
        expect.arrayContaining([
          'skill_synthesis_queue',
          'skill_synthesis_workspace_cursor',
          'skill_synthesis_budget',
        ]),
      );
    } finally {
      db.close();
    }
  });

  maybe(
    're-applying the migration is a no-op (every statement guarded)',
    () => {
      const db = openApplied();
      try {
        expect(() => db.exec(sql0032SkillSynthesisQueue)).not.toThrow();
      } finally {
        db.close();
      }
    },
  );

  maybe('accepts EVERY ONE of the eleven stage members', () => {
    const db = openApplied();
    try {
      for (const [i, stage] of ALL_STAGES.entries()) {
        expect(() =>
          insertRow(db, {
            id: 'stage-' + i,
            sessionId: 'session-' + i,
            stage,
            status: 'queued',
          }),
        ).not.toThrow();
      }
      const stored = (
        db.prepare('SELECT stage FROM skill_synthesis_queue').all() as Array<{
          stage: string;
        }>
      ).map((r) => r.stage);
      expect([...stored].sort()).toEqual([...ALL_STAGES].sort());
    } finally {
      db.close();
    }
  });

  maybe('accepts EVERY ONE of the seven status members', () => {
    const db = openApplied();
    try {
      for (const [i, status] of ALL_STATUSES.entries()) {
        expect(() =>
          insertRow(db, {
            id: 'status-' + i,
            sessionId: 'session-' + i,
            stage: 'prefilter',
            status,
          }),
        ).not.toThrow();
      }
      const stored = (
        db.prepare('SELECT status FROM skill_synthesis_queue').all() as Array<{
          status: string;
        }>
      ).map((r) => r.status);
      expect([...stored].sort()).toEqual([...ALL_STATUSES].sort());
    } finally {
      db.close();
    }
  });

  maybe('rejects a non-member stage and a non-member status', () => {
    const db = openApplied();
    try {
      expect(() =>
        insertRow(db, {
          id: 'bad-stage',
          sessionId: 's1',
          stage: 'archaeology-v2',
          status: 'queued',
        }),
      ).toThrow();
      expect(() =>
        insertRow(db, {
          id: 'bad-status',
          sessionId: 's2',
          stage: 'prefilter',
          status: 'pending',
        }),
      ).toThrow();
    } finally {
      db.close();
    }
  });

  maybe(
    'enforces UNIQUE(session_id, stage) — the idempotent-enqueue gate',
    () => {
      const db = openApplied();
      try {
        insertRow(db, {
          id: 'a',
          sessionId: 'session-1',
          stage: 'prefilter',
          status: 'queued',
        });

        // Same session, DIFFERENT stage: allowed — that is the stage DAG.
        expect(() =>
          insertRow(db, {
            id: 'b',
            sessionId: 'session-1',
            stage: 'synthesis',
            status: 'queued',
          }),
        ).not.toThrow();

        // Same session, SAME stage: the UNIQUE violation the store catches and
        // turns into a guarded re-open UPDATE. Without it, enqueue duplicates.
        let code: unknown;
        try {
          insertRow(db, {
            id: 'c',
            sessionId: 'session-1',
            stage: 'prefilter',
            status: 'queued',
          });
          throw new Error('expected a UNIQUE constraint violation');
        } catch (error: unknown) {
          code =
            error && typeof error === 'object'
              ? (error as { code?: unknown }).code
              : undefined;
        }
        // The store keys off this exact code via `isUniqueConstraintError`;
        // better-sqlite3 reports it directly, node:sqlite nests it in `errcode`.
        expect(
          code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'ERR_SQLITE_ERROR',
        ).toBe(true);
      } finally {
        db.close();
      }
    },
  );

  maybe('declares the defaults the queue store relies on', () => {
    const db = openApplied();
    try {
      insertRow(db, {
        id: 'defaults',
        sessionId: 'session-defaults',
        stage: 'prefilter',
        status: 'queued',
      });
      const row = db
        .prepare('SELECT * FROM skill_synthesis_queue WHERE id = ?')
        .get('defaults') as Record<string, unknown>;

      expect(row['workspace_root']).toBe('');
      expect(row['turn_count']).toBe(0);
      expect(row['attempt_count']).toBe(0);
      // `not_before = 0` means "eligible now"; a NULL here would silently drop
      // the row out of the drain's `not_before <= :now` predicate.
      expect(row['not_before']).toBe(0);
      expect(row['payload']).toBe('{}');
      expect(row['claimed_by']).toBeNull();
      expect(row['claimed_at']).toBeNull();
      expect(row['depends_on']).toBeNull();
      expect(row['candidate_id']).toBeNull();
    } finally {
      db.close();
    }
  });

  maybe(
    'makes depends_on a self-reference that SETs NULL, never cascades',
    () => {
      const db = openApplied();
      try {
        const fks = db
          .prepare('PRAGMA foreign_key_list(skill_synthesis_queue)')
          .all() as Array<{
          table: string;
          from: string;
          to: string;
          on_delete: string;
        }>;
        expect(fks).toHaveLength(1);
        expect(fks[0].table).toBe('skill_synthesis_queue');
        expect(fks[0].from).toBe('depends_on');
        expect(fks[0].to).toBe('id');
        expect(fks[0].on_delete).toBe('SET NULL');

        insertRow(db, {
          id: 'parent',
          sessionId: 'session-p',
          stage: 'prefilter',
          status: 'done',
        });
        insertRow(db, {
          id: 'child',
          sessionId: 'session-p',
          stage: 'synthesis',
          status: 'queued',
          dependsOn: 'parent',
        });

        db.prepare('DELETE FROM skill_synthesis_queue WHERE id = ?').run(
          'parent',
        );

        // Pruning a finished ancestor must not take pending work with it.
        const child = db
          .prepare('SELECT * FROM skill_synthesis_queue WHERE id = ?')
          .get('child') as Record<string, unknown> | undefined;
        expect(child).toBeDefined();
        expect(child?.['depends_on']).toBeNull();
      } finally {
        db.close();
      }
    },
  );

  maybe('creates the three drain indexes over the columns they serve', () => {
    const db = openApplied();
    try {
      const indexNames = (
        db.prepare('PRAGMA index_list(skill_synthesis_queue)').all() as Array<{
          name: string;
        }>
      ).map((i) => i.name);
      expect(indexNames).toEqual(
        expect.arrayContaining([
          'idx_ssq_drain',
          'idx_ssq_stale',
          'idx_ssq_session',
        ]),
      );

      const cols = (name: string): string[] =>
        (
          db.prepare('PRAGMA index_info(' + name + ')').all() as Array<{
            name: string;
          }>
        ).map((c) => c.name);

      expect(cols('idx_ssq_drain')).toEqual([
        'status',
        'not_before',
        'workspace_root',
      ]);
      expect(cols('idx_ssq_stale')).toEqual(['status', 'claimed_at']);
      expect(cols('idx_ssq_session')).toEqual(['session_id']);
    } finally {
      db.close();
    }
  });

  maybe('shapes the workspace cursor and budget tables', () => {
    const db = openApplied();
    try {
      const cursorCols = db
        .prepare('PRAGMA table_info(skill_synthesis_workspace_cursor)')
        .all() as Array<{ name: string; notnull: number; pk: number }>;
      const cursorByName = new Map(cursorCols.map((c) => [c.name, c]));
      expect(cursorByName.get('workspace_root')?.pk).toBeGreaterThan(0);
      expect(cursorByName.get('last_drained_at')?.notnull).toBe(1);

      // The budget key is a UTC 'YYYY-MM-DD' string, and every counter carries
      // a zero default so `record()` can accumulate onto a fresh day.
      const budgetCols = db
        .prepare('PRAGMA table_info(skill_synthesis_budget)')
        .all() as Array<{
        name: string;
        type: string;
        notnull: number;
        dflt_value: unknown;
        pk: number;
      }>;
      const budgetByName = new Map(budgetCols.map((c) => [c.name, c]));
      expect(budgetByName.get('day_key')?.pk).toBeGreaterThan(0);
      expect(budgetByName.get('day_key')?.type).toBe('TEXT');
      for (const name of ['input_tokens', 'output_tokens', 'cost_usd']) {
        expect(budgetByName.get(name)?.notnull).toBe(1);
        expect(budgetByName.get(name)?.dflt_value).toBe('0');
      }
      expect(budgetByName.get('updated_at')?.notnull).toBe(1);
      expect(budgetByName.get('updated_at')?.dflt_value).toBeNull();
    } finally {
      db.close();
    }
  });
});
