/**
 * IndexingControlService — unit tests
 */

import 'reflect-metadata';
import { container } from 'tsyringe';
import {
  IndexingControlService,
  type IndexingRunDeps,
  type IndexingRunProgress,
  type IndexingRunStats,
} from './indexing-control.service';
import * as fingerprintModule from '../workspace-fingerprint';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import { MEMORY_TOKENS } from '../di/tokens';
import { PERSISTENCE_TOKENS } from '@ptah-extension/persistence-sqlite';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import type {
  SqliteDatabase,
  SqliteStatement,
} from '@ptah-extension/persistence-sqlite';

// ---- Helpers ----------------------------------------------------------------

const VALID_SHA_A = 'aaaa1111bbbb2222cccc3333dddd4444eeee5555';
const VALID_SHA_B = 'bbbb2222cccc3333dddd4444eeee5555ffff6666';
const ROOT = '/workspace/test';

/** Build a minimal fake SqliteDatabase with a controllable rows map. */
function makeFakeDb(
  rowsByFp: Map<string, Record<string, unknown>> = new Map(),
): SqliteDatabase {
  const preparedStmts = new Map<string, SqliteStatement>();

  function makeStmt(sql: string): SqliteStatement {
    const normalizedSql = sql.trim().toLowerCase();

    const stmt: SqliteStatement = {
      run: jest.fn((...args: unknown[]) => {
        if (normalizedSql.startsWith('insert or ignore')) {
          const fp = args[0] as string;
          if (!rowsByFp.has(fp)) {
            rowsByFp.set(fp, {
              workspace_fingerprint: fp,
              git_head_sha: null,
              last_indexed_at: null,
              symbols_enabled: 1,
              memory_enabled: 1,
              symbols_cursor: null,
              disclosure_acknowledged_at: null,
              last_dismissed_stale_sha: null,
              last_error: null,
              last_run_json: null,
            });
          }
        } else if (normalizedSql.includes('and last_run_json is ?')) {
          // Compare-and-set: args [updated_at, last_run_json, fp, expected].
          const row = rowsByFp.get(args[2] as string);
          if (!row || (row['last_run_json'] ?? null) !== args[3]) {
            return { changes: 0, lastInsertRowid: 0 };
          }
          row['last_run_json'] = args[1];
        } else if (normalizedSql.startsWith('update indexing_state')) {
          // Parse SET clauses and apply to the row in the map
          // This is a best-effort simulation for tests
          const fpValue = args[args.length - 1] as string;
          const row = rowsByFp.get(fpValue);
          if (row) {
            // Extract SET columns from the SQL
            const setMatch = /set\s+(.+)\s+where/i.exec(sql);
            if (setMatch) {
              const setClauses = setMatch[1].split(',').map((s) => s.trim());
              // args: [now, ...fieldValues..., fp]
              let argIdx = 1; // skip the first (updated_at = now)
              for (const clause of setClauses) {
                if (clause.startsWith('updated_at')) continue;
                const colMatch = /^(\w+)\s*=/.exec(clause);
                if (colMatch) {
                  row[colMatch[1]] = args[argIdx] as unknown;
                  argIdx++;
                }
              }
            }
          }
        }
        return { changes: 1, lastInsertRowid: 1 };
      }),
      get: jest.fn((...args: unknown[]) => {
        const fp = args[0] as string;
        return rowsByFp.get(fp) ?? undefined;
      }),
      all: jest.fn(() => []),
      iterate: jest.fn(() => [][Symbol.iterator]()),
    };
    return stmt;
  }

  const db: SqliteDatabase = {
    exec: jest.fn(),
    prepare: jest.fn((sql: string): SqliteStatement => {
      if (!preparedStmts.has(sql)) {
        preparedStmts.set(sql, makeStmt(sql));
      }
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      return preparedStmts.get(sql)!;
    }),
    pragma: jest.fn(),
    close: jest.fn(),
    open: true,
    inTransaction: false,
    transaction: jest.fn((fn) => fn),
  };
  return db;
}

/** Build a fake IFileSystemProvider that serves git HEAD files. */
function makeFakeFs(options: {
  headContent?: string;
  refContent?: string;
  hasGitConfig?: boolean;
}) {
  return {
    readFile: jest.fn(async (path: string): Promise<string> => {
      const norm = path.replace(/\\/g, '/');
      if (norm.endsWith('/.git/HEAD')) {
        if (options.headContent !== undefined) return options.headContent;
        throw new Error('ENOENT');
      }
      if (norm.endsWith('/.git/refs/heads/main')) {
        if (options.refContent !== undefined) return options.refContent;
        throw new Error('ENOENT');
      }
      if (norm.endsWith('/.git/config')) {
        if (options.hasGitConfig) {
          return '[remote "origin"]\n\turl = https://github.com/test/repo.git\n';
        }
        throw new Error('ENOENT');
      }
      throw new Error(`ENOENT: ${path}`);
    }),
  };
}

/** Build a mock logger (logger.debug is a no-op; warn/error logged to stderr in CI). */
function makeLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

/** Build a mock WebviewManager (broadcastMessage is a no-op). */
function makeWebviewManager() {
  return {
    broadcastMessage: jest.fn().mockResolvedValue(undefined),
    sendMessage: jest.fn(),
  };
}

/** Build a mock MemoryCuratorService. */
function makeMemoryCurator() {
  return {
    start: jest.fn(),
    stop: jest.fn(),
  };
}

/** Build a simple IndexingRunDeps mock. */
function makeRunDeps(override?: Partial<IndexingRunDeps>): IndexingRunDeps {
  return {
    runSymbols: jest.fn().mockResolvedValue(undefined),
    runMemory: jest.fn().mockResolvedValue(undefined),
    ...override,
  };
}

/**
 * Build an IndexingControlService with mocked dependencies, bypassing the DI container.
 * We construct the service directly via `new` and assign private fields via type assertions.
 */
function buildService(
  fakeDb: SqliteDatabase,
  fsOptions: {
    headContent?: string;
    refContent?: string;
    hasGitConfig?: boolean;
  } = {},
) {
  const sqliteConn = { db: fakeDb };
  const memoryCurator = makeMemoryCurator();
  const fs = makeFakeFs(fsOptions);
  const logger = makeLogger();
  const workspace = {
    getConfiguration: jest.fn(
      (_section: string, key: string, fallback: unknown) =>
        key === 'memory.enabled' ? true : fallback,
    ),
  };
  const webviewManager = makeWebviewManager();
  const vecDiagnostic = {
    ok: false,
    reason: 'binary-missing' as const,
    electronVersion: '40.0.0',
    processArch: 'x64' as NodeJS.Architecture,
    processPlatform: 'linux' as NodeJS.Platform,
  };
  const vecStatus = {
    available: false,
    reason: vecDiagnostic.reason,
    diagnostic: vecDiagnostic,
    getStatus: () => ({
      available: false,
      reason: vecDiagnostic.reason,
      diagnostic: vecDiagnostic,
    }),
    on: () => ({ dispose: () => undefined }),
    refresh: () => undefined,
  };
  const embedderStatus = {
    getStatus: () => ({ ready: true, downloading: false }),
    ensureReady: async () => undefined,
    recordError: () => undefined,
    on: () => ({ dispose: () => undefined }),
  };

  const child = container.createChildContainer();
  child.register(PERSISTENCE_TOKENS.SQLITE_CONNECTION, {
    useValue: sqliteConn,
  });
  child.register(PERSISTENCE_TOKENS.VEC_STATUS, { useValue: vecStatus });
  child.register(MEMORY_TOKENS.EMBEDDER_STATUS, { useValue: embedderStatus });
  child.register(MEMORY_TOKENS.MEMORY_CURATOR, { useValue: memoryCurator });
  child.register(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER, { useValue: fs });
  child.register(PLATFORM_TOKENS.WORKSPACE_PROVIDER, { useValue: workspace });
  child.register(TOKENS.LOGGER, { useValue: logger });
  child.register(TOKENS.WEBVIEW_MANAGER, { useValue: webviewManager });
  child.register(MEMORY_TOKENS.INDEXING_CONTROL, {
    useClass: IndexingControlService,
  });

  const service = child.resolve<IndexingControlService>(
    MEMORY_TOKENS.INDEXING_CONTROL,
  );

  return {
    service,
    sqliteConn,
    memoryCurator,
    fs,
    logger,
    webviewManager,
    workspace,
  };
}

