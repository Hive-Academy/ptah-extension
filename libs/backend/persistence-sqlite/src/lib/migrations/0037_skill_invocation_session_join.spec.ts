/**
 * Migration 0037 — the invocation → session-outcome join (TASK_2026_180 phase 4).
 *
 * TWO ASSERTIONS CARRY THIS FILE, and "the column exists" is only one of them.
 *
 *  1. `workspace_root` is present, nullable, and defaults to NOTHING. A
 *     `NOT NULL DEFAULT ''` would compile, migrate and read back plausibly
 *     while backfilling every pre-0037 row with the value `0034` already spent
 *     on `skill_session_verdicts.workspace_root` to mean "deliberately
 *     cross-project". Unknown provenance and intentional cross-project work
 *     would become the same string, and a workspace-scoped digest would widen
 *     to the whole install with nothing to notice it by. So the spec asserts
 *     `dflt_value IS NULL` and `notnull === 0`, and separately proves a stored
 *     `''` is still distinguishable from a stored NULL in SQL.
 *
 *  2. `idx_skill_inv_events_session` EXISTS AND CHANGES A PLAN. Asserting the
 *     index is in `PRAGMA index_list` proves only that a `CREATE INDEX` ran, so
 *     there is a BEFORE/AFTER `EXPLAIN QUERY PLAN` on the lookup it exists for
 *     — `WHERE session_id = ?`, a full table scan at version 36 and an index
 *     search at 37. That test is measured, not assumed: the §2.5 query as
 *     WRITTEN drives events → verdicts and is served by the verdicts table's
 *     PRIMARY KEY, so it does not touch this index at all. The session-keyed
 *     direction is what has nothing, and it is what phase 4's per-session
 *     sweeps walk. See the test's own comment.
 *
 * The behavioural half applies EVERY bundled migration up to 36 first, so the
 * acceptance condition ("0037 applies at version 36") is proved against the
 * real schema lineage rather than a hand-picked subset. `vecSql` and `run`
 * migrations are skipped — that is exactly the vec-less path the runner takes.
 *
 * `better-sqlite3` in this repo is rebuilt against Electron's ABI by
 * postinstall, so it cannot load in the Jest/Node runner on a normal dev
 * machine. The opener therefore falls back to Node's built-in `node:sqlite` —
 * the same engine behind a different binding — exactly as 0032/0033/0035/0036
 * do. Only if BOTH are unavailable do the behavioural tests skip.
 */
import 'reflect-metadata';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { sql as sql0037SkillInvocationSessionJoin } from './0037_skill_invocation_session_join';
import { MIGRATIONS } from './index';

describe('migration 0037_skill_invocation_session_join — registry entry', () => {
  it('is registered as version 37, plain sql, NOT vec-gated', () => {
    const entry = MIGRATIONS.find((m) => m.version === 37);
    expect(entry).toBeDefined();
    expect(entry?.name).toBe('0037_skill_invocation_session_join');
    expect(entry?.sql).toBe(sql0037SkillInvocationSessionJoin);
    expect(entry?.vecSql).toBeUndefined();
    expect(entry?.requiresVec).toBeUndefined();
    expect(entry?.run).toBeUndefined();
  });

  it('is registered exactly once and appended after 36', () => {
    expect(MIGRATIONS.filter((m) => m.version === 37)).toHaveLength(1);
    expect(MIGRATIONS.map((m) => m.version)).toContain(36);
    // 0037 stopped being the tail when TASK_2026_277 appended 38. What still
    // matters here is that it was APPENDED, not inserted — so nothing sits
    // between 36 and 37, and everything after it is strictly greater.
    const versions = MIGRATIONS.map((m) => m.version);
    expect(versions.indexOf(37)).toBe(versions.indexOf(36) + 1);
    expect([...versions].sort((a, b) => a - b)).toEqual(versions);
  });
});

