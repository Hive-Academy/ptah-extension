import { sql as reviewSql } from './0065_ptah_review';
import { sql as publicationSql } from './0066_review_publication';
import { sql } from './0067_review_failure_records';
import { MIGRATIONS } from './index';

describe('migration 0067_review_failure_records', () => {
  it('adds nullable failure fields while preserving old attempts', () => {
    const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => {
      exec(query: string): void; prepare(query: string): { all(): Array<{ name: string }> }; close(): void;
    } };
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(reviewSql);
      db.exec(publicationSql);
      db.exec(sql);
      const columns = db.prepare('PRAGMA table_info(review_attempts)').all();
      expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining(['failure_stage', 'failure_code', 'failure_message']));
      const previousIndex = MIGRATIONS.findIndex((entry) => entry.version === 66);
      expect(MIGRATIONS[previousIndex + 1]).toEqual({ version: 67, name: '0067_review_failure_records', sql });
      expect(MIGRATIONS.filter((entry) => entry.version === 67)).toHaveLength(1);
      expect(sql).not.toContain('${');
    } finally { db.close(); }
  });
});