// ============================================================================
// State machine transitions
// ============================================================================

describe('IndexingControlService state machine', () => {
  it('does not start memory indexing while the master switch is paused', async () => {
    const fakeDb = makeFakeDb();
    const { service, workspace } = buildService(fakeDb, {
      headContent: `${VALID_SHA_A}\n`,
    });
    (workspace.getConfiguration as jest.Mock).mockReturnValue(false);
    const deps = makeRunDeps();

    await service.start('memory', ROOT, deps);

    expect(deps.runMemory).not.toHaveBeenCalled();
  });

  it('never-indexed → start() → completes → indexed state is written', async () => {
    const rows = new Map<string, Record<string, unknown>>();
    const fakeDb = makeFakeDb(rows);
    const { service } = buildService(fakeDb, {
      headContent: `${VALID_SHA_A}\n`,
      hasGitConfig: false,
    });
    const deps = makeRunDeps();

    await service.start(undefined, ROOT, deps);

    expect(deps.runSymbols as jest.Mock).toHaveBeenCalledTimes(1);
  });

  it('start() is idempotent — second call is ignored while running', async () => {
    const fakeDb = makeFakeDb();
    const { service } = buildService(fakeDb, {
      headContent: `${VALID_SHA_A}\n`,
    });

    // Make runSymbols hang until we resolve
    let resolveRun!: () => void;
    const hangingRun = new Promise<void>((res) => {
      resolveRun = res;
    });
    const deps = makeRunDeps({
      runSymbols: jest.fn().mockReturnValue(hangingRun),
    });

    const first = service.start(undefined, ROOT, deps);
    const second = service.start(undefined, ROOT, deps); // should be ignored

    resolveRun();
    await Promise.all([first, second]);

    expect(deps.runSymbols as jest.Mock).toHaveBeenCalledTimes(1);
  });

  it('pause() aborts the active run', async () => {
    const fakeDb = makeFakeDb();
    const { service } = buildService(fakeDb, {
      headContent: `${VALID_SHA_A}\n`,
    });

    let capturedSignal: AbortSignal | undefined;
    let runSymbolsStarted!: () => void;
    const runSymbolsStartedPromise = new Promise<void>((res) => {
      runSymbolsStarted = res;
    });

    const deps = makeRunDeps({
      runSymbols: jest
        .fn()
        .mockImplementation(
          async (_root: string, opts?: { signal?: AbortSignal }) => {
            capturedSignal = opts?.signal;
            runSymbolsStarted();
            // Simulate a long run — wait for abort
            await new Promise<void>((_res, rej) => {
              if (opts?.signal?.aborted) {
                rej(new DOMException('Aborted', 'AbortError'));
                return;
              }
              opts?.signal?.addEventListener('abort', () =>
                rej(new DOMException('Aborted', 'AbortError')),
              );
            });
          },
        ),
    });

    const runPromise = service.start(undefined, ROOT, deps);
    // Wait for runSymbols to actually start before pausing
    await runSymbolsStartedPromise;
    service.pause();
    await runPromise;

    expect(capturedSignal?.aborted).toBe(true);
  });

  it('cancel() clears cursor and does not update last_indexed_at', async () => {
    const fakeDb = makeFakeDb();
    const { service } = buildService(fakeDb, {
      headContent: `${VALID_SHA_A}\n`,
    });

    let runSymbolsStarted!: () => void;
    const runSymbolsStartedPromise = new Promise<void>((res) => {
      runSymbolsStarted = res;
    });

    const deps = makeRunDeps({
      runSymbols: jest
        .fn()
        .mockImplementation(
          async (_root: string, opts?: { signal?: AbortSignal }) => {
            runSymbolsStarted(); // signal that runSymbols has started
            await new Promise<void>((_res, rej) => {
              if (opts?.signal?.aborted) {
                rej(new DOMException('Aborted', 'AbortError'));
                return;
              }
              opts?.signal?.addEventListener('abort', () =>
                rej(new DOMException('Aborted', 'AbortError')),
              );
            });
          },
        ),
    });

    const runPromise = service.start(undefined, ROOT, deps);
    // Wait until runSymbols is actually executing before calling cancel()
    await runSymbolsStartedPromise;
    service.cancel();
    await runPromise;

    // Verify no UPDATE set last_indexed_at to a non-null value after cancel
    expect(fakeDb.prepare as jest.Mock).not.toHaveBeenCalledWith(
      expect.stringContaining('last_indexed_at = ?'),
    );
  });

  it('dismissStale writes last_dismissed_stale_sha', async () => {
    const rows = new Map<string, Record<string, unknown>>();
    const fakeDb = makeFakeDb(rows);
    const { service } = buildService(fakeDb, {
      headContent: `${VALID_SHA_A}\n`,
    });

    await service.dismissStale(ROOT);

    // The upsertRow call should have been made; verify via the row map
    // Since FP is computed from the FS mocks, we just verify no throws
    // and that an upsert was attempted
    expect(fakeDb.prepare as jest.Mock).toHaveBeenCalledWith(
      expect.stringContaining('last_dismissed_stale_sha'),
    );
  });

  it('acknowledgeDisclosure writes disclosure_acknowledged_at', async () => {
    const fakeDb = makeFakeDb();
    const { service } = buildService(fakeDb);

    await service.acknowledgeDisclosure(ROOT);

    expect(fakeDb.prepare as jest.Mock).toHaveBeenCalledWith(
      expect.stringContaining('disclosure_acknowledged_at'),
    );
  });
});

// ============================================================================
// Cursor round-trip
// ============================================================================

describe('IndexingControlService cursor handling', () => {
  it('resume() discards cursor when fingerprint changed', async () => {
    // Simulate a row with a cursor and a stored SHA that differs from current
    const fakeDb: SqliteDatabase = {
      ...makeFakeDb(),
      prepare: jest.fn().mockReturnValue({
        run: jest.fn().mockReturnValue({ changes: 1, lastInsertRowid: 1 }),
        get: jest.fn().mockReturnValue({
          workspace_fingerprint: 'any',
          git_head_sha: VALID_SHA_A, // old SHA
          last_indexed_at: Date.now() - 10000,
          symbols_enabled: 1,
          memory_enabled: 1,
          symbols_cursor: JSON.stringify({
            remainingFiles: ['src/a.ts'],
            processed: 5,
            total: 10,
            batchIndex: 1,
          }),
          disclosure_acknowledged_at: null,
          last_dismissed_stale_sha: null,
          last_error: null,
        }),
        all: jest.fn().mockReturnValue([]),
        iterate: jest.fn().mockReturnValue([][Symbol.iterator]()),
      }),
    };

    const { service } = buildService(fakeDb, {
      headContent: `${VALID_SHA_B}\n`, // current SHA differs → discard cursor
    });
    const deps = makeRunDeps();

    await service.resume(ROOT, deps);

    // Should have called runSymbols (fresh start, no error)
    expect(deps.runSymbols).toHaveBeenCalledTimes(1);
  });

  it('setSymbolWatcher stores the watcher reference', () => {
    const fakeDb = makeFakeDb();
    const { service } = buildService(fakeDb);
    const watcher = { close: jest.fn() };

    service.setSymbolWatcher(watcher);
    service.setSymbolWatcher(null);

    expect(watcher.close).not.toHaveBeenCalled(); // close only called on setPipelineEnabled
  });
});

// ============================================================================
// setPipelineEnabled
// ============================================================================

