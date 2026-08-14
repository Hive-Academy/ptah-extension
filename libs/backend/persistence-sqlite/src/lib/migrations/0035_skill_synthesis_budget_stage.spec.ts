/**
 * Migration 0035 — re-keying the daily token ledger by `(day_key, stage)`.
 *
 * Four things are load-bearing here, and "the column exists" is none of them.
 *
 *  1. **The old key must actually be GONE.** An `ALTER TABLE … ADD COLUMN stage`
 *     alone compiles, passes a column-list assertion, and still rejects the
 *     second stage row of a day, because `0032`'s `day_key TEXT PRIMARY KEY` is
 *     a UNIQUE index that survives the addition. The proof is behavioural:
 *     eleven stages plus `''` all insert for ONE day key, and the twelfth
 *     repeat of a `(day, stage)` pair is rejected.
 *  2. **Pre-existing day rows survive, attributed to `''`.** The ledger is a
 *     live table on every install that has ever run a background lane; a
 *     rebuild that silently dropped yesterday's spend would reset a user's
 *     daily cap mid-day.
 *  3. **The day TOTAL is unchanged.** `SUM(input_tokens + output_tokens)` over
 *     a day must equal what `spentToday()` returned before the split, because
 *     B0.4's budget gate compares exactly that number against
 *     `skillSynthesis.budget.maxTokensPerDay`. A re-key that changed the gate's
 *     trip point would be a behaviour change wearing a schema change's clothes.
 *  4. **`stage` has no CHECK.** `SkillBudgetStore` is the enforcing gate (it
 *     narrows an unrecognised stored stage to `''` on read); a CHECK here would
 *     cost a second live-database rebuild the first time the stage vocabulary
 *     moves. Asserted from the source text so it fails even without a binding.
 *
 * The behavioural half applies EVERY bundled migration up to 34 first, so the
 * acceptance condition ("0035 applies to a DB already at version 34") is proved
 * against the real schema lineage rather than a hand-picked subset. `vecSql` and
 * `run` migrations are skipped — that is exactly the vec-less path the runner
 * takes.
 *
 * Those assertions need a working SQLite binding, and `better-sqlite3` in this
 * repo is rebuilt against Electron's ABI by postinstall, so it cannot load in
 * the Jest/Node runner on a normal dev machine. Rather than let the behavioural
 * half sit permanently skipped — green while asserting nothing — the opener
 * falls back to Node's built-in `node:sqlite`, the same engine behind a
 * different binding, exactly as `0032`, `0033` and `0034`'s specs do. Only if
 * BOTH are unavailable do the behavioural tests skip.
 */
import 'reflect-metadata';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { sql as sql0035SkillSynthesisBudgetStage } from './0035_skill_synthesis_budget_stage';
import { MIGRATIONS } from './index';

/** The six columns the re-keyed table carries, in DDL order. */
const COLUMNS: ReadonlyArray<
  readonly [name: string, type: string, notnull: 0 | 1]
> = [
  ['day_key', 'TEXT', 1],
  ['stage', 'TEXT', 1],
  ['input_tokens', 'INTEGER', 1],
  ['output_tokens', 'INTEGER', 1],
  ['cost_usd', 'REAL', 1],
  ['updated_at', 'INTEGER', 1],
];

/**
 * The eleven queue stages of `0032` plus `''`. Restated rather than imported:
 * `persistence-sqlite` is a foundation lib and must not depend on
 * `skill-synthesis`. The copy is the point — if `SkillBudgetStore` and this
 * migration ever disagree about what a stage key is, this spec is where it
 * surfaces (the same tripwire `0033` and `0034`'s specs keep on their stores).
 */
