import 'reflect-metadata';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { sql as sql0021SkillInvocationEvents } from './0021_skill_invocation_events';
import { sql as sql0027SkillEventReconciliation } from './0027_skill_event_reconciliation';
import { sql as sql0030SkillEventMetrics } from './0030_skill_event_metrics';
import { MIGRATIONS } from './index';

describe('migration 0030_skill_event_metrics — registry entry', () => {
  it('is registered as version 30, plain sql, NOT vec-gated', () => {
    const entry = MIGRATIONS.find((m) => m.version === 30);
    expect(entry).toBeDefined();
    expect(entry?.name).toBe('0030_skill_event_metrics');
    expect(entry?.sql).toBe(sql0030SkillEventMetrics);
    expect(entry?.vecSql).toBeUndefined();
    expect(entry?.requiresVec).toBeUndefined();
    expect(entry?.run).toBeUndefined();
  });

  it('is the highest version (appended, not inserted)', () => {
    const maxVersion = Math.max(...MIGRATIONS.map((m) => m.version));
    expect(maxVersion).toBe(30);
  });
});

function makeTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-migr0030-test-'));
  return path.join(dir, 'ptah.db');
}

describe('migration 0030_skill_event_metrics — schema shape (skipped without native)', () => {
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
    'adds eight nullable metric/task columns to skill_invocation_events',
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
        db.exec(sql0027SkillEventReconciliation);
        expect(() => db.exec(sql0030SkillEventMetrics)).not.toThrow();

        const cols = db
          .prepare('PRAGMA table_info(skill_invocation_events)')
          .all() as Array<{ name: string; type: string; notnull: number }>;
        const byName = new Map(cols.map((c) => [c.name, c]));

        const expected: Array<{ name: string; type: string }> = [
          { name: 'input_tokens', type: 'INTEGER' },
          { name: 'output_tokens', type: 'INTEGER' },
          { name: 'cache_read_tokens', type: 'INTEGER' },
          { name: 'cache_creation_tokens', type: 'INTEGER' },
          { name: 'cost_usd', type: 'REAL' },
          { name: 'duration_ms', type: 'INTEGER' },
          { name: 'tool_count', type: 'INTEGER' },
          { name: 'task_id', type: 'TEXT' },
        ];

        for (const { name, type } of expected) {
          const col = byName.get(name);
          expect(col).toBeDefined();
          expect(col?.type).toBe(type);
          // All widened columns are nullable (no NOT NULL / no default) so
          // pre-existing rows remain valid without a backfill.
          expect(col?.notnull).toBe(0);
        }
      } finally {
        db.close();
      }
    },
  );

  maybe(
    'creates the composite (skill_slug, task_id) index backing the exact reconcile pass',
    () => {
      interface DatabaseShape {
        exec(sql: string): void;
        prepare(sql: string): {
          all(...params: unknown[]): unknown[];
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
        db.exec(sql0027SkillEventReconciliation);
        db.exec(sql0030SkillEventMetrics);

        const indexes = db
          .prepare('PRAGMA index_list(skill_invocation_events)')
          .all() as Array<{ name: string }>;
        expect(
          indexes.some((i) => i.name === 'idx_skill_inv_events_task'),
        ).toBe(true);

        const indexCols = db
          .prepare('PRAGMA index_info(idx_skill_inv_events_task)')
          .all() as Array<{ name: string }>;
        expect(indexCols.map((c) => c.name)).toEqual(['skill_slug', 'task_id']);
      } finally {
        db.close();
      }
    },
  );
});
