/** Real schema lineage, isolated in-memory databases; never opens a user's file. */
import 'reflect-metadata';
import { sql } from './0047_memory_retention_health';
import { MIGRATIONS } from './index';

interface DatabaseShape {
  exec(sql: string): void;
  prepare(sql: string): { all(): unknown[] };
  close(): void;
}

function openDatabase(): DatabaseShape {
  try {
    const Database = require('better-sqlite3') as new (
      file: string,
    ) => DatabaseShape;
    return new Database(':memory:');
  } catch {
    // Electron's native ABI may not load in Jest. Node 24's binding must then
    // work: an unavailable fallback throws and fails the test instead of skipping.
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (file: string) => DatabaseShape;
    };
    return new DatabaseSync(':memory:');
  }
}

describe('migration 0047_memory_retention_health', () => {
  it('is registered once as the latest, plain static SQL migration', () => {
    expect(MIGRATIONS.filter((m) => m.version === 47)).toEqual([
      { version: 47, name: '0047_memory_retention_health', sql },
    ]);
    expect(Math.max(...MIGRATIONS.map((m) => m.version))).toBe(47);
    expect(sql).not.toContain('${');
    expect(sql.match(/ALTER TABLE/g)).toHaveLength(2);
    expect(sql).not.toMatch(/\b(CREATE|DROP|INSERT|UPDATE|DELETE|SELECT)\b/i);
  });

  it.each([false, true])(
    'adds defaults without inventing history (existing row: %s)',
    (existing) => {
      const db = openDatabase();
      try {
        db.exec('PRAGMA foreign_keys = ON');
        for (const migration of MIGRATIONS.filter((m) => m.version < 47)) {
          if (migration.sql) db.exec(migration.sql);
        }
        if (existing) {
          db.exec(`INSERT INTO memory_retention_state
          (id, last_completed_at, last_skipped_at, last_skip_reason)
          VALUES (1, 100, 200, 'on-battery')`);
        }
        db.exec(sql);
        const columns = db
          .prepare('PRAGMA table_info(memory_retention_state)')
          .all();
        expect(columns).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              name: 'attempt_count',
              type: 'INTEGER',
              notnull: 1,
              dflt_value: '0',
            }),
            expect.objectContaining({
              name: 'first_attempt_at',
              type: 'INTEGER',
              notnull: 0,
              dflt_value: null,
            }),
          ]),
        );
        expect(
          db
            .prepare(
              `SELECT last_completed_at, last_skipped_at, last_skip_reason,
        attempt_count, first_attempt_at FROM memory_retention_state`,
            )
            .all(),
        ).toEqual(
          existing
            ? [
                {
                  last_completed_at: 100,
                  last_skipped_at: 200,
                  last_skip_reason: 'on-battery',
                  attempt_count: 0,
                  first_attempt_at: null,
                },
              ]
            : [],
        );
        // Like other ADD COLUMN migrations, exactly-once application belongs to
        // the runner. Replaying raw DDL is deliberately not silently accepted.
        expect(() => db.exec(sql)).toThrow(/duplicate column/i);
      } finally {
        db.close();
      }
    },
  );
});
