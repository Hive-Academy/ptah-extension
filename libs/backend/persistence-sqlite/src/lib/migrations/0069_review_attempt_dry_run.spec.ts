import { sql as reviewSql } from './0065_ptah_review';
import { sql } from './0069_review_attempt_dry_run';
import { MIGRATIONS } from './index';

describe('migration 0069_review_attempt_dry_run', () => {
  it('registers after 0068 and defaults prior attempts to live mode', () => {
    const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => {
      exec(query: string): void;
      prepare(query: string): { all(): Array<{ name: string; dflt_value: string | null }> };
      close(): void;
    } };
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(reviewSql);
      db.exec(sql);
      expect(db.prepare('PRAGMA table_info(review_attempts)').all()).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'dry_run', dflt_value: '0' })]),
      );
      const previous = MIGRATIONS.findIndex((entry) => entry.version === 68);
      expect(MIGRATIONS[previous + 1]).toEqual({ version: 69, name: '0069_review_attempt_dry_run', sql });
      expect(sql).not.toContain('${');
    } finally { db.close(); }
  });
});
