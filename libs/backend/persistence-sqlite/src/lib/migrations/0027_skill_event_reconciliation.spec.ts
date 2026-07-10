import 'reflect-metadata';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { sql as sql0021SkillInvocationEvents } from './0021_skill_invocation_events';
import { sql as sql0027SkillEventReconciliation } from './0027_skill_event_reconciliation';
import { MIGRATIONS } from './index';

describe('migration 0027_skill_event_reconciliation — registry entry', () => {
  it('is registered as version 27, plain sql, NOT vec-gated', () => {
    const entry = MIGRATIONS.find((m) => m.version === 27);
    expect(entry).toBeDefined();
    expect(entry?.name).toBe('0027_skill_event_reconciliation');
    expect(entry?.sql).toBe(sql0027SkillEventReconciliation);
    expect(entry?.vecSql).toBeUndefined();
    expect(entry?.requiresVec).toBeUndefined();
    expect(entry?.run).toBeUndefined();
  });
});

function makeTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-migr0027-test-'));
  return path.join(dir, 'ptah.db');
}

describe('migration 0027_skill_event_reconciliation — schema shape (skipped without native)', () => {
  let nativeAvailable = false;
  try {
    require.resolve('better-sqlite3');
    const Database = require('better-sqlite3') as new (file: string) => {
      close(): void;
    };
    const probe = new Database(':memory:');
    probe.close();
    nativeAvailable = true;
  } catch {
    nativeAvailable = false;
  }

  const maybe = nativeAvailable ? it : it.skip;

  maybe(
    'adds nullable reconciled_at + verdict_source to skill_invocation_events',
    () => {
      interface DatabaseShape {
        exec(sql: string): void;
        prepare(sql: string): {
          all(...params: unknown[]): unknown[];
          get(...params: unknown[]): unknown;
          run(...params: unknown[]): { changes: number };
        };
        close(): void;
      }
      const Database = require('better-sqlite3') as new (
        file: string,
      ) => DatabaseShape;
      const dbPath = makeTempDbPath();
      const db = new Database(dbPath);
      try {
        db.exec(sql0021SkillInvocationEvents);
        expect(() => db.exec(sql0027SkillEventReconciliation)).not.toThrow();

        const cols = db
          .prepare('PRAGMA table_info(skill_invocation_events)')
          .all() as Array<{ name: string; type: string; notnull: number }>;
        const reconciledAt = cols.find((c) => c.name === 'reconciled_at');
        const verdictSource = cols.find((c) => c.name === 'verdict_source');
        expect(reconciledAt).toBeDefined();
        expect(reconciledAt?.notnull).toBe(0);
        expect(verdictSource).toBeDefined();
        expect(verdictSource?.notnull).toBe(0);
      } finally {
        db.close();
      }
    },
  );
});
