/**
 * Migration 0036 — the empirical-gate measurement columns for TASK_2026_180's
 * phase 3.
 *
 * ONE ASSERTION IS THE POINT OF THIS FILE, and it is not "the columns exist".
 * A `NULL` `replay_confidence` must read back as NULL, distinguishable from a
 * genuine measured `0`. A replay that aligned with nothing scores zero and is
 * evidence AGAINST promotion; a replay that never ran has no score and must
 * leave the candidate retry-eligible. A spec that only checked the column
 * exists would pass against a `NOT NULL DEFAULT 0` definition that destroys the
 * distinction silently — which is precisely how `judge_score` used to fail
 * before `0033`.
 *
 * The same test runs in both directions on purpose: it asserts NULL stays NULL
 * *and* that a stored 0 stays 0. Either assertion alone passes against a
 * degenerate reader (one that returns NULL for everything, or 0 for
 * everything); only the pair pins the distinction.
 *
 * `registerCandidate`'s fixed fourteen-column INSERT must still succeed
 * UNCHANGED. It is reproduced verbatim below rather than imported, because
 * `persistence-sqlite` is a foundation lib and must not depend on
 * `skill-synthesis`. Copying the statement is the point: if the store's INSERT
 * and this migration ever disagree, this test is where it surfaces.
 *
 * The behavioural half applies EVERY bundled migration up to 35 first, so the
 * acceptance condition ("0036 applies at version 35") is proved against the
 * real schema lineage rather than a hand-picked subset. `vecSql` and `run`
 * migrations are skipped — that is exactly the vec-less path the runner takes.
 *
 * Those assertions need a working SQLite binding, and `better-sqlite3` in this
 * repo is rebuilt against Electron's ABI by postinstall, so it cannot load in
 * the Jest/Node runner on a normal dev machine. Rather than let the whole
 * behavioural half sit permanently skipped, the opener falls back to Node's
 * built-in `node:sqlite` — the same engine behind a different binding, exactly
 * as `0032`/`0033`/`0035` do. Only if BOTH are unavailable do the behavioural
 * tests skip.
 */
import 'reflect-metadata';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { sql as sql0036SkillEmpiricalGates } from './0036_skill_empirical_gates';
import { MIGRATIONS } from './index';

/**
 * The seven columns 0036 adds, with the affinity plan §2.3 specifies.
 * Ordered as the DDL orders them.
 */
const NEW_COLUMNS: ReadonlyArray<readonly [name: string, type: string]> = [
  ['replay_confidence', 'REAL'],
  ['replay_holdout_session_id', 'TEXT'],
  ['replay_at', 'INTEGER'],
  ['trigger_score', 'REAL'],
  ['trigger_precision', 'REAL'],
  ['trigger_recall', 'REAL'],
  ['trigger_eval_at', 'INTEGER'],
];

describe('migration 0036_skill_empirical_gates — registry entry', () => {
  it('is registered as version 36, plain sql, NOT vec-gated', () => {
    const entry = MIGRATIONS.find((m) => m.version === 36);
    expect(entry).toBeDefined();
    expect(entry?.name).toBe('0036_skill_empirical_gates');
    expect(entry?.sql).toBe(sql0036SkillEmpiricalGates);
    expect(entry?.vecSql).toBeUndefined();
    expect(entry?.requiresVec).toBeUndefined();
    expect(entry?.run).toBeUndefined();
  });

  it('is registered exactly once and follows 35 with no gap', () => {
    expect(MIGRATIONS.filter((m) => m.version === 36)).toHaveLength(1);
    expect(MIGRATIONS.map((m) => m.version)).toContain(35);
    // 0036 is no longer the tail — the same task's phase 4 appended 0037. The
    // invariant that survives is "36 exists exactly once and 35 precedes it";
    // the highest version is asserted by whichever migration is currently last
    // (0035's spec carries the identical note for the same reason).
    expect(MIGRATIONS.map((m) => m.version)).toContain(37);
  });
});

