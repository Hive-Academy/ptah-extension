/**
 * Unit tests for MemoryStore write-counter API.
 *
 * Covers:
 *   - `getWriteCounter` returns 0 for a workspace that has never been written
 *   - Counter increments on insert, setPinned, forget and appendChunks
 *   - Per-workspace counters are independent
 */
import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  SqliteConnectionService,
  VecStatusService,
} from '@ptah-extension/persistence-sqlite';
import type { IEmbedder } from '@ptah-extension/persistence-sqlite';
import { MemoryStore } from './memory.store';
import type { MemoryInsert } from './memory.types';
import { memoryId } from './memory.types';
import { MemoryLifecycleStore } from './retention/memory-lifecycle.store';
import {
  DAY_MS,
  MEMORY_RETENTION_DEFAULTS,
} from './retention/memory-retention-config';
import {
  adaptSqliteDatabase,
  requireSqliteOpener,
  type RawDb,
} from './retention/retention-sqlite.test-support';

function makeVecStatus(available = false): VecStatusService {
  const diagnostic = {
    ok: available,
    reason: available ? ('ok' as const) : ('binary-missing' as const),
    electronVersion: '40.0.0',
    processArch: 'x64' as NodeJS.Architecture,
    processPlatform: 'linux' as NodeJS.Platform,
  };
  return {
    available,
    reason: diagnostic.reason,
    diagnostic,
    getStatus: () => ({
      available,
      reason: diagnostic.reason,
      diagnostic,
    }),
    on: () => ({ dispose: () => undefined }),
    refresh: () => undefined,
  } as unknown as VecStatusService;
}

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
  vecStatus?: VecStatusService,
): MemoryStore {
  const available =
    (connection as unknown as { vecExtensionLoaded?: boolean })
      .vecExtensionLoaded ?? false;
  return new MemoryStore(
    makeLogger(),
    connection,
    embedder ?? makeEmbedder(),
    vecStatus ?? makeVecStatus(available),
  );
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
  it('marks each changed lifecycle workspace, including the global key', () => {
    const { stub } = makeDb();
    const store = makeStore(stub);
    store.markWorkspacesChanged(['/ws/A', null, '/ws/A']);
    expect(store.getWriteCounter('/ws/A')).toBe(2);
    expect(store.getWriteCounter('')).toBe(1);
  });

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
// stats — the workspaceRoot tri-state (TASK_2026_315 A4)
//
// These three states are genuinely different queries and the fix at the RPC
// boundary depends on them staying that way. Pinned here so nobody collapses
// `null` into `undefined` (or the reverse) while "simplifying" the signature.
// ---------------------------------------------------------------------------

describe('MemoryStore.stats — workspaceRoot tri-state', () => {
  function makeSqlCapturingDb(): {
    stub: SqliteConnectionService;
    prepared: string[];
    boundArgs: unknown[][];
  } {
    const prepared: string[] = [];
    const boundArgs: unknown[][] = [];
    const stub = {
      vecExtensionLoaded: false,
      db: {
        prepare: jest.fn((sql: string) => {
          prepared.push(sql);
          return {
            all: jest.fn((...args: unknown[]) => {
              boundArgs.push(args);
              return [];
            }),
            get: jest.fn((...args: unknown[]) => {
              boundArgs.push(args);
              return { m: null };
            }),
            run: jest.fn(() => ({ changes: 0 })),
          };
        }),
        exec: jest.fn(),
        transaction: jest.fn(),
      },
    } as unknown as SqliteConnectionService;
    return { stub, prepared, boundArgs };
  }

  it('a string workspaceRoot filters to that workspace', () => {
    const { stub, prepared, boundArgs } = makeSqlCapturingDb();
    makeStore(stub).stats('/ws/A');

    expect(prepared).toHaveLength(2);
    for (const sql of prepared) {
      expect(sql).toContain('WHERE workspace_root IS ?');
    }
    expect(boundArgs).toEqual([['/ws/A'], ['/ws/A']]);
  });

  it('null means global/unscoped memories — WHERE workspace_root IS NULL', () => {
    const { stub, prepared, boundArgs } = makeSqlCapturingDb();
    makeStore(stub).stats(null);

    for (const sql of prepared) {
      expect(sql).toContain('WHERE workspace_root IS ?');
    }
    // `IS ?` bound to null is `IS NULL` in SQLite — distinct from "no filter".
    expect(boundArgs).toEqual([[null], [null]]);
  });

  it('undefined drops the predicate entirely (whole-database sweep)', () => {
    const { stub, prepared, boundArgs } = makeSqlCapturingDb();
    makeStore(stub).stats();

    for (const sql of prepared) {
      expect(sql).not.toContain('WHERE');
    }
    expect(boundArgs).toEqual([[], []]);
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
// B1.5 regression — vec-offline graceful insert (TASK_2026_132)
// ---------------------------------------------------------------------------

describe('MemoryStore B1.5 — vec-offline graceful insert (TASK_2026_132)', () => {
  it('insertMemoryWithChunks succeeds with vec offline, prepares no vec INSERT, calls embedder zero times', async () => {
    const preparedSqls: string[] = [];
    const runMock = jest.fn(() => ({ changes: 1 }));
    const getMock = jest.fn(() => ({ workspace_root: '/ws/A', rowid: 7 }));
    const stub = {
      vecExtensionLoaded: false,
      db: {
        prepare: jest.fn((sql: string) => {
          preparedSqls.push(sql);
          return {
            run: runMock,
            get: getMock,
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
    const embedMock = jest.fn(async () => []);
    const embedder = {
      embed: embedMock,
      dim: 384,
    } as unknown as IEmbedder;
    const vecStatus = makeVecStatus(false);
    const store = new MemoryStore(makeLogger(), stub, embedder, vecStatus);

    const insert: MemoryInsert = {
      tier: 'core',
      kind: 'fact',
      content: 'vec-offline content',
      workspaceRoot: '/ws/A',
    };
    const id = await store.insertMemoryWithChunks(insert, [
      { ord: 0, text: 'chunk text', tokenCount: 2 },
    ]);

    expect(typeof id).toBe('string');
    expect(embedMock).not.toHaveBeenCalled();
    const vecInsertSql = preparedSqls.find((s) =>
      s.includes('memory_chunks_vec'),
    );
    expect(vecInsertSql).toBeUndefined();
    const baseMemoryInsert = preparedSqls.find((s) =>
      s.startsWith('INSERT INTO memories'),
    );
    expect(baseMemoryInsert).toBeDefined();
    const chunkInsert = preparedSqls.find((s) =>
      s.startsWith('INSERT INTO memory_chunks'),
    );
    expect(chunkInsert).toBeDefined();
    expect(store.getWriteCounter('/ws/A')).toBe(1);
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
    const vecStatus = new VecStatusService(logger, service);
    const store = new MemoryStore(logger, service, embedder, vecStatus);
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
    const vecStatus = new VecStatusService(logger, service);
    const store = new MemoryStore(logger, service, embedder, vecStatus);
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

// ---------------------------------------------------------------------------
// A1 gating — claude-mem 5-field summary + concepts FTS round-trip
// Critical Verification Point #1 (schema half).
// ---------------------------------------------------------------------------

describe('MemoryStore A1 — 5-field summary + concepts FTS round-trip (native-gated)', () => {
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
    const store = new MemoryStore(
      logger,
      service,
      embedder,
      new VecStatusService(logger, service),
    );
    return { service, store };
  }

  maybe(
    'persists request/investigated/learned/completed/nextSteps/type/concepts/files and round-trips through getById',
    async () => {
      const { service, store } = await bootstrap();
      try {
        const draftInsert = {
          tier: 'core' as const,
          kind: 'fact' as const,
          content: 'session learned how to wire OBSERVATION_QUEUE_STORE',
          workspaceRoot: '/ws/A',
          subject: 'memory:/ws/A#a1-fixture',
          request: 'Implement Batch A1 — schema foundations',
          investigated: 'inspected sql0016 + insertMemoryWithChunks',
          learned: 'concepts FTS uses delete-all shadow command, never rebuild',
          completed: 'migrations 15/16/17 + ObservationQueueStore + types',
          nextSteps: 'wire MemoryTriggerService against the queue in A2b',
          type: 'feature' as const,
          concepts: ['curator-worker', 'fts5-shadow', 'observation-queue'],
          files: [
            'libs/backend/persistence-sqlite/src/lib/migrations/0016_memory_schema_v2.ts',
            'libs/backend/memory-curator/src/lib/memory.store.ts',
          ],
        };
        const id = await store.insertMemoryWithChunks(draftInsert, [
          { ord: 0, text: 'fixture chunk one', tokenCount: 3 },
          { ord: 1, text: 'fixture chunk two', tokenCount: 3 },
        ]);

        const fetched = store.getById(id);
        expect(fetched).not.toBeNull();
        if (!fetched) throw new Error('fetched memory must be defined');

        expect(fetched.request).toBe(draftInsert.request);
        expect(fetched.investigated).toBe(draftInsert.investigated);
        expect(fetched.learned).toBe(draftInsert.learned);
        expect(fetched.completed).toBe(draftInsert.completed);
        expect(fetched.nextSteps).toBe(draftInsert.nextSteps);
        expect(fetched.type).toBe('feature');
        expect([...fetched.concepts].sort()).toEqual(
          [...draftInsert.concepts].sort(),
        );
        expect([...fetched.files].sort()).toEqual(
          [...draftInsert.files].sort(),
        );

        const ftsHits = service.db
          .prepare(
            `SELECT memory_id FROM memory_concepts_fts WHERE memory_concepts_fts MATCH '"observation-queue"'`,
          )
          .all() as Array<{ memory_id: string }>;
        expect(ftsHits.map((h) => h.memory_id)).toEqual([id]);

        const stemHits = service.db
          .prepare(
            `SELECT memory_id FROM memory_concepts_fts WHERE memory_concepts_fts MATCH '"curator-worker"'`,
          )
          .all() as Array<{ memory_id: string }>;
        expect(stemHits.map((h) => h.memory_id)).toEqual([id]);

        const typeRow = service.db
          .prepare('SELECT type FROM memories WHERE id = ?')
          .get(id) as { type: string } | undefined;
        expect(typeRow?.type).toBe('feature');
      } finally {
        service.close();
      }
    },
  );

  maybe(
    'defaults legacy-shape inserts to type=discovery + empty concepts/files',
    async () => {
      const { service, store } = await bootstrap();
      try {
        const id = await store.insertMemoryWithChunks(
          {
            tier: 'recall',
            kind: 'fact',
            content: 'legacy-shape insert without new fields',
            workspaceRoot: '/ws/A',
            subject: 'memory:/ws/A#legacy',
          },
          [{ ord: 0, text: 'legacy chunk', tokenCount: 2 }],
        );

        const fetched = store.getById(id);
        expect(fetched).not.toBeNull();
        if (!fetched) throw new Error('fetched memory must be defined');
        expect(fetched.type).toBe('discovery');
        expect(fetched.concepts).toEqual([]);
        expect(fetched.files).toEqual([]);
        expect(fetched.request).toBeNull();
        expect(fetched.investigated).toBeNull();
        expect(fetched.learned).toBeNull();
        expect(fetched.completed).toBeNull();
        expect(fetched.nextSteps).toBeNull();

        const count = service.db
          .prepare('SELECT COUNT(*) AS n FROM memory_concepts_fts')
          .get() as { n: number };
        expect(count.n).toBe(0);
      } finally {
        service.close();
      }
    },
  );

  maybe(
    'rebuildConceptsIndex uses delete-all + INSERT FROM SELECT and stays idempotent (no rebuild command)',
    async () => {
      const { service, store } = await bootstrap();
      try {
        await store.insertMemoryWithChunks(
          {
            tier: 'core',
            kind: 'fact',
            content: 'mem with concepts',
            workspaceRoot: '/ws/A',
            subject: 'memory:/ws/A#rb',
            type: 'decision',
            concepts: ['rebuild-tag-one', 'rebuild-tag-two'],
            files: [],
          },
          [{ ord: 0, text: 'rebuild chunk', tokenCount: 2 }],
        );

        const first = store.rebuildConceptsIndex();
        expect(first.rebuilt).toBe(true);

        const hits = service.db
          .prepare(
            `SELECT memory_id FROM memory_concepts_fts WHERE memory_concepts_fts MATCH '"rebuild-tag-one"'`,
          )
          .all() as Array<{ memory_id: string }>;
        expect(hits.length).toBe(1);

        const second = store.rebuildConceptsIndex();
        expect(second.rebuilt).toBe(true);
        const hitsAfter = service.db
          .prepare(
            `SELECT memory_id FROM memory_concepts_fts WHERE memory_concepts_fts MATCH '"rebuild-tag-two"'`,
          )
          .all() as Array<{ memory_id: string }>;
        expect(hitsAfter.length).toBe(1);
      } finally {
        service.close();
      }
    },
  );
});

/**
 * TASK_2026_295 — an empty session id is stored as NULL, never verbatim.
 *
 * `''` is not a scope. Written into `memories.session_id` it becomes a third
 * state — "the empty session" — which reads back as legitimately scoped and
 * which every row carrying the same upstream defect shares. NULL is the value
 * the column already has for "this memory has no session".
 *
 * Asserted on the bound statement parameters rather than through a round trip,
 * because what is under test is exactly what gets handed to SQLite.
 */
describe('MemoryStore — empty sessionId normalises to NULL (TASK_2026_295)', () => {
  const baseInsert: MemoryInsert = {
    tier: 'core',
    kind: 'fact',
    content: 'curated without a usable session id',
    workspaceRoot: '/ws/A',
  };

  async function insertAndReadParams(
    sessionId: string | null | undefined,
  ): Promise<Record<string, unknown>> {
    const { stub, runMock } = makeDb();
    const store = makeStore(stub);
    await store.insertMemoryWithChunks({ ...baseInsert, sessionId }, []);
    return runMock.mock.calls[0][0] as Record<string, unknown>;
  }

  it('stores NULL for an empty sessionId', async () => {
    expect((await insertAndReadParams('')).session_id).toBeNull();
  });

  it('stores NULL for a whitespace-only sessionId', async () => {
    expect((await insertAndReadParams('   ')).session_id).toBeNull();
  });

  it('stores NULL when no sessionId is supplied at all', async () => {
    expect((await insertAndReadParams(undefined)).session_id).toBeNull();
  });

  it('stores a real sessionId unchanged', async () => {
    // The control: normalisation must not touch a usable id.
    const id = '8f1c7d2e-2a5b-4b6e-9d3f-0c1a2b3c4d5e';
    expect((await insertAndReadParams(id)).session_id).toBe(id);
  });
});

describe('MemoryStore ranking and explicit use on real SQLite', () => {
  const opener = requireSqliteOpener();
  let raw: RawDb;
  let connection: SqliteConnectionService;
  let log: Logger;
  let store: MemoryStore;

  beforeEach(() => {
    raw = opener.open(':memory:');
    raw.exec(`CREATE TABLE memories (
      id TEXT PRIMARY KEY, session_id TEXT, workspace_root TEXT,
      tier TEXT NOT NULL, kind TEXT NOT NULL, subject TEXT, content TEXT NOT NULL,
      source_message_ids TEXT, salience REAL NOT NULL, decay_rate REAL NOT NULL,
      hits INTEGER NOT NULL, pinned INTEGER NOT NULL, created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL, archived_at INTEGER,
      expires_at INTEGER, request TEXT, investigated TEXT, learned TEXT,
      completed TEXT, next_steps TEXT, type TEXT NOT NULL,
      concepts_json TEXT NOT NULL, files_json TEXT NOT NULL
    );
    CREATE TABLE memory_chunks (
      id TEXT PRIMARY KEY, memory_id TEXT NOT NULL, ord INTEGER NOT NULL,
      text TEXT NOT NULL, token_count INTEGER NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE corpus_memories (corpus_id TEXT NOT NULL, memory_id TEXT NOT NULL);
    CREATE INDEX idx_memories_tier_last_used ON memories(tier, last_used_at);
    CREATE VIRTUAL TABLE memory_concepts_fts USING fts5(memory_id UNINDEXED, concept);`);
    const db = adaptSqliteDatabase(raw);
    connection = {
      db,
      handleFatalWriteError: jest.fn(),
    } as unknown as SqliteConnectionService;
    log = makeLogger();
    store = new MemoryStore(
      log,
      connection,
      makeEmbedder(),
      makeVecStatus(false),
    );
  });

  afterEach(() => raw.close());

  function seed(
    id: string,
    tier: 'core' | 'recall' | 'archival',
    workspaceRoot: string | null,
    options: { salience?: number; lastUsedAt?: number; pinned?: number } = {},
  ): void {
    raw
      .prepare(
        `INSERT INTO memories (
        id, session_id, workspace_root, tier, kind, subject, content,
        source_message_ids, salience, decay_rate, hits, pinned, created_at,
        updated_at, last_used_at, archived_at, expires_at, request, investigated,
        learned, completed, next_steps, type, concepts_json, files_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        null,
        workspaceRoot,
        tier,
        'fact',
        id,
        id,
        '[]',
        options.salience ?? 0.5,
        0.01,
        0,
        options.pinned ?? 0,
        1,
        1,
        options.lastUsedAt ?? 1,
        tier === 'archival' ? 1 : null,
        null,
        null,
        null,
        null,
        null,
        null,
        'discovery',
        '[]',
        '[]',
      );
  }

  it('deduplicates uses, restores archival rows, and invalidates only restored roots', () => {
    seed('archived', 'archival', '/restored');
    seed('recall', 'recall', '/plain');

    store.recordUse(['archived', 'archived', 'recall', 'unknown']);

    const rows = raw
      .prepare(
        'SELECT id, tier, hits, archived_at, last_used_at FROM memories ORDER BY id',
      )
      .all() as Array<{
      id: string;
      tier: string;
      hits: number;
      archived_at: number | null;
      last_used_at: number;
    }>;
    expect(rows).toEqual([
      expect.objectContaining({
        id: 'archived',
        tier: 'recall',
        hits: 1,
        archived_at: null,
      }),
      expect.objectContaining({ id: 'recall', tier: 'recall', hits: 1 }),
    ]);
    expect(rows.every((row) => row.last_used_at > 1)).toBe(true);
    expect(store.getWriteCounter('/restored')).toBe(1);
    expect(store.getWriteCounter('/plain')).toBe(0);
  });

  it('records core and pinned recall use without changing tier or write counters', () => {
    seed('core', 'core', '/core');
    seed('pinned-recall', 'recall', '/pinned', { pinned: 1 });
    const before = Date.now();

    store.recordUse(['core', 'pinned-recall']);
    const after = Date.now();

    const rows = raw
      .prepare(
        `SELECT id, tier, hits, pinned, last_used_at
           FROM memories
          WHERE id IN (?, ?)
          ORDER BY id`,
      )
      .all('core', 'pinned-recall') as Array<{
      id: string;
      tier: string;
      hits: number;
      pinned: number;
      last_used_at: number;
    }>;
    expect(rows).toEqual([
      expect.objectContaining({
        id: 'core',
        tier: 'core',
        hits: 1,
        pinned: 0,
      }),
      expect.objectContaining({
        id: 'pinned-recall',
        tier: 'recall',
        hits: 1,
        pinned: 1,
      }),
    ]);
    expect(
      rows.every(
        (row) => row.last_used_at >= before && row.last_used_at <= after,
      ),
    ).toBe(true);
    expect(store.getWriteCounter('/core')).toBe(0);
    expect(store.getWriteCounter('/pinned')).toBe(0);
  });

  it('restores a pinned archival row and keeps it exempt from later archival', () => {
    seed('pinned-archival', 'archival', '/pinned', { pinned: 1 });

    store.recordUse(['pinned-archival']);

    const restored = raw
      .prepare('SELECT tier, archived_at, pinned FROM memories WHERE id = ?')
      .get('pinned-archival') as {
      tier: string;
      archived_at: number | null;
      pinned: number;
    };
    expect(restored).toEqual({
      tier: 'recall',
      archived_at: null,
      pinned: 1,
    });

    const lifecycle = new MemoryLifecycleStore(
      log,
      connection,
      makeVecStatus(false),
    );
    const afterUse = Date.now() + DAY_MS;
    expect(
      lifecycle.archiveBatch(
        afterUse,
        afterUse,
        MEMORY_RETENTION_DEFAULTS.batchSize,
      ).archived,
    ).toBe(0);
    expect(store.getById(memoryId('pinned-archival'))?.tier).toBe('recall');
  });

  it('caps a call at 200 ids and logs once only when distinct ids are truncated', () => {
    for (let i = 0; i < 201; i++) seed(`id-${i}`, 'recall', '/ws');
    store.recordUse([]);
    store.recordUse(['unknown']);
    store.recordUse(Array.from({ length: 200 }, (_, i) => `short-${i}`));
    expect(log.debug).not.toHaveBeenCalled();

    store.recordUse(Array.from({ length: 201 }, (_, i) => `id-${i}`));
    const used = raw
      .prepare('SELECT COUNT(*) AS n FROM memories WHERE hits = ?')
      .get(1) as {
      n: number;
    };
    expect(used.n).toBe(200);
    expect(log.debug).toHaveBeenCalledTimes(1);
    expect(log.debug).toHaveBeenCalledWith(
      '[memory-curator] recordUse truncated memory ids',
      { received: 201, recorded: 200 },
    );
  });

  it('never throws after the connection closes and warns once', () => {
    raw.close();
    expect(() => store.recordUse(['id'])).not.toThrow();
    expect(log.warn).toHaveBeenCalledTimes(1);
    raw = opener.open(':memory:');
  });

  it('stamps archival inserts and restores archival append targets', async () => {
    const inserted = await store.insertMemoryWithChunks(
      {
        tier: 'archival',
        kind: 'fact',
        content: 'archived',
        workspaceRoot: '/ws',
      },
      [],
    );
    const archived = raw
      .prepare('SELECT archived_at FROM memories WHERE id = ?')
      .get(inserted) as { archived_at: number | null };
    expect(archived.archived_at).not.toBeNull();

    await store.appendChunks(inserted, [
      { ord: 0, text: 'restored content', tokenCount: 2 },
    ]);
    const restored = raw
      .prepare('SELECT tier, archived_at FROM memories WHERE id = ?')
      .get(inserted) as { tier: string; archived_at: number | null };
    expect(restored).toEqual({ tier: 'recall', archived_at: null });
  });

  it('orders list and listAll by ranking salience', () => {
    const now = Date.now();
    seed('old-high', 'recall', '/ws', {
      salience: 1,
      lastUsedAt: now - 90 * 86_400_000,
    });
    seed('recent-low', 'recall', '/ws', {
      salience: 0.25,
      lastUsedAt: now,
    });
    expect(
      store.list({ workspaceRoot: '/ws' }).memories.map((m) => m.id),
    ).toEqual(['recent-low', 'old-high']);
    expect(store.listAll('/ws').memories.map((m) => m.id)).toEqual([
      'recent-low',
      'old-high',
    ]);
  });
});

// ---------------------------------------------------------------------------
// TASK_2026_473 Track A — findMergeCandidates: merge candidate discovery
//
// The curator used to build its candidate list from the 200 highest-ranked
// rows and then filter them by exact, case-sensitive subject equality
// (TASK_2026_471 forensics: "The merge that never fires" — 98.29 percent of
// 36,252 rows were singletons). findMergeCandidates queries the whole
// workspace on LOWER(subject) instead. Every spec below re-runs the OLD
// predicate (`list({ limit: 200 })` + `subjects.has(m.subject)`) where it is
// meaningful, so each one also proves the old path would have missed the row.
// ---------------------------------------------------------------------------

describe('MemoryStore.findMergeCandidates — TASK_2026_473 Track A', () => {
  const opener = requireSqliteOpener();
  let raw: RawDb;
  let store: MemoryStore;

  beforeEach(() => {
    raw = opener.open(':memory:');
    raw.exec(`CREATE TABLE memories (
      id TEXT PRIMARY KEY, session_id TEXT, workspace_root TEXT,
      tier TEXT NOT NULL, kind TEXT NOT NULL, subject TEXT, content TEXT NOT NULL,
      source_message_ids TEXT, salience REAL NOT NULL, decay_rate REAL NOT NULL,
      hits INTEGER NOT NULL, pinned INTEGER NOT NULL, created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL, archived_at INTEGER,
      expires_at INTEGER, request TEXT, investigated TEXT, learned TEXT,
      completed TEXT, next_steps TEXT, type TEXT NOT NULL,
      concepts_json TEXT NOT NULL, files_json TEXT NOT NULL
    )`);
    const db = adaptSqliteDatabase(raw);
    const connection = {
      db,
      handleFatalWriteError: jest.fn(),
    } as unknown as SqliteConnectionService;
    store = new MemoryStore(
      makeLogger(),
      connection,
      makeEmbedder(),
      makeVecStatus(false),
    );
  });

  afterEach(() => raw.close());

  function seed(
    id: string,
    subject: string | null,
    workspaceRoot: string | null,
    options: {
      salience?: number;
      lastUsedAt?: number;
      hits?: number;
      pinned?: number;
    } = {},
  ): void {
    raw
      .prepare(
        `INSERT INTO memories (
        id, session_id, workspace_root, tier, kind, subject, content,
        source_message_ids, salience, decay_rate, hits, pinned, created_at,
        updated_at, last_used_at, archived_at, expires_at, request, investigated,
        learned, completed, next_steps, type, concepts_json, files_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        null,
        workspaceRoot,
        'recall',
        'fact',
        subject,
        id,
        '[]',
        options.salience ?? 0.5,
        0.01,
        options.hits ?? 0,
        options.pinned ?? 0,
        1,
        1,
        options.lastUsedAt ?? 1,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        'discovery',
        '[]',
        '[]',
      );
  }

  /** The OLD curator predicate, verbatim: top-200 window + case-sensitive Set. */
  function oldPathSubjects(
    draftSubjects: readonly string[],
    workspaceRoot: string | null,
  ): readonly string[] {
    const subjects = new Set(draftSubjects);
    return store
      .list({ workspaceRoot, limit: 200 })
      .memories.filter((m) => m.subject && subjects.has(m.subject))
      .map((m) => m.subject as string);
  }

  it('matches a stored subject that differs from the draft only by case', () => {
    // The case-sensitivity defect: the draft arrives as lowercase, the stored
    // row was extracted with different casing. The old Set filter missed it.
    seed('legacy-row', 'Memory-Store-Legacy', '/ws');

    expect(oldPathSubjects(['memory-store-legacy'], '/ws')).toEqual([]);
    expect(
      store
        .findMergeCandidates(['memory-store-legacy'], '/ws')
        .map((r) => r.id),
    ).toEqual(['legacy-row']);
  });

  it('finds a memory ranked far outside the 200-row recency window', () => {
    // Construction: 250 filler rows used "now" at salience 0.5 rank above the
    // target (salience 0.1, last used 90 days ago — its decayed rank is
    // ~0.007), so the target sits at rank 251 of 251 and the old top-200
    // window never contained it. This is the 36k-row live-database shape.
    const now = Date.now();
    for (let i = 0; i < 250; i++) {
      seed(`filler-${i}`, `filler-subject-${i}`, '/ws', {
        lastUsedAt: now,
        salience: 0.5,
      });
    }
    seed('buried-row', 'buried-subject', '/ws', {
      lastUsedAt: now - 90 * 86_400_000,
      salience: 0.1,
    });

    expect(oldPathSubjects(['buried-subject'], '/ws')).toEqual([]);
    expect(
      store.findMergeCandidates(['buried-subject'], '/ws').map((r) => r.id),
    ).toEqual(['buried-row']);
  });

  it('returns nothing for an empty subject list and nothing for a subject with no rows', () => {
    seed('present-row', 'present-subject', '/ws');

    expect(store.findMergeCandidates([], '/ws')).toEqual([]);
    expect(store.findMergeCandidates(['absent-subject'], '/ws')).toEqual([]);
  });

  it('does not return a matching subject stored under a different workspace root', () => {
    seed('row-a', 'shared-subject', '/ws/A');
    seed('row-b', 'shared-subject', '/ws/B');
    seed('row-null', 'shared-subject', null);

    expect(
      store.findMergeCandidates(['shared-subject'], '/ws/A').map((r) => r.id),
    ).toEqual(['row-a']);
    expect(
      store.findMergeCandidates(['shared-subject'], '/ws/B').map((r) => r.id),
    ).toEqual(['row-b']);
    // `null` workspaceRoot means the global/unscoped rows, as elsewhere.
    expect(
      store.findMergeCandidates(['shared-subject'], null).map((r) => r.id),
    ).toEqual(['row-null']);
  });

  it('caps each subject at 5 candidates and dedupes case-variant draft subjects', () => {
    for (let i = 0; i < 7; i++) {
      seed(`busy-${i}`, 'busy-subject', '/ws', { lastUsedAt: Date.now() - i });
    }

    // Two case variants of one draft subject must count as ONE key, or the
    // per-subject cap would double to 10.
    const got = store.findMergeCandidates(
      ['busy-subject', 'Busy-Subject'],
      '/ws',
    );
    expect(got).toHaveLength(5);
    expect(got.every((r) => r.subject === 'busy-subject')).toBe(true);
  });

  it('caps the combined result at 50 rows across subjects', () => {
    // 12 subjects x 5 rows = 60 matching rows, so only the caps decide.
    for (let s = 0; s < 12; s++) {
      for (let i = 0; i < 5; i++) {
        seed(`s${s}-${i}`, `subject-${s}`, '/ws', {
          lastUsedAt: Date.now() - s * 1000 - i,
        });
      }
    }
    const subjects = Array.from({ length: 12 }, (_, s) => `subject-${s}`);

    const got = store.findMergeCandidates(subjects, '/ws');
    expect(got).toHaveLength(50);
    const perSubject = new Map<string, number>();
    for (const r of got) {
      const key = (r.subject ?? '').toLowerCase();
      perSubject.set(key, (perSubject.get(key) ?? 0) + 1);
    }
    expect([...perSubject.values()].every((n) => n <= 5)).toBe(true);
  });

  it('applies custom per-subject and total limits at the same time', () => {
    const now = Date.now();
    // Subject A owns the three highest raw scores. Its custom cap removes a-3,
    // then the custom total cap removes b-2 from the four eligible rows.
    seed('a-1', 'subject-a', '/ws', { salience: 1, lastUsedAt: now });
    seed('a-2', 'subject-a', '/ws', { salience: 0.9, lastUsedAt: now });
    seed('a-3', 'subject-a', '/ws', { salience: 0.8, lastUsedAt: now });
    seed('b-1', 'subject-b', '/ws', { salience: 0.7, lastUsedAt: now });
    seed('b-2', 'subject-b', '/ws', { salience: 0.6, lastUsedAt: now });

    const got = store.findMergeCandidates(
      ['subject-a', 'subject-b'],
      '/ws',
      2,
      3,
    );

    expect(got.map((r) => r.id)).toEqual(['a-1', 'a-2', 'b-1']);
    expect(got.filter((r) => r.subject === 'subject-a')).toHaveLength(2);
    expect(got).toHaveLength(3);
  });

  it('returns exactly the five highest-ranked rows for one subject in rank order', () => {
    const now = Date.now();
    const halfLife = 604_800_000;
    // With zero hits and no pin bonus, score = salience * H / (H + age).
    seed('rank-1', 'ranked-subject', '/ws', {
      salience: 1,
      lastUsedAt: now,
    });
    seed('rank-2', 'ranked-subject', '/ws', {
      salience: 0.9,
      lastUsedAt: now,
    });
    seed('rank-3', 'ranked-subject', '/ws', {
      salience: 1,
      lastUsedAt: now - halfLife,
    });
    seed('rank-4', 'ranked-subject', '/ws', {
      salience: 0.8,
      lastUsedAt: now - halfLife,
    });
    seed('rank-5', 'ranked-subject', '/ws', {
      salience: 0.9,
      lastUsedAt: now - 2 * halfLife,
    });
    seed('rank-6', 'ranked-subject', '/ws', {
      salience: 0.5,
      lastUsedAt: now - halfLife,
    });
    seed('rank-7', 'ranked-subject', '/ws', {
      salience: 0.6,
      lastUsedAt: now - 2 * halfLife,
    });

    expect(
      store.findMergeCandidates(['ranked-subject'], '/ws').map((r) => r.id),
    ).toEqual(['rank-1', 'rank-2', 'rank-3', 'rank-4', 'rank-5']);
  });

  it('breaks identical rank-score ties by id descending', () => {
    const lastUsedAt = Date.now() - 1000;
    seed('aaa', 'tied-subject', '/ws', {
      salience: 0.5,
      hits: 2,
      pinned: 0,
      lastUsedAt,
    });
    seed('zzz', 'tied-subject', '/ws', {
      salience: 0.5,
      hits: 2,
      pinned: 0,
      lastUsedAt,
    });

    expect(
      store.findMergeCandidates(['tied-subject'], '/ws').map((r) => r.id),
    ).toEqual(['zzz', 'aaa']);
  });

  it('gives a quiet subject its full quota when busy subjects fill the shared scan horizon', () => {
    // The live ptah-tui case had 46 matches but received only 2 because nine
    // busier subjects occupied 198 of the shared 200 ranked scan positions.
    const now = Date.now();
    const subjects: string[] = [];
    for (let s = 0; s < 9; s++) {
      const subject = `busy-subject-${s}`;
      subjects.push(subject);
      for (let i = 0; i < 25; i++) {
        seed(`${subject}-${i}`, subject, '/ws', {
          salience: 1,
          lastUsedAt: now - i,
        });
      }
    }
    subjects.push('quiet-subject');
    for (let i = 0; i < 6; i++) {
      seed(`quiet-${i}`, 'quiet-subject', '/ws', {
        salience: 0.1,
        lastUsedAt: now - i,
      });
    }

    const quiet = store
      .findMergeCandidates(subjects, '/ws')
      .filter((row) => row.subject === 'quiet-subject');

    expect(quiet).toHaveLength(5);
  });

  it('ignores blank and whitespace-only subjects', () => {
    seed('real-row', 'real-subject', '/ws');

    expect(store.findMergeCandidates(['', '   ', '\t'], '/ws')).toEqual([]);
    const got = store.findMergeCandidates(['real-subject', '   ', ''], '/ws');
    expect(got.map((r) => r.id)).toEqual(['real-row']);
  });

  it('trims surrounding whitespace from an input subject before matching', () => {
    seed('padded-row', 'padded-subject', '/ws');

    expect(
      store
        .findMergeCandidates(['  padded-subject  '], '/ws')
        .map((r) => r.id),
    ).toEqual(['padded-row']);
  });
});
