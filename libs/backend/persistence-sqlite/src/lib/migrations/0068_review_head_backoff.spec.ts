import { sql as reviewSql } from './0065_ptah_review';
import { sql as failureSql } from './0067_review_failure_records';
import { sql } from './0068_review_head_backoff';
import { MIGRATIONS } from './index';

describe('migration 0068_review_head_backoff', () => {
  it('registers after 0067 and adds retry fields with defaults', () => {
    const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => {
      exec(query: string): void;
      prepare(query: string): { all(): Array<{ name: string; dflt_value: string | null }> };
      close(): void;
    } };
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(reviewSql);
      db.exec(failureSql);
      db.exec(sql);
      const columns = db.prepare('PRAGMA table_info(review_heads)').all();
      expect(columns).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'failure_count', dflt_value: '0' }),
        expect.objectContaining({ name: 'next_eligible_at', dflt_value: null }),
      ]));
      const previousIndex = MIGRATIONS.findIndex((entry) => entry.version === 67);
      expect(MIGRATIONS[previousIndex + 1]).toEqual({ version: 68, name: '0068_review_head_backoff', sql });
      expect(MIGRATIONS.filter((entry) => entry.version === 68)).toHaveLength(1);
      expect(sql).not.toContain('${');
    } finally {
      db.close();
    }
  });
});
