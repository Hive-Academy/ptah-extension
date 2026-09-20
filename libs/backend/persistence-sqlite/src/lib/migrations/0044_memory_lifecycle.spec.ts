/**
 * Migration 0044 — lifecycle timestamps, indexes, salience rebase, and run
 * metrics. Every database opened here is a fresh temp file; this spec must
 * never open a user database or a pre-migration snapshot.
 */
import 'reflect-metadata';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { sql as sql0044MemoryLifecycle } from './0044_memory_lifecycle';
import { MIGRATIONS } from './index';

interface DatabaseShape {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  close(): void;
}

type DbOpener = (file: string) => DatabaseShape;

function resolveOpener(): DbOpener | null {
  try {
    const Database = require('better-sqlite3') as new (
      file: string,
    ) => DatabaseShape;
    new Database(':memory:').close();
    return (file) => new Database(file);
  } catch {
    // Falls through to the built-in binding.
  }
  try {
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (file: string) => DatabaseShape;
    };
    new DatabaseSync(':memory:').close();
    return (file) => new DatabaseSync(file);
  } catch {
    return null;
  }
}

const tempDirs: string[] = [];

function makeTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-migr0044-test-'));
  tempDirs.push(dir);
  return path.join(dir, 'lifecycle.db');
}

describe('migration 0044_memory_lifecycle — registry and static SQL', () => {
  it('is the unique highest migration and is plain, static SQL', () => {
    const entry = MIGRATIONS.find((migration) => migration.version === 44);

    expect(entry).toEqual({
      version: 44,
      name: '0044_memory_lifecycle',
      sql: sql0044MemoryLifecycle,
    });
    expect(
      MIGRATIONS.filter((migration) => migration.version === 44),
    ).toHaveLength(1);
    // 45 since TASK_2026_461 appended 0045_skill_backlog_cleanup.
    // 46 since TASK_2026_473 appended 0046_memory_merge_subject_index.
    expect(Math.max(...MIGRATIONS.map((migration) => migration.version))).toBe(
      46,
    );
    expect(entry?.vecSql).toBeUndefined();
    expect(entry?.requiresVec).toBeUndefined();
    expect(entry?.run).toBeUndefined();
    expect(sql0044MemoryLifecycle).not.toContain('${');
  });

  it('drops obsolete indexes before either salience rebase update', () => {
    const salienceDrop = sql0044MemoryLifecycle.indexOf(
      'DROP INDEX IF EXISTS idx_memories_salience',
    );
    const tierDrop = sql0044MemoryLifecycle.indexOf(
      'DROP INDEX IF EXISTS idx_memories_tier',
    );
    const firstRebase = sql0044MemoryLifecycle.indexOf(
      'SET salience = MIN(1.0, MAX(0.0, salience - 0.45))',
    );

    expect(salienceDrop).toBeGreaterThan(-1);
    expect(tierDrop).toBeGreaterThan(-1);
    expect(firstRebase).toBeGreaterThan(salienceDrop);
    expect(firstRebase).toBeGreaterThan(tierDrop);
  });
});

