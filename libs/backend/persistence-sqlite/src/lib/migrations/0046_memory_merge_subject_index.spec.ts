import 'reflect-metadata';
import { sql as sql0046MemoryMergeSubjectIndex } from './0046_memory_merge_subject_index';
import { MIGRATIONS } from './index';

interface DatabaseShape {
  exec(sql: string): void;
  prepare(sql: string): {
    all(...params: unknown[]): Array<{ detail: string }>;
  };
  close(): void;
}

function openMemoryDatabase(): DatabaseShape {
  const Database = require('better-sqlite3') as new (
    file: string,
  ) => DatabaseShape;
  return new Database(':memory:');
}

describe('migration 0046_memory_merge_subject_index', () => {
  it('is the unique latest plain-SQL migration', () => {
    const entry = MIGRATIONS.find((migration) => migration.version === 46);

    expect(entry).toEqual({
      version: 46,
      name: '0046_memory_merge_subject_index',
      sql: sql0046MemoryMergeSubjectIndex,
    });
    expect(
      MIGRATIONS.filter((migration) => migration.version === 46),
    ).toHaveLength(1);
    expect(Math.max(...MIGRATIONS.map((migration) => migration.version))).toBe(
      47,
    );
    expect(sql0046MemoryMergeSubjectIndex).not.toContain('${');
  });

  it('creates an index SQLite uses for the exact normalized merge predicate', () => {
    const db = openMemoryDatabase();
    try {
      // Two separate exec calls, not one interpolated template: migration SQL
      // must stay static text, and the lint rule that enforces it reads this
      // file too.
      db.exec(`
        CREATE TABLE memories (
          id TEXT PRIMARY KEY,
          workspace_root TEXT,
          subject TEXT
        );
      `);
      db.exec(sql0046MemoryMergeSubjectIndex);

      const plan = db
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT id
             FROM memories
            WHERE workspace_root IS ?
              AND subject IS NOT NULL
              AND TRIM(LOWER(subject)) IN (?)`,
        )
        .all('/ws', 'padded-subject');

      expect(plan.map((row) => row.detail).join('\n')).toContain(
        'idx_memories_ws_normalized_subject',
      );
    } finally {
      db.close();
    }
  });
});
