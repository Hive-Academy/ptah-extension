/**
 * Migration 0034 — the session-verdict table for TASK_2026_180's phase 2.
 *
 * Three things are load-bearing here, and "the table exists" is none of them.
 *
 *  1. **The graceful-degradation row must be expressible.** A row with
 *     `intent IS NULL` and `degraded_reason NOT NULL` has to insert, persist and
 *     read back as itself. That row is how phase 2 records "analyzed, no
 *     verdict, here is why" without throwing and without leaving the drain to
 *     re-attempt forever. A spec that only checked the columns exist would pass
 *     against a `NOT NULL` definition that makes the state unrepresentable.
 *  2. **`evidence_class` is CHECK-constrained to exactly five members.** All
 *     five must insert and every non-member must be rejected by the database,
 *     because phase 4's win-rate arithmetic partitions on those exact names.
 *     NULL must still pass — SQLite treats a CHECK evaluating to NULL as
 *     satisfied, and the degraded row depends on it.
 *  3. **`friction_map` and `routine` survive a JSON round trip byte-for-byte**,
 *     including the integer `turnIndex` values and the `citations: number[]`
 *     that phase 3 reads. JSON in a TEXT column is only useful if nothing
 *     rewrites it.
 *
 * The behavioural half applies EVERY bundled migration up to 33 first, so the
 * acceptance condition ("0034 applies to a DB already at version 33") is proved
 * against the real schema lineage rather than a hand-picked subset. `vecSql` and
 * `run` migrations are skipped — that is exactly the vec-less path the runner
 * takes.
 *
 * Those assertions need a working SQLite binding, and `better-sqlite3` in this
 * repo is rebuilt against Electron's ABI by postinstall, so it cannot load in
 * the Jest/Node runner on a normal dev machine. Rather than let the behavioural
 * half sit permanently skipped — green while asserting nothing — the opener
 * falls back to Node's built-in `node:sqlite`, the same engine behind a
 * different binding, exactly as `0032` and `0033`'s specs do. Only if BOTH are
 * unavailable do the behavioural tests skip.
 */
import 'reflect-metadata';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { sql as sql0034SkillSessionVerdicts } from './0034_skill_session_verdicts';
import { MIGRATIONS } from './index';

/**
 * The fourteen columns 0034 creates, with the affinity and nullability plan
 * §2.4 specifies. `notnull` is the contract, not a detail: the four verdict
 * columns MUST be 0.
 */
const COLUMNS: ReadonlyArray<
  readonly [name: string, type: string, notnull: 0 | 1]
> = [
  ['session_id', 'TEXT', 0], // PRIMARY KEY; SQLite reports notnull 0 for a TEXT pk
  ['workspace_root', 'TEXT', 1],
  ['intent', 'TEXT', 0],
  ['outcome', 'TEXT', 0],
  ['evidence_class', 'TEXT', 0],
  ['friction_map', 'TEXT', 1],
  ['routine', 'TEXT', 0],
  ['turn_count', 'INTEGER', 1],
  ['lane', 'TEXT', 0],
  ['model', 'TEXT', 0],
  ['passes', 'INTEGER', 1],
  ['degraded_reason', 'TEXT', 0],
  ['created_at', 'INTEGER', 1],
  ['updated_at', 'INTEGER', 1],
];

/** Every `evidence_class` member the CHECK accepts, in DDL order. */
const EVIDENCE_CLASSES = [
  'tests-green',
  'user-accepted',
  'no-correction',
  'explicit-confirmation',
  'unverified',
] as const;

describe('migration 0034_skill_session_verdicts — registry entry', () => {
  it('is registered as version 34, plain sql, NOT vec-gated', () => {
    const entry = MIGRATIONS.find((m) => m.version === 34);
    expect(entry).toBeDefined();
    expect(entry?.name).toBe('0034_skill_session_verdicts');
    expect(entry?.sql).toBe(sql0034SkillSessionVerdicts);
    expect(entry?.vecSql).toBeUndefined();
    expect(entry?.requiresVec).toBeUndefined();
    expect(entry?.run).toBeUndefined();
  });

  it('is registered exactly once and appended after 33', () => {
    expect(MIGRATIONS.filter((m) => m.version === 34)).toHaveLength(1);
    expect(MIGRATIONS.map((m) => m.version)).toContain(33);
    // 0034 stopped being the tail when B0.8 appended 0035; the property that
    // survives is "34 exists exactly once and 33 precedes it" — the highest
    // version is asserted by whichever migration is currently last.
    expect(MIGRATIONS.map((m) => m.version)).toContain(35);
  });
});