describe('migration 0037_skill_invocation_session_join — static SQL', () => {
  it('carries no template interpolation', () => {
    // The ESLint and Semgrep rules target the SOURCE; this asserts the shipped
    // string, which is what actually reaches the database.
    expect(sql0037SkillInvocationSessionJoin).not.toContain('${');
  });

  it('is exactly two statements: one ADD COLUMN and one CREATE INDEX', () => {
    const statements = sql0037SkillInvocationSessionJoin
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toMatch(
      /^ALTER TABLE skill_invocation_events ADD COLUMN workspace_root TEXT$/,
    );
    expect(statements[1]).toMatch(
      /^CREATE INDEX IF NOT EXISTS idx_skill_inv_events_session ON skill_invocation_events\(session_id\)$/,
    );
  });

  it('declares workspace_root nullable with no default — no NOT NULL, no DEFAULT, no CHECK', () => {
    // A NOT NULL column with no default breaks `recordSkillEvent`'s fixed
    // column list on every existing install; a `NOT NULL DEFAULT ''` collides
    // with 0034's meaning for the empty string. See the migration header.
    const alter = sql0037SkillInvocationSessionJoin
      .split('\n')
      .filter((line) => line.startsWith('ALTER TABLE'));
    expect(alter).toHaveLength(1);
    expect(alter[0]).not.toMatch(/NOT NULL/i);
    expect(alter[0]).not.toMatch(/DEFAULT/i);
    expect(alter[0]).not.toMatch(/CHECK/i);
  });

  it('does not re-create any index 0021, 0027 or 0030 already shipped', () => {
    // A duplicate CREATE INDEX would be harmless under IF NOT EXISTS but is a
    // sign the author misread which access paths already exist. The four
    // pre-existing indexes all narrow by skill; this one narrows by session.
    for (const existing of [
      'idx_skill_inv_events_slug',
      'idx_skill_inv_events_ctx',
      'idx_skill_inv_events_recon',
      'idx_skill_inv_events_task',
    ]) {
      expect(sql0037SkillInvocationSessionJoin).not.toContain(existing);
    }
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-migr0037-test-'));
  return path.join(dir, 'ptah.db');
}

/**
 * `SkillCandidateStore.recordSkillEvent`'s statement as it stands AFTER this
 * batch: seventeen columns, `workspace_root` last. Reproduced rather than
 * imported because `persistence-sqlite` is a foundation lib and must not depend
 * on `skill-synthesis`. If the store's INSERT and this migration ever disagree,
 * this test is where it surfaces.
 */
const RECORD_SKILL_EVENT_INSERT = `INSERT INTO skill_invocation_events
         (id, skill_slug, session_id, context_id, source, succeeded, is_error, invoked_at,
          input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
          cost_usd, duration_ms, tool_count, task_id, workspace_root)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/** Plan §2.5's win-rate query, verbatim. Used to check the planner's choice. */
const WIN_RATE_SQL = `SELECT e.skill_slug,
       COUNT(*) AS invocations,
       SUM(CASE WHEN v.evidence_class IN
             ('tests-green','user-accepted','explicit-confirmation')
           THEN 1 ELSE 0 END) AS wins,
       SUM(CASE WHEN v.session_id IS NULL OR v.evidence_class = 'unverified'
           THEN 1 ELSE 0 END) AS unknown
FROM skill_invocation_events e
LEFT JOIN skill_session_verdicts v ON v.session_id = e.session_id
GROUP BY e.skill_slug`;

describe('migration 0037_skill_invocation_session_join — behaviour (skipped without any SQLite binding)', () => {
  const opener = resolveOpener();
  const maybe = opener ? it : it.skip;

  /**
   * Brings a fresh database all the way to version 36 the way the runner does
   * on a machine without sqlite-vec: every bundled migration in ascending
   * order, applying only the base `sql`.
   */
  function openAtVersion36(): DatabaseShape {
    const db = (opener as DbOpener)(makeTempDbPath());
    db.exec('PRAGMA foreign_keys = ON');
    for (const migration of [...MIGRATIONS]
      .filter((m) => m.version <= 36)
      .sort((a, b) => a.version - b.version)) {
      if (migration.sql) {
        db.exec(migration.sql);
      }
    }
    return db;
  }

  function eventColumns(
    db: DatabaseShape,
  ): Map<
    string,
    { name: string; type: string; notnull: number; dflt_value: unknown }
  > {
    const rows = db
      .prepare('PRAGMA table_info(skill_invocation_events)')
      .all() as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: unknown;
    }>;
    return new Map(rows.map((r) => [r.name, r]));
  }

  maybe('applies cleanly onto a database already at version 36', () => {
    const db = openAtVersion36();
    try {
      expect(() => db.exec(sql0037SkillInvocationSessionJoin)).not.toThrow();
    } finally {
      db.close();
    }
  });

  maybe('adds workspace_root as a nullable TEXT column with no default', () => {
    const db = openAtVersion36();
    try {
      // Absent before, present after — proving 0037 is what added it, not some
      // earlier migration this spec would otherwise be crediting.
      expect(eventColumns(db).has('workspace_root')).toBe(false);
      db.exec(sql0037SkillInvocationSessionJoin);

      const col = eventColumns(db).get('workspace_root');
      expect(col).toBeDefined();
      expect(col?.type).toBe('TEXT');
      expect(col?.notnull).toBe(0);
      expect(col?.dflt_value).toBeNull();

      // session_id is untouched: still the NOT NULL column 0021 declared.
      expect(eventColumns(db).get('session_id')?.notnull).toBe(1);
    } finally {
      db.close();
    }
  });

  maybe(
    'keeps a NULL workspace_root distinguishable from the empty string',
    () => {
      const db = openAtVersion36();
      try {
        db.exec(sql0037SkillInvocationSessionJoin);
        const insert = db.prepare(RECORD_SKILL_EVENT_INSERT);
        // A pre-0037 row: everything the old sixteen-column INSERT wrote, with
        // workspace_root left NULL because nothing knew it.
        insert.run(
          'e-legacy',
          'caveman',
          's-legacy',
          null,
          'tool-use',
          1,
          0,
          10,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
        );
        // 0034's meaning for '': deliberately cross-project.
        insert.run(
          'e-cross',
          'caveman',
          's-cross',
          null,
          'tool-use',
          1,
          0,
          20,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          '',
        );
        insert.run(
          'e-scoped',
          'caveman',
          's-scoped',
          null,
          'tool-use',
          1,
          0,
          30,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          'D:/projects/ptah-extension',
        );

        const read = (id: string): unknown =>
          (
            db
              .prepare(
                'SELECT workspace_root FROM skill_invocation_events WHERE id = ?',
              )
              .get(id) as Record<string, unknown>
          )['workspace_root'];

        // Stated in BOTH directions: a reader that returns NULL for everything
        // fails the second pair, one that coalesces NULL to '' fails the first.
        expect(read('e-legacy')).toBeNull();
        expect(read('e-legacy')).not.toBe('');
        expect(read('e-cross')).toBe('');
        expect(read('e-cross')).not.toBeNull();
        expect(read('e-scoped')).toBe('D:/projects/ptah-extension');

        // And SQL can tell them apart, which is what a workspace-scoped digest
        // needs: scoping to '' must not sweep up the unknown-provenance row.
        const crossOnly = db
          .prepare(
            `SELECT COUNT(*) AS n FROM skill_invocation_events
               WHERE workspace_root = ''`,
          )
          .get() as { n: number };
        expect(crossOnly.n).toBe(1);
        const unknownOnly = db
          .prepare(
            `SELECT COUNT(*) AS n FROM skill_invocation_events
               WHERE workspace_root IS NULL`,
          )
          .get() as { n: number };
        expect(unknownOnly.n).toBe(1);
      } finally {
        db.close();
      }
    },
  );

  maybe(
    'creates idx_skill_inv_events_session beside the four 0021/0027/0030 indexes',
    () => {
      const db = openAtVersion36();
      try {
        const names = (): string[] =>
          (
            db
              .prepare('PRAGMA index_list(skill_invocation_events)')
              .all() as Array<{ name: string }>
          ).map((r) => r.name);

        expect(names()).not.toContain('idx_skill_inv_events_session');
        db.exec(sql0037SkillInvocationSessionJoin);

        const after = names();
        expect(after).toContain('idx_skill_inv_events_session');
        // The pre-existing skill-keyed access paths survive.
        expect(after).toContain('idx_skill_inv_events_slug');
        expect(after).toContain('idx_skill_inv_events_ctx');
      } finally {
        db.close();
      }
    },
  );

  maybe(
    'turns the session-keyed lookup from a scan into an index search',
    () => {
      // WHICH DIRECTION THIS INDEX PAYS FOR, measured rather than assumed.
      // Plan §2.5's query as written drives events → verdicts, and that side is
      // already served by `skill_session_verdicts`'s PRIMARY KEY on
      // `session_id` — the planner picks `idx_skill_inv_events_slug` for the
      // GROUP BY and never touches this index. What has no index at all before
      // 0037 is the OTHER direction: "which skills ran in this session", which
      // is a full scan of the busiest table in the schema and is what phase 4's
      // sweeps (relevant-skill-never-invoked, per-session evidence) walk, and
      // what the same join costs the moment the planner drives it from the
      // verdicts side. So the assertion is a BEFORE/AFTER on that lookup: this
      // is the only test in the file that would notice the index being dropped.
      const db = openAtVersion36();
      try {
        // Spelled out rather than composed with a template literal: this
        // directory's ESLint rule (`no-template-curly-in-migration`) forbids
        // `${...}` in ANY file under `migrations/`, spec files included, so that
        // no reviewer ever has to decide which interpolations are the safe kind.
        const BY_SESSION_PLAN =
          "EXPLAIN QUERY PLAN SELECT skill_slug FROM skill_invocation_events WHERE session_id = 's1'";
        const planOf = (): string =>
          (
            db.prepare(BY_SESSION_PLAN).all() as Array<{
              detail: string;
            }>
          )
            .map((r) => r.detail)
            .join(' | ');

        // ANALYZE is deliberately NOT run: the planner must reach this index on
        // the schema alone, which is the state every real install is in.
        const before = planOf();
        expect(before).toMatch(/SCAN/);
        expect(before).not.toContain('idx_skill_inv_events_session');

        db.exec(sql0037SkillInvocationSessionJoin);

        const after = planOf();
        expect(after).toContain('idx_skill_inv_events_session');
        expect(after).toMatch(/SEARCH/);
        expect(after).not.toMatch(/SCAN skill_invocation_events/);
      } finally {
        db.close();
      }
    },
  );

  maybe(
    'runs the §2.5 win-rate query end to end on the migrated schema',
    () => {
      const db = openAtVersion36();
      try {
        db.exec(sql0037SkillInvocationSessionJoin);
        const insert = db.prepare(RECORD_SKILL_EVENT_INSERT);
        const event = (id: string, session: string, at: number): void => {
          insert.run(
            id,
            'caveman',
            session,
            null,
            'tool-use',
            1,
            0,
            at,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            '/ws',
          );
        };
        event('e1', 's-win', 1);
        event('e2', 's-unverified', 2);
        event('e3', 's-absent', 3);

        const verdict = db.prepare(
          `INSERT INTO skill_session_verdicts
           (session_id, workspace_root, evidence_class, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        );
        verdict.run('s-win', '/ws', 'tests-green', 1, 1);
        verdict.run('s-unverified', '/ws', 'unverified', 2, 2);

        const rows = db.prepare(WIN_RATE_SQL).all() as Array<{
          skill_slug: string;
          invocations: number;
          wins: number;
          unknown: number;
        }>;
        expect(rows).toHaveLength(1);
        // The arithmetic the join exists for: three invocations, one win, and
        // two unknowns (the unverified verdict AND the session with no row).
        expect(rows[0]).toEqual({
          skill_slug: 'caveman',
          invocations: 3,
          wins: 1,
          unknown: 2,
        });
      } finally {
        db.close();
      }
    },
  );
});