const STAGE_KEYS = [
  '',
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

describe('migration 0035_skill_synthesis_budget_stage — registry entry', () => {
  it('is registered as version 35, plain sql, NOT vec-gated', () => {
    const entry = MIGRATIONS.find((m) => m.version === 35);
    expect(entry).toBeDefined();
    expect(entry?.name).toBe('0035_skill_synthesis_budget_stage');
    expect(entry?.sql).toBe(sql0035SkillSynthesisBudgetStage);
    expect(entry?.vecSql).toBeUndefined();
    expect(entry?.requiresVec).toBeUndefined();
    expect(entry?.run).toBeUndefined();
  });

  it('is registered exactly once, appended after 34, and is the tail', () => {
    expect(MIGRATIONS.filter((m) => m.version === 35)).toHaveLength(1);
    expect(MIGRATIONS.map((m) => m.version)).toContain(34);
    expect(Math.max(...MIGRATIONS.map((m) => m.version))).toBe(35);
  });
});

describe('migration 0035_skill_synthesis_budget_stage — static SQL', () => {
  it('carries no template interpolation', () => {
    // The ESLint and Semgrep rules target the SOURCE; this asserts the shipped
    // string, which is what actually reaches the database.
    expect(sql0035SkillSynthesisBudgetStage).not.toContain('${');
  });

  it('rebuilds the table rather than trying to ALTER the primary key away', () => {
    // SQLite has no DROP CONSTRAINT. The four statements below, in this order,
    // ARE the migration; reordering any of them loses data.
    const statements = sql0035SkillSynthesisBudgetStage
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => s.split(/\s+/).slice(0, 3).join(' '));
    expect(statements).toEqual([
      'DROP TABLE IF',
      'CREATE TABLE skill_synthesis_budget_rekeyed',
      'INSERT INTO skill_synthesis_budget_rekeyed',
      'DROP TABLE skill_synthesis_budget',
      'ALTER TABLE skill_synthesis_budget_rekeyed',
    ]);
  });

  it('declares the composite primary key, not a bare day_key one', () => {
    expect(sql0035SkillSynthesisBudgetStage).toContain(
      'PRIMARY KEY (day_key, stage)',
    );
    // A leftover column-level `day_key TEXT PRIMARY KEY` would re-impose the
    // exact constraint this migration exists to remove.
    expect(sql0035SkillSynthesisBudgetStage).not.toMatch(
      /day_key\s+TEXT\s+PRIMARY KEY/,
    );
  });

  it('leaves stage unconstrained — no CHECK on it, deliberately', () => {
    // The asymmetry with `0032`'s queue `stage` is a decision (see the
    // migration header): the queue's enum is fixed, the ledger's is the eleven
    // stages plus `''` and moves with the pipeline, and SQLite cannot widen a
    // CHECK without another rebuild of a live table.
    expect(sql0035SkillSynthesisBudgetStage).not.toMatch(/CHECK/i);
  });

  it('defaults stage to the empty string so an unattributed write still lands', () => {
    const line = sql0035SkillSynthesisBudgetStage
      .split('\n')
      .find((l) => l.trim().startsWith('stage '));
    expect(line).toBeDefined();
    expect(line).toMatch(/NOT NULL/);
    expect(line).toContain("DEFAULT ''");
  });

  it('adds no index — the composite PK already leads with day_key', () => {
    expect(sql0035SkillSynthesisBudgetStage).not.toMatch(/CREATE INDEX/i);
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-migr0035-test-'));
  return path.join(dir, 'ptah.db');
}

const DAY = '2026-08-13';
const OTHER_DAY = '2026-08-12';

/** The pre-0035 ledger write — `0032`'s five-column shape, keyed by day alone. */
const LEGACY_INSERT =
  'INSERT INTO skill_synthesis_budget ' +
  '(day_key, input_tokens, output_tokens, cost_usd, updated_at) ' +
  'VALUES (?, ?, ?, ?, ?)';

/** The post-0035 write, as `SkillBudgetStore.record` issues it. */
const STAGE_INSERT =
  'INSERT INTO skill_synthesis_budget ' +
  '(day_key, stage, input_tokens, output_tokens, cost_usd, updated_at) ' +
  'VALUES (?, ?, ?, ?, ?, ?)';

describe('migration 0035_skill_synthesis_budget_stage — behaviour (skipped without any SQLite binding)', () => {
  const opener = resolveOpener();
  const maybe = opener ? it : it.skip;

  /**
   * Brings a fresh database all the way to version 34 the way the runner does
   * on a machine without sqlite-vec: every bundled migration in ascending
   * order, applying only the base `sql` and skipping `vecSql`-only and `run`
   * migrations.
   */
  function openAtVersion34(): DatabaseShape {
    const db = (opener as DbOpener)(makeTempDbPath());
    db.exec('PRAGMA foreign_keys = ON');
    for (const migration of [...MIGRATIONS]
      .filter((m) => m.version <= 34)
      .sort((a, b) => a.version - b.version)) {
      if (migration.sql) {
        db.exec(migration.sql);
      }
    }
    return db;
  }

  function openAtVersion35(): DatabaseShape {
    const db = openAtVersion34();
    db.exec(sql0035SkillSynthesisBudgetStage);
    return db;
  }

  maybe('applies cleanly onto a database already at version 34', () => {
    const db = openAtVersion34();
    try {
      expect(() => db.exec(sql0035SkillSynthesisBudgetStage)).not.toThrow();
    } finally {
      db.close();
    }
  });

  maybe(
    'leaves the six columns with the planned affinity and nullability',
    () => {
      const db = openAtVersion35();
      try {
        const rows = db
          .prepare('PRAGMA table_info(skill_synthesis_budget)')
          .all() as Array<{ name: string; type: string; notnull: number }>;
        expect(rows.map((r) => r.name)).toEqual(COLUMNS.map(([name]) => name));
        const byName = new Map(rows.map((r) => [r.name, r]));
        for (const [name, type, notnull] of COLUMNS) {
          expect(byName.get(name)?.type).toBe(type);
          expect(byName.get(name)?.notnull).toBe(notnull);
        }
      } finally {
        db.close();
      }
    },
  );

  maybe('keys on (day_key, stage), not on day_key alone', () => {
    const db = openAtVersion35();
    try {
      const pkColumns = (
        db.prepare('PRAGMA table_info(skill_synthesis_budget)').all() as Array<{
          name: string;
          pk: number;
        }>
      )
        .filter((c) => c.pk > 0)
        .sort((a, b) => a.pk - b.pk)
        .map((c) => c.name);
      expect(pkColumns).toEqual(['day_key', 'stage']);
    } finally {
      db.close();
    }
  });

  /**
   * THE assertion the rebuild exists for. Under `0032`'s key the second of
   * these throws; a bare `ADD COLUMN` would not have changed that.
   */
  maybe('accepts one row per stage for a single day', () => {
    const db = openAtVersion35();
    try {
      const insert = db.prepare(STAGE_INSERT);
      for (const stage of STAGE_KEYS) {
        expect(() => insert.run(DAY, stage, 10, 5, 0.001, 1)).not.toThrow();
      }
      const count = db
        .prepare(
          'SELECT COUNT(*) AS n FROM skill_synthesis_budget WHERE day_key = ?',
        )
        .get(DAY) as { n: number };
      expect(count.n).toBe(STAGE_KEYS.length);
    } finally {
      db.close();
    }
  });

  maybe('still rejects a duplicate (day_key, stage) pair', () => {
    // Enqueue-style accumulation stays INSERT-then-guarded-UPDATE; the store
    // depends on this violation being raised rather than silently upserted.
    const db = openAtVersion35();
    try {
      const insert = db.prepare(STAGE_INSERT);
      insert.run(DAY, 'judge', 1, 1, 0, 1);
      expect(() => insert.run(DAY, 'judge', 2, 2, 0, 2)).toThrow();
      // The same stage on a DIFFERENT day is a different row, not a duplicate.
      expect(() => insert.run(OTHER_DAY, 'judge', 3, 3, 0, 3)).not.toThrow();
    } finally {
      db.close();
    }
  });

  maybe('migrates pre-existing day rows to the unattributed stage', () => {
    const db = openAtVersion34();
    try {
      const legacy = db.prepare(LEGACY_INSERT);
      legacy.run(DAY, 1_200, 800, 0.04, 1_770_000_000_000);
      legacy.run(OTHER_DAY, 5, 0, 0.0001, 1_769_000_000_000);

      db.exec(sql0035SkillSynthesisBudgetStage);

      const rows = db
        .prepare('SELECT * FROM skill_synthesis_budget ORDER BY day_key')
        .all() as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r['day_key'])).toEqual([OTHER_DAY, DAY]);
      // `''` means "no queue stage owned this spend" — not a guessed stage.
      expect(rows.map((r) => r['stage'])).toEqual(['', '']);
      expect(rows[1]['input_tokens']).toBe(1_200);
      expect(rows[1]['output_tokens']).toBe(800);
      expect(rows[1]['cost_usd']).toBeCloseTo(0.04, 10);
      expect(rows[1]['updated_at']).toBe(1_770_000_000_000);
    } finally {
      db.close();
    }
  });

  /**
   * B0.4's budget gate reads the day total. Splitting the ledger by stage must
   * not move the number it trips on — before OR after the migration.
   */
  maybe('preserves the day total the budget gate reads', () => {
    const db = openAtVersion34();
    try {
      db.prepare(LEGACY_INSERT).run(DAY, 1_200, 800, 0.04, 1);
      const spentBefore = (
        db
          .prepare(
            `SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS spent
               FROM skill_synthesis_budget WHERE day_key = ?`,
          )
          .get(DAY) as { spent: number }
      ).spent;

      db.exec(sql0035SkillSynthesisBudgetStage);

      const spentAfter = (
        db
          .prepare(
            `SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS spent
               FROM skill_synthesis_budget WHERE day_key = ?`,
          )
          .get(DAY) as { spent: number }
      ).spent;
      expect(spentBefore).toBe(2_000);
      expect(spentAfter).toBe(spentBefore);

      // And it keeps summing correctly once the day carries several stages.
      const insert = db.prepare(STAGE_INSERT);
      insert.run(DAY, 'judge', 300, 200, 0.01, 2);
      insert.run(DAY, 'synthesis', 400, 100, 0.02, 3);
      const spentSplit = (
        db
          .prepare(
            `SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS spent
               FROM skill_synthesis_budget WHERE day_key = ?`,
          )
          .get(DAY) as { spent: number }
      ).spent;
      expect(spentSplit).toBe(3_000);
    } finally {
      db.close();
    }
  });

  maybe('leaves no rebuild scratch table behind', () => {
    const db = openAtVersion35();
    try {
      const tables = (
        db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all() as Array<{ name: string }>
      ).map((t) => t.name);
      expect(tables).toContain('skill_synthesis_budget');
      expect(tables).not.toContain('skill_synthesis_budget_rekeyed');
    } finally {
      db.close();
    }
  });

  maybe('defaults the counters and the stage on a minimal insert', () => {
    const db = openAtVersion35();
    try {
      db.prepare(
        'INSERT INTO skill_synthesis_budget (day_key, updated_at) VALUES (?, ?)',
      ).run(DAY, 7);
      const row = db
        .prepare('SELECT * FROM skill_synthesis_budget WHERE day_key = ?')
        .get(DAY) as Record<string, unknown>;
      expect(row['stage']).toBe('');
      expect(row['input_tokens']).toBe(0);
      expect(row['output_tokens']).toBe(0);
      expect(row['cost_usd']).toBe(0);
    } finally {
      db.close();
    }
  });
});