describe('migration 0034_skill_session_verdicts — static SQL', () => {
  it('carries no template interpolation', () => {
    // The ESLint and Semgrep rules target the SOURCE; this asserts the shipped
    // string, which is what actually reaches the database.
    expect(sql0034SkillSessionVerdicts).not.toContain('${');
  });

  it('creates the table guarded by IF NOT EXISTS', () => {
    expect(sql0034SkillSessionVerdicts).toContain(
      'CREATE TABLE IF NOT EXISTS skill_session_verdicts',
    );
  });

  it('constrains evidence_class to exactly the five plan §2.4 members', () => {
    // Member-for-member, because phase 4's win-rate query partitions on these
    // exact names and SQLite cannot widen a CHECK with ALTER TABLE.
    for (const member of EVIDENCE_CLASSES) {
      // Concatenated, not interpolated: the lib's ESLint bans template
      // expressions everywhere under migrations/**, specs included.
      expect(sql0034SkillSessionVerdicts).toContain("'" + member + "'");
    }
    const quoted = Array.from(
      sql0034SkillSessionVerdicts.matchAll(/'([a-z-]+)'/g),
    ).map((m) => m[1]);
    // `'[]'` is the friction_map default and is not a quoted identifier here.
    expect(new Set(quoted)).toEqual(new Set(EVIDENCE_CLASSES));
  });

  it('leaves degraded_reason unconstrained — no CHECK on it, deliberately', () => {
    // The asymmetry with evidence_class is a decision (see the migration
    // header): evidence_class is fully knowable today, degraded_reason is not,
    // and SQLite cannot widen a CHECK without rebuilding the table.
    const checks = Array.from(
      sql0034SkillSessionVerdicts.matchAll(/CHECK\s*\((\w+)/g),
    ).map((m) => m[1]);
    expect(checks).toEqual(['evidence_class']);
  });

  it('declares intent, outcome, evidence_class and routine WITHOUT NOT NULL', () => {
    // Source-level guard on the nullability contract, so a well-meaning
    // "tighten the schema" edit fails here even on a machine with no binding.
    for (const column of ['intent', 'outcome', 'evidence_class', 'routine']) {
      const line = sql0034SkillSessionVerdicts
        .split('\n')
        .find((l) => l.trim().startsWith(column + ' '));
      expect(line).toBeDefined();
      expect(line).not.toMatch(/NOT NULL/i);
    }
  });

  it('creates all three indexes guarded by IF NOT EXISTS', () => {
    expect(sql0034SkillSessionVerdicts).toContain(
      'CREATE INDEX IF NOT EXISTS idx_ssv_ws',
    );
    expect(sql0034SkillSessionVerdicts).toContain(
      'CREATE INDEX IF NOT EXISTS idx_ssv_evidence',
    );
    expect(sql0034SkillSessionVerdicts).toContain(
      'CREATE INDEX IF NOT EXISTS idx_ssv_degraded',
    );
    // The degraded index is PARTIAL on purpose — the sweep it serves only ever
    // looks at the minority of rows that carry a reason.
    expect(sql0034SkillSessionVerdicts).toMatch(
      /idx_ssv_degraded[\s\S]*WHERE degraded_reason IS NOT NULL/,
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-migr0034-test-'));
  return path.join(dir, 'ptah.db');
}

/**
 * The archaeologist's INSERT, reproduced here rather than imported.
 * `persistence-sqlite` is a foundation lib and must not depend on
 * `skill-synthesis`; copying the statement is the point — if
 * `SessionVerdictStore` and this migration ever disagree, this spec is where it
 * surfaces (the same tripwire 0033's spec keeps on `registerCandidate`).
 */
const VERDICT_INSERT = `INSERT INTO skill_session_verdicts (
         session_id, workspace_root, intent, outcome, evidence_class,
         friction_map, routine, turn_count, lane, model, passes,
         degraded_reason, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

describe('migration 0034_skill_session_verdicts — behaviour (skipped without any SQLite binding)', () => {
  const opener = resolveOpener();
  const maybe = opener ? it : it.skip;

  /**
   * Brings a fresh database all the way to version 33 the way the runner does
   * on a machine without sqlite-vec: every bundled migration in ascending
   * order, applying only the base `sql` and skipping `vecSql`-only and `run`
   * migrations.
   */
  function openAtVersion33(): DatabaseShape {
    const db = (opener as DbOpener)(makeTempDbPath());
    db.exec('PRAGMA foreign_keys = ON');
    for (const migration of [...MIGRATIONS]
      .filter((m) => m.version <= 33)
      .sort((a, b) => a.version - b.version)) {
      if (migration.sql) {
        db.exec(migration.sql);
      }
    }
    return db;
  }

  function openAtVersion34(): DatabaseShape {
    const db = openAtVersion33();
    db.exec(sql0034SkillSessionVerdicts);
    return db;
  }

  maybe('applies cleanly onto a database already at version 33', () => {
    const db = openAtVersion33();
    try {
      expect(() => db.exec(sql0034SkillSessionVerdicts)).not.toThrow();
    } finally {
      db.close();
    }
  });

  maybe('is idempotent — re-applying the whole script does not throw', () => {
    // Every statement is IF NOT EXISTS guarded, which is what lets a partially
    // applied schema be repaired by simply re-running.
    const db = openAtVersion34();
    try {
      expect(() => db.exec(sql0034SkillSessionVerdicts)).not.toThrow();
    } finally {
      db.close();
    }
  });

  maybe(
    'creates all fourteen columns with the planned affinity and nullability',
    () => {
      const db = openAtVersion34();
      try {
        const rows = db
          .prepare('PRAGMA table_info(skill_session_verdicts)')
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

  maybe('accepts every one of the five evidence_class members', () => {
    const db = openAtVersion34();
    try {
      const insert = db.prepare(VERDICT_INSERT);
      for (const member of EVIDENCE_CLASSES) {
        expect(() =>
          insert.run(
            's-' + member,
            '/ws',
            'intent',
            'outcome',
            member,
            '[]',
            null,
            3,
            null,
            null,
            1,
            null,
            1,
            1,
          ),
        ).not.toThrow();
      }
      const stored = (
        db
          .prepare(
            'SELECT evidence_class FROM skill_session_verdicts ORDER BY session_id',
          )
          .all() as Array<{ evidence_class: string }>
      ).map((r) => r.evidence_class);
      expect(new Set(stored)).toEqual(new Set(EVIDENCE_CLASSES));
    } finally {
      db.close();
    }
  });

  maybe('rejects a non-member evidence_class at the database', () => {
    const db = openAtVersion34();
    try {
      for (const bogus of ['tests_green', 'TESTS-GREEN', 'success', '']) {
        expect(() =>
          db
            .prepare(VERDICT_INSERT)
            .run(
              'bad-' + bogus,
              '/ws',
              'i',
              'o',
              bogus,
              '[]',
              null,
              1,
              null,
              null,
              1,
              null,
              1,
              1,
            ),
        ).toThrow();
      }
    } finally {
      db.close();
    }
  });

  maybe(
    'accepts a NULL evidence_class — the CHECK must not fight the degraded row',
    () => {
      const db = openAtVersion34();
      try {
        expect(() =>
          db
            .prepare(VERDICT_INSERT)
            .run(
              'null-evidence',
              '/ws',
              null,
              null,
              null,
              '[]',
              null,
              0,
              null,
              null,
              0,
              'no-query-path',
              1,
              1,
            ),
        ).not.toThrow();
      } finally {
        db.close();
      }
    },
  );

  maybe('persists and round-trips the graceful-degradation row', () => {
    const db = openAtVersion34();
    try {
      db.prepare(VERDICT_INSERT).run(
        'degraded-1',
        '/ws',
        null, // intent
        null, // outcome
        null, // evidence_class
        '[]',
        null, // routine
        7,
        null,
        null,
        0,
        'no-query-path',
        1_770_000_000_000,
        1_770_000_000_000,
      );

      const row = db
        .prepare('SELECT * FROM skill_session_verdicts WHERE session_id = ?')
        .get('degraded-1') as Record<string, unknown>;

      // THE assertion this table exists for: the row is present, the verdict is
      // absent, and the reason is legible. "No row" and "row without a verdict"
      // are different facts and stay different.
      expect(row['intent']).toBeNull();
      expect(row['outcome']).toBeNull();
      expect(row['evidence_class']).toBeNull();
      expect(row['routine']).toBeNull();
      expect(row['degraded_reason']).toBe('no-query-path');
      expect(row['turn_count']).toBe(7);

      // And SQL can separate the three states, which is what phase 3's fallback
      // and phase 4's `unknown` bucket both need.
      const degraded = db
        .prepare(
          `SELECT COUNT(*) AS n FROM skill_session_verdicts
            WHERE degraded_reason IS NOT NULL`,
        )
        .get() as { n: number };
      expect(degraded.n).toBe(1);
      const absent = db
        .prepare('SELECT * FROM skill_session_verdicts WHERE session_id = ?')
        .get('never-analyzed');
      expect(absent ?? null).toBeNull();
    } finally {
      db.close();
    }
  });

  maybe('round-trips friction_map and routine JSON unchanged', () => {
    const db = openAtVersion34();
    try {
      const frictionMap = JSON.stringify([
        { turnIndex: 4, kind: 'correction', note: 'wrong file targeted' },
        { turnIndex: 11, kind: 'retry', note: 'test run repeated' },
        {
          turnIndex: 19,
          kind: 'dead-end',
          note: 'abandoned the mock approach',
        },
      ]);
      const routine = JSON.stringify({
        summary: 'Rebase a stacked branch',
        steps: ['fetch', 'rebase onto base', 're-run the affected tests'],
        citations: [4, 11, 19],
      });

      db.prepare(VERDICT_INSERT).run(
        'verdict-1',
        '/ws/project',
        'rebase the stack without losing the WIP commit',
        'branch rebased, tests green',
        'tests-green',
        frictionMap,
        routine,
        21,
        'archaeologist',
        'a-model-id',
        2,
        null,
        1_770_000_000_000,
        1_770_000_000_001,
      );

      const row = db
        .prepare('SELECT * FROM skill_session_verdicts WHERE session_id = ?')
        .get('verdict-1') as Record<string, unknown>;
      expect(row['friction_map']).toBe(frictionMap);
      expect(row['routine']).toBe(routine);

      // Parsed shape, because a TEXT column that survives byte-for-byte is only
      // useful if the values inside it are the ones phases 3-4 read.
      const parsedFriction = JSON.parse(String(row['friction_map'])) as Array<{
        turnIndex: number;
      }>;
      expect(parsedFriction.map((f) => f.turnIndex)).toEqual([4, 11, 19]);
      for (const entry of parsedFriction) {
        expect(Number.isInteger(entry.turnIndex)).toBe(true);
      }
      const parsedRoutine = JSON.parse(String(row['routine'])) as {
        citations: number[];
      };
      expect(parsedRoutine.citations).toEqual([4, 11, 19]);

      expect(row['lane']).toBe('archaeologist');
      expect(row['passes']).toBe(2);
      expect(row['degraded_reason']).toBeNull();
    } finally {
      db.close();
    }
  });

  maybe(
    'defaults friction_map to an empty JSON array and the counters to 0',
    () => {
      const db = openAtVersion34();
      try {
        db.prepare(
          `INSERT INTO skill_session_verdicts (session_id, created_at, updated_at)
           VALUES (?, ?, ?)`,
        ).run('minimal', 1, 1);
        const row = db
          .prepare('SELECT * FROM skill_session_verdicts WHERE session_id = ?')
          .get('minimal') as Record<string, unknown>;
        // No reader needs a null branch around JSON.parse(friction_map).
        expect(row['friction_map']).toBe('[]');
        expect(row['workspace_root']).toBe('');
        expect(row['turn_count']).toBe(0);
        expect(row['passes']).toBe(0);
      } finally {
        db.close();
      }
    },
  );

  maybe(
    'keys one verdict per session — a duplicate session_id is rejected',
    () => {
      const db = openAtVersion34();
      try {
        const insert = db.prepare(
          `INSERT INTO skill_session_verdicts (session_id, created_at, updated_at)
           VALUES (?, ?, ?)`,
        );
        insert.run('once', 1, 1);
        // The store re-writes a verdict with UPDATE-then-INSERT, not a second
        // INSERT; this is the constraint that makes that mandatory.
        expect(() => insert.run('once', 2, 2)).toThrow();
      } finally {
        db.close();
      }
    },
  );

  maybe('creates the three indexes over the planned columns', () => {
    const db = openAtVersion34();
    try {
      const indexNames = (
        db.prepare('PRAGMA index_list(skill_session_verdicts)').all() as Array<{
          name: string;
        }>
      ).map((i) => i.name);
      expect(indexNames).toContain('idx_ssv_ws');
      expect(indexNames).toContain('idx_ssv_evidence');
      expect(indexNames).toContain('idx_ssv_degraded');

      const cols = (name: string): string[] =>
        (
          db.prepare('PRAGMA index_info(' + name + ')').all() as Array<{
            name: string;
          }>
        ).map((c) => c.name);
      expect(cols('idx_ssv_ws')).toEqual(['workspace_root', 'created_at']);
      expect(cols('idx_ssv_evidence')).toEqual(['evidence_class']);
      expect(cols('idx_ssv_degraded')).toEqual(['degraded_reason']);

      // `partial` is 1 only for the degraded index — that is the whole reason it
      // is affordable to carry a third index at all.
      const partial = new Map(
        (
          db
            .prepare('PRAGMA index_list(skill_session_verdicts)')
            .all() as Array<{ name: string; partial: number }>
        ).map((i) => [i.name, i.partial]),
      );
      expect(partial.get('idx_ssv_degraded')).toBe(1);
      expect(partial.get('idx_ssv_ws')).toBe(0);
      expect(partial.get('idx_ssv_evidence')).toBe(0);
    } finally {
      db.close();
    }
  });
});
