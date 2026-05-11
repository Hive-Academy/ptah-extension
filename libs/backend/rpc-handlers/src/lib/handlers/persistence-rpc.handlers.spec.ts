/**
 * Specs for PersistenceRpcHandlers (TASK_2026_THOTH_PERSISTENCE_HARDENING Batch 4).
 *
 * Coverage matrix:
 *   db:health — healthy DB (isOpen=true, stats populated)
 *   db:health — unavailable connection (isOpen=false, all nulls)
 *   db:health — fullCheck=true runs integrity_check
 *   db:reset  — happy path (backup → close → rename → reopen)
 *   db:reset  — rejects wrong confirm token
 *   db:reset  — rejects when inTransaction=true
 *   db:reset  — EPERM retry succeeds on second attempt
 *   db:reset  — EPERM both attempts fail returns success:false
 */

import 'reflect-metadata';
import {
  PersistenceRpcHandlers,
  mintResetChallengeToken,
} from './persistence-rpc.handlers';
import type { DbHealthResult, DbResetResult } from './persistence-rpc.handlers';
import { RpcUserError } from '@ptah-extension/vscode-core';

// Mock node:fs so we can control statSync, renameSync, and existsSync without spyOn limitations.
const mockStatSync = jest.fn();
const mockRenameSync = jest.fn();
const mockExistsSync = jest.fn();
jest.mock('node:fs', () => ({
  ...jest.requireActual('node:fs'),
  statSync: (...args: unknown[]) => mockStatSync(...args),
  renameSync: (...args: unknown[]) => mockRenameSync(...args),
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));

// ---- Minimal test doubles --------------------------------------------------

function makeLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function makeRpcHandler() {
  const registered = new Map<string, (params: unknown) => Promise<unknown>>();
  return {
    registerMethod: jest.fn(
      (name: string, handler: (p: unknown) => Promise<unknown>) => {
        registered.set(name, handler);
      },
    ),
    _call: async (name: string, params: unknown): Promise<unknown> => {
      const h = registered.get(name);
      if (!h) throw new Error(`No handler for ${name}`);
      return h(params);
    },
  };
}

function makeBackupService() {
  return {
    backup: jest.fn().mockResolvedValue('/path/to/backup.sqlite'),
    rotate: jest.fn(),
  };
}

// Minimal SqliteConnectionService double
function makeConnection(opts: {
  isOpen?: boolean;
  inTransaction?: boolean;
  vecExtensionLoaded?: boolean;
  lastMigrationVersion?: number;
  dbPath?: string;
  pragmaResponses?: Record<string, unknown>;
}) {
  const {
    isOpen = true,
    inTransaction = false,
    vecExtensionLoaded = true,
    lastMigrationVersion = 5,
    dbPath = '/home/user/.ptah/state/ptah.sqlite',
    pragmaResponses = {},
  } = opts;

  const db = {
    inTransaction,
    pragma: jest.fn((p: string, _opts?: unknown) => {
      if (pragmaResponses[p] !== undefined) return pragmaResponses[p];
      if (p.startsWith('quick_check')) return 'ok';
      if (p.startsWith('foreign_key_check')) return [];
      if (p.startsWith('page_count')) return 100;
      if (p.startsWith('page_size')) return 4096;
      if (p.startsWith('freelist_count')) return 5;
      if (p.startsWith('integrity_check')) return 'ok';
      return null;
    }),
  };

  const conn = {
    isOpen,
    vecExtensionLoaded,
    lastMigrationVersion,
    dbPath,
    unavailable: isOpen ? null : { reason: 'closed' as const, detail: null },
    get db() {
      if (!isOpen) throw new RpcUserError('Offline', 'PERSISTENCE_UNAVAILABLE');
      return db;
    },
    close: jest.fn(() => {
      conn.isOpen = false;
      conn.unavailable = { reason: 'closed', detail: null };
    }),
    openAndMigrate: jest.fn().mockResolvedValue(undefined),
  };
  return { conn, db };
}

// ---- Test suite ------------------------------------------------------------

describe('PersistenceRpcHandlers', () => {
  let logger: ReturnType<typeof makeLogger>;
  let rpcHandler: ReturnType<typeof makeRpcHandler>;
  let backup: ReturnType<typeof makeBackupService>;

  beforeEach(() => {
    logger = makeLogger();
    rpcHandler = makeRpcHandler();
    backup = makeBackupService();
    jest.clearAllMocks();
    // Default: no WAL file present
    mockStatSync.mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
    // Default: rename succeeds
    mockRenameSync.mockReturnValue(undefined);
    // Default: no sidecar files exist
    mockExistsSync.mockReturnValue(false);
  });

  // ---- db:health — healthy connection ----

  it('db:health returns populated stats when connection is open', async () => {
    const { conn } = makeConnection({ isOpen: true });

    const handler = new PersistenceRpcHandlers(
      logger as never,
      rpcHandler as never,
      conn as never,
      backup as never,
    );
    handler.register();

    const result = (await rpcHandler._call('db:health', {})) as DbHealthResult;

    expect(result.isOpen).toBe(true);
    expect(result.quickCheckPassed).toBe(true);
    expect(result.foreignKeyViolations).toBe(0);
    expect(result.foreignKeyViolationSample).toEqual([]);
    expect(result.dbSizeMb).toBeGreaterThanOrEqual(0);
    expect(result.vecExtensionLoaded).toBe(true);
    expect(result.lastMigrationVersion).toBe(5);
    expect(result.fullCheckRun).toBe(false);
    expect(result.integrityCheckPassed).toBeNull();
  });

  it('db:health returns isOpen=false with nulls when connection is unavailable', async () => {
    const { conn } = makeConnection({ isOpen: false });

    const handler = new PersistenceRpcHandlers(
      logger as never,
      rpcHandler as never,
      conn as never,
      backup as never,
    );
    handler.register();

    const result = (await rpcHandler._call('db:health', {})) as DbHealthResult;

    expect(result.isOpen).toBe(false);
    expect(result.quickCheckPassed).toBeNull();
    expect(result.foreignKeyViolations).toBeNull();
    expect(result.foreignKeyViolationSample).toEqual([]);
    expect(result.dbSizeMb).toBeNull();
    expect(result.freelistRatio).toBeNull();
    expect(result.walSizeKb).toBeNull();
    expect(result.vecExtensionLoaded).toBe(false);
    expect(result.lastMigrationVersion).toBe(0);
    expect(result.fullCheckRun).toBe(false);
    expect(result.integrityCheckPassed).toBeNull();
  });

  it('db:health with fullCheck=true runs integrity_check and sets fullCheckRun', async () => {
    const { conn } = makeConnection({ isOpen: true });

    const handler = new PersistenceRpcHandlers(
      logger as never,
      rpcHandler as never,
      conn as never,
      backup as never,
    );
    handler.register();

    const result = (await rpcHandler._call('db:health', {
      fullCheck: true,
    })) as DbHealthResult;

    expect(result.fullCheckRun).toBe(true);
    expect(result.integrityCheckPassed).toBe(true);
  });

  it('db:health reports quick_check failure without throwing', async () => {
    const { conn } = makeConnection({
      isOpen: true,
      pragmaResponses: { quick_check: 'integrity check failed' },
    });

    const handler = new PersistenceRpcHandlers(
      logger as never,
      rpcHandler as never,
      conn as never,
      backup as never,
    );
    handler.register();

    const result = (await rpcHandler._call('db:health', {})) as DbHealthResult;

    expect(result.isOpen).toBe(true);
    expect(result.quickCheckPassed).toBe(false);
    // Handler must not throw — always returns a structured result
  });

  it('db:health reports FK violations in the sample (up to 3)', async () => {
    const violations = [
      { table: 'memories', rowid: 1, parent: 'sessions', fkid: 0 },
      { table: 'memories', rowid: 2, parent: 'sessions', fkid: 0 },
      { table: 'memories', rowid: 3, parent: 'sessions', fkid: 0 },
      { table: 'memories', rowid: 4, parent: 'sessions', fkid: 0 },
    ];
    const { conn } = makeConnection({
      isOpen: true,
      pragmaResponses: { foreign_key_check: violations },
    });

    const handler = new PersistenceRpcHandlers(
      logger as never,
      rpcHandler as never,
      conn as never,
      backup as never,
    );
    handler.register();

    const result = (await rpcHandler._call('db:health', {})) as DbHealthResult;

    expect(result.foreignKeyViolations).toBe(4);
    expect(result.foreignKeyViolationSample).toHaveLength(3);
  });

  it('db:health returns walSizeKb=null when WAL file is absent', async () => {
    const { conn } = makeConnection({ isOpen: true });
    // mockStatSync already throws ENOENT by default (set in beforeEach)

    const handler = new PersistenceRpcHandlers(
      logger as never,
      rpcHandler as never,
      conn as never,
      backup as never,
    );
    handler.register();

    const result = (await rpcHandler._call('db:health', {})) as DbHealthResult;

    expect(result.walSizeKb).toBeNull();
  });

  it('db:health returns walSizeKb in KB when WAL file exists', async () => {
    const { conn } = makeConnection({ isOpen: true });
    mockStatSync.mockReturnValue({ size: 4096 });

    const handler = new PersistenceRpcHandlers(
      logger as never,
      rpcHandler as never,
      conn as never,
      backup as never,
    );
    handler.register();

    const result = (await rpcHandler._call('db:health', {})) as DbHealthResult;

    expect(result.walSizeKb).toBe(4);
  });

  // ---- db:reset — happy path ----

  it('db:reset happy path: backup → close → rename → reopen', async () => {
    const { conn } = makeConnection({ isOpen: true });
    // mockRenameSync succeeds by default

    const handler = new PersistenceRpcHandlers(
      logger as never,
      rpcHandler as never,
      conn as never,
      backup as never,
    );
    handler.register();

    const result = (await rpcHandler._call('db:reset', {
      confirm: mintResetChallengeToken(),
    })) as DbResetResult;

    expect(result.success).toBe(true);
    // F-M3: backupPath is now basename only, not the full absolute path.
    expect(result.backupPath).toBe('backup.sqlite');
    expect(result.message).toContain('reset');
    expect(backup.backup).toHaveBeenCalledWith(expect.anything(), 'reset');
    expect(conn.close).toHaveBeenCalled();
    expect(conn.openAndMigrate).toHaveBeenCalled();
  });

  // ---- db:reset — guard: bad confirm ----

  it('db:reset throws RpcUserError when confirm is not a valid token', async () => {
    const { conn } = makeConnection({ isOpen: true });

    const handler = new PersistenceRpcHandlers(
      logger as never,
      rpcHandler as never,
      conn as never,
      backup as never,
    );
    handler.register();

    await expect(
      rpcHandler._call('db:reset', { confirm: 'yes' }),
    ).rejects.toMatchObject({
      errorCode: 'PERSISTENCE_UNAVAILABLE',
    });
  });

  it('db:reset still accepts deprecated static CONFIRM token', async () => {
    const { conn } = makeConnection({ isOpen: true });

    const handler = new PersistenceRpcHandlers(
      logger as never,
      rpcHandler as never,
      conn as never,
      backup as never,
    );
    handler.register();

    const result = (await rpcHandler._call('db:reset', {
      confirm: 'CONFIRM',
    })) as DbResetResult;

    expect(result.success).toBe(true);
  });

  it('db:reset throws RpcUserError when params is undefined', async () => {
    const { conn } = makeConnection({ isOpen: true });

    const handler = new PersistenceRpcHandlers(
      logger as never,
      rpcHandler as never,
      conn as never,
      backup as never,
    );
    handler.register();

    await expect(rpcHandler._call('db:reset', undefined)).rejects.toMatchObject(
      {
        errorCode: 'PERSISTENCE_UNAVAILABLE',
      },
    );
  });

  // ---- db:reset — guard: inTransaction ----

  it('db:reset throws RpcUserError when db.inTransaction is true', async () => {
    const { conn } = makeConnection({ isOpen: true, inTransaction: true });

    const handler = new PersistenceRpcHandlers(
      logger as never,
      rpcHandler as never,
      conn as never,
      backup as never,
    );
    handler.register();

    await expect(
      rpcHandler._call('db:reset', { confirm: mintResetChallengeToken() }),
    ).rejects.toMatchObject({
      errorCode: 'PERSISTENCE_UNAVAILABLE',
    });
  });

  // ---- db:reset — EPERM retry succeeds ----

  it('db:reset retries rename once on EPERM and succeeds', async () => {
    const { conn } = makeConnection({ isOpen: true });

    let callCount = 0;
    mockRenameSync.mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        throw Object.assign(new Error('EPERM: operation not permitted'), {
          code: 'EPERM',
        });
      }
      // Second call succeeds
    });

    const handler = new PersistenceRpcHandlers(
      logger as never,
      rpcHandler as never,
      conn as never,
      backup as never,
    );
    handler.register();

    const result = (await rpcHandler._call('db:reset', {
      confirm: mintResetChallengeToken(),
    })) as DbResetResult;

    expect(result.success).toBe(true);
    // The first call is the main rename; second call after async wait.
    // Sidecar renames are also counted (existsSync returns false by default, so none).
    expect(callCount).toBe(2);
  });

  // ---- db:reset — EPERM both attempts fail ----

  it('db:reset returns success=false when EPERM persists on both rename attempts', async () => {
    const { conn } = makeConnection({ isOpen: true });

    mockRenameSync.mockImplementation(() => {
      throw Object.assign(new Error('EPERM: operation not permitted'), {
        code: 'EPERM',
      });
    });

    const handler = new PersistenceRpcHandlers(
      logger as never,
      rpcHandler as never,
      conn as never,
      backup as never,
    );
    handler.register();

    const result = (await rpcHandler._call('db:reset', {
      confirm: mintResetChallengeToken(),
    })) as DbResetResult;

    expect(result.success).toBe(false);
    expect(result.message).toContain('Could not rename old database file.');
    // F-M3: backupPath is now basename only.
    expect(result.backupPath).toBe('backup.sqlite');
  });

  // ---- db:reset — F-M1: challenge token security ----

  it('F-M1: mintResetChallengeToken() produces a token accepted by the handler', async () => {
    const { conn } = makeConnection({ isOpen: true });
    const handler = new PersistenceRpcHandlers(
      logger as never,
      rpcHandler as never,
      conn as never,
      backup as never,
    );
    handler.register();

    const token = mintResetChallengeToken();
    const result = (await rpcHandler._call('db:reset', {
      confirm: token,
    })) as DbResetResult;

    expect(result.success).toBe(true);
  });

  it('F-M1: challenge token is single-use (second use is rejected)', async () => {
    const { conn: conn1 } = makeConnection({ isOpen: true });
    const handler1 = new PersistenceRpcHandlers(
      logger as never,
      rpcHandler as never,
      conn1 as never,
      backup as never,
    );
    handler1.register();

    const token = mintResetChallengeToken();

    // First use: succeeds.
    const result1 = (await rpcHandler._call('db:reset', {
      confirm: token,
    })) as DbResetResult;
    expect(result1.success).toBe(true);

    // Second use of the same token: must be rejected.
    const rpcHandler2 = makeRpcHandler();
    const { conn: conn2 } = makeConnection({ isOpen: true });
    const handler2 = new PersistenceRpcHandlers(
      logger as never,
      rpcHandler2 as never,
      conn2 as never,
      backup as never,
    );
    handler2.register();

    await expect(
      rpcHandler2._call('db:reset', { confirm: token }),
    ).rejects.toMatchObject({ errorCode: 'PERSISTENCE_UNAVAILABLE' });
  });

  // ---- db:reset — D11: WAL/SHM sidecar cleanup ----

  it('D11: renames -wal and -shm sidecar files when they exist', async () => {
    const { conn } = makeConnection({
      isOpen: true,
      dbPath: '/home/user/.ptah/state/ptah.sqlite',
    });

    // Both sidecar files exist.
    mockExistsSync.mockImplementation(
      (p: string) => p.endsWith('-wal') || p.endsWith('-shm'),
    );

    const handler = new PersistenceRpcHandlers(
      logger as never,
      rpcHandler as never,
      conn as never,
      backup as never,
    );
    handler.register();

    await rpcHandler._call('db:reset', { confirm: mintResetChallengeToken() });

    // Verify renameSync was called for both sidecars in addition to the main DB rename.
    const renameCalls = mockRenameSync.mock.calls as [string, string][];
    const walRename = renameCalls.find(([src]) => src.endsWith('-wal'));
    const shmRename = renameCalls.find(([src]) => src.endsWith('-shm'));
    expect(walRename).toBeDefined();
    expect(shmRename).toBeDefined();
    // Dest must use the same .deleted-<ts>-<hex> base as the main DB rename.
    const mainRename = renameCalls.find(([src]) => src.endsWith('ptah.sqlite'));
    expect(mainRename).toBeDefined();
    if (!mainRename || !walRename || !shmRename)
      throw new Error('test setup failed: expected rename calls missing');
    const deletedBase = mainRename[1];
    expect(walRename[1]).toBe(`${deletedBase}-wal`);
    expect(shmRename[1]).toBe(`${deletedBase}-shm`);
  });

  it('D11: does not attempt sidecar renames when WAL/SHM files are absent', async () => {
    const { conn } = makeConnection({ isOpen: true });
    // mockExistsSync returns false by default (set in beforeEach)

    const handler = new PersistenceRpcHandlers(
      logger as never,
      rpcHandler as never,
      conn as never,
      backup as never,
    );
    handler.register();

    await rpcHandler._call('db:reset', { confirm: mintResetChallengeToken() });

    // Only the main DB rename should have fired.
    const renameCalls = mockRenameSync.mock.calls as [string, string][];
    const sidecarRenames = renameCalls.filter(
      ([src]) => src.endsWith('-wal') || src.endsWith('-shm'),
    );
    expect(sidecarRenames).toHaveLength(0);
  });

  // ---- db:reset — F-L4: random suffix on deleted path ----

  it('F-L4: deleted path includes a random hex suffix to avoid collision', async () => {
    const { conn } = makeConnection({ isOpen: true });
    const capturedDests: string[] = [];
    mockRenameSync.mockImplementation((_src: string, dest: string) => {
      capturedDests.push(dest);
    });

    const handler = new PersistenceRpcHandlers(
      logger as never,
      rpcHandler as never,
      conn as never,
      backup as never,
    );
    handler.register();

    await rpcHandler._call('db:reset', { confirm: mintResetChallengeToken() });

    // The main DB rename dest should match .deleted-<ts>-<8 hex chars>
    const mainDest = capturedDests.find(
      (d) => !d.endsWith('-wal') && !d.endsWith('-shm'),
    );
    expect(mainDest).toBeDefined();
    expect(mainDest).toMatch(/\.deleted-\d+-[0-9a-f]{8}$/);
  });

  // ---- db:reset — F-M3: path redaction ----

  it('F-M3: backupPath in result is basename only, not absolute path', async () => {
    const { conn } = makeConnection({ isOpen: true });
    const handler = new PersistenceRpcHandlers(
      logger as never,
      rpcHandler as never,
      conn as never,
      backup as never,
    );
    handler.register();

    const result = (await rpcHandler._call('db:reset', {
      confirm: mintResetChallengeToken(),
    })) as DbResetResult;

    // backupPath should be just the filename, no directory component.
    expect(result.backupPath).toBe('backup.sqlite');
    expect(result.backupPath).not.toContain('/');
    expect(result.backupPath).not.toContain('\\');
  });

  // ---- METHODS constant ----

  it('has METHODS constant with both method names', () => {
    expect(PersistenceRpcHandlers.METHODS).toContain('db:health');
    expect(PersistenceRpcHandlers.METHODS).toContain('db:reset');
  });
});
