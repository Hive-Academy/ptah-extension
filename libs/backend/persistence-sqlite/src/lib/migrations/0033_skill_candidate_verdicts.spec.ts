/**
 * Migration 0033 — the judge verdict columns for TASK_2026_180's phase 1.
 *
 * Two things are load-bearing here and neither is "the columns exist".
 *
 *  1. `judge_score` MUST be nullable, and NULL must survive a round trip as
 *     NULL. NULL is the `unscored` verdict — phase 1 stops the judge fabricating
 *     `score: 10` on failure, so "no trustworthy score" has to be distinguishable
 *     from a real score of 0. A spec that only checks the column exists would
 *     pass against a `NOT NULL DEFAULT 0` definition that silently destroys the
 *     distinction.
 *  2. `registerCandidate`'s fixed fourteen-column INSERT must still succeed
 *     UNCHANGED. It is reproduced verbatim below rather than imported, because
 *     `persistence-sqlite` is a foundation lib and must not depend on
 *     `skill-synthesis`. Copying the statement is the point: if the store's
 *     INSERT and this migration ever disagree, this test is where it surfaces.
 *
 * The behavioural half applies EVERY bundled migration up to 32 first, so the
 * acceptance condition ("0033 applies to a DB already at version 32") is proved
 * against the real schema lineage, not a hand-picked subset. `vecSql` and `run`
 * migrations are skipped — that is exactly the vec-less path the runner takes.
 *
 * Those assertions need a working SQLite binding, and `better-sqlite3` in this
 * repo is rebuilt against Electron's ABI by postinstall, so it cannot load in
 * the Jest/Node runner on a normal dev machine. Rather than let the whole
 * behavioural half sit permanently skipped, the opener falls back to Node's
 * built-in `node:sqlite` — the same engine behind a different binding, exactly
 * as `0032_skill_synthesis_queue.spec.ts` does. Only if BOTH are unavailable do
 * the behavioural tests skip.
 */
import 'reflect-metadata';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { sql as sql0033SkillCandidateVerdicts } from './0033_skill_candidate_verdicts';
import { MIGRATIONS } from './index';

/**
 * The eleven columns 0033 adds, with the affinity plan §2.3 specifies.
 * Ordered as the DDL orders them.
 */
const NEW_COLUMNS: ReadonlyArray<readonly [name: string, type: string]> = [
  ['judge_score', 'REAL'],
  ['judge_status', 'TEXT'],
  ['judge_reason', 'TEXT'],
  ['judge_novelty', 'REAL'],
  ['judge_actionability', 'REAL'],
  ['judge_scope', 'REAL'],
  ['judge_generalization', 'REAL'],
  ['judge_trigger_clarity', 'REAL'],
  ['judge_panel_rationales', 'TEXT'],
  ['judged_at', 'INTEGER'],
  ['display_name', 'TEXT'],
];

describe('migration 0033_skill_candidate_verdicts — registry entry', () => {
  it('is registered as version 33, plain sql, NOT vec-gated', () => {
    const entry = MIGRATIONS.find((m) => m.version === 33);
    expect(entry).toBeDefined();
    expect(entry?.name).toBe('0033_skill_candidate_verdicts');
    expect(entry?.sql).toBe(sql0033SkillCandidateVerdicts);
    expect(entry?.vecSql).toBeUndefined();
    expect(entry?.requiresVec).toBeUndefined();
    expect(entry?.run).toBeUndefined();
  });

  it('is registered exactly once and follows 32 with no gap', () => {
    expect(MIGRATIONS.filter((m) => m.version === 33)).toHaveLength(1);
    expect(MIGRATIONS.map((m) => m.version)).toContain(32);
    // 0033 is no longer the tail — the same task's phase 2 appended 0034. The
    // invariant that survives is "33 exists exactly once and 32 precedes it";
    // the highest version is asserted by whichever migration is currently last.
    expect(MIGRATIONS.map((m) => m.version)).toContain(34);
  });
});