describe('migration 0044_memory_lifecycle — behaviour', () => {
  const opener = resolveOpener();

  afterAll(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('has a SQLite binding to run against (fails instead of skipping)', () => {
    expect(opener).not.toBeNull();
  });

  function openAtVersion43(): DatabaseShape {
    if (!opener) {
      throw new Error(
        'No SQLite binding loaded (neither better-sqlite3 nor node:sqlite)',
      );
    }
    const db = opener(makeTempDbPath());
    db.exec('PRAGMA foreign_keys = ON');
    for (const migration of [...MIGRATIONS]
      .filter((candidate) => candidate.version <= 43)
      .sort((left, right) => left.version - right.version)) {
      if (migration.sql) {
        db.exec(migration.sql);
      }
    }
    return db;
  }

  function seedMemory(
    db: DatabaseShape,
    id: string,
    options: {
      sessionId: string | null;
      tier: 'recall' | 'archival';
      salience: number;
      pinned: number;
    },
  ): void {
    db.prepare(
      `INSERT INTO memories (
         id, session_id, workspace_root, tier, kind, content, salience,
         pinned, created_at, updated_at, last_used_at
       ) VALUES (?, ?, '/workspace', ?, 'fact', ?, ?, ?, 100, 100, 100)`,
    ).run(
      id,
      options.sessionId,
      options.tier,
      'fixture content',
      options.salience,
      options.pinned,
    );
  }

  it('rebases legacy salience and backfills archival time only for archival rows', () => {
    const db = openAtVersion43();
    try {
      seedMemory(db, 'unmerged', {
        sessionId: 'session-1',
        tier: 'recall',
        salience: 0.75,
        pinned: 0,
      });
      seedMemory(db, 'merged', {
        sessionId: 'session-2',
        tier: 'recall',
        salience: 1.9,
        pinned: 0,
      });
      seedMemory(db, 'low', {
        sessionId: 'session-3',
        tier: 'recall',
        salience: 0.5,
        pinned: 0,
      });
      seedMemory(db, 'writer', {
        sessionId: null,
        tier: 'recall',
        salience: 0.6,
        pinned: 0,
      });
      seedMemory(db, 'pinned', {
        sessionId: 'session-4',
        tier: 'recall',
        salience: 1.0,
        pinned: 1,
      });
      seedMemory(db, 'pinned-high', {
        sessionId: 'session-5',
        tier: 'recall',
        salience: 1.7,
        pinned: 1,
      });
      seedMemory(db, 'sessionless-low', {
        sessionId: null,
        tier: 'recall',
        salience: -0.2,
        pinned: 0,
      });
      seedMemory(db, 'sessionless-high', {
        sessionId: null,
        tier: 'recall',
        salience: 1.3,
        pinned: 0,
      });
      seedMemory(db, 'archived', {
        sessionId: null,
        tier: 'archival',
        salience: 0.6,
        pinned: 0,
      });

      const before = Math.floor(Date.now() / 1000) * 1000;
      db.exec(sql0044MemoryLifecycle);
      const after = Date.now();

      const rows = db
        .prepare(
          'SELECT id, tier, salience, archived_at FROM memories ORDER BY id',
        )
        .all() as Array<{
        id: string;
        tier: string;
        salience: number;
        archived_at: number | null;
      }>;
      const byId = new Map(rows.map((row) => [row.id, row]));

      expect(byId.get('unmerged')?.salience).toBeCloseTo(0.3, 10);
      expect(byId.get('merged')?.salience).toBe(1);
      expect(byId.get('low')?.salience).toBeCloseTo(0.05, 10);
      expect(byId.get('writer')?.salience).toBe(0.6);
      expect(byId.get('pinned')?.salience).toBe(1);
      expect(byId.get('pinned-high')?.salience).toBe(1);
      expect(byId.get('sessionless-low')?.salience).toBe(0);
      expect(byId.get('sessionless-high')?.salience).toBe(1);

      const archived = byId.get('archived');
      expect(archived).toBeDefined();
      expect(archived?.tier).toBe('archival');
      expect(archived?.salience).toBe(0.6);
      if (!archived || archived.archived_at === null) {
        throw new Error('Migration did not backfill archived_at');
      }
      expect(Number.isInteger(archived.archived_at)).toBe(true);
      expect(archived.archived_at % 1000).toBe(0);
      expect(archived.archived_at).toBeGreaterThanOrEqual(before);
      expect(archived.archived_at).toBeLessThanOrEqual(after);

      for (const id of [
        'unmerged',
        'merged',
        'low',
        'writer',
        'pinned',
        'pinned-high',
        'sessionless-low',
        'sessionless-high',
      ]) {
        expect(byId.get(id)?.archived_at).toBeNull();
      }
    } finally {
      db.close();
    }
  });

  it('replaces the old indexes with lifecycle and corpus lookup indexes', () => {
    const db = openAtVersion43();
    try {
      db.exec(sql0044MemoryLifecycle);
      const memoryIndexes = db
        .prepare("PRAGMA index_list('memories')")
        .all() as Array<{
        name: string;
      }>;
      const corpusIndexes = db
        .prepare("PRAGMA index_list('corpus_memories')")
        .all() as Array<{ name: string }>;
      const memoryNames = memoryIndexes.map((index) => index.name);
      const corpusNames = corpusIndexes.map((index) => index.name);

      expect(memoryNames).not.toContain('idx_memories_salience');
      expect(memoryNames).not.toContain('idx_memories_tier');
      expect(memoryNames).toEqual(
        expect.arrayContaining([
          'idx_memories_tier_last_used',
          'idx_memories_tier_archived',
        ]),
      );
      expect(corpusNames).toContain('idx_corpus_mem_memory');
    } finally {
      db.close();
    }
  });

  it('adds all nine retention columns with the specified defaults', () => {
    const db = openAtVersion43();
    try {
      db.exec(sql0044MemoryLifecycle);
      const columns = db
        .prepare("PRAGMA table_info('memory_retention_state')")
        .all() as Array<{
        name: string;
        notnull: number;
        dflt_value: string | null;
      }>;
      const byName = new Map(columns.map((column) => [column.name, column]));

      for (const name of [
        'memories_archived',
        'memories_deleted',
        'memories_evicted',
      ]) {
        expect(byName.get(name)).toMatchObject({
          name,
          notnull: 1,
          dflt_value: '0',
        });
      }
      for (const name of [
        'lifecycle_note',
        'preview_measured_at',
        'preview_for_run_at',
        'preview_archive_eligible',
        'preview_delete_eligible',
        'preview_over_cap',
      ]) {
        expect(byName.get(name)).toMatchObject({
          name,
          notnull: 0,
          dflt_value: null,
        });
      }
    } finally {
      db.close();
    }
  });
});
