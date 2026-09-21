import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type {
  SqliteConnectionService,
  SqliteDatabase,
  VecStatusService,
} from '@ptah-extension/persistence-sqlite';
import type { MemoryStorageHealthDto } from '@ptah-extension/shared';
import { MemoryDiagnosticsService } from './diagnostics.service';
import type { MemoryCuratorService } from './memory-curator.service';
import type { MemoryRetentionService } from './retention/memory-retention.service';

const STORAGE_HEALTH: MemoryStorageHealthDto = {
  dbBytes: 4096,
  reclaimableBytes: 1024,
  autoVacuumIncremental: true,
  observations: {
    pendingRows: 2,
    pendingBytes: 256,
    oldestPendingAt: 1700000000000,
    stuckEligibleRows: 1,
    processedRows: 10,
    processedBytesEstimate: 1280,
    measuredAt: 1700000001000,
    quarantineLedgerRows: 3,
  },
  retention: {
    healthVerdict: 'healthy',
    enabled: true,
    processedDays: 30,
    stuckDays: 7,
    lastRun: null,
    lastCompletedAt: null,
    nextDueAt: null,
    lastSkippedAt: null,
    lastSkipReason: null,
  },
  memoryLifecycle: {
    enabled: true,
    archiveAfterDays: 30,
    deleteAfterDays: 60,
    maxPerWorkspace: 25_000,
    lastNote: null,
    preview: null,
  },
};

function makeRetention(
  storage: MemoryStorageHealthDto = STORAGE_HEALTH,
): MemoryRetentionService {
  return {
    storageHealth: jest.fn(() => storage),
  } as unknown as MemoryRetentionService;
}

function makeVecStatus(available: boolean): VecStatusService {
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

function makeLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
}

interface TableCounts {
  memories: number;
  memory_chunks: number;
  memory_chunks_vec: number;
  memory_chunks_fts: number;
  code_symbols: number;
  code_symbols_vec: number;
}

function resolveTableCount(table: string, c: TableCounts): number {
  switch (table) {
    case 'memory_chunks_fts':
    case 'memory_chunks_fts_docsize':
      return c.memory_chunks_fts ?? 0;
    case 'memory_chunks_vec':
    case 'memory_chunks_vec_rowids':
      return c.memory_chunks_vec ?? 0;
    case 'code_symbols_vec':
    case 'code_symbols_vec_rowids':
      return c.code_symbols_vec ?? 0;
    default:
      return c[table as keyof TableCounts] ?? 0;
  }
}

function makeSqlite(
  counts: Partial<TableCounts>,
  vecLoaded = true,
  throwOn: readonly string[] = [],
): SqliteConnectionService {
  const c: TableCounts = {
    memories: 0,
    memory_chunks: 0,
    memory_chunks_vec: 0,
    memory_chunks_fts: 0,
    code_symbols: 0,
    code_symbols_vec: 0,
    ...counts,
  };
  const throwSet = new Set(throwOn);
  const db = {
    prepare: jest.fn((sql: string) => ({
      get: jest.fn(() => {
        const match = /FROM (\w+)/.exec(sql);
        if (!match) return { n: 0 };
        const t = match[1];
        if (throwSet.has(t)) {
          throw new Error(`no such column: T.chunk_id (${t})`);
        }
        return { n: resolveTableCount(t, c) };
      }),
    })),
  } as unknown as SqliteDatabase;
  return {
    db,
    vecExtensionLoaded: vecLoaded,
  } as unknown as SqliteConnectionService;
}

function makeWorkspace(): IWorkspaceProvider {
  const cfg: Record<string, unknown> = {
    'memory.triggers.preCompact': true,
    'memory.triggers.idleMs': 600000,
    'memory.triggers.turnThreshold': 20,
    'memory.triggers.bootScan': true,
  };
  return {
    getConfiguration: jest.fn(
      (_section: string, key: string, def: unknown) => cfg[key] ?? def,
    ),
    setConfiguration: jest.fn().mockResolvedValue(undefined),
    getWorkspaceRoot: jest.fn(() => '/ws'),
    getWorkspaceFolders: jest.fn(() => ['/ws']),
    onDidChangeConfiguration: jest.fn(),
    onDidChangeWorkspaceFolders: jest.fn(),
  } as unknown as IWorkspaceProvider;
}

function makeCurator(
  lastAt: number | null = null,
  events: unknown[] = [],
): MemoryCuratorService {
  return {
    lastRunInfo: jest.fn(() => ({
      at: lastAt,
      stats: lastAt
        ? { extracted: 3, merged: 1, created: 2, skipped: 0 }
        : null,
    })),
    recentEvents: jest.fn(() => events),
    pushEvent: jest.fn(),
    curate: jest.fn(),
  } as unknown as MemoryCuratorService;
}

