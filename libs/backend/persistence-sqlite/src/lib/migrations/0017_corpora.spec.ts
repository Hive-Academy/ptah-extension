import 'reflect-metadata';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { sql as sql0002Memory } from './0002_memory';
import { sql as sql0017Corpora } from './0017_corpora';

function makeTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-migr0017-test-'));
  return path.join(dir, 'ptah.db');
}

describe('migration 0017_corpora — schema shape (skipped without native)', () => {
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

  interface DatabaseShape {
    exec(sql: string): void;
    prepare(sql: string): {
      run(...params: unknown[]): { changes: number };
      all(...params: unknown[]): unknown[];
      get(...params: unknown[]): unknown;
    };
    close(): void;
  }

  function openWithMemoriesBase(): {
    db: InstanceType<new (file: string) => DatabaseShape>;
  } {
    const Database = require('better-sqlite3') as new (
      file: string,
    ) => DatabaseShape;
    const dbPath = makeTempDbPath();
    const db = new Database(dbPath);
    db.exec(sql0002Memory);
    db.exec('PRAGMA foreign_keys = ON');
    return { db };
  }

  maybe('applies cleanly when memories table already exists', () => {
    const { db } = openWithMemoriesBase();
    try {
      expect(() => db.exec(sql0017Corpora)).not.toThrow();
    } finally {
      db.close();
    }
  });

  maybe(
    'creates corpora with expected columns + UNIQUE(name) + default primed_session_ids_json',
    () => {
      const { db } = openWithMemoriesBase();
      try {
        db.exec(sql0017Corpora);
        const cols = db.prepare('PRAGMA table_info(corpora)').all() as Array<{
          name: string;
          type: string;
          notnull: number;
          dflt_value: string | null;
          pk: number;
        }>;
        const byName = new Map(cols.map((c) => [c.name, c]));
        expect(byName.get('id')?.pk).toBeGreaterThan(0);
        expect(byName.get('name')?.notnull).toBe(1);
        expect(byName.get('query_json')?.notnull).toBe(1);
        expect(byName.get('built_at')?.type).toBe('INTEGER');
        expect(byName.get('built_at')?.notnull).toBe(1);
        expect(byName.get('rebuilt_at')?.notnull).toBe(0);
        expect(byName.get('primed_session_ids_json')?.notnull).toBe(1);
        expect(byName.get('primed_session_ids_json')?.dflt_value).toBe("'[]'");

        const insert = db.prepare(
          `INSERT INTO corpora (id, name, workspace_root, query_json, built_at)
           VALUES (?, ?, ?, ?, ?)`,
        );
        insert.run('c1', 'corpus-α', '/ws/A', '{}', 1000);
        expect(() => insert.run('c2', 'corpus-α', '/ws/B', '{}', 2000)).toThrow(
          /UNIQUE/i,
        );
      } finally {
        db.close();
      }
    },
  );

  maybe(
    'corpus_memories enforces composite PK and ON DELETE CASCADE from corpora',
    () => {
      const { db } = openWithMemoriesBase();
      try {
        db.exec(sql0017Corpora);

        db.prepare(
          `INSERT INTO memories (id, session_id, workspace_root, tier, kind, subject, content,
             source_message_ids, salience, decay_rate, hits, pinned,
             created_at, updated_at, last_used_at, expires_at)
           VALUES ('mem-1', NULL, '/ws/A', 'core', 'fact', NULL, 'body',
             '[]', 0, 0.01, 0, 0,
             1000, 1000, 1000, NULL)`,
        ).run();

        db.prepare(
          `INSERT INTO corpora (id, name, workspace_root, query_json, built_at)
           VALUES ('c1', 'corpus-α', '/ws/A', '{}', 1000)`,
        ).run();

        const insertJoin = db.prepare(
          `INSERT INTO corpus_memories (corpus_id, memory_id, ord) VALUES (?, ?, ?)`,
        );
        insertJoin.run('c1', 'mem-1', 0);
        expect(() => insertJoin.run('c1', 'mem-1', 1)).toThrow(
          /UNIQUE constraint failed|PRIMARY KEY/i,
        );

        db.prepare(`DELETE FROM corpora WHERE id = 'c1'`).run();
        const remaining = db
          .prepare(`SELECT COUNT(*) AS n FROM corpus_memories`)
          .get() as { n: number };
        expect(remaining.n).toBe(0);
      } finally {
        db.close();
      }
    },
  );

  maybe(
    'corpus_memories cascades when the referenced memory row is deleted',
    () => {
      const { db } = openWithMemoriesBase();
      try {
        db.exec(sql0017Corpora);

        db.prepare(
          `INSERT INTO memories (id, session_id, workspace_root, tier, kind, subject, content,
             source_message_ids, salience, decay_rate, hits, pinned,
             created_at, updated_at, last_used_at, expires_at)
           VALUES ('mem-1', NULL, '/ws/A', 'core', 'fact', NULL, 'body',
             '[]', 0, 0.01, 0, 0,
             1000, 1000, 1000, NULL)`,
        ).run();
        db.prepare(
          `INSERT INTO corpora (id, name, workspace_root, query_json, built_at)
           VALUES ('c1', 'corpus-α', '/ws/A', '{}', 1000)`,
        ).run();
        db.prepare(
          `INSERT INTO corpus_memories (corpus_id, memory_id, ord) VALUES (?, ?, ?)`,
        ).run('c1', 'mem-1', 0);

        db.prepare(`DELETE FROM memories WHERE id = 'mem-1'`).run();

        const remaining = db
          .prepare(`SELECT COUNT(*) AS n FROM corpus_memories`)
          .get() as { n: number };
        expect(remaining.n).toBe(0);
      } finally {
        db.close();
      }
    },
  );
});
