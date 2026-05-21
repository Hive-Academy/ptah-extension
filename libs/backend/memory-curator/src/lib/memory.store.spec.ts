/**
 * Unit tests for MemoryStore write-counter API.
 *
 * Covers:
 *   - `getWriteCounter` returns 0 for a workspace that has never been written
 *   - Counter increments on insert, setPinned, forget, updateSalience, appendChunks
 *   - Per-workspace counters are independent
 */
import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import { SqliteConnectionService } from '@ptah-extension/persistence-sqlite';
import type { IEmbedder } from '@ptah-extension/persistence-sqlite';
import { MemoryStore } from './memory.store';
import type { MemoryInsert } from './memory.types';
import { memoryId } from './memory.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function makeEmbedder(): IEmbedder {
  return {
    embed: jest.fn(async () => []),
    dim: 384,
  } as unknown as IEmbedder;
}

/**
 * Minimal SQLite stub that tracks prepared statement calls.
 * `runResult` controls the `.run()` return value (defaults to { changes: 1 }).
 * `getResult` controls what `.get()` returns for workspace_root lookups.
 */
function makeDb(
  opts: {
    getResult?: unknown;
    runChanges?: number;
  } = {},
): {
  stub: SqliteConnectionService;
  runMock: jest.Mock;
  getMock: jest.Mock;
  execMock: jest.Mock;
  transactionMock: jest.Mock;
} {
  const runMock = jest.fn(() => ({ changes: opts.runChanges ?? 1 }));
  const getMock = jest.fn(() => opts.getResult ?? { workspace_root: null });
  const execMock = jest.fn();

  // transaction() must return a callable that invokes the callback immediately.
  const transactionMock = jest.fn(
    (fn: (...args: unknown[]) => unknown) =>
      (...args: unknown[]) =>
        fn(...args),
  );

  const stub = {
    vecExtensionLoaded: false,
    db: {
      prepare: jest.fn(() => ({
        run: runMock,
        get: getMock,
        all: jest.fn(() => []),
      })),
      exec: execMock,
      transaction: transactionMock,
    },
  } as unknown as SqliteConnectionService;

  return { stub, runMock, getMock, execMock, transactionMock };
}

function makeStore(
  connection: SqliteConnectionService,
  embedder?: IEmbedder,
): MemoryStore {
  return new MemoryStore(makeLogger(), connection, embedder ?? makeEmbedder());
}

// ---------------------------------------------------------------------------
// getWriteCounter — initial state
// ---------------------------------------------------------------------------