describe('MemoryDiagnosticsService', () => {
  it('returns last-run details from the curator', async () => {
    const t = 1700000000000;
    const service = new MemoryDiagnosticsService(
      makeLogger(),
      makeSqlite({}),
      makeCurator(t, [{ kind: 'curator-run', timestamp: t }]),
      makeWorkspace(),
      makeVecStatus(true),
      makeRetention(),
    );
    const snap = await service.getSnapshot('/ws');
    expect(snap.lastRunAt).toBe(t);
    expect(snap.lastRunStats).toEqual({
      extracted: 3,
      merged: 1,
      created: 2,
      skipped: 0,
    });
    expect(snap.recentEvents).toHaveLength(1);
    expect(snap.triggers.idleMs).toBe(600000);
  });

  it('returns the storage health object from the retention service unchanged', async () => {
    const storage = { ...STORAGE_HEALTH, dbBytes: 8192 };
    const service = new MemoryDiagnosticsService(
      makeLogger(),
      makeSqlite({}),
      makeCurator(),
      makeWorkspace(),
      makeVecStatus(true),
      makeRetention(storage),
    );

    const snap = await service.getSnapshot('/ws');

    expect(snap.storage).toBe(storage);
  });

  it('reports coherent when all paired counts match', async () => {
    const service = new MemoryDiagnosticsService(
      makeLogger(),
      makeSqlite({
        memories: 5,
        memory_chunks: 12,
        memory_chunks_vec: 12,
        memory_chunks_fts: 12,
        code_symbols: 50,
        code_symbols_vec: 50,
      }),
      makeCurator(),
      makeWorkspace(),
      makeVecStatus(true),
      makeRetention(),
    );
    const snap = await service.getSnapshot('/ws');
    expect(snap.dbHealth.coherent).toBe(true);
    expect(snap.dbHealth.mismatches).toEqual([]);
  });

  it('detects code_symbols/code_symbols_vec MISMATCH (TASK_2026_125 regression)', async () => {
    const service = new MemoryDiagnosticsService(
      makeLogger(),
      makeSqlite({
        memories: 5,
        memory_chunks: 12,
        memory_chunks_vec: 12,
        memory_chunks_fts: 12,
        code_symbols: 50,
        code_symbols_vec: 49,
      }),
      makeCurator(),
      makeWorkspace(),
      makeVecStatus(true),
      makeRetention(),
    );
    const snap = await service.getSnapshot('/ws');
    expect(snap.dbHealth.coherent).toBe(false);
    expect(snap.dbHealth.mismatches).toContain('code_symbols/code_symbols_vec');
  });

  it('survives a throwing fts count without zeroing other counts or reporting a false mismatch', async () => {
    const service = new MemoryDiagnosticsService(
      makeLogger(),
      makeSqlite(
        {
          memories: 5,
          memory_chunks: 4231,
          memory_chunks_vec: 4231,
          memory_chunks_fts: 4231,
          code_symbols: 50,
          code_symbols_vec: 50,
        },
        true,
        ['memory_chunks_fts_docsize'],
      ),
      makeCurator(),
      makeWorkspace(),
      makeVecStatus(true),
      makeRetention(),
    );
    const snap = await service.getSnapshot('/ws');

    expect(snap.dbHealth.memories).toBe(5);
    expect(snap.dbHealth.memory_chunks).toBe(4231);
    expect(snap.dbHealth.memory_chunks_vec).toBe(4231);
    expect(snap.dbHealth.code_symbols).toBe(50);
    expect(snap.dbHealth.code_symbols_vec).toBe(50);
    expect(snap.dbHealth.memory_chunks_fts).toBe(0);
    expect(snap.dbHealth.mismatches).not.toContain(
      'memory_chunks/memory_chunks_fts',
    );
    expect(snap.dbHealth.coherent).toBe(true);
    expect(snap.dbHealth.countErrors).toBeDefined();
    expect(snap.dbHealth.countErrors?.[0]).toContain(
      'memory_chunks_fts_docsize',
    );
  });

  it('falls back to vec rowid shadow tables when the vec count throws', async () => {
    const service = new MemoryDiagnosticsService(
      makeLogger(),
      makeSqlite(
        {
          memories: 5,
          memory_chunks: 12,
          memory_chunks_vec: 12,
          memory_chunks_fts: 12,
          code_symbols: 50,
          code_symbols_vec: 50,
        },
        true,
        ['memory_chunks_vec', 'code_symbols_vec'],
      ),
      makeCurator(),
      makeWorkspace(),
      makeVecStatus(true),
      makeRetention(),
    );
    const snap = await service.getSnapshot('/ws');

    expect(snap.dbHealth.memory_chunks_vec).toBe(12);
    expect(snap.dbHealth.code_symbols_vec).toBe(50);
    expect(snap.dbHealth.coherent).toBe(true);
    expect(snap.dbHealth.countErrors).toBeUndefined();
  });

  it('skips vec mismatch checks when sqlite-vec is not loaded', async () => {
    const service = new MemoryDiagnosticsService(
      makeLogger(),
      makeSqlite(
        {
          memories: 5,
          memory_chunks: 12,
          memory_chunks_fts: 12,
          code_symbols: 50,
        },
        false,
      ),
      makeCurator(),
      makeWorkspace(),
      makeVecStatus(false),
      makeRetention(),
    );
    const snap = await service.getSnapshot('/ws');
    expect(snap.dbHealth.coherent).toBe(true);
    expect(snap.dbHealth.memory_chunks_vec).toBe(0);
    expect(snap.dbHealth.code_symbols_vec).toBe(0);
  });
});
