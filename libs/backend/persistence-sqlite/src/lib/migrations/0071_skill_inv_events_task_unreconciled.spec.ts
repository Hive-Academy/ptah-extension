import { sql } from './0071_skill_inv_events_task_unreconciled';
import { MIGRATIONS } from './index';

interface DatabaseShape {
  exec(statement: string): void;
  prepare(statement: string): {
    all(...params: (string | number | null)[]): unknown;
  };
  close(): void;
}

describe('migration 0071_skill_inv_events_task_unreconciled', () => {
  it('registers after 0070 as the latest migration', () => {
    const previous = MIGRATIONS.findIndex((migration) => migration.version === 70);
    expect(MIGRATIONS[previous + 1]).toEqual({
      version: 71,
      name: '0071_skill_inv_events_task_unreconciled',
      sql,
    });
    expect(MIGRATIONS[MIGRATIONS.length - 1]?.version).toBe(71);
    expect(sql).not.toContain('${');
  });

  it('serves the unreconciled task lookup from the partial task index', () => {
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (file: string) => DatabaseShape;
    };
    const db = new DatabaseSync(':memory:');
    try {
      // The columns the lookup reads, with the existing slug-leading index.
      db.exec(`CREATE TABLE skill_invocation_events (
        id TEXT PRIMARY KEY, skill_slug TEXT NOT NULL, task_id TEXT,
        workspace_root TEXT, reconciled_at INTEGER);
        CREATE INDEX idx_skill_inv_events_task
          ON skill_invocation_events(skill_slug, task_id);`);
      db.exec(sql);
      db.exec(sql); // idempotent
      const plan = db
        .prepare(
          `EXPLAIN QUERY PLAN SELECT id, workspace_root FROM skill_invocation_events
           WHERE task_id = ? AND reconciled_at IS NULL`,
        )
        .all('TASK_1') as { detail: string }[];
      expect(plan.map((row) => row.detail).join('\n')).toContain(
        'idx_skill_inv_events_task_unreconciled',
      );
    } finally {
      db.close();
    }
  });
});
