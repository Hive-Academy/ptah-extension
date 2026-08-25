/**
 * Migration 0040 — the workspace a skill candidate was captured in
 * (TASK_2026_322).
 *
 * TWO ASSERTIONS ARE THE POINT OF THIS FILE, and neither is "the column
 * exists".
 *
 * 1. `workspace_root` is THREE-VALUED and all three values survive a round
 *    trip. A real path is "captured there"; `''` is "deliberately
 *    cross-project"; `NULL` is "origin unknown". A spec that only checked the
 *    column exists would pass against a `NOT NULL DEFAULT ''` definition, which
 *    silently asserts that every pre-existing candidate is cross-project —
 *    exactly the fabricated-value defect `0033` and `0036` were written to
 *    prevent for their own columns.
 *
 * 2. The scoped predicate the store is about to run INCLUDES the `NULL` rows
 *    and EXCLUDES `''`. Those two facts are tested together because either
 *    alone passes against a degenerate predicate: matching everything passes
 *    the inclusion half, matching only the exact path passes the exclusion
 *    half, and only the pair pins the rule.
 *
 * The backfill is tested against a real `skill_synthesis_queue` — the resolvable
 * candidate, the one whose only queue row is cross-project (`''`), and the one
 * with no queue row at all must come out as three DIFFERENT values.
 *
 * `registerCandidate`'s INSERT is reproduced verbatim rather than imported,
 * because `persistence-sqlite` is a foundation lib and must not depend on
 * `skill-synthesis`. Copying it is the point: if the store's statement and this
 * migration ever disagree, this test is where it surfaces. Both the pre-0040
 * fourteen-column form and the post-0040 fifteen-column form are exercised —
 * the first because an install mid-upgrade still runs it, the second because it
 * is what ships.
 *
 * The behavioural half applies EVERY bundled migration up to 39 first, so the
 * acceptance condition is proved against the real schema lineage rather than a
 * hand-picked subset. `vecSql` and `run` migrations are skipped — that is
 * exactly the vec-less path the runner takes. `better-sqlite3` in this repo is
 * rebuilt against Electron's ABI by postinstall and cannot load in the Jest
 * runner on a normal dev machine, so the opener falls back to Node's built-in
 * `node:sqlite`, as `0032`/`0033`/`0035`/`0036` do.
 */
import 'reflect-metadata';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { sql as sql0040SkillCandidateWorkspaceRoot } from './0040_skill_candidate_workspace_root';
import { MIGRATIONS } from './index';

describe('migration 0040_skill_candidate_workspace_root — registry entry', () => {
  it('is registered as version 40, plain sql, NOT vec-gated', () => {
    const entry = MIGRATIONS.find((m) => m.version === 40);
    expect(entry).toBeDefined();
    expect(entry?.name).toBe('0040_skill_candidate_workspace_root');
    expect(entry?.sql).toBe(sql0040SkillCandidateWorkspaceRoot);
    expect(entry?.vecSql).toBeUndefined();
    expect(entry?.requiresVec).toBeUndefined();
    expect(entry?.run).toBeUndefined();
  });

  it('is registered exactly once and follows 39 with no gap', () => {
    expect(MIGRATIONS.filter((m) => m.version === 40)).toHaveLength(1);
    expect(MIGRATIONS.map((m) => m.version)).toContain(39);
  });

  it('is the highest bundled version', () => {
    // Migrations are forward-only and APPENDED, never inserted. This assertion
    // tracks the current highest version and moves forward with every appended
    // migration — that movement is the ratchet, not a failure (0028 / 0030 /
    // 0038 / 0039 carry the identical test for the same reason).
    expect(Math.max(...MIGRATIONS.map((m) => m.version))).toBe(40);
  });
});

