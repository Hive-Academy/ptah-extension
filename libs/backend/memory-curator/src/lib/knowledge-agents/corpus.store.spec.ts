/**
 * Specs for CorpusStore — exercises the `corpora` + `corpus_memories` schema
 * landed by migration 0017. Native-gated so CI without `better-sqlite3` is
 * skipped, mirroring `observation-queue.store.spec.ts`.
 */
import 'reflect-metadata';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Logger } from '@ptah-extension/vscode-core';
import { SqliteConnectionService } from '@ptah-extension/persistence-sqlite';
import { CorpusStore } from './corpus.store';
import type { BuildCorpusParams } from './corpus.types';

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function makeTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-corpus-store-test-'));
  return path.join(dir, 'ptah.db');
}

describe('CorpusStore (native-gated)', () => {
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

  async function bootstrap(): Promise<{
    service: SqliteConnectionService;
    store: CorpusStore;
  }> {
    const dbPath = makeTempDbPath();
    const logger = makeLogger();
    const service = new SqliteConnectionService(dbPath, logger);
    await service.openAndMigrate();
    const store = new CorpusStore(logger, service);
    return { service, store };
  }

  function seedMemory(
    service: SqliteConnectionService,
    id: string,
    workspaceRoot: string | null,
  ): void {
    const now = Date.now();
    service.db
      .prepare(
        `INSERT INTO memories
           (id, session_id, workspace_root, tier, kind, subject, content,
            source_message_ids, salience, decay_rate, hits, pinned,
            created_at, updated_at, last_used_at, expires_at,
            type, concepts_json, files_json)
         VALUES (?, NULL, ?, 'recall', 'fact', ?, 'content', '[]', 0.5, 0.01, 0, 0,
                 ?, ?, ?, NULL, 'discovery', '[]', '[]')`,
      )
      .run(id, workspaceRoot, `subj-${id}`, now, now, now);
  }

  const baseParams: BuildCorpusParams = {
    name: 'corpus-A',
    workspaceRoot: '/ws/X',
    query: 'tag search',
    type: ['feature'],
    concepts: ['memory', 'curator'],
    files: [],
    limit: 50,
  };

  maybe(
    'create + getByName round-trips identity, query blob, builtAt',
    async () => {
      const { service, store } = await bootstrap();
      try {
        const ref = store.create(baseParams);
        expect(ref.id).toBeTruthy();
        expect(ref.name).toBe('corpus-A');
        expect(ref.workspaceRoot).toBe('/ws/X');
        expect(ref.count).toBe(0);
        expect(ref.builtAt).toBeGreaterThan(0);
        expect(ref.rebuiltAt).toBeNull();

        const fetched = store.getByName('corpus-A');
        expect(fetched).not.toBeNull();
        expect(fetched?.id).toBe(ref.id);
        const parsed = JSON.parse(fetched?.queryJson ?? '{}');
        expect(parsed.query).toBe('tag search');
        expect(parsed.type).toEqual(['feature']);
        expect(fetched?.primedSessionIds).toEqual([]);
      } finally {
        service.close();
      }
    },
  );

  maybe(
    'setMemberIds persists ordered ids and getMemberIds returns them in order',
    async () => {
      const { service, store } = await bootstrap();
      try {
        const ref = store.create(baseParams);
        seedMemory(service, 'mem-1', '/ws/X');
        seedMemory(service, 'mem-2', '/ws/X');
        seedMemory(service, 'mem-3', '/ws/X');
        store.setMemberIds(ref.id, ['mem-2', 'mem-1', 'mem-3']);
        expect(store.getMemberIds(ref.id)).toEqual(['mem-2', 'mem-1', 'mem-3']);
        expect(store.countMembers(ref.id)).toBe(3);
      } finally {
        service.close();
      }
    },
  );

  maybe('setMemberIds replaces existing membership atomically', async () => {
    const { service, store } = await bootstrap();
    try {
      const ref = store.create(baseParams);
      seedMemory(service, 'mem-1', '/ws/X');
      seedMemory(service, 'mem-2', '/ws/X');
      store.setMemberIds(ref.id, ['mem-1', 'mem-2']);
      store.setMemberIds(ref.id, ['mem-2']);
      expect(store.getMemberIds(ref.id)).toEqual(['mem-2']);
    } finally {
      service.close();
    }
  });

  maybe('list filters by workspaceRoot via NULL-safe equality', async () => {
    const { service, store } = await bootstrap();
    try {
      store.create({ ...baseParams, name: 'a', workspaceRoot: '/ws/A' });
      store.create({ ...baseParams, name: 'b', workspaceRoot: '/ws/B' });
      store.create({ ...baseParams, name: 'c', workspaceRoot: null });
      expect(store.list({ workspaceRoot: '/ws/A' }).map((c) => c.name)).toEqual(
        ['a'],
      );
      expect(store.list({ workspaceRoot: null }).map((c) => c.name)).toEqual([
        'c',
      ]);
      expect(store.list().length).toBe(3);
    } finally {
      service.close();
    }
  });

  maybe('delete cascades to corpus_memories via FK', async () => {
    const { service, store } = await bootstrap();
    try {
      const ref = store.create(baseParams);
      seedMemory(service, 'mem-1', '/ws/X');
      store.setMemberIds(ref.id, ['mem-1']);
      expect(store.countMembers(ref.id)).toBe(1);
      expect(store.delete(ref.id)).toBe(true);
      expect(store.getByName('corpus-A')).toBeNull();
      const remaining = service.db
        .prepare(
          `SELECT COUNT(*) AS n FROM corpus_memories WHERE corpus_id = ?`,
        )
        .get(ref.id) as { n: number };
      expect(remaining.n).toBe(0);
    } finally {
      service.close();
    }
  });

  maybe('updateRebuiltAt bumps rebuilt_at', async () => {
    const { service, store } = await bootstrap();
    try {
      const ref = store.create(baseParams);
      expect(store.getByName('corpus-A')?.rebuiltAt).toBeNull();
      store.updateRebuiltAt(ref.id);
      expect(store.getByName('corpus-A')?.rebuiltAt).not.toBeNull();
    } finally {
      service.close();
    }
  });

  maybe('setPrimedSessionIds persists and round-trips', async () => {
    const { service, store } = await bootstrap();
    try {
      const ref = store.create(baseParams);
      store.setPrimedSessionIds(ref.id, ['sess-1', 'sess-2']);
      expect(store.getByName('corpus-A')?.primedSessionIds).toEqual([
        'sess-1',
        'sess-2',
      ]);
    } finally {
      service.close();
    }
  });

  maybe(
    'malformed primed_session_ids_json degrades to empty array',
    async () => {
      const { service, store } = await bootstrap();
      try {
        const ref = store.create(baseParams);
        service.db
          .prepare(
            `UPDATE corpora SET primed_session_ids_json = ? WHERE id = ?`,
          )
          .run('not-json', ref.id);
        expect(store.getByName('corpus-A')?.primedSessionIds).toEqual([]);
      } finally {
        service.close();
      }
    },
  );

  maybe(
    'onChange emits built on create, rebuilt on updateRebuiltAt, primed on setPrimedSessionIds, deleted on delete',
    async () => {
      const { service, store } = await bootstrap();
      try {
        const events: Array<{ action: string; name: string; count: number }> =
          [];
        const sub = store.onChange((evt) => {
          events.push({
            action: evt.action,
            name: evt.name,
            count: evt.count,
          });
        });
        const ref = store.create(baseParams);
        seedMemory(service, 'mem-1', '/ws/A');
        store.setMemberIds(ref.id, ['mem-1']);
        store.updateRebuiltAt(ref.id);
        store.setPrimedSessionIds(ref.id, ['sess-1']);
        const deleted = store.delete(ref.id);
        expect(deleted).toBe(true);
        sub.dispose();
        const actions = events.map((e) => e.action);
        expect(actions).toEqual(['built', 'rebuilt', 'primed', 'deleted']);
        const built = events[0];
        expect(built.name).toBe('corpus-A');
        expect(built.count).toBe(0);
        const rebuilt = events[1];
        expect(rebuilt.count).toBe(1);
        const primed = events[2];
        expect(primed.count).toBe(1);
      } finally {
        service.close();
      }
    },
  );

  maybe(
    'onChange does not emit primed when sessionIds list is cleared',
    async () => {
      const { service, store } = await bootstrap();
      try {
        const ref = store.create(baseParams);
        const events: string[] = [];
        store.onChange((evt) => {
          events.push(evt.action);
        });
        store.setPrimedSessionIds(ref.id, []);
        expect(events.includes('primed')).toBe(false);
      } finally {
        service.close();
      }
    },
  );

  maybe('onChange dispose detaches listener', async () => {
    const { service, store } = await bootstrap();
    try {
      const events: string[] = [];
      const sub = store.onChange((evt) => {
        events.push(evt.action);
      });
      sub.dispose();
      store.create({ ...baseParams, name: 'corpus-after-dispose' });
      expect(events).toEqual([]);
    } finally {
      service.close();
    }
  });
});
