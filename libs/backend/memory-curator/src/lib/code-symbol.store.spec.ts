import 'reflect-metadata';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IEmbedder } from '@ptah-extension/persistence-sqlite';
import {
  SqliteConnectionService,
  VecStatusService,
} from '@ptah-extension/persistence-sqlite';
import { CodeSymbolStore, type CodeSymbolInsert } from './code-symbol.store';

function makeTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-code-symbol-test-'));
  return path.join(dir, 'ptah.db');
}

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function makeDeterministicEmbedder(dim = 384): IEmbedder {
  return {
    dim,
    modelId: 'test/deterministic',
    embed: jest.fn(async (texts: readonly string[]) =>
      texts.map((text, i) => {
        const arr = new Float32Array(dim);
        const seed = text.length + i;
        for (let j = 0; j < dim; j++) {
          arr[j] = ((seed + j) % 13) / 13;
        }
        return arr;
      }),
    ),
    dispose: jest.fn(async () => undefined),
  };
}

function makeEntry(over: Partial<CodeSymbolInsert> = {}): CodeSymbolInsert {
  return {
    workspaceRoot: '/test/ws',
    filePath: '/test/ws/src/a.ts',
    kind: 'function',
    symbolName: 'foo',
    subject: 'code:/test/ws/src/a.ts#foo',
    text: 'function foo() { return 1; }',
    tokenCount: 8,
    ...over,
  };
}

/**
 * SQL-level cover for the workspaceRoot tri-state (TASK_2026_315 A4).
 *
 * The behavioural tests at the bottom of this file are native-gated and skip
 * wherever `better-sqlite3` is built for Electron's ABI rather than the local
 * Node — which is every developer machine in this repo after `postinstall`.
 * These stub-DB tests run everywhere, so the rule "null means
 * `workspace_root IS NULL`, only `undefined` means no predicate" is pinned by
 * something that actually executes in CI.
 */
describe('CodeSymbolStore — workspaceRoot tri-state (SQL shape)', () => {
  function makeSqlCapturingStore(): {
    store: CodeSymbolStore;
    prepared: string[];
    boundArgs: unknown[][];
  } {
    const prepared: string[] = [];
    const boundArgs: unknown[][] = [];
    const connection = {
      vecExtensionLoaded: false,
      db: {
        prepare: jest.fn((sql: string) => {
          prepared.push(sql);
          return {
            get: jest.fn((...args: unknown[]) => {
              boundArgs.push(args);
              return { n: 0 };
            }),
            all: jest.fn((...args: unknown[]) => {
              boundArgs.push(args);
              return [];
            }),
            run: jest.fn((...args: unknown[]) => {
              boundArgs.push(args);
              return { changes: 0 };
            }),
          };
        }),
        exec: jest.fn(),
        transaction: jest.fn(),
      },
    } as unknown as SqliteConnectionService;

    const store = new CodeSymbolStore(
      makeLogger(),
      connection,
      makeDeterministicEmbedder(),
      { available: false } as unknown as VecStatusService,
    );
    return { store, prepared, boundArgs };
  }

  describe('count', () => {
    it('a string binds workspace_root IS ?', () => {
      const { store, prepared, boundArgs } = makeSqlCapturingStore();
      store.count('/ws/a');
      expect(prepared[0]).toContain('WHERE workspace_root IS ?');
      expect(boundArgs[0]).toEqual(['/ws/a']);
    });

    it('null emits workspace_root IS NULL with no bound value', () => {
      const { store, prepared, boundArgs } = makeSqlCapturingStore();
      store.count(null);
      expect(prepared[0]).toContain('WHERE workspace_root IS NULL');
      expect(boundArgs[0]).toEqual([]);
    });

    it('undefined emits no predicate at all', () => {
      const { store, prepared, boundArgs } = makeSqlCapturingStore();
      store.count();
      expect(prepared[0]).not.toContain('WHERE');
      expect(boundArgs[0]).toEqual([]);
    });
  });

  describe('search', () => {
    it('null filters to unscoped rows rather than dropping the predicate', () => {
      const { store, prepared } = makeSqlCapturingStore();
      store.search({ workspaceRoot: null });
      expect(prepared[0]).toContain('WHERE workspace_root IS NULL');
    });

    it('undefined leaves the query unfiltered', () => {
      const { store, prepared } = makeSqlCapturingStore();
      store.search({});
      expect(prepared[0]).not.toContain('workspace_root');
    });
  });

  describe('purgeJunk', () => {
    it('null scopes the DELETE to unscoped rows', () => {
      const { store, prepared } = makeSqlCapturingStore();
      store.purgeJunk(null);
      expect(prepared[0]).toContain('AND workspace_root IS NULL');
    });

    it('a string scopes the DELETE to that workspace', () => {
      const { store, prepared, boundArgs } = makeSqlCapturingStore();
      store.purgeJunk('/ws/a');
      expect(prepared[0]).toContain('AND workspace_root IS ?');
      expect(boundArgs[0][1]).toBe('/ws/a');
    });

    it('undefined deletes across every workspace (raw store capability)', () => {
      const { store, prepared } = makeSqlCapturingStore();
      store.purgeJunk();
      expect(prepared[0]).not.toContain('workspace_root');
    });
  });
});

