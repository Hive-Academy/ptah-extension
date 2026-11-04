import { sql as baseSql } from './0065_ptah_review';
import { sql } from './0066_review_publication';
import { MIGRATIONS } from './index';

interface DatabaseShape {
  exec(statement: string): void;
  prepare(statement: string): { all(...params: string[]): { name: string }[] };
  close(): void;
}

describe('migration 0066_review_publication', () => {
  it('registers after 0065 and adds identity and reconciliation fields', () => {
    const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (file: string) => DatabaseShape };
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(baseSql);
      db.exec(sql);
      expect(MIGRATIONS.find((entry) => entry.version === 66)).toEqual({ version: 66, name: '0066_review_publication', sql });
      const columns = (table: string) => db.prepare('SELECT name FROM pragma_table_info(?)').all(table).map((row) => row.name);
      expect(columns('review_findings')).toEqual(expect.arrayContaining(['symbol_id', 'failure_mode', 'affected_behavior', 'addressed_at', 'reopened_at']));
      expect(columns('review_identity_matches')).toEqual(expect.arrayContaining(['source_head_sha', 'lens_family', 'suppression_reason']));
      expect(columns('review_publications')).toEqual(expect.arrayContaining(['finding_id', 'last_reconciled_at']));
      expect(sql).not.toContain('${');
    } finally {
      db.close();
    }
  });
});
