import 'reflect-metadata';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { sql as sql0002Memory } from './0002_memory';
import { sql as sql0010Fts5Porter } from './0010_fts5_porter';
import { sql as sql0017MemorySchemaV2 } from './0017_memory_schema_v2';

function makeTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-migr0017-test-'));
  return path.join(dir, 'ptah.db');
}

describe('migration 0017_memory_schema_v2 — schema shape (skipped without native)', () => {
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

  function openWithMemoryBase(): {
    db: InstanceType<new (file: string) => DatabaseShape>;
  } {
    const Database = require('better-sqlite3') as new (
      file: string,
    ) => DatabaseShape;
    const dbPath = makeTempDbPath();
    const db = new Database(dbPath);
    db.exec(sql0002Memory);
    db.exec(sql0010Fts5Porter);
    return { db };
  }

  maybe(
    'applies cleanly on a database already at the 0014 baseline (memories from 0002 + fts5 from 0010)',
    () => {
      const { db } = openWithMemoryBase();
      try {
        expect(() => db.exec(sql0017MemorySchemaV2)).not.toThrow();
      } finally {
        db.close();
      }
    },
  );

  maybe('adds the 5-field summary columns + type + json columns', () => {
    const { db } = openWithMemoryBase();
    try {
      db.exec(sql0017MemorySchemaV2);
      const cols = db.prepare('PRAGMA table_info(memories)').all() as Array<{
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
      }>;
      const byName = new Map(cols.map((c) => [c.name, c]));
      expect(byName.has('request')).toBe(true);
      expect(byName.has('investigated')).toBe(true);
      expect(byName.has('learned')).toBe(true);
      expect(byName.has('completed')).toBe(true);
      expect(byName.has('next_steps')).toBe(true);
      const typeCol = byName.get('type');
      expect(typeCol?.notnull).toBe(1);
      expect(typeCol?.dflt_value).toBe("'discovery'");
      const conceptsCol = byName.get('concepts_json');
      expect(conceptsCol?.notnull).toBe(1);
      expect(conceptsCol?.dflt_value).toBe("'[]'");
      const filesCol = byName.get('files_json');
      expect(filesCol?.notnull).toBe(1);
      expect(filesCol?.dflt_value).toBe("'[]'");
    } finally {
      db.close();
    }
  });

  maybe(
    'backfills pre-existing rows with defaults (type=discovery, concepts_json=[], files_json=[])',
    () => {
      const { db } = openWithMemoryBase();
      try {
        db.prepare(
          `INSERT INTO memories (id, session_id, workspace_root, tier, kind, subject, content,
              source_message_ids, salience, decay_rate, hits, pinned,
              created_at, updated_at, last_used_at, expires_at)
            VALUES ('legacy-1', NULL, '/ws/A', 'core', 'fact', NULL, 'legacy content',
              '[]', 0, 0.01, 0, 0,
              1000, 1000, 1000, NULL)`,
        ).run();

        db.exec(sql0017MemorySchemaV2);

        const row = db
          .prepare(
            'SELECT type, concepts_json, files_json, request, investigated, learned, completed, next_steps FROM memories WHERE id = ?',
          )
          .get('legacy-1') as {
          type: string;
          concepts_json: string;
          files_json: string;
          request: string | null;
          investigated: string | null;
          learned: string | null;
          completed: string | null;
          next_steps: string | null;
        };
        expect(row.type).toBe('discovery');
        expect(row.concepts_json).toBe('[]');
        expect(row.files_json).toBe('[]');
        expect(row.request).toBeNull();
        expect(row.investigated).toBeNull();
        expect(row.learned).toBeNull();
        expect(row.completed).toBeNull();
        expect(row.next_steps).toBeNull();
      } finally {
        db.close();
      }
    },
  );

  maybe(
    'creates memory_concepts_fts as a contentless FTS5 with memory_id UNINDEXED + concept',
    () => {
      const { db } = openWithMemoryBase();
      try {
        db.exec(sql0017MemorySchemaV2);
        const exists = db
          .prepare(
            `SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name = 'memory_concepts_fts'`,
          )
          .get() as { name: string } | undefined;
        expect(exists?.name).toBe('memory_concepts_fts');
      } finally {
        db.close();
      }
    },
  );

  maybe(
    'INSERT FROM SELECT populates memory_concepts_fts and MATCH returns hits',
    () => {
      const { db } = openWithMemoryBase();
      try {
        db.exec(sql0017MemorySchemaV2);

        db.prepare(
          `INSERT INTO memories (id, session_id, workspace_root, tier, kind, subject, content,
             source_message_ids, salience, decay_rate, hits, pinned,
             created_at, updated_at, last_used_at, expires_at,
             type, concepts_json, files_json)
           VALUES ('mem-α', NULL, '/ws/A', 'core', 'fact', 'subject-α', 'body-α',
             '[]', 0, 0.01, 0, 0,
             1000, 1000, 1000, NULL,
             'feature', '["concept-alpha","shared-tag"]', '["a.ts"]')`,
        ).run();
        db.prepare(
          `INSERT INTO memories (id, session_id, workspace_root, tier, kind, subject, content,
             source_message_ids, salience, decay_rate, hits, pinned,
             created_at, updated_at, last_used_at, expires_at,
             type, concepts_json, files_json)
           VALUES ('mem-β', NULL, '/ws/A', 'core', 'fact', 'subject-β', 'body-β',
             '[]', 0, 0.01, 0, 0,
             2000, 2000, 2000, NULL,
             'bugfix', '["concept-beta","shared-tag"]', '["b.ts"]')`,
        ).run();

        db.exec(
          `INSERT INTO memory_concepts_fts(memory_id, concept)
           SELECT memories.id, json_each.value FROM memories, json_each(memories.concepts_json)`,
        );

        const alphaHits = db
          .prepare(
            `SELECT memory_id FROM memory_concepts_fts WHERE memory_concepts_fts MATCH '"concept-alpha"'`,
          )
          .all() as Array<{ memory_id: string }>;
        expect(alphaHits.map((h) => h.memory_id)).toEqual(['mem-α']);

        const sharedHits = db
          .prepare(
            `SELECT memory_id FROM memory_concepts_fts WHERE memory_concepts_fts MATCH '"shared-tag"' ORDER BY memory_id`,
          )
          .all() as Array<{ memory_id: string }>;
        expect(sharedHits.map((h) => h.memory_id).sort()).toEqual([
          'mem-α',
          'mem-β',
        ]);
      } finally {
        db.close();
      }
    },
  );

  maybe(
    'AFTER DELETE trigger removes concept rows so MATCH no longer returns the deleted memory',
    () => {
      const { db } = openWithMemoryBase();
      try {
        db.exec(sql0017MemorySchemaV2);

        db.prepare(
          `INSERT INTO memories (id, session_id, workspace_root, tier, kind, subject, content,
             source_message_ids, salience, decay_rate, hits, pinned,
             created_at, updated_at, last_used_at, expires_at,
             type, concepts_json, files_json)
           VALUES ('mem-γ', NULL, '/ws/A', 'core', 'fact', 'subject-γ', 'body-γ',
             '[]', 0, 0.01, 0, 0,
             3000, 3000, 3000, NULL,
             'discovery', '["gamma-concept"]', '[]')`,
        ).run();

        db.exec(
          `INSERT INTO memory_concepts_fts(memory_id, concept)
           SELECT memories.id, json_each.value FROM memories, json_each(memories.concepts_json) WHERE memories.id = 'mem-γ'`,
        );

        const before = db
          .prepare(
            `SELECT COUNT(*) AS n FROM memory_concepts_fts WHERE memory_concepts_fts MATCH '"gamma-concept"'`,
          )
          .get() as { n: number };
        expect(before.n).toBe(1);

        db.prepare(`DELETE FROM memories WHERE id = 'mem-γ'`).run();

        const after = db
          .prepare(
            `SELECT COUNT(*) AS n FROM memory_concepts_fts WHERE memory_concepts_fts MATCH '"gamma-concept"'`,
          )
          .get() as { n: number };
        expect(after.n).toBe(0);
      } finally {
        db.close();
      }
    },
  );

  maybe(
    "delete-all shadow command + INSERT FROM SELECT rebuilds the index without 'rebuild' (per [[project_fts5_external_content_column_mismatch]])",
    () => {
      const { db } = openWithMemoryBase();
      try {
        db.exec(sql0017MemorySchemaV2);

        db.prepare(
          `INSERT INTO memories (id, session_id, workspace_root, tier, kind, subject, content,
             source_message_ids, salience, decay_rate, hits, pinned,
             created_at, updated_at, last_used_at, expires_at,
             type, concepts_json, files_json)
           VALUES ('mem-δ', NULL, '/ws/A', 'core', 'fact', 'subject-δ', 'body-δ',
             '[]', 0, 0.01, 0, 0,
             4000, 4000, 4000, NULL,
             'feature', '["delta-concept"]', '[]')`,
        ).run();

        expect(() =>
          db.exec(
            `INSERT INTO memory_concepts_fts(memory_concepts_fts) VALUES('delete-all');
             INSERT INTO memory_concepts_fts(memory_id, concept)
               SELECT memories.id, json_each.value FROM memories, json_each(memories.concepts_json);`,
          ),
        ).not.toThrow();

        const hits = db
          .prepare(
            `SELECT memory_id FROM memory_concepts_fts WHERE memory_concepts_fts MATCH '"delta-concept"'`,
          )
          .all() as Array<{ memory_id: string }>;
        expect(hits.map((h) => h.memory_id)).toEqual(['mem-δ']);
      } finally {
        db.close();
      }
    },
  );
});
