import { sql as indexingStateSql } from './0012_indexing_state';
import { sql } from './0070_indexing_last_run';
import { MIGRATIONS } from './index';

interface DatabaseShape {
  exec(statement: string): void;
  prepare(statement: string): {
    run(...params: (string | number | null)[]): unknown;
    get(...params: (string | number | null)[]): unknown;
    all(...params: (string | number | null)[]): unknown;
  };
  close(): void;
}

describe('migration 0070_indexing_last_run', () => {
  it('registers after 0069 and adds a nullable column without changing existing rows', () => {
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (file: string) => DatabaseShape;
    };
    const db = new DatabaseSync(':memory:');
    try {
      const previous = MIGRATIONS.findIndex((migration) => migration.version === 69);
      expect(MIGRATIONS[previous + 1]).toEqual({ version: 70, name: '0070_indexing_last_run', sql });
      expect(MIGRATIONS[MIGRATIONS.length - 1]?.version).toBe(71);
      db.exec(indexingStateSql);
      db.prepare(`INSERT INTO indexing_state
        (workspace_fingerprint, git_head_sha, last_indexed_at, last_error)
        VALUES (?, ?, ?, ?)`).run('fp', 'head', 123, 'old error');
      db.exec(sql);
      const columns = db.prepare('PRAGMA table_info(indexing_state)').all() as {
        name: string; notnull: number;
      }[];
      expect(columns.find((column) => column.name === 'last_run_json')).toMatchObject({ notnull: 0 });
      expect(db.prepare(`SELECT workspace_fingerprint, git_head_sha,
        last_indexed_at, last_error, last_run_json FROM indexing_state`).get()).toEqual({
        workspace_fingerprint: 'fp',
        git_head_sha: 'head',
        last_indexed_at: 123,
        last_error: 'old error',
        last_run_json: null,
      });
    } finally {
      db.close();
    }
  });
});