describe('migration 0036_skill_empirical_gates — static SQL', () => {
  it('carries no template interpolation', () => {
    // The ESLint and Semgrep rules target the SOURCE; this asserts the shipped
    // string, which is what actually reaches the database.
    expect(sql0036SkillEmpiricalGates).not.toContain('${');
  });

  it('adds exactly the seven columns, all onto skill_candidates', () => {
    const statements = Array.from(
      sql0036SkillEmpiricalGates.matchAll(
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
    // INSERT on every existing install; a `NOT NULL … DEFAULT 0` fabricates a
    // measurement nobody took and makes "not measured" indistinguishable from
    // "measured zero". The 0–1 ranges are enforced at the store's write edge
    // instead, because SQLite cannot widen or drop a CHECK — see the header.
    const alters = sql0036SkillEmpiricalGates
      .split('\n')
      .filter((line) => line.startsWith('ALTER TABLE'));
    expect(alters).toHaveLength(NEW_COLUMNS.length);
    for (const line of alters) {
      expect(line).not.toMatch(/NOT NULL/i);
      expect(line).not.toMatch(/DEFAULT/i);
      expect(line).not.toMatch(/CHECK/i);
    }
  });

  it('does NOT re-add judge_panel_rationales, which shipped in 0033', () => {
    // Phase 3 only starts WRITING that column. Re-adding it here would fail
    // with "duplicate column name" the first time this migration ran on a real
    // database — a break that no unit test touching only 0036 would catch.
    expect(sql0036SkillEmpiricalGates).not.toContain('judge_panel_rationales');
  });

  it('creates no index', () => {
    // Nothing queries on these columns; the weekly drain reaches a candidate by
    // id and the promotion sweep narrows through idx_skill_candidates_judge.
    expect(sql0036SkillEmpiricalGates).not.toMatch(/CREATE\s+INDEX/i);
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-migr0036-test-'));
  return path.join(dir, 'ptah.db');
}

/**
 * `registerCandidate`'s statement, character-for-character as
 * `skill-candidate.store.ts:130-137` writes it. Fourteen named columns, three
 * of them literal. If 0036 ever forces this to change, that is a breaking
 * schema change and this spec is the tripwire.
 */
const REGISTER_CANDIDATE_INSERT = `INSERT INTO skill_candidates (
         id, name, description, body_path, source_session_ids,
         trajectory_hash, embedding_rowid, status,
         success_count, failure_count, created_at,
         promoted_at, rejected_at, rejected_reason
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'candidate', 0, 0, ?, NULL, NULL, NULL)`;

describe('migration 0036_skill_empirical_gates — behaviour (skipped without any SQLite binding)', () => {
  const opener = resolveOpener();
  const maybe = opener ? it : it.skip;

  /**
   * Brings a fresh database all the way to version 35 the way the runner does
   * on a machine without sqlite-vec: every bundled migration in ascending
   * order, applying only the base `sql` and skipping `vecSql`-only and `run`
   * migrations.
   */
  function openAtVersion35(): DatabaseShape {
    const db = (opener as DbOpener)(makeTempDbPath());
    db.exec('PRAGMA foreign_keys = ON');
    for (const migration of [...MIGRATIONS]
      .filter((m) => m.version <= 35)
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

  maybe('applies cleanly onto a database already at version 35', () => {
    const db = openAtVersion35();
    try {
      // Proves the acceptance condition directly, and is also what catches a
      // re-added `judge_panel_rationales`: 0033 already put it on this table,
      // so a duplicate ADD COLUMN throws right here.
      expect(() => db.exec(sql0036SkillEmpiricalGates)).not.toThrow();
    } finally {
      db.close();
    }
  });

  maybe('adds all seven columns, every one nullable with no default', () => {
    const db = openAtVersion35();
    try {
      db.exec(sql0036SkillEmpiricalGates);
      const byName = columns(db);
      for (const [name, type] of NEW_COLUMNS) {
        const col = byName.get(name);
        expect(col).toBeDefined();
        expect(col?.type).toBe(type);
        // notnull 0 + no default is what keeps the fourteen-column INSERT valid
        // AND what keeps "not measured" representable.
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
      const db = openAtVersion35();
      try {
        db.exec(sql0036SkillEmpiricalGates);
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
    'keeps a NULL replay_confidence distinguishable from a measured 0',
    () => {
      const db = openAtVersion35();
      try {
        db.exec(sql0036SkillEmpiricalGates);
        const insert = db.prepare(REGISTER_CANDIDATE_INSERT);
        insert.run(
          'unmeasured',
          'n-u',
          'd',
          '/tmp/SKILL.md',
          '[]',
          'h-u',
          null,
          1,
        );
        insert.run('zero', 'n-z', 'd', '/tmp/SKILL.md', '[]', 'h-z', null, 1);

        // Only the second candidate is replayed, and it aligned with nothing.
        db.prepare(
          `UPDATE skill_candidates
              SET replay_confidence = ?, replay_holdout_session_id = ?, replay_at = ?
            WHERE id = ?`,
        ).run(0, 'sess-held-out', 1_770_000_000_000, 'zero');

        const read = (id: string): Record<string, unknown> =>
          db
            .prepare(
              `SELECT replay_confidence, replay_holdout_session_id, replay_at
                 FROM skill_candidates WHERE id = ?`,
            )
            .get(id) as Record<string, unknown>;

        // THE assertion this batch exists for, stated in BOTH directions. A
        // reader that returns null for everything fails the second pair; a
        // reader that coalesces null to 0 fails the first.
        expect(read('unmeasured')['replay_confidence']).toBeNull();
        expect(read('unmeasured')['replay_confidence']).not.toBe(0);
        expect(read('zero')['replay_confidence']).toBe(0);
        expect(read('zero')['replay_confidence']).not.toBeNull();

        // The companion columns follow the same rule: an unmeasured candidate
        // has no hold-out session and no timestamp, not empty-string and not 0.
        expect(read('unmeasured')['replay_holdout_session_id']).toBeNull();
        expect(read('unmeasured')['replay_at']).toBeNull();
        expect(read('zero')['replay_holdout_session_id']).toBe('sess-held-out');
        expect(read('zero')['replay_at']).toBe(1_770_000_000_000);

        // And SQL can tell them apart, which is what the promotion sweep needs:
        // `replay_confidence < 0.5` must NOT sweep up the unmeasured row.
        const unmeasured = db
          .prepare(
            'SELECT COUNT(*) AS n FROM skill_candidates WHERE replay_confidence IS NULL',
          )
          .get() as { n: number };
        expect(unmeasured.n).toBe(1);
        const belowThreshold = db
          .prepare(
            'SELECT COUNT(*) AS n FROM skill_candidates WHERE replay_confidence < 0.5',
          )
          .get() as { n: number };
        expect(belowThreshold.n).toBe(1);
      } finally {
        db.close();
      }
    },
  );

  maybe(
    'keeps NULL trigger metrics distinguishable from measured zeros',
    () => {
      const db = openAtVersion35();
      try {
        db.exec(sql0036SkillEmpiricalGates);
        const insert = db.prepare(REGISTER_CANDIDATE_INSERT);
        insert.run(
          't-none',
          'n-tn',
          'd',
          '/tmp/SKILL.md',
          '[]',
          'h-tn',
          null,
          1,
        );
        insert.run(
          't-zero',
          'n-tz',
          'd',
          '/tmp/SKILL.md',
          '[]',
          'h-tz',
          null,
          1,
        );

        // A skill whose description retrieves nothing scores a genuine 0 on all
        // three — that is a measurement, and it is not the same as "never ran".
        db.prepare(
          `UPDATE skill_candidates
              SET trigger_score = ?, trigger_precision = ?, trigger_recall = ?,
                  trigger_eval_at = ?
            WHERE id = ?`,
        ).run(0, 0, 0, 1_770_000_000_001, 't-zero');

        const read = (id: string): Record<string, unknown> =>
          db
            .prepare('SELECT * FROM skill_candidates WHERE id = ?')
            .get(id) as Record<string, unknown>;

        for (const col of [
          'trigger_score',
          'trigger_precision',
          'trigger_recall',
          'trigger_eval_at',
        ]) {
          expect(read('t-none')[col]).toBeNull();
          expect(read('t-none')[col]).not.toBe(0);
        }
        expect(read('t-zero')['trigger_score']).toBe(0);
        expect(read('t-zero')['trigger_precision']).toBe(0);
        expect(read('t-zero')['trigger_recall']).toBe(0);
        expect(read('t-zero')['trigger_eval_at']).toBe(1_770_000_000_001);
      } finally {
        db.close();
      }
    },
  );

  maybe('round-trips a full replay + trigger-eval measurement', () => {
    const db = openAtVersion35();
    try {
      db.exec(sql0036SkillEmpiricalGates);
      db.prepare(REGISTER_CANDIDATE_INSERT).run(
        'g1',
        'n-g',
        'd',
        '/tmp/SKILL.md',
        '[]',
        'h-g',
        null,
        1,
      );
      db.prepare(
        `UPDATE skill_candidates SET
            replay_confidence = ?, replay_holdout_session_id = ?, replay_at = ?,
            trigger_score = ?, trigger_precision = ?, trigger_recall = ?,
            trigger_eval_at = ?
          WHERE id = ?`,
      ).run(
        0.82,
        'sess-9f3a',
        1_770_000_000_000,
        0.75,
        0.8,
        0.7,
        1_770_000_060_000,
        'g1',
      );

      const row = db
        .prepare('SELECT * FROM skill_candidates WHERE id = ?')
        .get('g1') as Record<string, unknown>;
      expect(row['replay_confidence']).toBeCloseTo(0.82);
      expect(row['replay_holdout_session_id']).toBe('sess-9f3a');
      expect(row['replay_at']).toBe(1_770_000_000_000);
      expect(row['trigger_score']).toBeCloseTo(0.75);
      expect(row['trigger_precision']).toBeCloseTo(0.8);
      expect(row['trigger_recall']).toBeCloseTo(0.7);
      expect(row['trigger_eval_at']).toBe(1_770_000_060_000);

      // The 0033 judge columns are untouched by a 0036 write — the two gates
      // are independent axes and neither clobbers the other.
      expect(row['judge_score']).toBeNull();
      expect(row['judge_panel_rationales']).toBeNull();
    } finally {
      db.close();
    }
  });
});