describe('migration 0040_skill_candidate_workspace_root — static SQL', () => {
  it('carries no template interpolation', () => {
    // The ESLint and Semgrep rules target the SOURCE; this asserts the shipped
    // string, which is what actually reaches the database.
    expect(sql0040SkillCandidateWorkspaceRoot).not.toContain('${');
  });

  it('adds exactly one column, nullable, with no default and no CHECK', () => {
    const alters = sql0040SkillCandidateWorkspaceRoot
      .split('\n')
      .filter((line) => line.startsWith('ALTER TABLE'));
    expect(alters).toHaveLength(1);
    expect(alters[0]).toContain('skill_candidates');
    expect(alters[0]).toContain('workspace_root');
    // `NOT NULL` without a default breaks the store's fixed-column INSERT on
    // every existing install; `NOT NULL DEFAULT ''` would claim every legacy
    // candidate is deliberately cross-project. Both are the same class of
    // fabricated value the 0033/0036 headers reject.
    expect(alters[0]).not.toMatch(/NOT NULL/i);
    expect(alters[0]).not.toMatch(/DEFAULT/i);
    expect(alters[0]).not.toMatch(/CHECK/i);
  });

  it('creates the index the scoped list read narrows through', () => {
    // Unlike 0036, which deliberately added no index because nothing queried
    // its columns, this column IS the new WHERE clause and it backs an
    // interactive list.
    expect(sql0040SkillCandidateWorkspaceRoot).toMatch(/CREATE\s+INDEX/i);
    expect(sql0040SkillCandidateWorkspaceRoot).toContain(
      'skill_candidates(status, workspace_root)',
    );
  });

  it("never copies a cross-project queue row's empty workspace_root", () => {
    // Without this predicate the backfill would turn "this row was clustering
    // work, it names no project" into the assertion "this candidate is
    // deliberately cross-project", which is the one thing the NULL value exists
    // to avoid saying.
    expect(sql0040SkillCandidateWorkspaceRoot).toContain(
      "q.workspace_root <> ''",
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-migr0040-test-'));
  return path.join(dir, 'ptah.db');
}

/**
 * `registerCandidate`'s statement as it stood BEFORE this migration — fourteen
 * named columns. Still valid afterwards, which is what keeps a host running an
 * older build able to write to a migrated database.
 */
const LEGACY_INSERT = `INSERT INTO skill_candidates (
         id, name, description, body_path, source_session_ids,
         trajectory_hash, embedding_rowid, status,
         success_count, failure_count, created_at,
         promoted_at, rejected_at, rejected_reason
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'candidate', 0, 0, ?, NULL, NULL, NULL)`;

/**
 * `registerCandidate`'s statement as it ships after this migration — the same
 * fourteen plus `workspace_root`, character-for-character as
 * `skill-candidate.store.ts` writes it.
 */
const CURRENT_INSERT = `INSERT INTO skill_candidates (
         id, name, description, body_path, source_session_ids,
         trajectory_hash, embedding_rowid, status,
         success_count, failure_count, created_at,
         promoted_at, rejected_at, rejected_reason, workspace_root
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'candidate', 0, 0, ?, NULL, NULL, NULL, ?)`;

const QUEUE_INSERT = `INSERT INTO skill_synthesis_queue (
         id, session_id, workspace_root, source, stage, status,
         enqueued_at, candidate_id
       ) VALUES (?, ?, ?, 'test', 'prefilter', 'done', ?, ?)`;

describe('migration 0040_skill_candidate_workspace_root — behaviour (skipped without any SQLite binding)', () => {
  const opener = resolveOpener();
  const maybe = opener ? it : it.skip;

  /**
   * Brings a fresh database all the way to version 39 the way the runner does
   * on a machine without sqlite-vec: every bundled migration in ascending
   * order, applying only the base `sql`.
   */
  function openAtVersion39(): DatabaseShape {
    const db = (opener as DbOpener)(makeTempDbPath());
    db.exec('PRAGMA foreign_keys = ON');
    for (const migration of [...MIGRATIONS]
      .filter((m) => m.version <= 39)
      .sort((a, b) => a.version - b.version)) {
      if (migration.sql) {
        db.exec(migration.sql);
      }
    }
    return db;
  }

  function readRoot(db: DatabaseShape, id: string): unknown {
    const row = db
      .prepare('SELECT workspace_root FROM skill_candidates WHERE id = ?')
      .get(id) as Record<string, unknown>;
    return row['workspace_root'];
  }

  maybe('applies cleanly onto a database already at version 39', () => {
    const db = openAtVersion39();
    try {
      expect(() => db.exec(sql0040SkillCandidateWorkspaceRoot)).not.toThrow();
    } finally {
      db.close();
    }
  });

  maybe('adds the column nullable with no default', () => {
    const db = openAtVersion39();
    try {
      db.exec(sql0040SkillCandidateWorkspaceRoot);
      const col = (
        db.prepare('PRAGMA table_info(skill_candidates)').all() as Array<{
          name: string;
          type: string;
          notnull: number;
          dflt_value: unknown;
        }>
      ).find((c) => c.name === 'workspace_root');
      expect(col).toBeDefined();
      expect(col?.type).toBe('TEXT');
      // notnull 0 + no default is what keeps the legacy INSERT valid AND what
      // keeps "origin unknown" representable.
      expect(col?.notnull).toBe(0);
      expect(col?.dflt_value).toBeNull();
    } finally {
      db.close();
    }
  });

  maybe('leaves the pre-0040 fourteen-column INSERT working unchanged', () => {
    const db = openAtVersion39();
    try {
      db.exec(sql0040SkillCandidateWorkspaceRoot);
      expect(() =>
        db
          .prepare(LEGACY_INSERT)
          .run('c1', 'n1', 'd', '/tmp/SKILL.md', '[]', 'h1', null, 1),
      ).not.toThrow();
      expect(readRoot(db, 'c1')).toBeNull();
    } finally {
      db.close();
    }
  });

  maybe('round-trips all three values distinctly', () => {
    const db = openAtVersion39();
    try {
      db.exec(sql0040SkillCandidateWorkspaceRoot);
      const insert = db.prepare(CURRENT_INSERT);
      insert.run(
        'known',
        'n-k',
        'd',
        '/tmp/SKILL.md',
        '[]',
        'h-k',
        null,
        1,
        'D:\\projects\\alpha',
      );
      insert.run(
        'cross',
        'n-c',
        'd',
        '/tmp/SKILL.md',
        '[]',
        'h-c',
        null,
        1,
        '',
      );
      insert.run(
        'unknown',
        'n-u',
        'd',
        '/tmp/SKILL.md',
        '[]',
        'h-u',
        null,
        1,
        null,
      );

      // Stated in every direction, because a degenerate reader that returns
      // NULL for everything, or '' for everything, passes any single pair.
      expect(readRoot(db, 'known')).toBe('D:\\projects\\alpha');
      expect(readRoot(db, 'cross')).toBe('');
      expect(readRoot(db, 'cross')).not.toBeNull();
      expect(readRoot(db, 'unknown')).toBeNull();
      expect(readRoot(db, 'unknown')).not.toBe('');
    } finally {
      db.close();
    }
  });

  maybe(
    'the scoped predicate includes the unknown rows and excludes the cross-project one',
    () => {
      const db = openAtVersion39();
      try {
        db.exec(sql0040SkillCandidateWorkspaceRoot);
        const insert = db.prepare(CURRENT_INSERT);
        insert.run(
          'mine',
          'n-m',
          'd',
          '/tmp/SKILL.md',
          '[]',
          'h-m',
          null,
          1,
          'D:\\projects\\alpha',
        );
        insert.run(
          'theirs',
          'n-t',
          'd',
          '/tmp/SKILL.md',
          '[]',
          'h-t',
          null,
          1,
          'D:\\projects\\beta',
        );
        insert.run(
          'cross',
          'n-c',
          'd',
          '/tmp/SKILL.md',
          '[]',
          'h-c',
          null,
          1,
          '',
        );
        insert.run(
          'legacy',
          'n-l',
          'd',
          '/tmp/SKILL.md',
          '[]',
          'h-l',
          null,
          1,
          null,
        );

        // The exact predicate `SkillCandidateStore.listByStatus` runs.
        const ids = (
          db
            .prepare(
              `SELECT id FROM skill_candidates
                WHERE status = ?
                  AND (workspace_root = ? OR workspace_root IS NULL)
                ORDER BY id`,
            )
            .all('candidate', 'D:\\projects\\alpha') as Array<{ id: string }>
        ).map((r) => r.id);

        // `legacy` is IN — hiding it would make every pre-migration candidate
        // unreachable in every workspace. `cross` is OUT — `''` is a known
        // value meaning "not this workspace", not an unknown one.
        expect(ids).toEqual(['legacy', 'mine']);
      } finally {
        db.close();
      }
    },
  );

  maybe('backfills only the candidates a queue row can resolve', () => {
    const db = openAtVersion39();
    try {
      // Three candidates written BEFORE the migration, so all three start with
      // no column at all.
      const legacyInsert = db.prepare(LEGACY_INSERT);
      legacyInsert.run(
        'resolvable',
        'n-r',
        'd',
        '/tmp/SKILL.md',
        '[]',
        'h-r',
        null,
        1,
      );
      legacyInsert.run(
        'cross-only',
        'n-c',
        'd',
        '/tmp/SKILL.md',
        '[]',
        'h-c',
        null,
        1,
      );
      legacyInsert.run(
        'orphan',
        'n-o',
        'd',
        '/tmp/SKILL.md',
        '[]',
        'h-o',
        null,
        1,
      );

      const queue = db.prepare(QUEUE_INSERT);
      queue.run('q1', 's1', 'D:\\projects\\alpha', 10, 'resolvable');
      // A later row for the same candidate: `ORDER BY enqueued_at ASC LIMIT 1`
      // must make the result deterministic rather than last-writer-wins.
      queue.run('q2', 's2', 'D:\\projects\\alpha', 20, 'resolvable');
      // Clustering work names no project, and copying its `''` would fabricate
      // the "deliberately cross-project" claim.
      queue.run('q3', 's3', '', 30, 'cross-only');
      // `orphan` has no queue row at all — reaped by 0039, or older than 0032.

      db.exec(sql0040SkillCandidateWorkspaceRoot);

      expect(readRoot(db, 'resolvable')).toBe('D:\\projects\\alpha');
      expect(readRoot(db, 'cross-only')).toBeNull();
      expect(readRoot(db, 'orphan')).toBeNull();
    } finally {
      db.close();
    }
  });
});
