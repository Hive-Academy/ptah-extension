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
            iterate: jest.fn((...args: unknown[]) => {
              boundArgs.push(args);
              return [][Symbol.iterator]();
            }),
          };
        }),
        exec: jest.fn(),
        transaction: jest.fn((fn: (...args: unknown[]) => unknown) => fn),
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

  describe('getIndexFreshness', () => {
    it('runs one COUNT/MAX aggregate scoped to the workspace root', async () => {
      const { store, prepared, boundArgs } = makeSqlCapturingStore();
      const freshness = await store.getIndexFreshness('/ws/a');
      expect(prepared).toHaveLength(1);
      expect(prepared[0]).toContain('COUNT(*)');
      expect(prepared[0]).toContain('MAX(updated_at)');
      expect(prepared[0]).toContain('WHERE workspace_root = ?');
      expect(boundArgs[0]).toEqual(['/ws/a']);
      // The stub row carries no `newest` column: a missing max reads as null.
      expect(freshness).toEqual({ symbolCount: 0, newestUpdatedAt: null });
    });
  });

  describe('searchSymbols exact-name candidate list', () => {
    it('an identifier query prepares a workspace-scoped exact symbol_name lookup', async () => {
      const { store, prepared, boundArgs } = makeSqlCapturingStore();
      await store.searchSymbols('handleToolsList', 5, '/ws/a');
      const exactIdx = prepared.findIndex((sql) =>
        sql.includes('cs.symbol_name = ?'),
      );
      expect(exactIdx).toBeGreaterThanOrEqual(0);
      expect(prepared[exactIdx]).toContain('AND cs.workspace_root = ?');
      expect(prepared[exactIdx]).not.toContain('NOCASE');
      expect(boundArgs[exactIdx]).toEqual(['handleToolsList', '/ws/a', 5]);
    });

    it('with no case-sensitive row, the Unicode fallback binds a length window and the workspace', async () => {
      const { store, prepared, boundArgs } = makeSqlCapturingStore();
      // U+0130 lowers to "i" + U+0307: 6 characters, one of which may fold away.
      await store.searchSymbols('İNDEX', 5, '/ws/a');
      const foldIdx = prepared.findIndex((sql) =>
        sql.includes('length(cs.symbol_name) BETWEEN ? AND ?'),
      );
      expect(foldIdx).toBeGreaterThanOrEqual(0);
      expect(prepared[foldIdx]).toContain('AND cs.workspace_root = ?');
      expect(boundArgs[foldIdx]).toEqual([5, 6, '/ws/a']);
      // The scan streams only rowid and name, never the symbol text.
      expect(prepared[foldIdx]).not.toContain('cs.text');
      expect(prepared.some((sql) => sql.includes('NOCASE'))).toBe(false);
    });

    it('an ASCII case-insensitive miss uses SQL NOCASE and never the JS scan', async () => {
      const { store, prepared, boundArgs } = makeSqlCapturingStore();
      await store.searchSymbols('transactions', 5, '/ws/a');
      const nocaseIdx = prepared.findIndex((sql) =>
        sql.includes('cs.symbol_name = ? COLLATE NOCASE'),
      );
      expect(nocaseIdx).toBeGreaterThanOrEqual(0);
      expect(prepared[nocaseIdx]).toContain('AND cs.workspace_root = ?');
      expect(prepared[nocaseIdx]).toContain('LIMIT ?');
      expect(boundArgs[nocaseIdx]).toEqual(['transactions', '/ws/a', 5]);
      expect(
        prepared.some((sql) => sql.includes('length(cs.symbol_name)')),
      ).toBe(false);
    });

    it('a query containing whitespace skips the exact lookup', async () => {
      const { store, prepared } = makeSqlCapturingStore();
      await store.searchSymbols('validate session token', 5, '/ws/a');
      expect(
        prepared.some(
          (sql) =>
            sql.includes('cs.symbol_name = ?') ||
            sql.includes('length(cs.symbol_name)'),
        ),
      ).toBe(false);
    });
  });

  describe('purgeMissing', () => {
    it('lists distinct file_path scoped to workspace_root', () => {
      const { store, prepared, boundArgs } = makeSqlCapturingStore();
      store.purgeMissing('/ws/a', ['/ws/a/src/keep.ts']);
      expect(prepared[0]).toContain('SELECT DISTINCT file_path');
      expect(prepared[0]).toContain('WHERE workspace_root = ?');
      expect(boundArgs[0]).toEqual(['/ws/a']);
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
  let nativeProbeError: string | null = null;
  try {
    require.resolve('better-sqlite3');
    require.resolve('sqlite-vec');
    const Database = require('better-sqlite3') as new (file: string) => {
      close(): void;
    };
    const probe = new Database(':memory:');
    probe.close();
    nativeAvailable = true;
  } catch (err: unknown) {
    nativeAvailable = false;
    nativeProbeError = err instanceof Error ? err.message : String(err);
  }

  // CI (GitHub Actions sets CI=true) rebuilds better-sqlite3 for Node, so the
  // recall guard below must execute there: a native failure fails the run with
  // its cause instead of skipping. Only a local run may skip, with a message.
  const ciValue = process.env['CI'];
  const nativeRequired =
    ciValue !== undefined && ciValue !== '' && ciValue !== 'false';

  if (!nativeAvailable && !nativeRequired) {
    process.stderr.write(
      `[code-symbol.store.spec] native probe failed; native-gated tests (including the exact-name recall guard) skipped locally: ${nativeProbeError}\n`,
    );
  }

  it('native better-sqlite3 + sqlite-vec are loadable (required when CI is set)', () => {
    if (nativeAvailable || !nativeRequired) return;
    throw new Error(
      `native modules failed to load in CI, so the exact-name recall guard cannot run: ${nativeProbeError}`,
    );
  });

  const maybe = nativeAvailable || nativeRequired ? it : it.skip;

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

  // -------------------------------------------------------------------------
  // Exact-name recall guard and index freshness — TASK_2026_559 Batch 5
  //
  // The porter/unicode61 FTS tokenizer keeps a camelCase identifier as one
  // opaque token, so a short caller that mentions a name several times out-
  // scores the declaration under BM25, and the vector list adds its own noise.
  // The exact `symbol_name` candidate list must put the declaration at rank 1.
  // These tests fail if that list is removed or down-weighted.
  // -------------------------------------------------------------------------

  const WS = '/bench/ws';

  /**
   * Lowest score an exact-name row can receive at topK = 5: weight 3 at the
   * last index, 3 / (25 + 5). No non-exact row reaches it, since BM25 and the
   * vector list together contribute at most 1 / 26.
   */
  const EXACT_ROW_MIN_SCORE = 3 / 30;

  async function bootstrapInMemory(): Promise<{
    service: SqliteConnectionService;
    store: CodeSymbolStore;
  }> {
    const logger = makeLogger();
    const service = new SqliteConnectionService(':memory:', logger);
    await service.openAndMigrate();
    const vecStatus = new VecStatusService(logger, service);
    const store = new CodeSymbolStore(
      logger,
      service,
      makeDeterministicEmbedder(),
      vecStatus,
    );
    return { service, store };
  }

  function sym(
    symbolName: string,
    file: string,
    text: string,
    kind = 'function',
    workspaceRoot = WS,
  ): CodeSymbolInsert {
    const filePath = `${workspaceRoot}/${file}`;
    return {
      workspaceRoot,
      filePath,
      kind,
      symbolName,
      subject: `code:${filePath}#${symbolName}`,
      text,
      tokenCount: text.split(/\s+/).length,
    };
  }

  /** Declarations the recall guard queries by exact name. */
  const TARGETS: readonly CodeSymbolInsert[] = [
    sym(
      'handleToolsList',
      'mcp/protocol-dispatcher.ts',
      'export async function handleToolsList(request: JsonRpcRequest, deps: DispatcherDeps): Promise<JsonRpcResponse> { const caller = resolveCaller(request); const tools = buildToolSet(caller, deps); return { jsonrpc: "2.0", id: request.id, result: { tools } }; }',
    ),
    sym(
      'createToolSuccessResponse',
      'mcp/tool-response.ts',
      'export function createToolSuccessResponse(id: RequestId, text: string, meta?: ToolMeta): JsonRpcResponse { const content = [{ type: "text", text }]; return { jsonrpc: "2.0", id, result: { content, isError: false, _meta: meta } }; }',
    ),
    sym(
      'createToolErrorResponse',
      'mcp/tool-response.ts',
      'export function createToolErrorResponse(id: RequestId, message: string): JsonRpcResponse { return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: message }], isError: true } }; }',
    ),
    sym(
      'buildToolSet',
      'mcp/tool-set.ts',
      'export function buildToolSet(caller: McpCaller, deps: DispatcherDeps): readonly ToolDefinition[] { const base = ALWAYS_EAGER_TOOLS.concat(IDE_EAGER_TOOLS); return base.filter((t) => !deps.disabledMcpNamespaces.has(t.namespace)); }',
    ),
    sym(
      'resolveCaller',
      'mcp/caller.ts',
      'export function resolveCaller(request: JsonRpcRequest): McpCaller { const sessionId = request._callerSessionId; if (sessionId) return { kind: "session", sessionId }; return { kind: "anonymous" }; }',
    ),
    sym(
      'searchSymbols',
      'code/code-symbol.store.ts',
      'async searchSymbols(query: string, topK = 10, workspaceRoot?: string): Promise<CodeSymbolHitPage> { const limit = Math.max(1, Math.min(50, topK)); const rows = this.bm25SearchSymbols(query, limit, workspaceRoot); return { hits: rows, bm25Only: true }; }',
      'method',
    ),
    sym(
      'ensureIndexFresh',
      'code/code-namespace.builder.ts',
      'async function ensureIndexFresh(root: string): Promise<IndexFreshnessReport> { const freshness = await reader.getIndexFreshness(root); const stale = freshness.symbolCount === 0 || now() - freshness.newestUpdatedAt > CODE_INDEX_STALE_MS; if (stale) startBackgroundIndex(root); return { ...freshness, stale }; }',
    ),
    sym(
      'indexWorkspace',
      'code/code-symbol-indexer.service.ts',
      'async indexWorkspace(root: string, options: { userInitiated: boolean }): Promise<IndexRunSummary> { await this.governor.waitForIdle(options.userInitiated); const files = await this.listSourceFiles(root); for (const file of files) await this.indexFile(root, file); return { files: files.length }; }',
      'method',
    ),
    sym(
      'parseSubject',
      'code/symbol-sink.adapter.ts',
      'function parseSubject(subject: string): { kind: string; symbolName: string } | null { const hash = subject.lastIndexOf("#"); if (hash < 0) return null; return { kind: "function", symbolName: subject.slice(hash + 1) }; }',
    ),
    sym(
      'rrfFuseSymbols',
      'code/code-symbol.store.ts',
      'private rrfFuseSymbols(bm25: readonly Row[], vec: readonly Row[], limit: number): Scored[] { const acc = new Map<number, Scored>(); bm25.forEach((row, idx) => acc.set(row.rowid, { row, score: 1 / (25 + idx + 1) })); return Array.from(acc.values()).slice(0, limit); }',
      'method',
    ),
    sym(
      'SqliteConnectionService',
      'persistence/sqlite-connection.service.ts',
      'export class SqliteConnectionService { private database: Database | null = null; constructor(private readonly filePath: string, private readonly logger: Logger) {} get db(): Database { if (!this.database) throw new Error("not open"); return this.database; } }',
      'class',
    ),
    sym(
      'McpCaller',
      'mcp/caller.ts',
      'export interface McpCaller { readonly kind: "session" | "agent" | "workspace" | "anonymous"; readonly sessionId?: string; readonly agentId?: string; readonly workspaceRoot?: string; }',
      'interface',
    ),
    sym(
      'login',
      'auth/auth.ts',
      'export function login(user: User): Session { validateSessionToken(user.token); return openSession(user); } // login handler validates the session token for a user',
    ),
    sym(
      'getIndexFreshness',
      'code/code-symbol.store.ts',
      'async getIndexFreshness(workspaceRoot: string): Promise<CodeIndexFreshness> { const row = this.db.prepare(sql).get(workspaceRoot); return { symbolCount: row.n, newestUpdatedAt: row.newest }; }',
      'method',
    ),
  ];

  /**
   * Short callers and tests that repeat the target names: under BM25 alone
   * they out-score the long declarations that the guard asks for.
   */
  const DISTRACTORS: readonly CodeSymbolInsert[] = [
    sym(
      'dispatch',
      'mcp/dispatch.ts',
      'handleToolsList handleToolsList createToolSuccessResponse createToolSuccessResponse createToolErrorResponse createToolErrorResponse',
    ),
    sym(
      'toolsListSpec',
      'mcp/protocol-dispatcher.spec.ts',
      'handleToolsList buildToolSet resolveCaller handleToolsList buildToolSet resolveCaller',
    ),
    sym(
      'searchTool',
      'code/search-tool.ts',
      'searchSymbols searchSymbols ensureIndexFresh ensureIndexFresh getIndexFreshness getIndexFreshness',
    ),
    sym(
      'reindexTool',
      'code/reindex-tool.ts',
      'indexWorkspace indexWorkspace ensureIndexFresh indexWorkspace',
    ),
    sym(
      'sinkSpec',
      'code/symbol-sink.adapter.spec.ts',
      'parseSubject parseSubject rrfFuseSymbols rrfFuseSymbols',
    ),
    sym(
      'bootstrapDb',
      'persistence/bootstrap.ts',
      'SqliteConnectionService SqliteConnectionService McpCaller McpCaller login login',
    ),
  ];

  async function seedBench(store: CodeSymbolStore): Promise<void> {
    await store.insertBatch([...TARGETS, ...DISTRACTORS]);
  }

  async function rankOf(
    store: CodeSymbolStore,
    target: CodeSymbolInsert,
    topK: number,
  ): Promise<number> {
    const page = await store.searchSymbols(target.symbolName, topK, WS);
    return page.hits.findIndex((h) => h.subject === target.subject) + 1;
  }

  maybe(
    'recall guard: every exact symbol name ranks its declaration first (recall@1 = 100%, recall@5 >= 90%)',
    async () => {
      const { service, store } = await bootstrapInMemory();
      try {
        expect(TARGETS.length).toBeGreaterThanOrEqual(12);
        await seedBench(store);

        const missedAt1: string[] = [];
        let hitsAt5 = 0;
        for (const target of TARGETS) {
          const rank = await rankOf(store, target, 5);
          if (rank !== 1) missedAt1.push(`${target.symbolName}@${rank}`);
          if (rank >= 1 && rank <= 5) hitsAt5++;
        }
        expect(missedAt1).toEqual([]);
        expect(hitsAt5 / TARGETS.length).toBeGreaterThanOrEqual(0.9);
      } finally {
        service.close();
      }
    },
  );

  maybe(
    'a natural-language query still returns its target in the top 5',
    async () => {
      const { service, store } = await bootstrapInMemory();
      try {
        await seedBench(store);
        const page = await store.searchSymbols(
          'validates the session token for a user',
          5,
          WS,
        );
        expect(page.hits.map((h) => h.symbolName)).toContain('login');
      } finally {
        service.close();
      }
    },
  );

  maybe(
    'every row sharing the exact name outranks every other row',
    async () => {
      const { service, store } = await bootstrapInMemory();
      try {
        const files = ['a', 'b', 'c', 'd', 'e', 'f'];
        await store.insertBatch([
          ...files.map((f) =>
            sym(
              'dispose',
              `src/${f}.ts`,
              `dispose(): void { this.subscriptions.forEach((s) => s.unsubscribe()); this.${f}Cache.clear(); }`,
              'method',
            ),
          ),
          sym('teardown', 'src/teardown.ts', 'dispose dispose dispose dispose'),
          sym('cleanupAll', 'src/cleanup.ts', 'dispose dispose dispose'),
        ]);

        const page = await store.searchSymbols('dispose', 8, WS);
        const names = page.hits.map((h) => h.symbolName);
        expect(names.slice(0, files.length)).toEqual(
          files.map(() => 'dispose'),
        );
        expect(names.slice(files.length).sort()).toEqual([
          'cleanupAll',
          'teardown',
        ]);
      } finally {
        service.close();
      }
    },
  );

  maybe(
    'at the maximum topK, 50 same-name rows outrank a distractor that tops both BM25 and vector lists',
    async () => {
      const { service, store } = await bootstrapInMemory();
      try {
        // The deterministic embedder seeds each vector with text.length + batch
        // index, so a 7-char text inserted alone at index 0 embeds identically
        // to the 7-char query: vector rank 1. It is also the only BM25 match.
        await store.insertBatch([
          sym('teardown', 'src/teardown.ts', 'dispose'),
        ]);
        const declarations = Array.from({ length: 50 }, (_, n) =>
          sym(
            'dispose',
            `src/m${String(n).padStart(2, '0')}.ts`,
            `() => { this.cache${n}.clear(); this.subs${n}.length = 0; }`,
            'method',
          ),
        );
        await store.insertBatch(declarations);

        const page = await store.searchSymbols('dispose', 50, WS);
        expect(page.bm25Only).toBe(false);
        expect(page.hits).toHaveLength(50);
        expect(page.hits.filter((h) => h.symbolName !== 'dispose')).toEqual([]);
      } finally {
        service.close();
      }
    },
  );

  maybe(
    'case-sensitive exact match wins; case-insensitive matches are the fallback',
    async () => {
      const { service, store } = await bootstrapInMemory();
      try {
        await store.insertBatch([
          sym(
            'handleToolsList',
            'mcp/a.ts',
            'export function handleToolsList(req) { return list(req); }',
          ),
          sym(
            'HandleToolsList',
            'mcp/b.ts',
            'export class HandleToolsList { run(req) { return list(req); } }',
            'class',
          ),
          sym('caller', 'mcp/c.ts', 'handleToolsList handleToolsList'),
        ]);

        const exact = await store.searchSymbols('handleToolsList', 5, WS);
        expect(exact.hits[0].filePath).toBe(`${WS}/mcp/a.ts`);

        const pascal = await store.searchSymbols('HandleToolsList', 5, WS);
        expect(pascal.hits[0].filePath).toBe(`${WS}/mcp/b.ts`);

        // No case-sensitive row: both case-insensitive rows lead the ranking.
        const upper = await store.searchSymbols('HANDLETOOLSLIST', 5, WS);
        expect(
          upper.hits
            .slice(0, 2)
            .map((h) => h.filePath)
            .sort(),
        ).toEqual([`${WS}/mcp/a.ts`, `${WS}/mcp/b.ts`]);
      } finally {
        service.close();
      }
    },
  );

  maybe(
    'SQL special characters in the query stay literal in the exact lookup',
    async () => {
      const { service, store } = await bootstrapInMemory();
      try {
        await store.insertBatch([
          sym('foo_bar', 'src/a.ts', 'function foo_bar() { return 1; }'),
          sym('fooXbar', 'src/b.ts', 'function fooXbar() { return 2; }'),
        ]);

        const underscore = await store.searchSymbols('foo_bar', 5, WS);
        expect(underscore.hits[0].symbolName).toBe('foo_bar');

        for (const q of [
          'foo%',
          "foo'bar",
          'foo"; DROP TABLE code_symbols;--',
        ]) {
          const page = await store.searchSymbols(q, 5, WS);
          // `%` is not a wildcard under `=`: neither row is an exact match.
          expect(page.hits.every((h) => h.score < EXACT_ROW_MIN_SCORE)).toBe(
            true,
          );
        }
        expect(store.count(WS)).toBe(2);
      } finally {
        service.close();
      }
    },
  );

  maybe('the exact lookup is scoped to the workspace root', async () => {
    const { service, store } = await bootstrapInMemory();
    try {
      await store.insertBatch([
        sym(
          'handleToolsList',
          'mcp/a.ts',
          'function handleToolsList() {}',
          'function',
          '/ws/a',
        ),
        sym(
          'handleToolsList',
          'mcp/a.ts',
          'function handleToolsList() {}',
          'function',
          '/ws/b',
        ),
      ]);

      const page = await store.searchSymbols('handleToolsList', 5, '/ws/a');
      expect(page.hits.length).toBeGreaterThan(0);
      for (const hit of page.hits) expect(hit.workspaceRoot).toBe('/ws/a');
    } finally {
      service.close();
    }
  });

  /** Paths of the hits that reached the exact-name tier. */
  function exactTier(page: {
    readonly hits: readonly { filePath: string; score: number }[];
  }): string[] {
    return page.hits
      .filter((h) => h.score >= EXACT_ROW_MIN_SCORE)
      .map((h) => h.filePath);
  }

  /**
   * Records every SQL string the store prepares and every `iterate()` call on
   * the resulting statements, while delegating to the real connection.
   */
  function spyOnQueries(service: SqliteConnectionService): {
    prepared: string[];
    iterated: string[];
    reset(): void;
    restore(): void;
  } {
    const db = service.db;
    const realPrepare = db.prepare.bind(db);
    const prepared: string[] = [];
    const iterated: string[] = [];
    const spy = jest.spyOn(db, 'prepare').mockImplementation(((sql: string) => {
      prepared.push(sql);
      const stmt = realPrepare(sql);
      const realIterate = stmt.iterate.bind(stmt);
      (stmt as { iterate: unknown }).iterate = (...args: unknown[]) => {
        iterated.push(sql);
        return realIterate(...args);
      };
      return stmt;
    }) as unknown as typeof db.prepare);
    return {
      prepared,
      iterated,
      reset: () => {
        prepared.length = 0;
        iterated.length = 0;
      },
      restore: () => spy.mockRestore(),
    };
  }

  maybe(
    'bounded work: an ASCII single-token miss in a 20k-symbol workspace never enters the JS scan',
    async () => {
      const { service, store } = await bootstrapInMemory();
      try {
        // 20,000 names of the query's length, the r2 worst case for the JS
        // scan. Direct inserts keep the fixture fast; the FTS triggers still fire.
        const insert = service.db.prepare(
          `INSERT INTO code_symbols (id, workspace_root, file_path, kind, symbol_name, subject, text, token_count, created_at, updated_at)
           VALUES (?, ?, ?, 'function', ?, ?, ?, 3, 1, 1)`,
        );
        const seed = service.db.transaction(() => {
          for (let n = 0; n < 20_000; n++) {
            const name = `symbol${String(n).padStart(6, '0')}`;
            const filePath = `${WS}/src/f${n}.ts`;
            insert.run(
              `id-${n}`,
              WS,
              filePath,
              name,
              `code:${filePath}#${name}`,
              `function ${name}() {}`,
            );
          }
        });
        seed();
        expect(store.count(WS)).toBe(20_000);

        const queries = spyOnQueries(service);
        try {
          const miss = await store.searchSymbols('transactions', 5, WS);
          expect(exactTier(miss)).toEqual([]);
          expect(
            queries.prepared.some((sql) =>
              sql.includes('cs.symbol_name = ? COLLATE NOCASE'),
            ),
          ).toBe(true);
          expect(
            queries.prepared.some((sql) =>
              sql.includes('length(cs.symbol_name)'),
            ),
          ).toBe(false);
          expect(queries.iterated).toEqual([]);

          // A case variant of a seeded name is found by the same SQL path.
          queries.reset();
          const hit = await store.searchSymbols('SYMBOL012345', 5, WS);
          expect(hit.hits[0].symbolName).toBe('symbol012345');
          expect(queries.iterated).toEqual([]);
        } finally {
          queries.restore();
        }
      } finally {
        service.close();
      }
    },
  );

  maybe(
    'an ASCII case variant (HandleToolsList -> handleToolsList) is found through SQL NOCASE',
    async () => {
      const { service, store } = await bootstrapInMemory();
      try {
        await store.insertBatch([
          sym(
            'handleToolsList',
            'mcp/a.ts',
            'export function handleToolsList(req) { return list(req); }',
          ),
          sym('caller', 'mcp/c.ts', 'HandleToolsList HandleToolsList'),
          sym(
            'handleToolsList',
            'mcp/a.ts',
            'function handleToolsList() {}',
            'function',
            '/ws/other',
          ),
        ]);
        const queries = spyOnQueries(service);
        try {
          const page = await store.searchSymbols('HandleToolsList', 5, WS);
          expect(page.hits[0].filePath).toBe(`${WS}/mcp/a.ts`);
          expect(exactTier(page)).toEqual([`${WS}/mcp/a.ts`]);
          for (const hit of page.hits) expect(hit.workspaceRoot).toBe(WS);
          expect(
            queries.prepared.some((sql) =>
              sql.includes('cs.symbol_name = ? COLLATE NOCASE'),
            ),
          ).toBe(true);
          expect(queries.iterated).toEqual([]);
        } finally {
          queries.restore();
        }
      } finally {
        service.close();
      }
    },
  );

  maybe(
    'documented gap: an ASCII query does not match a stored name with U+212A KELVIN SIGN',
    async () => {
      const { service, store } = await bootstrapInMemory();
      try {
        const kelvinName = 'Kelvin';
        // toLowerCase folds U+212A to ASCII "k"; SQLite NOCASE does not.
        expect(kelvinName.toLowerCase()).toBe('kelvin');
        await store.insertBatch([
          sym(kelvinName, 'src/k.ts', `function ${kelvinName}() {}`),
        ]);
        expect(exactTier(await store.searchSymbols('kelvin', 5, WS))).toEqual(
          [],
        );
        // The identical spelling still reaches the exact tier.
        expect(exactTier(await store.searchSymbols(kelvinName, 5, WS))).toEqual(
          [`${WS}/src/k.ts`],
        );
      } finally {
        service.close();
      }
    },
  );

  maybe(
    'a non-ASCII case variant reaches the exact tier over a caller (Äpfel / äpfel)',
    async () => {
      const { service, store } = await bootstrapInMemory();
      const queries = spyOnQueries(service);
      try {
        await store.insertBatch([
          sym(
            'Äpfel',
            'src/a.ts',
            `function Äpfel() { ${'lots of unrelated content '.repeat(80)} }`,
          ),
          sym('caller', 'src/b.ts', 'äpfel äpfel äpfel'),
          // Identical-case name in another workspace: must not satisfy the
          // case-sensitive tier for WS, nor leak into its results.
          sym(
            'äpfel',
            'src/a.ts',
            'function äpfel() {}',
            'function',
            '/ws/other',
          ),
        ]);

        for (const q of ['äpfel', 'ÄPFEL']) {
          queries.reset();
          const page = await store.searchSymbols(q, 5, WS);
          expect(page.hits[0].filePath).toBe(`${WS}/src/a.ts`);
          expect(exactTier(page)).toEqual([`${WS}/src/a.ts`]);
          for (const hit of page.hits) expect(hit.workspaceRoot).toBe(WS);
          // Non-ASCII query: the JS scan runs, never SQL NOCASE.
          expect(queries.iterated).toHaveLength(1);
          expect(queries.iterated[0]).toContain('length(cs.symbol_name)');
          expect(queries.prepared.some((sql) => sql.includes('NOCASE'))).toBe(
            false,
          );
        }

        // An identical-case row in WS takes the tier; the variant drops out.
        await store.insertBatch([
          sym('äpfel', 'src/c.ts', 'function äpfel() {}'),
        ]);
        const exact = await store.searchSymbols('äpfel', 5, WS);
        expect(exactTier(exact)).toEqual([`${WS}/src/c.ts`]);
      } finally {
        queries.restore();
        service.close();
      }
    },
  );

  maybe(
    'case folding is the locale-independent toLowerCase mapping (sharp s, Turkish I)',
    async () => {
      const { service, store } = await bootstrapInMemory();
      try {
        await store.insertBatch([
          sym('straße', 'src/s.ts', 'function straße() {}'),
          sym('İndex', 'src/i.ts', 'function İndex() {}'),
          sym('index', 'src/j.ts', 'function index() {}'),
        ]);
        const queries = spyOnQueries(service);
        /** Exact tier for `q`, asserting which case-insensitive path served it. */
        const tierOf = async (q: string, path: 'js-scan' | 'nocase') => {
          queries.reset();
          const tier = exactTier(await store.searchSymbols(q, 5, WS));
          const usedNocase = queries.prepared.some((sql) =>
            sql.includes('COLLATE NOCASE'),
          );
          expect({ q, iterated: queries.iterated.length, usedNocase }).toEqual(
            path === 'js-scan'
              ? { q, iterated: 1, usedNocase: false }
              : { q, iterated: 0, usedNocase: true },
          );
          return tier;
        };

        try {
          // Capital sharp s U+1E9E lowers to U+00DF.
          expect(await tierOf('STRAẞE', 'js-scan')).toEqual([`${WS}/src/s.ts`]);
          // No full case folding: "SS" does not match U+00DF.
          expect(await tierOf('STRASSE', 'nocase')).toEqual([]);
          // U+0130 lowers to "i" + U+0307, so it matches only its own spelling.
          expect(await tierOf('İNDEX', 'js-scan')).toEqual([`${WS}/src/i.ts`]);
          expect(await tierOf('i̇ndex', 'js-scan')).toEqual([`${WS}/src/i.ts`]);
          // ASCII I lowers to i regardless of locale, never dotless U+0131.
          expect(await tierOf('INDEX', 'nocase')).toEqual([`${WS}/src/j.ts`]);
          expect(await tierOf('ındex', 'js-scan')).toEqual([]);
        } finally {
          queries.restore();
        }
      } finally {
        service.close();
      }
    },
  );

  maybe(
    'getIndexFreshness reports count and newest updated_at per workspace',
    async () => {
      const { service, store } = await bootstrapInMemory();
      const nowSpy = jest.spyOn(Date, 'now');
      try {
        expect(await store.getIndexFreshness(WS)).toEqual({
          symbolCount: 0,
          newestUpdatedAt: null,
        });

        nowSpy.mockReturnValue(1_000);
        await store.insertBatch([
          sym('alpha', 'src/a.ts', 'function alpha() {}'),
          sym('beta', 'src/b.ts', 'function beta() {}'),
        ]);
        nowSpy.mockReturnValue(5_000);
        await store.insertBatch([
          sym('gamma', 'src/c.ts', 'function gamma() {}'),
        ]);
        nowSpy.mockReturnValue(9_000);
        await store.insertBatch([
          sym(
            'other',
            'src/o.ts',
            'function other() {}',
            'function',
            '/ws/other',
          ),
        ]);

        expect(await store.getIndexFreshness(WS)).toEqual({
          symbolCount: 3,
          newestUpdatedAt: 5_000,
        });
        expect(await store.getIndexFreshness('/ws/none')).toEqual({
          symbolCount: 0,
          newestUpdatedAt: null,
        });
      } finally {
        nowSpy.mockRestore();
        service.close();
      }
    },
  );

  maybe(
    'replaceFileSymbols: a failed insert keeps the previous symbol, FTS and vector rows',
    async () => {
      const { service, store } = await bootstrap();
      try {
        const first = makeEntry({
          symbolName: 'keepMe',
          subject: 'code:/test/ws/src/a.ts#keepMe',
          text: 'function keepMe() { return 1; }',
        });
        await store.replaceFileSymbols(first.workspaceRoot, first.filePath, [
          first,
        ]);
        expect(
          (
            service.db
              .prepare('SELECT COUNT(*) AS n FROM code_symbols')
              .get() as { n: number }
          ).n,
        ).toBe(1);
        expect(
          (
            service.db
              .prepare('SELECT COUNT(*) AS n FROM code_symbols_vec')
              .get() as { n: number }
          ).n,
        ).toBe(1);
        expect(
          (
            service.db
              .prepare('SELECT COUNT(*) AS n FROM code_symbols_fts')
              .get() as { n: number }
          ).n,
        ).toBe(1);

        const dbRef = service.db;
        const originalPrepare = dbRef.prepare.bind(dbRef);
        const prepareSpy = jest
          .spyOn(dbRef, 'prepare')
          .mockImplementation((sql: string) => {
            const stmt = originalPrepare(sql);
            if (/INSERT INTO code_symbols \(id, workspace_root/i.test(sql)) {
              return {
                ...stmt,
                run: () => {
                  throw new Error('simulated insert failure');
                },
              } as unknown as ReturnType<typeof originalPrepare>;
            }
            return stmt;
          });

        await expect(
          store.replaceFileSymbols(first.workspaceRoot, first.filePath, [
            makeEntry({
              symbolName: 'replacement',
              subject: 'code:/test/ws/src/a.ts#replacement',
              text: 'function replacement() {}',
            }),
          ]),
        ).rejects.toThrow(/simulated insert failure/);
        prepareSpy.mockRestore();

        const kept = service.db
          .prepare('SELECT symbol_name AS name, text AS text FROM code_symbols')
          .get() as { name: string; text: string };
        expect(kept.name).toBe('keepMe');
        expect(kept.text).toBe('function keepMe() { return 1; }');
        expect(
          (
            service.db
              .prepare('SELECT COUNT(*) AS n FROM code_symbols_vec')
              .get() as { n: number }
          ).n,
        ).toBe(1);
        expect(
          (
            service.db
              .prepare('SELECT COUNT(*) AS n FROM code_symbols_fts')
              .get() as { n: number }
          ).n,
        ).toBe(1);
      } finally {
        service.close();
      }
    },
  );

  maybe(
    'purgeMissing deletes FTS and vector rows with symbols and never crosses workspace_root',
    async () => {
      const { service, store } = await bootstrap();
      try {
        const keep = makeEntry({
          filePath: '/test/ws/src/keep.ts',
          subject: 'code:/test/ws/src/keep.ts#keep',
          symbolName: 'keep',
          text: 'function keep() {}',
        });
        const gone = makeEntry({
          filePath: '/test/ws/src/gone.ts',
          subject: 'code:/test/ws/src/gone.ts#gone',
          symbolName: 'gone',
          text: 'function gone() {}',
        });
        const otherRoot = makeEntry({
          workspaceRoot: '/other/ws',
          filePath: '/other/ws/src/gone.ts',
          subject: 'code:/other/ws/src/gone.ts#gone',
          symbolName: 'gone',
          text: 'function gone() {}',
        });
        await store.insertBatch([keep, gone, otherRoot]);
        expect(
          (
            service.db
              .prepare('SELECT COUNT(*) AS n FROM code_symbols')
              .get() as { n: number }
          ).n,
        ).toBe(3);

        const deleted = store.purgeMissing('/test/ws', [keep.filePath]);
        expect(deleted).toBe(1);

        const remaining = service.db
          .prepare(
            'SELECT workspace_root AS root, file_path AS file FROM code_symbols ORDER BY workspace_root, file_path',
          )
          .all() as Array<{ root: string; file: string }>;
        expect(remaining).toEqual([
          { root: '/other/ws', file: '/other/ws/src/gone.ts' },
          { root: '/test/ws', file: '/test/ws/src/keep.ts' },
        ]);
        expect(
          (
            service.db
              .prepare('SELECT COUNT(*) AS n FROM code_symbols_vec')
              .get() as { n: number }
          ).n,
        ).toBe(2);
        expect(
          (
            service.db
              .prepare('SELECT COUNT(*) AS n FROM code_symbols_fts')
              .get() as { n: number }
          ).n,
        ).toBe(2);
      } finally {
        service.close();
      }
    },
  );

  function setVecAvailable(
    service: SqliteConnectionService,
    available: boolean,
  ): void {
    Object.defineProperty(service, 'vecExtensionLoaded', {
      configurable: true,
      get: () => available,
    });
    Object.defineProperty(service, 'vecLoadDiagnostic', {
      configurable: true,
      get: () => ({
        ok: available,
        reason: available ? 'loaded' : 'binary-missing',
        electronVersion: 'unknown',
        processArch: process.arch,
        processPlatform: process.platform,
      }),
    });
  }

  function countTable(service: SqliteConnectionService, table: string): number {
    return (
      service.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
        n: number;
      }
    ).n;
  }

  function symbolRowid(
    service: SqliteConnectionService,
    subject: string,
  ): number {
    return (
      service.db
        .prepare('SELECT rowid AS rowid FROM code_symbols WHERE subject = ?')
        .get(subject) as { rowid: number }
    ).rowid;
  }

  function vecEmbedding(
    service: SqliteConnectionService,
    rowid: number,
  ): Buffer | undefined {
    const row = service.db
      .prepare(
        'SELECT embedding AS embedding FROM code_symbols_vec WHERE rowid = ?',
      )
      .get(rowid) as { embedding: Buffer } | undefined;
    return row?.embedding;
  }

  function staleMarkerCount(service: SqliteConnectionService): number {
    return (
      service.db
        .prepare(
          'SELECT COUNT(*) AS n FROM indexing_state WHERE workspace_fingerprint = ?',
        )
        .get('code-symbols-vec-stale') as { n: number }
    ).n;
  }

  maybe(
    'vec outage leaves symbol-less vec rows, and the next vec-available call removes them',
    async () => {
      const { service, store } = await bootstrap();
      try {
        const entry = makeEntry({
          symbolName: 'alpha',
          subject: 'code:/test/ws/src/a.ts#alpha',
          text: 'function alpha() { return 1; }',
        });
        await store.insertBatch([entry]);
        expect(countTable(service, 'code_symbols')).toBe(1);
        expect(countTable(service, 'code_symbols_vec')).toBe(1);

        setVecAvailable(service, false);
        expect(store.deleteByFile(entry.workspaceRoot, entry.filePath)).toBe(1);
        expect(countTable(service, 'code_symbols')).toBe(0);
        // The vec table cannot be touched while the extension is unloaded.
        expect(countTable(service, 'code_symbols_vec')).toBe(1);

        setVecAvailable(service, true);
        await store.searchSymbols('alpha', 5, entry.workspaceRoot);
        expect(countTable(service, 'code_symbols_vec')).toBe(0);
      } finally {
        service.close();
      }
    },
  );

  maybe(
    'a reused rowid does not keep the previous embedding once vec writes resume',
    async () => {
      const { service, store } = await bootstrap();
      try {
        const first = makeEntry({
          symbolName: 'alpha',
          subject: 'code:/test/ws/src/a.ts#alpha',
          text: 'function alpha() { return 1; }',
        });
        await store.insertBatch([first]);
        const firstRow = service.db
          .prepare('SELECT rowid AS rowid FROM code_symbols WHERE subject = ?')
          .get(first.subject) as { rowid: number };
        const firstEmbedding = (
          service.db
            .prepare(
              'SELECT embedding AS embedding FROM code_symbols_vec WHERE rowid = ?',
            )
            .get(firstRow.rowid) as { embedding: Buffer }
        ).embedding;

        setVecAvailable(service, false);
        store.deleteByFile(first.workspaceRoot, first.filePath);
        const second = makeEntry({
          symbolName: 'beta',
          subject: 'code:/test/ws/src/b.ts#beta',
          filePath: '/test/ws/src/b.ts',
          text: 'function beta() { return 222222; }',
        });
        await store.insertBatch([second]);
        const secondRow = service.db
          .prepare('SELECT rowid AS rowid FROM code_symbols WHERE subject = ?')
          .get(second.subject) as { rowid: number };

        setVecAvailable(service, true);
        await store.insertBatch([second]);

        expect(countTable(service, 'code_symbols')).toBe(1);
        expect(countTable(service, 'code_symbols_vec')).toBe(1);
        const joined = service.db
          .prepare(
            `SELECT COUNT(*) AS n FROM code_symbols s
             JOIN code_symbols_vec v ON v.rowid = s.rowid`,
          )
          .get() as { n: number };
        expect(joined.n).toBe(1);
        const current = (
          service.db
            .prepare(
              'SELECT embedding AS embedding FROM code_symbols_vec WHERE rowid = ?',
            )
            .get(secondRow.rowid) as { embedding: Buffer }
        ).embedding;
        expect(Buffer.compare(current, firstEmbedding)).not.toBe(0);
      } finally {
        service.close();
      }
    },
  );

  maybe(
    'a replace during a vec outage is not served with the old embedding after search',
    async () => {
      const { service, store } = await bootstrap();
      try {
        const first = makeEntry({
          symbolName: 'alpha',
          subject: 'code:/test/ws/src/a.ts#alpha',
          text: 'function alpha() { return 1; }',
        });
        await store.replaceFileSymbols(first.workspaceRoot, first.filePath, [
          first,
        ]);
        const firstRow = service.db
          .prepare('SELECT rowid AS rowid FROM code_symbols WHERE subject = ?')
          .get(first.subject) as { rowid: number };
        const firstEmbedding = (
          service.db
            .prepare(
              'SELECT embedding AS embedding FROM code_symbols_vec WHERE rowid = ?',
            )
            .get(firstRow.rowid) as { embedding: Buffer }
        ).embedding;

        setVecAvailable(service, false);
        const second = makeEntry({
          symbolName: 'beta',
          subject: 'code:/test/ws/src/a.ts#beta',
          text: 'function beta() { return 222222; }',
        });
        await store.replaceFileSymbols(second.workspaceRoot, second.filePath, [
          second,
        ]);
        const secondRow = service.db
          .prepare('SELECT rowid AS rowid FROM code_symbols WHERE subject = ?')
          .get(second.subject) as { rowid: number };
        // The only symbol was deleted, so SQLite reuses its implicit rowid.
        expect(secondRow.rowid).toBe(firstRow.rowid);
        const stale = service.db
          .prepare(
            'SELECT embedding AS embedding FROM code_symbols_vec WHERE rowid = ?',
          )
          .get(secondRow.rowid) as { embedding: Buffer } | undefined;
        expect(stale).toBeDefined();
        if (!stale)
          throw new Error(
            'expected the reused rowid to keep the old embedding',
          );
        expect(Buffer.compare(stale.embedding, firstEmbedding)).toBe(0);
        const marked = service.db
          .prepare(
            'SELECT COUNT(*) AS n FROM indexing_state WHERE workspace_fingerprint = ?',
          )
          .get('code-symbols-vec-stale') as { n: number };
        expect(marked.n).toBe(1);

        setVecAvailable(service, true);
        const page = await store.searchSymbols('alpha', 5, first.workspaceRoot);
        expect(page.bm25Only).toBe(false);
        expect(page.hits.map((hit) => hit.symbolName)).not.toContain('beta');
        const served = service.db
          .prepare(
            `SELECT v.embedding AS embedding
             FROM code_symbols s
             JOIN code_symbols_vec v ON v.rowid = s.rowid
             WHERE s.symbol_name = 'beta'`,
          )
          .get() as { embedding: Buffer } | undefined;
        expect(served).toBeUndefined();
        const markerLeft = service.db
          .prepare(
            'SELECT COUNT(*) AS n FROM indexing_state WHERE workspace_fingerprint = ?',
          )
          .get('code-symbols-vec-stale') as { n: number };
        expect(markerLeft.n).toBe(0);
      } finally {
        service.close();
      }
    },
  );

  maybe(
    'purgeJunk deletes vec rows of junk symbols and leaves the others',
    async () => {
      const { service, store } = await bootstrap();
      try {
        const junk = makeEntry({
          workspaceRoot: '/ws/a',
          symbolName: 'junkA',
          subject: 'code:/ws/a/node_modules/x/i.ts#junkA',
          filePath: '/ws/a/node_modules/x/i.ts',
          text: 'function junkA() { return 1; }',
        });
        const keep = makeEntry({
          workspaceRoot: '/ws/a',
          symbolName: 'keepA',
          subject: 'code:/ws/a/src/keep.ts#keepA',
          filePath: '/ws/a/src/keep.ts',
          text: 'function keepA() { return 2; }',
        });
        const other = makeEntry({
          workspaceRoot: '/ws/b',
          symbolName: 'junkB',
          subject: 'code:/ws/b/dist/b.ts#junkB',
          filePath: '/ws/b/dist/b.ts',
          text: 'function junkB() { return 3; }',
        });
        await store.insertBatch([junk, keep, other]);
        const junkRowid = symbolRowid(service, junk.subject);
        const keepRowid = symbolRowid(service, keep.subject);
        const otherRowid = symbolRowid(service, other.subject);
        const keepEmbedding = vecEmbedding(service, keepRowid);
        const otherEmbedding = vecEmbedding(service, otherRowid);
        expect(vecEmbedding(service, junkRowid)).toBeDefined();
        expect(keepEmbedding).toBeDefined();
        expect(otherEmbedding).toBeDefined();
        if (!keepEmbedding || !otherEmbedding) {
          throw new Error('expected vec rows for the symbols purgeJunk keeps');
        }

        expect(store.purgeJunk('/ws/a')).toBe(1);

        expect(countTable(service, 'code_symbols')).toBe(2);
        expect(countTable(service, 'code_symbols_vec')).toBe(2);
        expect(vecEmbedding(service, junkRowid)).toBeUndefined();
        const keepLeft = vecEmbedding(service, keepRowid);
        const otherLeft = vecEmbedding(service, otherRowid);
        expect(keepLeft).toBeDefined();
        expect(otherLeft).toBeDefined();
        if (!keepLeft || !otherLeft) {
          throw new Error('expected the kept vec rows to remain');
        }
        expect(Buffer.compare(keepLeft, keepEmbedding)).toBe(0);
        expect(Buffer.compare(otherLeft, otherEmbedding)).toBe(0);
        expect(staleMarkerCount(service)).toBe(0);
      } finally {
        service.close();
      }
    },
  );

  maybe(
    'purgeJunk during a vec outage writes the stale marker only when rows are deleted',
    async () => {
      const { service, store } = await bootstrap();
      try {
        const junk = makeEntry({
          workspaceRoot: '/ws/a',
          symbolName: 'junkA',
          subject: 'code:/ws/a/node_modules/x/i.ts#junkA',
          filePath: '/ws/a/node_modules/x/i.ts',
          text: 'function junkA() { return 1; }',
        });
        const keep = makeEntry({
          workspaceRoot: '/ws/a',
          symbolName: 'keepA',
          subject: 'code:/ws/a/src/keep.ts#keepA',
          filePath: '/ws/a/src/keep.ts',
          text: 'function keepA() { return 2; }',
        });
        await store.insertBatch([junk, keep]);
        expect(countTable(service, 'code_symbols_vec')).toBe(2);

        setVecAvailable(service, false);
        expect(store.purgeJunk(null)).toBe(0);
        expect(staleMarkerCount(service)).toBe(0);
        expect(countTable(service, 'code_symbols')).toBe(2);
        expect(countTable(service, 'code_symbols_vec')).toBe(2);

        expect(store.purgeJunk('/ws/a')).toBe(1);
        expect(countTable(service, 'code_symbols')).toBe(1);
        expect(countTable(service, 'code_symbols_vec')).toBe(2);
        expect(staleMarkerCount(service)).toBe(1);
      } finally {
        service.close();
      }
    },
  );

  maybe(
    'purgeWorkspace deletes vec rows of that workspace and leaves the others',
    async () => {
      const { service, store } = await bootstrap();
      try {
        const first = makeEntry({
          workspaceRoot: '/ws/a',
          symbolName: 'alpha',
          subject: 'code:/ws/a/src/a.ts#alpha',
          filePath: '/ws/a/src/a.ts',
          text: 'function alpha() { return 1; }',
        });
        const second = makeEntry({
          workspaceRoot: '/ws/a',
          symbolName: 'beta',
          subject: 'code:/ws/a/src/b.ts#beta',
          filePath: '/ws/a/src/b.ts',
          text: 'function beta() { return 2; }',
        });
        const other = makeEntry({
          workspaceRoot: '/ws/b',
          symbolName: 'gamma',
          subject: 'code:/ws/b/src/c.ts#gamma',
          filePath: '/ws/b/src/c.ts',
          text: 'function gamma() { return 3; }',
        });
        await store.insertBatch([first, second, other]);
        const firstRowid = symbolRowid(service, first.subject);
        const secondRowid = symbolRowid(service, second.subject);
        const otherRowid = symbolRowid(service, other.subject);
        const otherEmbedding = vecEmbedding(service, otherRowid);
        expect(vecEmbedding(service, firstRowid)).toBeDefined();
        expect(vecEmbedding(service, secondRowid)).toBeDefined();
        expect(otherEmbedding).toBeDefined();
        if (!otherEmbedding) {
          throw new Error('expected a vec row for the workspace that stays');
        }

        expect(store.purgeWorkspace('/ws/a')).toBe(2);

        expect(countTable(service, 'code_symbols')).toBe(1);
        expect(countTable(service, 'code_symbols_vec')).toBe(1);
        expect(vecEmbedding(service, firstRowid)).toBeUndefined();
        expect(vecEmbedding(service, secondRowid)).toBeUndefined();
        const otherLeft = vecEmbedding(service, otherRowid);
        expect(otherLeft).toBeDefined();
        if (!otherLeft) {
          throw new Error('expected the other workspace vec row to remain');
        }
        expect(Buffer.compare(otherLeft, otherEmbedding)).toBe(0);
        expect(staleMarkerCount(service)).toBe(0);
      } finally {
        service.close();
      }
    },
  );

  maybe(
    'purgeWorkspace during a vec outage writes the stale marker only when rows are deleted',
    async () => {
      const { service, store } = await bootstrap();
      try {
        const first = makeEntry({
          workspaceRoot: '/ws/a',
          symbolName: 'alpha',
          subject: 'code:/ws/a/src/a.ts#alpha',
          filePath: '/ws/a/src/a.ts',
          text: 'function alpha() { return 1; }',
        });
        const second = makeEntry({
          workspaceRoot: '/ws/a',
          symbolName: 'beta',
          subject: 'code:/ws/a/src/b.ts#beta',
          filePath: '/ws/a/src/b.ts',
          text: 'function beta() { return 2; }',
        });
        const other = makeEntry({
          workspaceRoot: '/ws/b',
          symbolName: 'gamma',
          subject: 'code:/ws/b/src/c.ts#gamma',
          filePath: '/ws/b/src/c.ts',
          text: 'function gamma() { return 3; }',
        });
        await store.insertBatch([first, second, other]);
        expect(countTable(service, 'code_symbols_vec')).toBe(3);

        setVecAvailable(service, false);
        expect(store.purgeWorkspace('/missing')).toBe(0);
        expect(staleMarkerCount(service)).toBe(0);
        expect(countTable(service, 'code_symbols')).toBe(3);
        expect(countTable(service, 'code_symbols_vec')).toBe(3);

        expect(store.purgeWorkspace('/ws/a')).toBe(2);
        expect(countTable(service, 'code_symbols')).toBe(1);
        expect(store.count('/ws/b')).toBe(1);
        expect(countTable(service, 'code_symbols_vec')).toBe(3);
        expect(staleMarkerCount(service)).toBe(1);
      } finally {
        service.close();
      }
    },
  );

  maybe(
    'purgeMissing deletes 201 missing paths across the 200-file batch boundary',
    async () => {
      const { service, store } = await bootstrap();
      try {
        const keep = makeEntry({
          filePath: '/test/ws/src/keep.ts',
          subject: 'code:/test/ws/src/keep.ts#keep',
          symbolName: 'keep',
          text: 'function keep() { return 1; }',
        });
        const other = makeEntry({
          workspaceRoot: '/other/ws',
          filePath: '/other/ws/src/stay.ts',
          subject: 'code:/other/ws/src/stay.ts#stay',
          symbolName: 'stay',
          text: 'function stay() { return 1; }',
        });
        const missing = Array.from({ length: 201 }, (_, i) =>
          makeEntry({
            filePath: `/test/ws/src/m${i}.ts`,
            subject: `code:/test/ws/src/m${i}.ts#m${i}`,
            symbolName: `m${i}`,
            text: `function m${i}() { return ${i}; }`,
          }),
        );
        await store.insertBatch([keep, other, ...missing]);
        expect(countTable(service, 'code_symbols')).toBe(203);

        const deleted = store.purgeMissing('/test/ws', [keep.filePath]);
        expect(deleted).toBe(201);
        expect(countTable(service, 'code_symbols')).toBe(2);
        expect(countTable(service, 'code_symbols_vec')).toBe(2);
        expect(countTable(service, 'code_symbols_fts')).toBe(2);
        const remaining = service.db
          .prepare(
            'SELECT workspace_root AS root, file_path AS file FROM code_symbols ORDER BY workspace_root, file_path',
          )
          .all() as Array<{ root: string; file: string }>;
        expect(remaining).toEqual([
          { root: '/other/ws', file: '/other/ws/src/stay.ts' },
          { root: '/test/ws', file: '/test/ws/src/keep.ts' },
        ]);
      } finally {
        service.close();
      }
    },
  );

  maybe(
    'a failure in the second purge batch rolls that batch back and leaves earlier batches committed',
    async () => {
      const { service, store } = await bootstrap();
      try {
        const keep = makeEntry({
          filePath: '/test/ws/src/keep.ts',
          subject: 'code:/test/ws/src/keep.ts#keep',
          symbolName: 'keep',
          text: 'function keep() { return 1; }',
        });
        const missing = Array.from({ length: 201 }, (_, i) =>
          makeEntry({
            filePath: `/test/ws/src/m${i}.ts`,
            subject: `code:/test/ws/src/m${i}.ts#m${i}`,
            symbolName: `m${i}`,
            text: `function m${i}() { return ${i}; }`,
          }),
        );
        await store.insertBatch([keep, ...missing]);

        let symbolDeletes = 0;
        const originalPrepare = service.db.prepare.bind(service.db);
        const prepareSpy = jest
          .spyOn(service.db, 'prepare')
          .mockImplementation((sql: string) => {
            const stmt = originalPrepare(sql);
            if (sql.startsWith('DELETE FROM code_symbols WHERE')) {
              const run = stmt.run.bind(stmt);
              return {
                ...stmt,
                run: (...args: unknown[]) => {
                  symbolDeletes += 1;
                  if (symbolDeletes > 200) {
                    throw new Error('batch-2 failure');
                  }
                  return run(...args);
                },
              } as unknown as ReturnType<typeof originalPrepare>;
            }
            return stmt;
          });

        expect(() => store.purgeMissing('/test/ws', [keep.filePath])).toThrow(
          /batch-2 failure/,
        );
        prepareSpy.mockRestore();

        // Batch 1 (200 files) committed. Batch 2 (1 file) rolled back, so
        // that symbol and its vec/FTS row are still there with `keep`.
        expect(countTable(service, 'code_symbols')).toBe(2);
        expect(countTable(service, 'code_symbols_vec')).toBe(2);
        expect(countTable(service, 'code_symbols_fts')).toBe(2);
        const keepRow = service.db
          .prepare('SELECT COUNT(*) AS n FROM code_symbols WHERE file_path = ?')
          .get(keep.filePath) as { n: number };
        expect(keepRow.n).toBe(1);
      } finally {
        service.close();
      }
    },
  );

  maybe(
    'workspace_root scoping does not fold case or a trailing separator; file paths fold backslashes',
    async () => {
      const { service, store } = await bootstrap();
      try {
        const root = 'C:/Repo';
        const keep = makeEntry({
          workspaceRoot: root,
          filePath: 'C:/Repo/src/keep.ts',
          subject: 'code:C:/Repo/src/keep.ts#keep',
          symbolName: 'keep',
          text: 'function keep() { return 1; }',
        });
        const gone = makeEntry({
          workspaceRoot: root,
          filePath: 'C:/Repo/src/gone.ts',
          subject: 'code:C:/Repo/src/gone.ts#gone',
          symbolName: 'gone',
          text: 'function gone() { return 2; }',
        });
        const otherCase = makeEntry({
          workspaceRoot: 'c:/repo',
          filePath: 'c:/repo/src/keep.ts',
          subject: 'code:c:/repo/src/keep.ts#keep',
          symbolName: 'keep',
          text: 'function otherCase() { return 3; }',
        });
        await store.insertBatch([keep, gone, otherCase]);

        // Present-path comparison rewrites `\\` to `/`. The root string is
        // bound as given.
        const deleted = store.purgeMissing(root, ['C:\\Repo\\src\\keep.ts']);
        expect(deleted).toBe(1);

        // A trailing separator and a different case are different roots.
        // An empty present list deletes every file of the root it names.
        expect(store.purgeMissing(`${root}/`, [keep.filePath])).toBe(0);
        expect(store.purgeMissing('c:/Repo', [])).toBe(0);
        expect(store.purgeMissing('c:/repo', [])).toBe(1);

        const remaining = service.db
          .prepare(
            'SELECT workspace_root AS root, file_path AS file FROM code_symbols ORDER BY workspace_root, file_path',
          )
          .all() as Array<{ root: string; file: string }>;
        expect(remaining).toEqual([
          { root: 'C:/Repo', file: 'C:/Repo/src/keep.ts' },
        ]);
      } finally {
        service.close();
      }
    },
  );
});