describe('migration 0033_skill_candidate_verdicts — static SQL', () => {
  it('carries no template interpolation', () => {
    // The ESLint and Semgrep rules target the SOURCE; this asserts the shipped
    // string, which is what actually reaches the database.
    expect(sql0033SkillCandidateVerdicts).not.toContain('${');
  });

  it('adds exactly the eleven columns, all onto skill_candidates', () => {
    const statements = Array.from(
      sql0033SkillCandidateVerdicts.matchAll(
        /ALTER TABLE (\w+) ADD COLUMN\s+(\w+)\s+(\w+)/g,
      ),
    ).map((m) => ({ table: m[1], column: m[2], type: m[3] }));

    expect(statements).toHaveLength(NEW_COLUMNS.length);
    expect(statements.map((s) => s.table)).toEqual(
      statements.map(() => 'skill_candidates'),
    );
    expect(statements.map((s) => [s.column, s.type])).toEqual(
      NEW_COLUMNS.map(([name, type]) => [name, type]),
    );
  });

  it('declares every column nullable with no default — no NOT NULL, no DEFAULT, no CHECK', () => {
    // A `NOT NULL` column without a default breaks `registerCandidate`'s fixed
    // INSERT on every existing install; a `NOT NULL … DEFAULT` fabricates a
    // verdict for candidates nobody judged. `judge_status` deliberately carries
    // no CHECK either — SQLite cannot widen one, and phases 3-4 extend the
    // vocabulary. See the migration header.
    const alters = sql0033SkillCandidateVerdicts
      .split('\n')
      .filter((line) => line.startsWith('ALTER TABLE'));
    expect(alters).toHaveLength(NEW_COLUMNS.length);
    for (const line of alters) {
      expect(line).not.toMatch(/NOT NULL/i);
      expect(line).not.toMatch(/DEFAULT/i);
      expect(line).not.toMatch(/CHECK/i);
    }
  });

  it('creates the judge index guarded by IF NOT EXISTS', () => {
    expect(sql0033SkillCandidateVerdicts).toContain(
      'CREATE INDEX IF NOT EXISTS idx_skill_candidates_judge',
    );
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-migr0033-test-'));
  return path.join(dir, 'ptah.db');
}

/**
 * `registerCandidate`'s statement, character-for-character as
 * `skill-candidate.store.ts:130-137` writes it. Fourteen named columns, three
 * of them literal. If 0033 ever forces this to change, that is a breaking
 * schema change and this spec is the tripwire.
 */
const REGISTER_CANDIDATE_INSERT = `INSERT INTO skill_candidates (
         id, name, description, body_path, source_session_ids,
         trajectory_hash, embedding_rowid, status,
         success_count, failure_count, created_at,
         promoted_at, rejected_at, rejected_reason
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'candidate', 0, 0, ?, NULL, NULL, NULL)`;

describe('migration 0033_skill_candidate_verdicts — behaviour (skipped without any SQLite binding)', () => {
  const opener = resolveOpener();
  const maybe = opener ? it : it.skip;

  /**
   * Brings a fresh database all the way to version 32 the way the runner does
   * on a machine without sqlite-vec: every bundled migration in ascending
   * order, applying only the base `sql` and skipping `vecSql`-only and `run`
   * migrations.
   */
  function openAtVersion32(): DatabaseShape {
    const db = (opener as DbOpener)(makeTempDbPath());
    db.exec('PRAGMA foreign_keys = ON');
    for (const migration of [...MIGRATIONS]
      .filter((m) => m.version <= 32)
      .sort((a, b) => a.version - b.version)) {
      if (migration.sql) {
        db.exec(migration.sql);
      }
    }
    return db;
  }

  function columns(
    db: DatabaseShape,
  ): Map<
    string,
    { name: string; type: string; notnull: number; dflt_value: unknown }
  > {
    const rows = db
      .prepare('PRAGMA table_info(skill_candidates)')
      .all() as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: unknown;
    }>;
    return new Map(rows.map((r) => [r.name, r]));
  }

  maybe('applies cleanly onto a database already at version 32', () => {
    const db = openAtVersion32();
    try {
      // Proves the acceptance condition directly: none of the eleven columns
      // collides with anything 0003 → 0032 already put on the table.
      expect(() => db.exec(sql0033SkillCandidateVerdicts)).not.toThrow();
    } finally {
      db.close();
    }
  });

  maybe('adds all eleven columns, every one nullable with no default', () => {
    const db = openAtVersion32();
    try {
      db.exec(sql0033SkillCandidateVerdicts);
      const byName = columns(db);
      for (const [name, type] of NEW_COLUMNS) {
        const col = byName.get(name);
        expect(col).toBeDefined();
        expect(col?.type).toBe(type);
        // notnull 0 + no default is what keeps the fourteen-column INSERT valid.
        expect(col?.notnull).toBe(0);
        expect(col?.dflt_value).toBeNull();
      }
    } finally {
      db.close();
    }
  });

  maybe(
    "leaves registerCandidate's fourteen-column INSERT working unchanged",
    () => {
      const db = openAtVersion32();
      try {
        db.exec(sql0033SkillCandidateVerdicts);
        expect(() =>
          db
            .prepare(REGISTER_CANDIDATE_INSERT)
            .run('c1', 'n1', 'd', '/tmp/SKILL.md', '[]', 'h1', null, 1),
        ).not.toThrow();

        const row = db
          .prepare('SELECT * FROM skill_candidates WHERE id = ?')
          .get('c1') as Record<string, unknown>;
        // Every new column is absent-but-present: readable, and NULL.
        for (const [name] of NEW_COLUMNS) {
          expect(row[name]).toBeNull();
        }
      } finally {
        db.close();
      }
    },
  );

  maybe(
    'keeps a NULL judge_score distinguishable from a real score of 0',
    () => {
      const db = openAtVersion32();
      try {
        db.exec(sql0033SkillCandidateVerdicts);
        const insert = db.prepare(REGISTER_CANDIDATE_INSERT);
        insert.run(
          'unscored',
          'n-u',
          'd',
          '/tmp/SKILL.md',
          '[]',
          'h-u',
          null,
          1,
        );
        insert.run('zero', 'n-z', 'd', '/tmp/SKILL.md', '[]', 'h-z', null, 1);

        db.prepare(
          `UPDATE skill_candidates
              SET judge_score = ?, judge_status = ?
            WHERE id = ?`,
        ).run(0, 'scored', 'zero');
        db.prepare(
          'UPDATE skill_candidates SET judge_status = ? WHERE id = ?',
        ).run('unscored', 'unscored');

        const read = (id: string): Record<string, unknown> =>
          db
            .prepare(
              'SELECT judge_score, judge_status FROM skill_candidates WHERE id = ?',
            )
            .get(id) as Record<string, unknown>;

        // THE assertion phase 1 exists for: a failed judge run reads back NULL,
        // not a fabricated score, and not the same value as a genuine zero.
        expect(read('unscored')['judge_score']).toBeNull();
        expect(read('unscored')['judge_status']).toBe('unscored');
        expect(read('zero')['judge_score']).toBe(0);
        expect(read('zero')['judge_status']).toBe('scored');

        // And SQL can tell them apart, which is what the promotion sweep needs.
        const nullCount = db
          .prepare(
            'SELECT COUNT(*) AS n FROM skill_candidates WHERE judge_score IS NULL',
          )
          .get() as { n: number };
        expect(nullCount.n).toBe(1);
      } finally {
        db.close();
      }
    },
  );

  maybe('round-trips all five per-criterion scores plus the reason', () => {
    const db = openAtVersion32();
    try {
      db.exec(sql0033SkillCandidateVerdicts);
      db.prepare(REGISTER_CANDIDATE_INSERT).run(
        'v1',
        'n-v',
        'd',
        '/tmp/SKILL.md',
        '[]',
        'h-v',
        null,
        1,
      );
      db.prepare(
        `UPDATE skill_candidates SET
            judge_score = ?, judge_status = ?, judge_reason = ?,
            judge_novelty = ?, judge_actionability = ?, judge_scope = ?,
            judge_generalization = ?, judge_trigger_clarity = ?,
            judge_panel_rationales = ?, judged_at = ?, display_name = ?
          WHERE id = ?`,
      ).run(
        7.5,
        'scored',
        'narrow but reusable',
        8,
        7,
        6.5,
        9,
        5,
        '[]',
        1_770_000_000_000,
        'Rebase A Stacked Branch',
        'v1',
      );

      const row = db
        .prepare('SELECT * FROM skill_candidates WHERE id = ?')
        .get('v1') as Record<string, unknown>;
      expect(row['judge_score']).toBe(7.5);
      expect(row['judge_status']).toBe('scored');
      expect(row['judge_reason']).toBe('narrow but reusable');
      expect(row['judge_novelty']).toBe(8);
      expect(row['judge_actionability']).toBe(7);
      expect(row['judge_scope']).toBe(6.5);
      expect(row['judge_generalization']).toBe(9);
      expect(row['judge_trigger_clarity']).toBe(5);
      expect(row['judge_panel_rationales']).toBe('[]');
      expect(row['judged_at']).toBe(1_770_000_000_000);

      // `display_name` is a SEPARATE column from `name`: the slug stays an
      // internal id (it is the SKILL.md folder name and carries a UNIQUE
      // index), the display name is what a human reads.
      expect(row['display_name']).toBe('Rebase A Stacked Branch');
      expect(row['name']).toBe('n-v');
    } finally {
      db.close();
    }
  });

  maybe(
    'creates idx_skill_candidates_judge over (status, judge_status)',
    () => {
      const db = openAtVersion32();
      try {
        db.exec(sql0033SkillCandidateVerdicts);
        const indexNames = (
          db.prepare('PRAGMA index_list(skill_candidates)').all() as Array<{
            name: string;
          }>
        ).map((i) => i.name);
        expect(indexNames).toContain('idx_skill_candidates_judge');

        const cols = (
          db
            .prepare('PRAGMA index_info(idx_skill_candidates_judge)')
            .all() as Array<{ name: string }>
        ).map((c) => c.name);
        expect(cols).toEqual(['status', 'judge_status']);
      } finally {
        db.close();
      }
    },
  );
});