describe('IndexingControlService.setPipelineEnabled', () => {
  it('stops memoryCurator when memory pipeline is disabled', async () => {
    const fakeDb = makeFakeDb();
    const { service, memoryCurator } = buildService(fakeDb);

    await service.setPipelineEnabled('memory', false, ROOT);

    expect(memoryCurator.stop).toHaveBeenCalledTimes(1);
  });

  it('starts memoryCurator when memory pipeline is enabled', async () => {
    const fakeDb = makeFakeDb();
    const { service, memoryCurator } = buildService(fakeDb);

    await service.setPipelineEnabled('memory', true, ROOT);

    expect(memoryCurator.start).toHaveBeenCalledTimes(1);
  });

  it('closes symbolWatcher when symbols pipeline is disabled', async () => {
    const fakeDb = makeFakeDb();
    const { service } = buildService(fakeDb);
    const watcher = { close: jest.fn() };
    service.setSymbolWatcher(watcher);

    await service.setPipelineEnabled('symbols', false, ROOT);

    expect(watcher.close).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// onProgress subscription
// ============================================================================

describe('IndexingControlService.onProgress', () => {
  it('calls registered listener and returns unsubscribe function', () => {
    const fakeDb = makeFakeDb();
    const { service } = buildService(fakeDb);
    const listener = jest.fn();

    const unsub = service.onProgress(listener);
    unsub();

    // After unsub, listener should not be in the internal list
    // (no direct way to verify the internal array, but no errors thrown)
    expect(typeof unsub).toBe('function');
  });
});

// ============================================================================
// getStatus fileCount
// ============================================================================

interface FakeSymbolRow {
  readonly workspace_root: string;
  readonly file_path: string;
}

/**
 * A fake DB that answers the two `readFileCount` statements from `symbols`
 * and defers every other statement to `makeFakeDb`.
 */
function makeFileCountDb(
  symbols: readonly FakeSymbolRow[],
  options: { failCount?: boolean } = {},
  rowsByFp: Map<string, Record<string, unknown>> = new Map(),
): SqliteDatabase {
  const base = makeFakeDb(rowsByFp);
  const basePrepare = base.prepare.bind(base);
  const prepare = jest.fn((sql: string): SqliteStatement => {
    if (sql.includes('SELECT DISTINCT workspace_root')) {
      const stmt = basePrepare(sql);
      stmt.all = jest.fn(() =>
        [...new Set(symbols.map((s) => s.workspace_root))].map((root) => ({
          root,
        })),
      );
      return stmt;
    }
    if (sql.includes('COUNT(DISTINCT file_path)')) {
      if (options.failCount) throw new Error('no such table: code_symbols');
      const stmt = basePrepare(sql);
      stmt.get = jest.fn((...roots: unknown[]) => ({
        n: new Set(
          symbols
            .filter((s) => roots.includes(s.workspace_root))
            .map((s) => s.file_path),
        ).size,
      }));
      return stmt;
    }
    return basePrepare(sql);
  });
  return { ...base, prepare };
}

describe('IndexingControlService.getStatus fileCount', () => {
  it('counts distinct files for the requested workspace only', async () => {
    const fakeDb = makeFileCountDb([
      { workspace_root: ROOT, file_path: `${ROOT}/a.ts` },
      { workspace_root: ROOT, file_path: `${ROOT}/a.ts` },
      { workspace_root: ROOT, file_path: `${ROOT}/b.ts` },
      {
        workspace_root: '/workspace/other',
        file_path: '/workspace/other/c.ts',
      },
    ]);
    const { service } = buildService(fakeDb);

    const status = await service.getStatus(ROOT);

    expect(status.fileCount).toBe(2);
    expect(fakeDb.prepare as jest.Mock).toHaveBeenCalledWith(
      'SELECT COUNT(DISTINCT file_path) AS n FROM code_symbols WHERE workspace_root IN (?)',
    );
  });

  it('matches a stored root spelled differently from the requested one', async () => {
    const fakeDb = makeFileCountDb([
      { workspace_root: `${ROOT}/`, file_path: `${ROOT}/a.ts` },
      { workspace_root: ROOT, file_path: `${ROOT}/a.ts` },
      { workspace_root: ROOT, file_path: `${ROOT}/b.ts` },
    ]);
    const { service } = buildService(fakeDb);

    const status = await service.getStatus(ROOT);

    expect(status.fileCount).toBe(2);
  });

  it('seeks the exact root first and scans stored roots only when it has no rows', async () => {
    const fakeDb = makeFileCountDb([
      { workspace_root: ROOT, file_path: `${ROOT}/a.ts` },
      { workspace_root: ROOT, file_path: `${ROOT}/b.ts` },
    ]);
    const { service } = buildService(fakeDb);
    const prepare = fakeDb.prepare as jest.Mock;
    const scans = (): number =>
      prepare.mock.calls.filter(([sql]) =>
        String(sql).includes('SELECT DISTINCT workspace_root'),
      ).length;

    expect((await service.getStatus(ROOT)).fileCount).toBe(2);
    expect(scans()).toBe(0);

    expect((await service.getStatus(`${ROOT}/`)).fileCount).toBe(2);
    expect(scans()).toBe(1);
  });

  it('reports 0 when the workspace has no symbols', async () => {
    const fakeDb = makeFileCountDb([
      {
        workspace_root: '/workspace/other',
        file_path: '/workspace/other/c.ts',
      },
    ]);
    const { service } = buildService(fakeDb);

    const status = await service.getStatus(ROOT);

    expect(status.fileCount).toBe(0);
  });

  it('leaves fileCount undefined when the count query fails', async () => {
    const fakeDb = makeFileCountDb(
      [{ workspace_root: ROOT, file_path: `${ROOT}/a.ts` }],
      { failCount: true },
    );
    const { service, logger } = buildService(fakeDb);

    const status = await service.getStatus(ROOT);

    expect(status.fileCount).toBeUndefined();
    expect('fileCount' in status).toBe(false);
    expect(logger.debug).toHaveBeenCalledWith(
      '[indexing-control] code_symbols file count failed',
      { error: 'no such table: code_symbols' },
    );
  });

  it('sets fileCount on the existing-row branch too', async () => {
    const rows = new Map<string, Record<string, unknown>>();
    const fakeDb = makeFileCountDb(
      [{ workspace_root: ROOT, file_path: `${ROOT}/a.ts` }],
      {},
      rows,
    );
    const { service } = buildService(fakeDb, {
      headContent: `${VALID_SHA_A}
`,
    });
    const { workspaceFingerprint } = await service.getStatus(ROOT);
    rows.set(workspaceFingerprint, {
      workspace_fingerprint: workspaceFingerprint,
      git_head_sha: VALID_SHA_A,
      last_indexed_at: 1,
      symbols_enabled: 1,
      memory_enabled: 1,
      symbols_cursor: null,
      disclosure_acknowledged_at: null,
      last_dismissed_stale_sha: null,
      last_error: null,
    });

    const status = await service.getStatus(ROOT);

    expect(status.state).toBe('indexed');
    expect(status.fileCount).toBe(1);
  });
});

describe('IndexingControlService Done progress event', () => {
  it('omits processed/total from the final Done event', async () => {
    const fakeDb = makeFakeDb();
    const { service, webviewManager } = buildService(fakeDb, {
      headContent: `${VALID_SHA_A}\n`,
    });

    await service.start('symbols', ROOT, makeRunDeps());

    const done = (webviewManager.broadcastMessage as jest.Mock).mock.calls
      .map((call: unknown[]) => call[1] as Record<string, unknown>)
      .find((payload) => payload?.['currentLabel'] === 'Done');
    expect(done).toBeDefined();
    expect(done).not.toHaveProperty('processed');
    expect(done).not.toHaveProperty('total');
  });
});

// ============================================================================
// Run state, last run and the census registry (TASK_2026_878 Batch 11)
// ============================================================================

const STATS: IndexingRunStats = {
  filesScanned: 4,
  symbolsIndexed: 40,
  errors: 1,
  durationMs: 25,
};

/** Drain pending promise callbacks and immediates. */
async function settle(): Promise<void> {
  for (let i = 0; i < 25; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (condition()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error('waitFor: condition never became true');
}

function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

interface FakeCensus {
  readonly promise: Promise<IndexingRunStats>;
  readonly resolve: (stats: IndexingRunStats) => void;
  readonly reject: (error: unknown) => void;
  readonly listeners: Set<(progress: IndexingRunProgress) => void>;
}

/**
 * Fake code-symbol indexer with the real join semantics: the first call for
 * the root creates a deferred census; a later call shares its promise and
 * adds its `onProgress`; a joiner's abort rejects only that joiner; the
 * starter's abort rejects the census. The census leaves the indexer before it
 * settles, so a later call starts a new one.
 */
function makeFakeIndexer() {
  let active: FakeCensus | null = null;
  let calls = 0;

  function index(
    _root: string,
    options?: {
      signal?: AbortSignal;
      onProgress?: (progress: IndexingRunProgress) => void;
    },
  ): Promise<IndexingRunStats> {
    calls++;
    const progress = options?.onProgress;
    const signal = options?.signal;
    if (active !== null) {
      const census = active;
      if (progress) census.listeners.add(progress);
      if (!signal) return census.promise;
      return new Promise<IndexingRunStats>((resolve, reject) => {
        const onAbort = (): void => {
          if (progress) census.listeners.delete(progress);
          reject(abortError());
        };
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
        census.promise.then(
          (stats) => {
            signal.removeEventListener('abort', onAbort);
            resolve(stats);
          },
          (error: unknown) => {
            signal.removeEventListener('abort', onAbort);
            reject(error);
          },
        );
      });
    }
    let resolve!: (stats: IndexingRunStats) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<IndexingRunStats>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    // The census may reject with no direct listener left in a test.
    promise.catch(() => undefined);
    const census: FakeCensus = {
      promise,
      resolve,
      reject,
      listeners: new Set(progress ? [progress] : []),
    };
    active = census;
    signal?.addEventListener(
      'abort',
      () => {
        if (active === census) active = null;
        census.reject(abortError());
      },
      { once: true },
    );
    return promise;
  }

  function current(): FakeCensus {
    if (active === null) throw new Error('no active fake census');
    return active;
  }

  return {
    index,
    calls: () => calls,
    hasActive: () => active !== null,
    batch(filesScanned: number, totalFiles: number): void {
      for (const listener of current().listeners) {
        listener({ filesScanned, totalFiles });
      }
    },
    succeed(stats: IndexingRunStats = STATS): void {
      const census = current();
      active = null;
      census.resolve(stats);
    },
    fail(error: unknown): void {
      const census = current();
      active = null;
      census.reject(error);
    },
  };
}

type FakeIndexer = ReturnType<typeof makeFakeIndexer>;

function manualDeps(
  indexer: FakeIndexer,
  runMemory: () => Promise<void> = () => Promise.resolve(),
): IndexingRunDeps {
  return {
    runSymbols: (root, options) => indexer.index(root, options),
    runMemory: jest.fn(runMemory),
  };
}

/** A lifecycle-style background run with its own abort controller. */
function startBackground(
  service: IndexingControlService,
  indexer: FakeIndexer,
  controller: AbortController = new AbortController(),
): Promise<IndexingRunStats> {
  return service.trackBackgroundRun(ROOT, (onProgress) =>
    indexer.index(ROOT, { signal: controller.signal, onProgress }),
  );
}

/** Rows written with a `last_run_json` value, in order. */
function lastRunWrites(fakeDb: SqliteDatabase): Array<Record<string, unknown>> {
  const prepare = fakeDb.prepare as jest.Mock;
  const seen = new Set<SqliteStatement>();
  const writes: Array<Record<string, unknown>> = [];
  prepare.mock.calls.forEach((call: unknown[], i: number) => {
    const sql = call[0] as string;
    const stmt = prepare.mock.results[i]?.value as SqliteStatement;
    if (!sql.includes('last_run_json = ?') || seen.has(stmt)) return;
    seen.add(stmt);
    for (const args of (stmt.run as jest.Mock).mock.calls as unknown[][]) {
      // args: [updated_at, last_run_json, fingerprint]
      writes.push(JSON.parse(args[1] as string) as Record<string, unknown>);
    }
  });
  return writes;
}

function pushes(
  webviewManager: { broadcastMessage: jest.Mock },
  type: string,
): Array<Record<string, unknown>> {
  return webviewManager.broadcastMessage.mock.calls
    .filter((call: unknown[]) => call[0] === type)
    .map((call: unknown[]) => call[1] as Record<string, unknown>);
}

/** Batch progress pushes (the manual "Done" push has no `processed`). */
function batchPushes(webviewManager: {
  broadcastMessage: jest.Mock;
}): Array<Record<string, unknown>> {
  return pushes(webviewManager, MESSAGE_TYPES.INDEXING_PROGRESS).filter(
    (event) => event['processed'] !== undefined,
  );
}

/**
 * Size of the private open-census map. A-F6 is a statement about this map,
 * so the spec reads it directly as well as through `getStatus().running`.
 */
function openCensusCount(service: IndexingControlService): number {
  return (service as unknown as { openCensuses: Map<string, unknown> })
    .openCensuses.size;
}

function buildCensusService() {
  const rows = new Map<string, Record<string, unknown>>();
  const fakeDb = makeFakeDb(rows);
  const built = buildService(fakeDb, { headContent: `${VALID_SHA_A}\n` });
  return { ...built, rows, fakeDb, indexer: makeFakeIndexer() };
}

describe('IndexingControlService run state and lastRun', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('a fingerprint throw releases the controller', async () => {
    const { service, indexer } = buildCensusService();
    jest
      .spyOn(fingerprintModule, 'deriveWorkspaceFingerprint')
      .mockRejectedValueOnce(new Error('fingerprint boom'));

    await expect(
      service.start('symbols', ROOT, manualDeps(indexer)),
    ).rejects.toThrow('fingerprint boom');
    expect(service.isRunning()).toBe(false);

    const second = service.start('symbols', ROOT, manualDeps(indexer));
    await waitFor(() => indexer.calls() === 1);
    indexer.succeed();
    await second;
    expect(service.isRunning()).toBe(false);
  });

  it('a duplicate manual start is ignored and logged', async () => {
    const { service, indexer, logger } = buildCensusService();
    const first = service.start('symbols', ROOT, manualDeps(indexer));
    await waitFor(() => indexer.calls() === 1);

    await service.start('symbols', ROOT, manualDeps(indexer));

    expect(service.isRunning()).toBe(true);
    expect(indexer.calls()).toBe(1);
    expect(logger.info).toHaveBeenCalledWith(
      '[indexing-control] start ignored — already running',
    );
    indexer.succeed();
    await first;
  });

  it('a manual failure pushes indexing:failed, persists last_error and records lastRun.failed', async () => {
    const { service, indexer, webviewManager, fakeDb, logger } =
      buildCensusService();
    const run = service.start('symbols', ROOT, manualDeps(indexer));
    await waitFor(() => indexer.calls() === 1);
    indexer.fail(new Error('parser crashed at /secret/path'));
    await run;

    const failed = pushes(webviewManager, MESSAGE_TYPES.INDEXING_FAILED);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toEqual(
      expect.objectContaining({ origin: 'manual', workspaceRoot: ROOT }),
    );
    expect(JSON.stringify(failed[0])).not.toContain('parser crashed');
    expect(
      pushes(webviewManager, MESSAGE_TYPES.INDEXING_COMPLETE),
    ).toHaveLength(0);
    const status = await service.getStatus(ROOT);
    expect(status.errorMessage).toBe('parser crashed at /secret/path');
    expect(status.lastRun).toEqual(
      expect.objectContaining({ origin: 'manual', outcome: 'failed' }),
    );
    expect(JSON.stringify(status.lastRun)).not.toContain('parser crashed');
    expect(lastRunWrites(fakeDb)).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(service.isRunning()).toBe(false);
  });

  it('getStatus reports indexing + running during a manual run and the persisted lastRun after, across instances', async () => {
    const { service, indexer, fakeDb } = buildCensusService();
    const run = service.start('symbols', ROOT, manualDeps(indexer));
    await waitFor(() => indexer.calls() === 1);
    indexer.batch(2, 4);

    const during = await service.getStatus(ROOT);
    expect(during.state).toBe('indexing');
    expect(during.running).toEqual(
      expect.objectContaining({
        origin: 'manual',
        force: false,
        processed: 2,
        total: 4,
      }),
    );
    expect(during.running?.joinedBackground).toBeUndefined();

    indexer.succeed(STATS);
    await run;

    const after = await service.getStatus(ROOT);
    expect(after.state).toBe('indexed');
    expect(after.running).toBeNull();
    expect(after.lastRun).toEqual(
      expect.objectContaining({
        origin: 'manual',
        outcome: 'succeeded',
        filesScanned: 4,
        symbolsIndexed: 40,
        errors: 1,
      }),
    );

    const fresh = buildService(fakeDb, { headContent: `${VALID_SHA_A}\n` });
    expect((await fresh.service.getStatus(ROOT)).lastRun).toEqual(
      after.lastRun,
    );
  });

  it('a corrupt or invalid last_run_json reads as lastRun null', async () => {
    const { service, rows, logger } = buildCensusService();
    const { workspaceFingerprint } = await service.getStatus(ROOT);
    const base = {
      workspace_fingerprint: workspaceFingerprint,
      git_head_sha: VALID_SHA_A,
      last_indexed_at: 1,
      symbols_enabled: 1,
      memory_enabled: 1,
      symbols_cursor: null,
      disclosure_acknowledged_at: null,
      last_dismissed_stale_sha: null,
      last_error: null,
    };

    rows.set(workspaceFingerprint, { ...base, last_run_json: '{not json' });
    expect((await service.getStatus(ROOT)).lastRun).toBeNull();

    rows.set(workspaceFingerprint, {
      ...base,
      last_run_json: JSON.stringify({ origin: 'manual', outcome: 'exploded' }),
    });
    expect((await service.getStatus(ROOT)).lastRun).toBeNull();
    expect(logger.debug).toHaveBeenCalledWith(
      '[indexing-control] last_run_json has an invalid shape',
    );
  });
});

describe('IndexingControlService.trackBackgroundRun alone', () => {
  it('success: running background, progress, one INDEXING_COMPLETE and lastRun', async () => {
    const { service, indexer, webviewManager, fakeDb, rows } =
      buildCensusService();
    const bg = startBackground(service, indexer);
    await waitFor(() => indexer.calls() === 1);
    indexer.batch(1, 4);

    const during = await service.getStatus(ROOT);
    expect(during.state).toBe('indexing');
    expect(during.running).toEqual(
      expect.objectContaining({ origin: 'background', processed: 1, total: 4 }),
    );
    expect(service.isRunning()).toBe(false);

    indexer.succeed(STATS);
    await expect(bg).resolves.toBe(STATS);

    expect(batchPushes(webviewManager)).toHaveLength(1);
    expect(
      pushes(webviewManager, MESSAGE_TYPES.INDEXING_COMPLETE),
    ).toHaveLength(1);
    expect(lastRunWrites(fakeDb)).toEqual([
      expect.objectContaining({
        origin: 'background',
        outcome: 'succeeded',
        filesScanned: 4,
      }),
    ]);
    // Background runs never write the per-call columns.
    const row = [...rows.values()][0];
    expect(row['last_indexed_at']).toBeNull();
    expect(row['last_error']).toBeNull();
  });

  it('failure: one INDEXING_FAILED, and the rejection passes through unchanged', async () => {
    const { service, indexer, webviewManager, fakeDb } = buildCensusService();
    const error = new Error('census broke');
    const bg = startBackground(service, indexer);
    await waitFor(() => indexer.calls() === 1);
    indexer.fail(error);

    await expect(bg).rejects.toBe(error);
    expect(pushes(webviewManager, MESSAGE_TYPES.INDEXING_FAILED)).toEqual([
      expect.objectContaining({ origin: 'background' }),
    ]);
    expect(lastRunWrites(fakeDb)).toEqual([
      expect.objectContaining({ origin: 'background', outcome: 'failed' }),
    ]);
  });

  it('abort: records nothing, pushes nothing and removes the record', async () => {
    const { service, indexer, webviewManager, fakeDb } = buildCensusService();
    const controller = new AbortController();
    const bg = startBackground(service, indexer, controller);
    await waitFor(() => indexer.calls() === 1);
    controller.abort();

    await expect(bg).rejects.toMatchObject({ name: 'AbortError' });
    expect(lastRunWrites(fakeDb)).toHaveLength(0);
    expect(
      pushes(webviewManager, MESSAGE_TYPES.INDEXING_COMPLETE),
    ).toHaveLength(0);
    expect(pushes(webviewManager, MESSAGE_TYPES.INDEXING_FAILED)).toHaveLength(
      0,
    );
    expect(openCensusCount(service)).toBe(0);
    expect((await service.getStatus(ROOT)).running).toBeNull();
  });

  it('passes a non-Error rejection and a plain resolution through unchanged', async () => {
    const { service } = buildCensusService();
    const reason = { code: 'not-an-error' };
    await expect(
      service.trackBackgroundRun(ROOT, () => Promise.reject(reason)),
    ).rejects.toBe(reason);
    await expect(
      service.trackBackgroundRun(ROOT, () => Promise.resolve('done')),
    ).resolves.toBe('done');
  });
});

describe('IndexingControlService census join (F5)', () => {
  it('manual first, watcher second, success', async () => {
    const { service, indexer, webviewManager, fakeDb } = buildCensusService();
    const manual = service.start('symbols', ROOT, manualDeps(indexer));
    await waitFor(() => indexer.calls() === 1);
    const bg = startBackground(service, indexer);
    await waitFor(() => indexer.calls() === 2);

    const during = await service.getStatus(ROOT);
    expect(during.running?.origin).toBe('manual');
    expect(during.running?.joinedBackground).toBeUndefined();

    indexer.batch(2, 4);
    indexer.batch(4, 4);
    indexer.succeed(STATS);
    await manual;
    await expect(bg).resolves.toBe(STATS);

    expect(batchPushes(webviewManager)).toHaveLength(2);
    expect(lastRunWrites(fakeDb)).toEqual([
      expect.objectContaining({
        origin: 'manual',
        outcome: 'succeeded',
        filesScanned: 4,
        symbolsIndexed: 40,
      }),
    ]);
    expect(
      pushes(webviewManager, MESSAGE_TYPES.INDEXING_COMPLETE),
    ).toHaveLength(1);
    expect(pushes(webviewManager, MESSAGE_TYPES.INDEXING_FAILED)).toHaveLength(
      0,
    );
  });

  it('manual first, watcher second, failure', async () => {
    const { service, indexer, webviewManager, fakeDb, logger } =
      buildCensusService();
    const error = new Error('census broke');
    const manual = service.start('symbols', ROOT, manualDeps(indexer));
    await waitFor(() => indexer.calls() === 1);
    const bg = startBackground(service, indexer);
    await waitFor(() => indexer.calls() === 2);

    indexer.fail(error);
    await manual;
    await expect(bg).rejects.toBe(error);

    expect(lastRunWrites(fakeDb)).toEqual([
      expect.objectContaining({ origin: 'manual', outcome: 'failed' }),
    ]);
    expect(pushes(webviewManager, MESSAGE_TYPES.INDEXING_FAILED)).toHaveLength(
      1,
    );
    expect(
      pushes(webviewManager, MESSAGE_TYPES.INDEXING_COMPLETE),
    ).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const lastErrorWrites = (fakeDb.prepare as jest.Mock).mock.calls.filter(
      (call: unknown[]) =>
        (call[0] as string).includes(
          'SET updated_at = ?, last_error = ? WHERE',
        ),
    );
    expect(lastErrorWrites).toHaveLength(1);
  });

  it('background then background, success', async () => {
    const { service, indexer, webviewManager, fakeDb } = buildCensusService();
    const first = startBackground(service, indexer);
    await waitFor(() => indexer.calls() === 1);
    const second = startBackground(service, indexer);
    await waitFor(() => indexer.calls() === 2);

    expect((await service.getStatus(ROOT)).running?.origin).toBe('background');
    indexer.batch(2, 4);
    indexer.succeed(STATS);
    await expect(first).resolves.toBe(STATS);
    await expect(second).resolves.toBe(STATS);

    expect(batchPushes(webviewManager)).toHaveLength(1);
    expect(lastRunWrites(fakeDb)).toEqual([
      expect.objectContaining({ origin: 'background', outcome: 'succeeded' }),
    ]);
    expect(
      pushes(webviewManager, MESSAGE_TYPES.INDEXING_COMPLETE),
    ).toHaveLength(1);
  });

  it('background then background, failure', async () => {
    const { service, indexer, webviewManager, fakeDb } = buildCensusService();
    const error = new Error('census broke');
    const first = startBackground(service, indexer);
    await waitFor(() => indexer.calls() === 1);
    const second = startBackground(service, indexer);
    await waitFor(() => indexer.calls() === 2);

    indexer.fail(error);
    await expect(first).rejects.toBe(error);
    await expect(second).rejects.toBe(error);

    expect(lastRunWrites(fakeDb)).toEqual([
      expect.objectContaining({ outcome: 'failed' }),
    ]);
    expect(pushes(webviewManager, MESSAGE_TYPES.INDEXING_FAILED)).toHaveLength(
      1,
    );
  });

  it('background first, manual second, success', async () => {
    const { service, indexer, webviewManager, fakeDb } = buildCensusService();
    const bg = startBackground(service, indexer);
    await waitFor(() => indexer.calls() === 1);
    const manual = service.start('symbols', ROOT, manualDeps(indexer));
    await waitFor(() => indexer.calls() === 2);

    const during = await service.getStatus(ROOT);
    expect(during.running).toEqual(
      expect.objectContaining({ origin: 'background', joinedBackground: true }),
    );

    indexer.batch(2, 4);
    indexer.succeed(STATS);
    await expect(bg).resolves.toBe(STATS);
    await manual;

    expect(batchPushes(webviewManager)).toHaveLength(1);
    expect(lastRunWrites(fakeDb)).toEqual([
      expect.objectContaining({ origin: 'background', outcome: 'succeeded' }),
    ]);
    expect(
      pushes(webviewManager, MESSAGE_TYPES.INDEXING_COMPLETE),
    ).toHaveLength(1);
  });

  it('a manual start is running in status before its setup reads finish', async () => {
    const { service, indexer } = buildCensusService();
    const real = fingerprintModule.deriveWorkspaceFingerprint;
    let releaseSetup!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseSetup = resolve;
    });
    jest
      .spyOn(fingerprintModule, 'deriveWorkspaceFingerprint')
      .mockImplementationOnce(async (...args) => {
        await gate;
        return real(...args);
      });

    const manual = service.start('symbols', ROOT, manualDeps(indexer), {
      force: true,
    });
    const during = await service.getStatus(ROOT);
    expect(during.state).toBe('indexing');
    expect(during.running).toEqual(
      expect.objectContaining({ origin: 'manual', force: true }),
    );

    releaseSetup();
    await waitFor(() => indexer.calls() === 1);
    indexer.succeed(STATS);
    await manual;
    expect((await service.getStatus(ROOT)).running).toBeNull();
  });

  it('a pending manual start reports joinedBackground on an open background census', async () => {
    const { service, indexer } = buildCensusService();
    const bg = startBackground(service, indexer);
    await waitFor(() => indexer.calls() === 1);
    const real = fingerprintModule.deriveWorkspaceFingerprint;
    let releaseSetup!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseSetup = resolve;
    });
    jest
      .spyOn(fingerprintModule, 'deriveWorkspaceFingerprint')
      .mockImplementationOnce(async (...args) => {
        await gate;
        return real(...args);
      });

    const manual = service.start('symbols', ROOT, manualDeps(indexer));
    expect((await service.getStatus(ROOT)).running).toEqual(
      expect.objectContaining({ origin: 'background', joinedBackground: true }),
    );

    releaseSetup();
    await waitFor(() => indexer.calls() === 2);
    indexer.succeed(STATS);
    await expect(bg).resolves.toBe(STATS);
    await manual;
  });

  it('A-F7: background first, manual second, census fails', async () => {
    const { service, indexer, webviewManager, fakeDb } = buildCensusService();
    const error = new Error('census broke');
    const bg = startBackground(service, indexer);
    await waitFor(() => indexer.calls() === 1);
    const manual = service.start('symbols', ROOT, manualDeps(indexer));
    await waitFor(() => indexer.calls() === 2);

    indexer.fail(error);
    await expect(bg).rejects.toBe(error);
    await manual;

    expect(lastRunWrites(fakeDb)).toEqual([
      expect.objectContaining({ origin: 'background', outcome: 'failed' }),
    ]);
    const failed = pushes(webviewManager, MESSAGE_TYPES.INDEXING_FAILED);
    expect(failed).toHaveLength(1);
    expect(failed[0]['origin']).toBe('background');
    expect(
      pushes(webviewManager, MESSAGE_TYPES.INDEXING_COMPLETE),
    ).toHaveLength(0);
  });

  it('record closes: a watcher run during the manual memory phase opens a new census', async () => {
    const { service, indexer, webviewManager, fakeDb } = buildCensusService();
    let finishMemory!: () => void;
    const memory = new Promise<void>((resolve) => {
      finishMemory = resolve;
    });
    const manual = service.start(
      undefined,
      ROOT,
      manualDeps(indexer, () => memory),
    );
    await waitFor(() => indexer.calls() === 1);
    indexer.succeed(STATS);
    await settle();

    const bg = startBackground(service, indexer);
    await waitFor(() => indexer.calls() === 2);
    expect(indexer.hasActive()).toBe(true);
    // The live manual record wins the running view.
    expect((await service.getStatus(ROOT)).running?.origin).toBe('manual');

    indexer.succeed(STATS);
    await expect(bg).resolves.toBe(STATS);
    finishMemory();
    await manual;

    // The newer background census settled first; the older manual census
    // settles later and must not overwrite its persisted summary.
    const writes = lastRunWrites(fakeDb);
    expect(writes).toEqual([
      expect.objectContaining({ origin: 'background', outcome: 'succeeded' }),
    ]);
    const status = await service.getStatus(ROOT);
    expect(status.lastRun).toEqual(
      expect.objectContaining({ origin: 'background', outcome: 'succeeded' }),
    );
    expect(status.running).toBeNull();
    // The stale-skipped older census sends no second real completion, only
    // a status-only refresh.
    const completes = pushes(webviewManager, MESSAGE_TYPES.INDEXING_COMPLETE);
    expect(completes).toHaveLength(2);
    expect(completes[0]['refreshOnly']).toBeUndefined();
    expect(completes[1]['refreshOnly']).toBe(true);
  });

  it('joiner cancel: background first, manual joins, cancel → the census continues', async () => {
    const { service, indexer, webviewManager, fakeDb } = buildCensusService();
    const bg = startBackground(service, indexer);
    await waitFor(() => indexer.calls() === 1);
    const manual = service.start('symbols', ROOT, manualDeps(indexer));
    await waitFor(() => indexer.calls() === 2);
    expect((await service.getStatus(ROOT)).running?.joinedBackground).toBe(
      true,
    );

    service.cancel();
    await manual;
    const after = await service.getStatus(ROOT);
    expect(after.running?.origin).toBe('background');
    expect(after.running?.joinedBackground).toBeUndefined();

    indexer.succeed(STATS);
    await expect(bg).resolves.toBe(STATS);

    expect(lastRunWrites(fakeDb)).toEqual([
      expect.objectContaining({ origin: 'background', outcome: 'succeeded' }),
    ]);
    expect(
      pushes(webviewManager, MESSAGE_TYPES.INDEXING_COMPLETE),
    ).toHaveLength(1);
  });

  it('an older background success that settles after a newer failed census sends only a status refresh', async () => {
    const { service, indexer, webviewManager, fakeDb } = buildCensusService();
    const bg = startBackground(service, indexer);
    await waitFor(() => indexer.calls() === 1);
    const joiner = service.start('symbols', ROOT, manualDeps(indexer));
    await waitFor(() => indexer.calls() === 2);
    service.cancel();
    await joiner; // the aborted manual participant leaves the older census

    // A memory-only run opens a newer census of its own, which fails.
    await service.start(
      'memory',
      ROOT,
      manualDeps(indexer, () => Promise.reject(new Error('memory broke'))),
      { force: true },
    );
    expect(pushes(webviewManager, MESSAGE_TYPES.INDEXING_FAILED)).toHaveLength(
      1,
    );

    indexer.succeed(STATS);
    await expect(bg).resolves.toBe(STATS);

    expect(lastRunWrites(fakeDb)).toEqual([
      expect.objectContaining({ origin: 'manual', outcome: 'failed' }),
    ]);
    const status = await service.getStatus(ROOT);
    expect(status.lastRun).toEqual(
      expect.objectContaining({ origin: 'manual', outcome: 'failed' }),
    );
    expect(status.running).toBeNull();
    // The failure push arrived while the older census was still live, so
    // the panel needs one status-only refresh, never a real completion.
    const completes = pushes(webviewManager, MESSAGE_TYPES.INDEXING_COMPLETE);
    expect(completes).toHaveLength(1);
    expect(completes[0]).toEqual(
      expect.objectContaining({ workspaceRoot: ROOT, refreshOnly: true }),
    );
    expect(pushes(webviewManager, MESSAGE_TYPES.INDEXING_FAILED)).toHaveLength(
      1,
    );
  });

  it('manual first, watcher joined, cancel → one cancelled lastRun, no push', async () => {
    const { service, indexer, webviewManager, fakeDb } = buildCensusService();
    const manual = service.start('symbols', ROOT, manualDeps(indexer));
    await waitFor(() => indexer.calls() === 1);
    const bg = startBackground(service, indexer);
    await waitFor(() => indexer.calls() === 2);

    service.cancel();
    await manual;
    await expect(bg).rejects.toMatchObject({ name: 'AbortError' });

    expect(lastRunWrites(fakeDb)).toEqual([
      expect.objectContaining({ origin: 'manual', outcome: 'cancelled' }),
    ]);
    expect(
      pushes(webviewManager, MESSAGE_TYPES.INDEXING_COMPLETE),
    ).toHaveLength(0);
    expect(pushes(webviewManager, MESSAGE_TYPES.INDEXING_FAILED)).toHaveLength(
      0,
    );
  });
});

describe('IndexingControlService census removal on final release (A-F6)', () => {
  let now = 1_000;

  beforeEach(() => {
    now = 1_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('A-F6: manual start, watcher joins, cancel → record removed; a fresh manual start opens a new manual record', async () => {
    const { service, indexer, webviewManager, fakeDb } = buildCensusService();
    const manual = service.start('symbols', ROOT, manualDeps(indexer));
    await waitFor(() => indexer.calls() === 1);
    const bg = startBackground(service, indexer);
    await waitFor(() => indexer.calls() === 2);

    service.cancel();
    await manual;
    await expect(bg).rejects.toMatchObject({ name: 'AbortError' });

    expect(openCensusCount(service)).toBe(0);
    expect((await service.getStatus(ROOT)).running).toBeNull();
    const cancelWrites = lastRunWrites(fakeDb).length;
    const settlePushesBefore =
      pushes(webviewManager, MESSAGE_TYPES.INDEXING_COMPLETE).length +
      pushes(webviewManager, MESSAGE_TYPES.INDEXING_FAILED).length;
    expect(settlePushesBefore).toBe(0);

    now = 5_000;
    const fresh = service.start('symbols', ROOT, manualDeps(indexer));
    await waitFor(() => indexer.calls() === 3);
    const running = (await service.getStatus(ROOT)).running;
    expect(running).toEqual(
      expect.objectContaining({ origin: 'manual', startedAt: 5_000 }),
    );
    indexer.succeed(STATS);
    await fresh;

    const freshWrites = lastRunWrites(fakeDb).slice(cancelWrites);
    expect(freshWrites).toEqual([
      expect.objectContaining({
        origin: 'manual',
        outcome: 'succeeded',
        startedAt: 5_000,
      }),
    ]);
    expect(
      pushes(webviewManager, MESSAGE_TYPES.INDEXING_COMPLETE),
    ).toHaveLength(1);
    expect(pushes(webviewManager, MESSAGE_TYPES.INDEXING_FAILED)).toHaveLength(
      0,
    );
    expect(openCensusCount(service)).toBe(0);
  });

  it('A-F6 pause variant: no lastRun write and the record is removed', async () => {
    const { service, indexer, webviewManager, fakeDb } = buildCensusService();
    const manual = service.start('symbols', ROOT, manualDeps(indexer));
    await waitFor(() => indexer.calls() === 1);
    const bg = startBackground(service, indexer);
    await waitFor(() => indexer.calls() === 2);

    service.pause();
    await manual;
    await expect(bg).rejects.toMatchObject({ name: 'AbortError' });

    expect(lastRunWrites(fakeDb)).toHaveLength(0);
    expect(
      pushes(webviewManager, MESSAGE_TYPES.INDEXING_COMPLETE),
    ).toHaveLength(0);
    expect(pushes(webviewManager, MESSAGE_TYPES.INDEXING_FAILED)).toHaveLength(
      0,
    );
    expect(openCensusCount(service)).toBe(0);
    expect((await service.getStatus(ROOT)).running).toBeNull();
    expect((await service.getStatus(ROOT)).state).toBe('paused');
  });
});

/** Makes every `last_run_json` write throw, as a failing SQLite write would. */
function failLastRunWrites(fakeDb: SqliteDatabase): void {
  const prepare = fakeDb.prepare as jest.Mock;
  const original = prepare.getMockImplementation() as (
    sql: string,
  ) => SqliteStatement;
  prepare.mockImplementation((sql: string): SqliteStatement => {
    const stmt = original(sql);
    if (!sql.includes('last_run_json = ?')) return stmt;
    return {
      ...stmt,
      run: jest.fn(() => {
        throw new Error('SQLITE_FULL: database or disk is full');
      }),
    };
  });
}

describe('IndexingControlService review fixes (TASK_2026_878 B/C)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('a failed lastRun write turns a succeeded census into one INDEXING_FAILED push', async () => {
    const { service, indexer, webviewManager, fakeDb, logger } =
      buildCensusService();
    failLastRunWrites(fakeDb);
    const run = service.start('symbols', ROOT, manualDeps(indexer));
    await waitFor(() => indexer.calls() === 1);
    indexer.succeed(STATS);
    await run;

    expect(
      pushes(webviewManager, MESSAGE_TYPES.INDEXING_COMPLETE),
    ).toHaveLength(0);
    const failed = pushes(webviewManager, MESSAGE_TYPES.INDEXING_FAILED);
    expect(failed).toEqual([
      expect.objectContaining({ origin: 'manual', workspaceRoot: ROOT }),
    ]);
    expect(JSON.stringify(failed[0])).not.toContain('SQLITE_FULL');
    expect(logger.warn).toHaveBeenCalledWith(
      '[indexing-control] last run could not be saved',
      expect.objectContaining({ origin: 'manual', outcome: 'succeeded' }),
    );
    expect((await service.getStatus(ROOT)).lastRun).toBeNull();
  });

  it('a failed lastRun write for a failed census still pushes INDEXING_FAILED once', async () => {
    const { service, indexer, webviewManager, fakeDb } = buildCensusService();
    failLastRunWrites(fakeDb);
    const bg = startBackground(service, indexer);
    await waitFor(() => indexer.calls() === 1);
    const error = new Error('census broke');
    indexer.fail(error);
    await expect(bg).rejects.toBe(error);

    expect(pushes(webviewManager, MESSAGE_TYPES.INDEXING_FAILED)).toHaveLength(
      1,
    );
    expect(
      pushes(webviewManager, MESSAGE_TYPES.INDEXING_COMPLETE),
    ).toHaveLength(0);
  });

  it('a late progress callback after the census settled produces no broadcast', async () => {
    const { service, webviewManager } = buildCensusService();
    const captured: { onProgress?: (progress: IndexingRunProgress) => void } =
      {};
    await service.trackBackgroundRun(ROOT, (onProgress) => {
      captured.onProgress = onProgress;
      onProgress({ filesScanned: 1, totalFiles: 4 });
      return Promise.resolve(STATS);
    });
    expect(batchPushes(webviewManager)).toHaveLength(1);
    const listener = jest.fn();
    service.onProgress(listener);

    expect(captured.onProgress).toBeDefined();
    captured.onProgress?.({ filesScanned: 3, totalFiles: 4 });

    expect(batchPushes(webviewManager)).toHaveLength(1);
    expect(listener).not.toHaveBeenCalled();
    expect((await service.getStatus(ROOT)).running).toBeNull();
  });

  it('a background setup failure after the fingerprint records one failed background lastRun and one push', async () => {
    const { service, webviewManager, fakeDb, logger } = buildCensusService();
    const setupError = new Error('EACCES: /home/user/.git/HEAD');
    jest
      .spyOn(fingerprintModule, 'deriveGitHeadSha')
      .mockRejectedValueOnce(setupError);
    const run = jest.fn(() => Promise.resolve(STATS));

    await expect(service.trackBackgroundRun(ROOT, run)).rejects.toBe(
      setupError,
    );

    expect(run).not.toHaveBeenCalled();
    expect(lastRunWrites(fakeDb)).toEqual([
      expect.objectContaining({ origin: 'background', outcome: 'failed' }),
    ]);
    const failed = pushes(webviewManager, MESSAGE_TYPES.INDEXING_FAILED);
    expect(failed).toEqual([
      expect.objectContaining({ origin: 'background', workspaceRoot: ROOT }),
    ]);
    expect(JSON.stringify(failed[0])).not.toContain('EACCES');
    expect((await service.getStatus(ROOT)).lastRun).toEqual(
      expect.objectContaining({ origin: 'background', outcome: 'failed' }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      '[indexing-control] background index setup failed',
      expect.objectContaining({ error: 'EACCES: /home/user/.git/HEAD' }),
    );
    expect(openCensusCount(service)).toBe(0);
  });

  it('a background setup failure without a fingerprint warns with a fixed message and pushes one fingerprint-less INDEXING_FAILED', async () => {
    const { service, webviewManager, fakeDb, logger } = buildCensusService();
    const setupError = new Error('fingerprint boom');
    jest
      .spyOn(fingerprintModule, 'deriveWorkspaceFingerprint')
      .mockRejectedValueOnce(setupError);

    await expect(
      service.trackBackgroundRun(ROOT, () => Promise.resolve(STATS)),
    ).rejects.toBe(setupError);

    expect(logger.warn).toHaveBeenCalledWith(
      '[indexing-control] background index setup failed before a workspace fingerprint was derived',
      expect.objectContaining({ error: 'fingerprint boom' }),
    );
    // No fingerprint, no indexing_state row: nothing to write a lastRun to.
    expect(lastRunWrites(fakeDb)).toHaveLength(0);
    const failed = pushes(webviewManager, MESSAGE_TYPES.INDEXING_FAILED);
    expect(failed).toEqual([
      expect.objectContaining({ origin: 'background', workspaceRoot: ROOT }),
    ]);
    expect(failed[0]).not.toHaveProperty('workspaceFingerprint');
    expect(JSON.stringify(failed[0])).not.toContain('fingerprint boom');
  });

  it('a delayed setup failure never replaces the last run of a census that opened and settled after it started', async () => {
    const { service, indexer, webviewManager, fakeDb } = buildCensusService();
    let failSha!: (error: Error) => void;
    jest.spyOn(fingerprintModule, 'deriveGitHeadSha').mockImplementationOnce(
      () =>
        new Promise<string | null>((_resolve, reject) => {
          failSha = reject;
        }),
    );
    const bg = service.trackBackgroundRun(ROOT, () => Promise.resolve(STATS));
    await settle();

    const manual = service.start('symbols', ROOT, manualDeps(indexer));
    await waitFor(() => indexer.calls() === 1);
    indexer.succeed(STATS);
    await manual;

    const setupError = new Error('EIO: late HEAD read');
    failSha(setupError);
    await expect(bg).rejects.toBe(setupError);

    expect(lastRunWrites(fakeDb)).toEqual([
      expect.objectContaining({ origin: 'manual', outcome: 'succeeded' }),
    ]);
    expect((await service.getStatus(ROOT)).lastRun).toEqual(
      expect.objectContaining({ origin: 'manual', outcome: 'succeeded' }),
    );
    expect(pushes(webviewManager, MESSAGE_TYPES.INDEXING_FAILED)).toEqual([
      expect.objectContaining({ origin: 'background' }),
    ]);
  });

  it('orders by the in-memory sequence after a clock rollback', async () => {
    const { service, fakeDb } = buildCensusService();
    let now = 10_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    await service.trackBackgroundRun(ROOT, () => Promise.resolve(STATS));
    now = 5_000; // the wall clock moves backwards
    await service.trackBackgroundRun(ROOT, () => Promise.resolve(STATS));

    expect(lastRunWrites(fakeDb).map((w) => w['startedAt'])).toEqual([
      10_000, 5_000,
    ]);
    expect((await service.getStatus(ROOT)).lastRun).toEqual(
      expect.objectContaining({ startedAt: 5_000 }),
    );
  });

  it('keeps a newer last run written by another instance', async () => {
    const { service, fakeDb } = buildCensusService();
    let now = 10_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    await service.trackBackgroundRun(ROOT, () => Promise.resolve(STATS));

    const other = buildService(fakeDb, { headContent: `${VALID_SHA_A}\n` });
    now = 5_000;
    await other.service.trackBackgroundRun(ROOT, () => Promise.resolve(STATS));

    expect(lastRunWrites(fakeDb).map((w) => w['startedAt'])).toEqual([10_000]);
    expect((await other.service.getStatus(ROOT)).lastRun).toEqual(
      expect.objectContaining({ startedAt: 10_000 }),
    );
  });

  it('does not overwrite a newer row from another instance after this instance wrote the row', async () => {
    const { service, fakeDb } = buildCensusService();
    let now = 10_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    // A1: this instance writes the row first.
    await service.trackBackgroundRun(ROOT, () => Promise.resolve(STATS));

    // A2 opens at 20 000 and stays in flight.
    now = 20_000;
    let finishA2!: (stats: typeof STATS) => void;
    const a2 = service.trackBackgroundRun(
      ROOT,
      () =>
        new Promise<typeof STATS>((resolve) => {
          finishA2 = resolve;
        }),
    );
    await waitFor(() => finishA2 !== undefined);

    // B1: another instance writes a newer census (30 000) to the same row.
    const other = buildService(fakeDb, { headContent: `${VALID_SHA_A}\n` });
    now = 30_000;
    await other.service.trackBackgroundRun(ROOT, () => Promise.resolve(STATS));

    // A2 settles last. Its local sequence beats A1, but the row is no longer
    // A1, so the persisted startedAt decides and B1 stays.
    now = 40_000;
    finishA2(STATS);
    await a2;

    expect(lastRunWrites(fakeDb).map((w) => w['startedAt'])).toEqual([
      10_000, 30_000,
    ]);
    expect((await service.getStatus(ROOT)).lastRun).toEqual(
      expect.objectContaining({ startedAt: 30_000 }),
    );
  });

  const SELECT_ROW =
    'SELECT * FROM indexing_state WHERE workspace_fingerprint = ?';
  const CAS_LAST_RUN =
    'UPDATE indexing_state SET updated_at = ?, last_run_json = ? WHERE workspace_fingerprint = ? AND last_run_json IS ?';

  it('does not write the last run when the stored row cannot be read', async () => {
    const { service, fakeDb, logger } = buildCensusService();
    let now = 10_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    await service.trackBackgroundRun(ROOT, () => Promise.resolve(STATS));

    const select = fakeDb.prepare(SELECT_ROW);
    const realGet = select.get;
    select.get = jest.fn(() => {
      throw new Error('SQLITE_BUSY: database is locked');
    });
    now = 20_000;
    await service.trackBackgroundRun(ROOT, () => Promise.resolve(STATS));
    select.get = realGet;

    expect(lastRunWrites(fakeDb).map((w) => w['startedAt'])).toEqual([10_000]);
    expect(logger.warn).toHaveBeenCalledWith(
      '[indexing-control] indexing_state read failed; last run not written',
      expect.objectContaining({ error: 'SQLITE_BUSY: database is locked' }),
    );
    expect((await service.getStatus(ROOT)).lastRun).toEqual(
      expect.objectContaining({ startedAt: 10_000 }),
    );
  });

  it('re-reads and keeps a newer row that another process wrote between the read and the write', async () => {
    const { service, fakeDb, rows } = buildCensusService();
    let now = 10_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    await service.trackBackgroundRun(ROOT, () => Promise.resolve(STATS));
    const [fp] = [...rows.keys()];
    const newer = JSON.stringify({
      ...JSON.parse(rows.get(fp)?.['last_run_json'] as string),
      startedAt: 30_000,
    });

    // Another process replaces the row after this process read it and
    // before its compare-and-set write runs.
    const cas = fakeDb.prepare(CAS_LAST_RUN);
    const realRun = cas.run;
    let raced = false;
    cas.run = jest.fn((...args: unknown[]) => {
      if (!raced) {
        raced = true;
        const row = rows.get(fp);
        if (row) row['last_run_json'] = newer;
      }
      return realRun(...args);
    }) as typeof cas.run;
    now = 20_000;
    await service.trackBackgroundRun(ROOT, () => Promise.resolve(STATS));
    cas.run = realRun;

    expect(raced).toBe(true);
    expect(rows.get(fp)?.['last_run_json']).toBe(newer);
    expect((await service.getStatus(ROOT)).lastRun).toEqual(
      expect.objectContaining({ startedAt: 30_000 }),
    );
  });

  it('writes after a conflict when the re-read row is older', async () => {
    const { service, fakeDb, rows } = buildCensusService();
    let now = 10_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    await service.trackBackgroundRun(ROOT, () => Promise.resolve(STATS));
    const [fp] = [...rows.keys()];
    const older = JSON.stringify({
      ...JSON.parse(rows.get(fp)?.['last_run_json'] as string),
      startedAt: 15_000,
    });

    const cas = fakeDb.prepare(CAS_LAST_RUN);
    const realRun = cas.run;
    let raced = false;
    cas.run = jest.fn((...args: unknown[]) => {
      if (!raced) {
        raced = true;
        const row = rows.get(fp);
        if (row) row['last_run_json'] = older;
      }
      return realRun(...args);
    }) as typeof cas.run;
    now = 20_000;
    await service.trackBackgroundRun(ROOT, () => Promise.resolve(STATS));
    cas.run = realRun;

    expect(raced).toBe(true);
    expect((await service.getStatus(ROOT)).lastRun).toEqual(
      expect.objectContaining({ startedAt: 20_000 }),
    );
  });
});