describe('CodeSymbolStore (native-gated)', () => {
  let nativeAvailable = false;
  try {
    require.resolve('better-sqlite3');
    require.resolve('sqlite-vec');
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
    store: CodeSymbolStore;
    embedder: IEmbedder;
    dbPath: string;
  }> {
    const dbPath = makeTempDbPath();
    const logger = makeLogger();
    const service = new SqliteConnectionService(dbPath, logger);
    await service.openAndMigrate();
    expect(service.vecExtensionLoaded).toBe(true);
    const embedder = makeDeterministicEmbedder();
    const vecStatus = new VecStatusService(logger, service);
    const store = new CodeSymbolStore(logger, service, embedder, vecStatus);
    return { service, store, embedder, dbPath };
  }

  maybe(
    'insertBatch writes symbol + vec rows with matching rowid',
    async () => {
      const { service, store } = await bootstrap();
      try {
        const entries: CodeSymbolInsert[] = [
          makeEntry({
            symbolName: 'foo',
            subject: 'code:/test/ws/src/a.ts#foo',
          }),
          makeEntry({
            symbolName: 'bar',
            subject: 'code:/test/ws/src/a.ts#bar',
            text: 'function bar() { return 2; }',
          }),
        ];

        await store.insertBatch(entries);

        const symbolCount = (
          service.db
            .prepare('SELECT COUNT(*) AS n FROM code_symbols')
            .get() as { n: number }
        ).n;
        const vecCount = (
          service.db
            .prepare('SELECT COUNT(*) AS n FROM code_symbols_vec')
            .get() as { n: number }
        ).n;
        expect(symbolCount).toBe(2);
        expect(vecCount).toBe(2);

        const rowids = service.db
          .prepare(
            'SELECT s.rowid AS srowid, v.rowid AS vrowid FROM code_symbols s LEFT JOIN code_symbols_vec v ON v.rowid = s.rowid ORDER BY s.rowid',
          )
          .all() as Array<{ srowid: number; vrowid: number | null }>;
        expect(rowids).toHaveLength(2);
        for (const row of rowids) {
          expect(row.vrowid).toBe(row.srowid);
        }
      } finally {
        service.close();
      }
    },
  );

  maybe(
    're-running insertBatch for same (workspace_root, subject) updates without zeroing counts',
    async () => {
      const { service, store } = await bootstrap();
      try {
        const first = makeEntry({
          symbolName: 'foo',
          subject: 'code:/test/ws/src/a.ts#foo',
          text: 'first body',
          tokenCount: 3,
        });
        await store.insertBatch([first]);

        const firstSymbolRowid = (
          service.db
            .prepare(
              'SELECT rowid FROM code_symbols WHERE workspace_root = ? AND subject = ?',
            )
            .get(first.workspaceRoot, first.subject) as { rowid: number }
        ).rowid;

        const second: CodeSymbolInsert = {
          ...first,
          text: 'second body — updated',
          tokenCount: 9,
        };
        await store.insertBatch([second]);

        const symbolCount = (
          service.db
            .prepare('SELECT COUNT(*) AS n FROM code_symbols')
            .get() as { n: number }
        ).n;
        const vecCount = (
          service.db
            .prepare('SELECT COUNT(*) AS n FROM code_symbols_vec')
            .get() as { n: number }
        ).n;
        expect(symbolCount).toBe(1);
        expect(vecCount).toBe(1);

        const persistedText = (
          service.db
            .prepare(
              'SELECT text FROM code_symbols WHERE workspace_root = ? AND subject = ?',
            )
            .get(first.workspaceRoot, first.subject) as { text: string }
        ).text;
        expect(persistedText).toBe('second body — updated');

        const updatedSymbolRowid = (
          service.db
            .prepare(
              'SELECT rowid FROM code_symbols WHERE workspace_root = ? AND subject = ?',
            )
            .get(first.workspaceRoot, first.subject) as { rowid: number }
        ).rowid;
        expect(updatedSymbolRowid).toBe(firstSymbolRowid);

        const vecRowid = (
          service.db.prepare('SELECT rowid FROM code_symbols_vec').get() as {
            rowid: number;
          }
        ).rowid;
        expect(vecRowid).toBe(updatedSymbolRowid);
      } finally {
        service.close();
      }
    },
  );

  maybe(
    'when vecExtensionLoaded is false, still inserts code_symbols rows',
    async () => {
      const dbPath = makeTempDbPath();
      const logger = makeLogger();
      const service = new SqliteConnectionService(dbPath, logger);
      await service.openAndMigrate();
      Object.defineProperty(service, 'vecExtensionLoaded', {
        configurable: true,
        get: () => false,
      });
      Object.defineProperty(service, 'vecLoadDiagnostic', {
        configurable: true,
        get: () => ({
          ok: false,
          reason: 'binary-missing',
          electronVersion: 'unknown',
          processArch: process.arch,
          processPlatform: process.platform,
        }),
      });
      const embedder = makeDeterministicEmbedder();
      const vecStatus = new VecStatusService(logger, service);
      const store = new CodeSymbolStore(logger, service, embedder, vecStatus);
      try {
        await store.insertBatch([
          makeEntry({
            symbolName: 'baz',
            subject: 'code:/test/ws/src/a.ts#baz',
          }),
        ]);

        const symbolCount = (
          service.db
            .prepare('SELECT COUNT(*) AS n FROM code_symbols')
            .get() as { n: number }
        ).n;
        expect(symbolCount).toBe(1);
        expect(embedder.embed).not.toHaveBeenCalled();
      } finally {
        service.close();
      }
    },
  );

  maybe(
    'rolls back code_symbols when vec INSERT throws (transaction contract preserved)',
    async () => {
      const { service, store } = await bootstrap();
      try {
        await store.insertBatch([
          makeEntry({
            symbolName: 'pre',
            subject: 'code:/test/ws/src/a.ts#pre',
          }),
        ]);
        const before = (
          service.db
            .prepare('SELECT COUNT(*) AS n FROM code_symbols')
            .get() as { n: number }
        ).n;
        expect(before).toBe(1);

        const dbRef = service.db;
        const originalPrepare = dbRef.prepare.bind(dbRef);
        const prepareSpy = jest
          .spyOn(dbRef, 'prepare')
          .mockImplementation((sql: string) => {
            const stmt = originalPrepare(sql);
            if (/INTO code_symbols_vec/i.test(sql)) {
              return {
                ...stmt,
                run: () => {
                  throw new Error(
                    'Only integers are allows for primary key values on code_symbols_vec',
                  );
                },
              } as unknown as ReturnType<typeof originalPrepare>;
            }
            return stmt;
          });

        await expect(
          store.insertBatch([
            makeEntry({
              symbolName: 'should_roll_back',
              subject: 'code:/test/ws/src/a.ts#should_roll_back',
            }),
          ]),
        ).rejects.toThrow(/Only integers are allows/);

        prepareSpy.mockRestore();

        const after = (
          service.db
            .prepare('SELECT COUNT(*) AS n FROM code_symbols')
            .get() as { n: number }
        ).n;
        expect(after).toBe(1);
      } finally {
        service.close();
      }
    },
  );

  maybe(
    'searchSymbols returns hybrid hits ranked by relevance with text + score',
    async () => {
      const { service, store } = await bootstrap();
      try {
        await store.insertBatch([
          makeEntry({
            symbolName: 'login',
            subject: 'code:/test/ws/src/auth.ts#login',
            filePath: '/test/ws/src/auth.ts',
            text: 'login handler validates the session token for a user',
          }),
          makeEntry({
            symbolName: 'add',
            subject: 'code:/test/ws/src/math.ts#add',
            filePath: '/test/ws/src/math.ts',
            text: 'add two numbers and return the sum',
          }),
        ]);

        const page = await store.searchSymbols('session token', 10, '/test/ws');
        expect(page.bm25Only).toBe(false);
        expect(page.hits.length).toBeGreaterThan(0);
        const top = page.hits[0];
        expect(top.symbolName).toBe('login');
        expect(top.text).toContain('session token');
        expect(top.kind).toBe('function');
        expect(top.score).toBeGreaterThan(0);
      } finally {
        service.close();
      }
    },
  );

  maybe('searchSymbols scopes results to workspaceRoot', async () => {
    const { service, store } = await bootstrap();
    try {
      await store.insertBatch([
        makeEntry({
          workspaceRoot: '/ws/a',
          symbolName: 'login',
          subject: 'code:/ws/a/src/auth.ts#login',
          filePath: '/ws/a/src/auth.ts',
          text: 'login handler validates the session token',
        }),
        makeEntry({
          workspaceRoot: '/ws/b',
          symbolName: 'login',
          subject: 'code:/ws/b/src/auth.ts#login',
          filePath: '/ws/b/src/auth.ts',
          text: 'login handler validates the session token',
        }),
      ]);

      const page = await store.searchSymbols('session token', 10, '/ws/a');
      expect(page.hits.length).toBeGreaterThan(0);
      for (const hit of page.hits) {
        expect(hit.workspaceRoot).toBe('/ws/a');
      }
    } finally {
      service.close();
    }
  });

  maybe(
    'searchSymbols falls back to BM25-only when vec is unavailable',
    async () => {
      const { service, store } = await bootstrap();
      try {
        await store.insertBatch([
          makeEntry({
            symbolName: 'login',
            subject: 'code:/test/ws/src/auth.ts#login',
            filePath: '/test/ws/src/auth.ts',
            text: 'login handler validates the session token',
          }),
        ]);

        const logger = makeLogger();
        const embedder = makeDeterministicEmbedder();
        const fakeVecStatus = {
          available: false,
        } as unknown as VecStatusService;
        const bm25Store = new CodeSymbolStore(
          logger,
          service,
          embedder,
          fakeVecStatus,
        );

        const page = await bm25Store.searchSymbols(
          'session token',
          10,
          '/test/ws',
        );
        expect(page.bm25Only).toBe(true);
        expect(page.hits.length).toBeGreaterThan(0);
        expect(page.hits[0].symbolName).toBe('login');
        expect(embedder.embed).not.toHaveBeenCalled();
      } finally {
        service.close();
      }
    },
  );

  maybe(
    'searchSymbols neutralises adversarial FTS metacharacters without throwing',
    async () => {
      const { service, store } = await bootstrap();
      try {
        await store.insertBatch([
          makeEntry({
            symbolName: 'login',
            subject: 'code:/test/ws/src/auth.ts#login',
            filePath: '/test/ws/src/auth.ts',
            text: 'login handler validates the session token',
          }),
        ]);

        await expect(
          store.searchSymbols('"OR session*() ^token:', 10, '/test/ws'),
        ).resolves.toEqual(
          expect.objectContaining({ hits: expect.any(Array) }),
        );
      } finally {
        service.close();
      }
    },
  );

  maybe('searchSymbols returns an empty page for a blank query', async () => {
    const { service, store } = await bootstrap();
    try {
      const page = await store.searchSymbols('   ', 10, '/test/ws');
      expect(page.hits).toHaveLength(0);
    } finally {
      service.close();
    }
  });

  // -------------------------------------------------------------------------
  // workspaceRoot tri-state — TASK_2026_315 A4
  //
  // `null` used to be folded into `undefined` in count/search/purgeJunk, so a
  // caller saying "global/unscoped" got EVERY workspace in the shared database
  // back. `null` now means `workspace_root IS NULL` — which matches nothing,
  // because `code_symbols.workspace_root` is never NULL — and only `undefined`
  // still means "no predicate".
  // -------------------------------------------------------------------------

  async function seedTwoWorkspaces(store: CodeSymbolStore): Promise<void> {
    await store.insertBatch([
      makeEntry({
        workspaceRoot: '/ws/a',
        symbolName: 'alpha',
        subject: 'code:/ws/a/src/a.ts#alpha',
        filePath: '/ws/a/src/a.ts',
      }),
      makeEntry({
        workspaceRoot: '/ws/b',
        symbolName: 'beta',
        subject: 'code:/ws/b/src/b.ts#beta',
        filePath: '/ws/b/src/b.ts',
      }),
    ]);
  }

  maybe('count() distinguishes string / null / undefined', async () => {
    const { service, store } = await bootstrap();
    try {
      await seedTwoWorkspaces(store);

      expect(store.count('/ws/a')).toBe(1);
      // null = global/unscoped rows only; there are none.
      expect(store.count(null)).toBe(0);
      // undefined = no predicate — the raw whole-database capability.
      expect(store.count()).toBe(2);
    } finally {
      service.close();
    }
  });

  maybe('search() distinguishes string / null / undefined', async () => {
    const { service, store } = await bootstrap();
    try {
      await seedTwoWorkspaces(store);

      expect(store.search({ workspaceRoot: '/ws/a' }).total).toBe(1);
      expect(store.search({ workspaceRoot: null }).total).toBe(0);
      expect(store.search({}).total).toBe(2);
    } finally {
      service.close();
    }
  });

  maybe(
    'purgeJunk(null) deletes nothing across workspaces; a scoped call deletes only its own',
    async () => {
      const { service, store } = await bootstrap();
      try {
        await store.insertBatch([
          makeEntry({
            workspaceRoot: '/ws/a',
            symbolName: 'junkA',
            subject: 'code:/ws/a/node_modules/x/i.ts#junkA',
            filePath: '/ws/a/node_modules/x/i.ts',
          }),
          makeEntry({
            workspaceRoot: '/ws/b',
            symbolName: 'junkB',
            subject: 'code:/ws/b/node_modules/y/i.ts#junkB',
            filePath: '/ws/b/node_modules/y/i.ts',
          }),
        ]);

        expect(store.purgeJunk(null)).toBe(0);
        expect(store.count()).toBe(2);

        expect(store.purgeJunk('/ws/a')).toBe(1);
        expect(store.count('/ws/a')).toBe(0);
        expect(store.count('/ws/b')).toBe(1);
      } finally {
        service.close();
      }
    },
  );
});