describe('MemoryStore.getWriteCounter', () => {
  it('returns 0 for a workspace that has never been written', () => {
    const { stub } = makeDb();
    const store = makeStore(stub);
    expect(store.getWriteCounter('/never/written')).toBe(0);
  });

  it('returns 0 for the global (empty string) key before any write', () => {
    const { stub } = makeDb();
    const store = makeStore(stub);
    expect(store.getWriteCounter('')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Write-counter bumps per write path
// ---------------------------------------------------------------------------

describe('MemoryStore write-counter bumps', () => {
  /**
   * A minimal MemoryInsert for testing insertMemoryWithChunks.
   * Runs synchronously because the embedder mock returns [] and chunks=[].
   */
  const baseInsert: MemoryInsert = {
    tier: 'core',
    kind: 'fact',
    content: 'test content',
    workspaceRoot: '/ws/A',
  };

  it('bumps counter on insertMemoryWithChunks for the correct workspace', async () => {
    // The transaction mock invokes the callback synchronously.
    const { stub } = makeDb({ getResult: { workspace_root: '/ws/A' } });
    const store = makeStore(stub);

    expect(store.getWriteCounter('/ws/A')).toBe(0);
    await store.insertMemoryWithChunks(baseInsert, []);
    expect(store.getWriteCounter('/ws/A')).toBe(1);
  });

  it('bumps counter on setPinned (looks up workspace_root from DB)', () => {
    const { stub } = makeDb({ getResult: { workspace_root: '/ws/A' } });
    const store = makeStore(stub);
    const id = memoryId('01J000000000000000000000A1');

    expect(store.getWriteCounter('/ws/A')).toBe(0);
    store.setPinned(id, true);
    expect(store.getWriteCounter('/ws/A')).toBe(1);
  });

  it('bumps counter on forget (looks up workspace_root from DB)', () => {
    const { stub } = makeDb({ getResult: { workspace_root: '/ws/B' } });
    const store = makeStore(stub);
    const id = memoryId('01J000000000000000000000B2');

    expect(store.getWriteCounter('/ws/B')).toBe(0);
    store.forget(id);
    expect(store.getWriteCounter('/ws/B')).toBe(1);
  });

  it('bumps counter on updateSalience (looks up workspace_root from DB)', () => {
    const { stub } = makeDb({ getResult: { workspace_root: '/ws/A' } });
    const store = makeStore(stub);
    const id = memoryId('01J000000000000000000000A3');

    expect(store.getWriteCounter('/ws/A')).toBe(0);
    store.updateSalience(id, 0.9);
    expect(store.getWriteCounter('/ws/A')).toBe(1);
  });

  it('bumps counter on deleteBySubjectPrefix when rows are deleted', () => {
    const { stub } = makeDb({ runChanges: 3 });
    const store = makeStore(stub);

    expect(store.getWriteCounter('/ws/C')).toBe(0);
    store.deleteBySubjectPrefix('file://', '/ws/C');
    expect(store.getWriteCounter('/ws/C')).toBe(1);
  });

  it('does NOT bump counter on deleteBySubjectPrefix when no rows match', () => {
    const { stub } = makeDb({ runChanges: 0 });
    const store = makeStore(stub);

    store.deleteBySubjectPrefix('file://', '/ws/D');
    expect(store.getWriteCounter('/ws/D')).toBe(0);
  });

  it('bumps counter on appendChunks', async () => {
    const { stub } = makeDb({ getResult: { workspace_root: '/ws/A' } });
    const store = makeStore(stub);
    const id = memoryId('01J000000000000000000000A5');

    expect(store.getWriteCounter('/ws/A')).toBe(0);
    await store.appendChunks(id, [
      { ord: 0, text: 'chunk text', tokenCount: 2 },
    ]);
    expect(store.getWriteCounter('/ws/A')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// handleFatalWriteError wiring
// ---------------------------------------------------------------------------

describe('MemoryStore D5 — handleFatalWriteError wiring', () => {
  /**
   * Simulate a disk-full error thrown by the transaction callback.
   * The store must call connection.handleFatalWriteError(err) and re-throw.
   */
  it('calls handleFatalWriteError on connection when insertMemoryWithChunks transaction throws SQLITE_FULL', async () => {
    const handleFatalWriteError = jest.fn().mockReturnValue(true);
    const diskFullError = new Error('SQLITE_FULL: database or disk is full');

    const transactionMock = jest.fn(
      // transaction() returns a function that throws when called.
      (_fn: unknown) =>
        (..._args: unknown[]) => {
          throw diskFullError;
        },
    );

    const stub = {
      vecExtensionLoaded: false,
      db: {
        prepare: jest.fn(() => ({
          run: jest.fn(() => ({ changes: 1 })),
          get: jest.fn(() => undefined),
          all: jest.fn(() => []),
        })),
        exec: jest.fn(),
        transaction: transactionMock,
      },
      handleFatalWriteError,
    } as unknown as SqliteConnectionService;

    const store = makeStore(stub);
    const insert: MemoryInsert = {
      tier: 'core',
      kind: 'fact',
      content: 'test',
      workspaceRoot: '/ws/A',
    };

    await expect(store.insertMemoryWithChunks(insert, [])).rejects.toThrow(
      'SQLITE_FULL',
    );
    expect(handleFatalWriteError).toHaveBeenCalledWith(diskFullError);
  });

  it('calls handleFatalWriteError on connection when appendChunks transaction throws SQLITE_FULL', async () => {
    const handleFatalWriteError = jest.fn().mockReturnValue(true);
    const diskFullError = new Error('SQLITE_FULL: database or disk is full');

    const transactionMock = jest.fn((_fn: unknown) => (..._args: unknown[]) => {
      throw diskFullError;
    });

    const stub = {
      vecExtensionLoaded: false,
      db: {
        prepare: jest.fn(() => ({
          run: jest.fn(() => ({ changes: 1 })),
          get: jest.fn(() => ({ workspace_root: '/ws/A', m: 0 })),
          all: jest.fn(() => []),
        })),
        exec: jest.fn(),
        transaction: transactionMock,
      },
      handleFatalWriteError,
    } as unknown as SqliteConnectionService;

    const store = makeStore(stub);
    const id = memoryId('01J000000000000000000000A1');

    await expect(
      store.appendChunks(id, [{ ord: 0, text: 'text', tokenCount: 1 }]),
    ).rejects.toThrow('SQLITE_FULL');
    expect(handleFatalWriteError).toHaveBeenCalledWith(diskFullError);
  });
});

// ---------------------------------------------------------------------------
// Per-workspace independence
// ---------------------------------------------------------------------------

describe('MemoryStore — per-workspace counter independence', () => {
  it('bumping workspace A does not affect workspace B counter', () => {
    // getMock returns different workspaces depending on call order.
    let callIndex = 0;
    const workspaces = ['/ws/A', '/ws/B'];
    const runMock = jest.fn(() => ({ changes: 1 }));
    const getMock = jest.fn(() => ({
      workspace_root: workspaces[callIndex++ % 2],
    }));
    const stub = {
      vecExtensionLoaded: false,
      db: {
        prepare: jest.fn(() => ({
          run: runMock,
          get: getMock,
          all: jest.fn(() => []),
        })),
        exec: jest.fn(),
        transaction: jest.fn(
          (fn: (...args: unknown[]) => unknown) =>
            (...args: unknown[]) =>
              fn(...args),
        ),
      },
    } as unknown as SqliteConnectionService;

    const store = makeStore(stub);
    const idA = memoryId('01J000000000000000000000AA');
    const idB = memoryId('01J000000000000000000000BB');

    store.forget(idA); // bumps /ws/A
    store.forget(idB); // bumps /ws/B

    expect(store.getWriteCounter('/ws/A')).toBe(1);
    expect(store.getWriteCounter('/ws/B')).toBe(1);

    store.forget(idA); // getMock cycles back to /ws/A
    expect(store.getWriteCounter('/ws/A')).toBe(2);
    expect(store.getWriteCounter('/ws/B')).toBe(1); // unchanged
  });

  it('null workspace_root bumps the global ("") counter', () => {
    const { stub } = makeDb({ getResult: { workspace_root: null } });
    const store = makeStore(stub);
    const id = memoryId('01J000000000000000000000G1');

    store.forget(id);
    expect(store.getWriteCounter('')).toBe(1);
    expect(store.getWriteCounter('/ws/any')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// purgeBySubjectPattern
// ---------------------------------------------------------------------------

/**
 * Build a SqliteConnectionService stub that records every `prepare(sql)` call
 * and returns a dedicated `run` mock per prepared statement.
 *
 * `runChanges` controls the `.changes` returned by each `run()` call (shared).
 */
function makePurgeDb(runChanges = 1): {
  stub: SqliteConnectionService;
  preparedSqls: string[];
  runArgs: unknown[][];
} {
  const preparedSqls: string[] = [];
  const runArgs: unknown[][] = [];

  const stub = {
    vecExtensionLoaded: false,
    db: {
      prepare: jest.fn((sql: string) => {
        preparedSqls.push(sql);
        return {
          run: jest.fn((...args: unknown[]) => {
            runArgs.push(args);
            return { changes: runChanges };
          }),
          get: jest.fn(() => undefined),
          all: jest.fn(() => []),
        };
      }),
      exec: jest.fn(),
      transaction: jest.fn(
        (fn: (...args: unknown[]) => unknown) =>
          (...args: unknown[]) =>
            fn(...args),
      ),
    },
  } as unknown as SqliteConnectionService;

  return { stub, preparedSqls, runArgs };
}

describe('MemoryStore.purgeBySubjectPattern', () => {
  // --- Test 1: substring mode escapes metacharacters and wraps in %…% ---
  it('substring mode: passes escaped %pattern% to SQL and returns deleted count', () => {
    const { stub, preparedSqls, runArgs } = makePurgeDb(1);
    const store = makeStore(stub);

    const deleted = store.purgeBySubjectPattern('node_modules', 'substring');

    expect(deleted).toBe(1);
    // SQL must be parameterised — no pattern in the SQL string itself.
    expect(preparedSqls[0]).toContain('subject LIKE ?');
    // The ESCAPE clause must be present (literal backslash in the SQL string).
    expect(preparedSqls[0]).toContain("ESCAPE '\\'");
    // Pattern must be wrapped in % and passed as bind parameter.
    // Note: '_' is a LIKE metachar so substring mode escapes it to '\_'.
    expect(runArgs[0][0]).toBe('%node\\_modules%');
    // Write counter must have been bumped.
    expect(store.getWriteCounter('')).toBe(1);
  });

  // --- Test 2: like mode passes the pattern verbatim ---
  it('like mode: passes the raw LIKE pattern verbatim to SQL', () => {
    const { stub, preparedSqls, runArgs } = makePurgeDb(3);
    const store = makeStore(stub);

    const deleted = store.purgeBySubjectPattern('code:function:%', 'like');

    expect(deleted).toBe(3);
    expect(preparedSqls[0]).toContain('subject LIKE ?');
    // Pattern must be verbatim, not wrapped.
    expect(runArgs[0][0]).toBe('code:function:%');
  });

  // --- Test 3: empty pattern guard — returns 0 immediately, no SQL executed ---
  it('empty pattern guard: returns 0 without executing any SQL', () => {
    const { stub, preparedSqls, runArgs } = makePurgeDb(99);
    const store = makeStore(stub);

    // Whitespace-only should also be treated as empty.
    expect(store.purgeBySubjectPattern('', 'substring')).toBe(0);
    expect(store.purgeBySubjectPattern('   ', 'substring')).toBe(0);

    // No prepare() call should have occurred.
    // (The stub's prepare mock is shared; filter to purge-related calls.)
    // Since no DB calls occur for purge, preparedSqls must be empty.
    expect(preparedSqls).toHaveLength(0);
    expect(runArgs).toHaveLength(0);
    // No write counter bump.
    expect(store.getWriteCounter('')).toBe(0);
  });

  // --- Test 4: NULL-subject rows are preserved ---
  // NULL-subject rows are excluded by LIKE semantics (NULL LIKE ? → NULL/falsy),
  // so we verify the SQL does NOT include an explicit NULL-exclusion clause,
  // meaning the store relies on SQLite's own NULL-safe LIKE behaviour.
  it('NULL-subject rows: SQL does not explicitly exclude NULLs (relies on LIKE NULL semantics)', () => {
    const { stub, preparedSqls } = makePurgeDb(0);
    const store = makeStore(stub);

    store.purgeBySubjectPattern('anything', 'substring');

    // SQL must use LIKE on subject but must NOT have an extra "subject IS NOT NULL"
    // clause — the LIKE NULL-safety is inherent to SQLite behaviour.
    expect(preparedSqls[0]).not.toContain('IS NOT NULL');
    // Confirm the store returns 0 changes when no rows are matched.
    expect(store.getWriteCounter('')).toBe(0); // no bump when changes === 0
  });

  // --- Test 5: workspaceRoot scoping ---
  it('workspaceRoot scoping: adds AND workspace_root IS ? clause and passes workspaceRoot as second bind param', () => {
    const { stub, preparedSqls, runArgs } = makePurgeDb(2);
    const store = makeStore(stub);

    const deleted = store.purgeBySubjectPattern(
      'stale_prefix',
      'substring',
      '/ws/A',
    );

    expect(deleted).toBe(2);
    expect(preparedSqls[0]).toContain('workspace_root IS ?');
    // First bind param is the LIKE pattern, second is the workspaceRoot.
    // Note: '_' is a LIKE metachar so substring mode escapes it to '\_'.
    expect(runArgs[0][0]).toBe('%stale\\_prefix%');
    expect(runArgs[0][1]).toBe('/ws/A');
    // Write counter bumped for /ws/A.
    expect(store.getWriteCounter('/ws/A')).toBe(1);
    // Other workspace unaffected.
    expect(store.getWriteCounter('/ws/B')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// B5 regression — sqlite-vec rowid INTEGER affinity (native-gated)
// ---------------------------------------------------------------------------

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

function makeTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-memory-store-test-'));
  return path.join(dir, 'ptah.db');
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
  } as unknown as IEmbedder;
}

describe('MemoryStore B5 — sqlite-vec rowid INTEGER affinity (native-gated)', () => {
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
    store: MemoryStore;
    embedder: IEmbedder;
  }> {
    const dbPath = makeTempDbPath();
    const logger = makeLogger();
    const service = new SqliteConnectionService(dbPath, logger);
    await service.openAndMigrate();
    expect(service.vecExtensionLoaded).toBe(true);
    const embedder = makeDeterministicEmbedder();
    const store = new MemoryStore(logger, service, embedder);
    return { service, store, embedder };
  }

  maybe(
    'insertMemoryWithChunks writes memory + chunk + vec rows with matching rowid',
    async () => {
      const { service, store } = await bootstrap();
      try {
        const id = await store.insertMemoryWithChunks(
          {
            tier: 'core',
            kind: 'fact',
            content: 'first memory body',
            workspaceRoot: '/ws/A',
            subject: 'memory:/ws/A#first',
          },
          [
            { ord: 0, text: 'chunk one text', tokenCount: 3 },
            { ord: 1, text: 'chunk two text', tokenCount: 3 },
          ],
        );
        expect(typeof id).toBe('string');

        const memoryCount = (
          service.db.prepare('SELECT COUNT(*) AS n FROM memories').get() as {
            n: number;
          }
        ).n;
        const chunkCount = (
          service.db
            .prepare('SELECT COUNT(*) AS n FROM memory_chunks')
            .get() as { n: number }
        ).n;
        const vecCount = (
          service.db
            .prepare('SELECT COUNT(*) AS n FROM memory_chunks_vec')
            .get() as { n: number }
        ).n;
        expect(memoryCount).toBe(1);
        expect(chunkCount).toBe(2);
        expect(vecCount).toBe(2);

        const rowids = service.db
          .prepare(
            'SELECT c.rowid AS crowid, v.rowid AS vrowid FROM memory_chunks c LEFT JOIN memory_chunks_vec v ON v.rowid = c.rowid ORDER BY c.rowid',
          )
          .all() as Array<{ crowid: number; vrowid: number | null }>;
        expect(rowids).toHaveLength(2);
        for (const row of rowids) {
          expect(row.vrowid).toBe(row.crowid);
        }
      } finally {
        service.close();
      }
    },
  );

  maybe(
    're-running insertMemoryWithChunks preserves memory + chunk + vec counts',
    async () => {
      const { service, store } = await bootstrap();
      try {
        await store.insertMemoryWithChunks(
          {
            tier: 'core',
            kind: 'fact',
            content: 'first',
            workspaceRoot: '/ws/A',
            subject: 'memory:/ws/A#first',
          },
          [{ ord: 0, text: 'chunk text one', tokenCount: 3 }],
        );
        await store.insertMemoryWithChunks(
          {
            tier: 'recall',
            kind: 'fact',
            content: 'second',
            workspaceRoot: '/ws/A',
            subject: 'memory:/ws/A#second',
          },
          [{ ord: 0, text: 'chunk text two', tokenCount: 3 }],
        );

        const memoryCount = (
          service.db.prepare('SELECT COUNT(*) AS n FROM memories').get() as {
            n: number;
          }
        ).n;
        const chunkCount = (
          service.db
            .prepare('SELECT COUNT(*) AS n FROM memory_chunks')
            .get() as { n: number }
        ).n;
        const vecCount = (
          service.db
            .prepare('SELECT COUNT(*) AS n FROM memory_chunks_vec')
            .get() as { n: number }
        ).n;
        expect(memoryCount).toBe(2);
        expect(chunkCount).toBe(2);
        expect(vecCount).toBe(2);
      } finally {
        service.close();
      }
    },
  );

  maybe(
    'appendChunks writes additional chunk + vec rows with matching rowid',
    async () => {
      const { service, store } = await bootstrap();
      try {
        const id = await store.insertMemoryWithChunks(
          {
            tier: 'core',
            kind: 'fact',
            content: 'base',
            workspaceRoot: '/ws/A',
            subject: 'memory:/ws/A#base',
          },
          [{ ord: 0, text: 'original chunk', tokenCount: 3 }],
        );

        await store.appendChunks(id, [
          { ord: 1, text: 'appended chunk one', tokenCount: 3 },
          { ord: 2, text: 'appended chunk two', tokenCount: 3 },
        ]);

        const chunkCount = (
          service.db
            .prepare('SELECT COUNT(*) AS n FROM memory_chunks')
            .get() as { n: number }
        ).n;
        const vecCount = (
          service.db
            .prepare('SELECT COUNT(*) AS n FROM memory_chunks_vec')
            .get() as { n: number }
        ).n;
        expect(chunkCount).toBe(3);
        expect(vecCount).toBe(3);

        const rowids = service.db
          .prepare(
            'SELECT c.rowid AS crowid, v.rowid AS vrowid FROM memory_chunks c LEFT JOIN memory_chunks_vec v ON v.rowid = c.rowid ORDER BY c.rowid',
          )
          .all() as Array<{ crowid: number; vrowid: number | null }>;
        expect(rowids).toHaveLength(3);
        for (const row of rowids) {
          expect(row.vrowid).toBe(row.crowid);
        }
      } finally {
        service.close();
      }
    },
  );
});

// ---------------------------------------------------------------------------
// B7 regression — rebuildIndex repopulates FTS5 from memory_chunks (native-gated)
// ---------------------------------------------------------------------------

describe('MemoryStore B7 — rebuildIndex FTS repopulation (native-gated)', () => {
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
    store: MemoryStore;
  }> {
    const dbPath = makeTempDbPath();
    const logger = makeLogger();
    const service = new SqliteConnectionService(dbPath, logger);
    await service.openAndMigrate();
    expect(service.vecExtensionLoaded).toBe(true);
    const embedder = makeDeterministicEmbedder();
    const store = new MemoryStore(logger, service, embedder);
    return { service, store };
  }

  maybe(
    'repopulates memory_chunks_fts so FTS MATCH returns inserted rows',
    async () => {
      const { service, store } = await bootstrap();
      try {
        await store.insertMemoryWithChunks(
          {
            tier: 'core',
            kind: 'fact',
            content: 'alpha body',
            workspaceRoot: '/ws/A',
            subject: 'memory:/ws/A#alpha',
          },
          [
            { ord: 0, text: 'distinctive alpha keyword', tokenCount: 3 },
            { ord: 1, text: 'second alpha chunk', tokenCount: 3 },
          ],
        );
        await store.insertMemoryWithChunks(
          {
            tier: 'recall',
            kind: 'fact',
            content: 'bravo body',
            workspaceRoot: '/ws/A',
            subject: 'memory:/ws/A#bravo',
          },
          [{ ord: 0, text: 'unique bravo phrase', tokenCount: 3 }],
        );

        const chunkCount = (
          service.db
            .prepare('SELECT COUNT(*) AS n FROM memory_chunks')
            .get() as { n: number }
        ).n;
        expect(chunkCount).toBe(3);

        const result = await store.rebuildIndex();
        expect(result.rebuiltFts).toBe(true);
        expect(result.rebuiltVec).toBe(true);

        const alphaHits = service.db
          .prepare(
            `SELECT rowid FROM memory_chunks_fts WHERE memory_chunks_fts MATCH 'alpha'`,
          )
          .all() as Array<{ rowid: number }>;
        expect(alphaHits.length).toBeGreaterThan(0);

        const bravoHits = service.db
          .prepare(
            `SELECT rowid FROM memory_chunks_fts WHERE memory_chunks_fts MATCH 'bravo'`,
          )
          .all() as Array<{ rowid: number }>;
        expect(bravoHits.length).toBe(1);
      } finally {
        service.close();
      }
    },
  );

  maybe('succeeds without error on an empty memory_chunks table', async () => {
    const { service, store } = await bootstrap();
    try {
      const result = await store.rebuildIndex();
      expect(result.rebuiltFts).toBe(true);
      expect(result.rebuiltVec).toBe(true);

      const hits = service.db
        .prepare(
          `SELECT rowid FROM memory_chunks_fts WHERE memory_chunks_fts MATCH 'anything'`,
        )
        .all();
      expect(hits).toEqual([]);
    } finally {
      service.close();
    }
  });

  maybe(
    'is idempotent — running twice leaves the FTS row count equal to chunks',
    async () => {
      const { service, store } = await bootstrap();
      try {
        await store.insertMemoryWithChunks(
          {
            tier: 'core',
            kind: 'fact',
            content: 'gamma body',
            workspaceRoot: '/ws/A',
            subject: 'memory:/ws/A#gamma',
          },
          [
            { ord: 0, text: 'gamma chunk one', tokenCount: 3 },
            { ord: 1, text: 'gamma chunk two', tokenCount: 3 },
          ],
        );

        await store.rebuildIndex();
        const firstHits = service.db
          .prepare(
            `SELECT rowid FROM memory_chunks_fts WHERE memory_chunks_fts MATCH 'gamma'`,
          )
          .all() as Array<{ rowid: number }>;
        expect(firstHits.length).toBe(2);

        await store.rebuildIndex();
        const secondHits = service.db
          .prepare(
            `SELECT rowid FROM memory_chunks_fts WHERE memory_chunks_fts MATCH 'gamma'`,
          )
          .all() as Array<{ rowid: number }>;
        expect(secondHits.length).toBe(2);
        expect(secondHits.map((h) => h.rowid).sort()).toEqual(
          firstHits.map((h) => h.rowid).sort(),
        );
      } finally {
        service.close();
      }
    },
  );
});
