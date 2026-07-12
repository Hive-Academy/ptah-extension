/**
 * Specs for CorpusSuggestionService — the deterministic, read-only clustering
 * pass behind `corpus:suggest`. Drives a real in-memory-migrated SQLite via the
 * shared connection (native-gated, mirroring `corpus.store.spec.ts`).
 */
import 'reflect-metadata';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Logger } from '@ptah-extension/vscode-core';
import { SqliteConnectionService } from '@ptah-extension/persistence-sqlite';
import { CorpusStore } from './corpus.store';
import { CorpusSuggestionService } from './corpus-suggestion.service';

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function makeTempDbPath(): string {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ptah-corpus-suggest-test-'),
  );
  return path.join(dir, 'ptah.db');
}

interface SeedOpts {
  readonly id: string;
  readonly workspaceRoot: string | null;
  readonly type: string;
  readonly concepts: readonly string[];
  readonly kind?: string;
}

describe('CorpusSuggestionService (native-gated)', () => {
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
    suggestions: CorpusSuggestionService;
  }> {
    const dbPath = makeTempDbPath();
    const logger = makeLogger();
    const service = new SqliteConnectionService(dbPath, logger);
    await service.openAndMigrate();
    const store = new CorpusStore(logger, service);
    const suggestions = new CorpusSuggestionService(logger, service, store);
    return { service, store, suggestions };
  }

  function seed(service: SqliteConnectionService, opts: SeedOpts): void {
    const now = Date.now();
    service.db
      .prepare(
        `INSERT INTO memories
           (id, session_id, workspace_root, tier, kind, subject, content,
            source_message_ids, salience, decay_rate, hits, pinned,
            created_at, updated_at, last_used_at, expires_at,
            type, concepts_json, files_json)
         VALUES (?, NULL, ?, 'recall', ?, ?, 'content', '[]', 0.5, 0.01, 0, 0,
                 ?, ?, ?, NULL, ?, ?, '[]')`,
      )
      .run(
        opts.id,
        opts.workspaceRoot,
        opts.kind ?? 'fact',
        `subj-${opts.id}`,
        now,
        now,
        now,
        opts.type,
        JSON.stringify([...opts.concepts]),
      );
  }

  function seedCluster(
    service: SqliteConnectionService,
    prefix: string,
    workspaceRoot: string | null,
    concepts: readonly string[],
    count: number,
    type = 'discovery',
  ): void {
    for (let i = 0; i < count; i++) {
      seed(service, {
        id: `${prefix}-${i}`,
        workspaceRoot,
        type,
        concepts,
      });
    }
  }

  const WS = '/ws/X';

  maybe(
    'case 1 — concept cluster ≥ MIN_CLUSTER_SIZE yields one enriched suggestion',
    async () => {
      const { service, suggestions } = await bootstrap();
      try {
        // 5 auth memories; jwt co-occurs twice, session once.
        seed(service, {
          id: 'm1',
          workspaceRoot: WS,
          type: 'bugfix',
          concepts: ['auth', 'jwt'],
        });
        seed(service, {
          id: 'm2',
          workspaceRoot: WS,
          type: 'bugfix',
          concepts: ['auth', 'jwt'],
        });
        seed(service, {
          id: 'm3',
          workspaceRoot: WS,
          type: 'bugfix',
          concepts: ['auth', 'session'],
        });
        seed(service, {
          id: 'm4',
          workspaceRoot: WS,
          type: 'bugfix',
          concepts: ['auth'],
        });
        seed(service, {
          id: 'm5',
          workspaceRoot: WS,
          type: 'bugfix',
          concepts: ['auth'],
        });

        const out = suggestions.suggestCorpora({ workspaceRoot: WS });
        expect(out).toHaveLength(1);
        const s = out[0];
        expect(s.suggestedName).toBe('auth');
        expect(s.signal).toBe('concept');
        expect(s.memberCount).toBe(5);
        expect(s.filter).toEqual({
          name: 'auth',
          workspaceRoot: WS,
          concepts: ['auth'],
          limit: 100,
        });
        // defining + up to 2 co-occurring, ties alphabetical.
        expect(s.topConcepts).toEqual(['auth', 'jwt', 'session']);
        expect(s.rationale).toBe('5 memories tagged "auth" (mostly bugfix)');
      } finally {
        service.close();
      }
    },
  );

  maybe('case 2 — threshold boundary: 4 excluded, 5 included', async () => {
    const { service, suggestions } = await bootstrap();
    try {
      seedCluster(service, 'thin', WS, ['thin'], 4);
      seedCluster(service, 'thick', WS, ['thick'], 5);
      const names = suggestions
        .suggestCorpora({ workspaceRoot: WS })
        .map((s) => s.suggestedName);
      expect(names).toEqual(['thick']);
    } finally {
      service.close();
    }
  });

  maybe(
    'case 3 — dedupe against existing corpus by concept and by name',
    async () => {
      const { service, store, suggestions } = await bootstrap();
      try {
        // Distinct types so neither type pool reaches TYPE_MIN_CLUSTER_SIZE
        // (keeps the type-fill fallback out of this dedupe assertion).
        seedCluster(service, 'auth', WS, ['auth'], 6, 'bugfix');
        seedCluster(service, 'billing', WS, ['billing'], 6, 'feature');
        // Existing corpus covering the 'auth' concept (case-insensitive).
        store.create({
          name: 'Auth board',
          workspaceRoot: WS,
          concepts: ['AUTH'],
        });
        // Existing corpus whose NAME collides with the 'billing' candidate.
        store.create({
          name: 'billing',
          workspaceRoot: WS,
          concepts: ['unrelated'],
        });

        const names = suggestions
          .suggestCorpora({ workspaceRoot: WS })
          .map((s) => s.suggestedName);
        expect(names).not.toContain('auth');
        expect(names).not.toContain('billing');
        expect(names).toEqual([]);
      } finally {
        service.close();
      }
    },
  );

  maybe(
    'case 4 — ranking by memberCount desc then name; cap at 6',
    async () => {
      const { service, suggestions } = await bootstrap();
      try {
        seedCluster(service, 'alpha', WS, ['alpha'], 10);
        seedCluster(service, 'bravo', WS, ['bravo'], 9);
        seedCluster(service, 'charlie', WS, ['charlie'], 8);
        seedCluster(service, 'delta', WS, ['delta'], 7);
        seedCluster(service, 'echo', WS, ['echo'], 6);
        seedCluster(service, 'foxtrot', WS, ['foxtrot'], 6);
        seedCluster(service, 'golf', WS, ['golf'], 5);
        seedCluster(service, 'hotel', WS, ['hotel'], 5);

        const names = suggestions
          .suggestCorpora({ workspaceRoot: WS })
          .map((s) => s.suggestedName);
        // 6 cap; echo/foxtrot tie at 6 → alphabetical; golf/hotel (5) dropped.
        expect(names).toEqual([
          'alpha',
          'bravo',
          'charlie',
          'delta',
          'echo',
          'foxtrot',
        ]);
      } finally {
        service.close();
      }
    },
  );

  maybe(
    'case 5 — type fill when concept clusters are short of the limit',
    async () => {
      const { service, suggestions } = await bootstrap();
      try {
        // No concept clusters (empty concepts) but a large bugfix type pool.
        seedCluster(service, 'bug', WS, [], 14, 'bugfix');
        const out = suggestions.suggestCorpora({ workspaceRoot: WS });
        expect(out).toHaveLength(1);
        const s = out[0];
        expect(s.signal).toBe('type');
        expect(s.filter.type).toEqual(['bugfix']);
        expect(s.filter.name).toBe(s.suggestedName);
        expect(s.filter.limit).toBe(100);
        expect(s.memberCount).toBe(14);
        expect(s.topConcepts).toEqual([]);
      } finally {
        service.close();
      }
    },
  );

  maybe(
    'case 5b — type fill skips a type already covered by a single-type corpus',
    async () => {
      const { service, store, suggestions } = await bootstrap();
      try {
        seedCluster(service, 'bug', WS, [], 14, 'bugfix');
        store.create({
          name: 'My bugfixes',
          workspaceRoot: WS,
          type: ['bugfix'],
        });
        const out = suggestions.suggestCorpora({ workspaceRoot: WS });
        expect(out).toEqual([]);
      } finally {
        service.close();
      }
    },
  );

  maybe('case 6 — workspace scoping vs global', async () => {
    const { service, suggestions } = await bootstrap();
    try {
      seedCluster(service, 'a', '/ws/A', ['authA'], 5);
      seedCluster(service, 'b', '/ws/B', ['otherB'], 5);

      const scoped = suggestions
        .suggestCorpora({ workspaceRoot: '/ws/A' })
        .map((s) => s.suggestedName);
      expect(scoped).toEqual(['authA']);

      const global = suggestions
        .suggestCorpora()
        .map((s) => s.suggestedName)
        .sort();
      expect(global).toEqual(['authA', 'otherB']);
    } finally {
      service.close();
    }
  });

  maybe('case 7 — read-only: row counts unchanged', async () => {
    const { service, store, suggestions } = await bootstrap();
    try {
      seedCluster(service, 'auth', WS, ['auth'], 6);
      store.create({ name: 'preexisting', workspaceRoot: WS, concepts: ['x'] });

      const countMemories = (): number =>
        (
          service.db.prepare('SELECT COUNT(*) AS n FROM memories').get() as {
            n: number;
          }
        ).n;
      const countCorpora = (): number =>
        (
          service.db.prepare('SELECT COUNT(*) AS n FROM corpora').get() as {
            n: number;
          }
        ).n;

      const memBefore = countMemories();
      const corpBefore = countCorpora();
      suggestions.suggestCorpora({ workspaceRoot: WS });
      expect(countMemories()).toBe(memBefore);
      expect(countCorpora()).toBe(corpBefore);
    } finally {
      service.close();
    }
  });

  maybe('case 8 — entity rows never contribute concepts', async () => {
    const { service, suggestions } = await bootstrap();
    try {
      // 5 entity rows tagged 'symbolic' must be ignored.
      for (let i = 0; i < 5; i++) {
        seed(service, {
          id: `sym-${i}`,
          workspaceRoot: WS,
          type: 'discovery',
          concepts: ['symbolic'],
          kind: 'entity',
        });
      }
      seedCluster(service, 'real', WS, ['realtag'], 5);

      const names = suggestions
        .suggestCorpora({ workspaceRoot: WS })
        .map((s) => s.suggestedName);
      expect(names).toContain('realtag');
      expect(names).not.toContain('symbolic');
    } finally {
      service.close();
    }
  });
});
