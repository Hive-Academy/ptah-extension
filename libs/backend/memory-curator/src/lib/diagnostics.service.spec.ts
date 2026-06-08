import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type {
  SqliteConnectionService,
  SqliteDatabase,
  VecStatusService,
} from '@ptah-extension/persistence-sqlite';
import { MemoryDiagnosticsService } from './diagnostics.service';
import type { MemoryCuratorService } from './memory-curator.service';
import type { MemoryDecayJob } from './memory-decay.job';

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

function makeSqlite(
  counts: Partial<TableCounts>,
  vecLoaded = true,
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
  const db = {
    prepare: jest.fn((sql: string) => ({
      get: jest.fn(() => {
        const match = /FROM (\w+)/.exec(sql);
        if (!match) return { n: 0 };
        const t = match[1] as keyof TableCounts;
        return { n: c[t] ?? 0 };
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

function makeDecay(lastAt: number | null = null): MemoryDecayJob {
  return {
    lastDecayInfo: jest.fn(() => ({
      at: lastAt,
      stats: lastAt
        ? { scanned: 10, demoted: 1, archived: 1, expired: 0 }
        : null,
    })),
  } as unknown as MemoryDecayJob;
}

describe('MemoryDiagnosticsService', () => {
  it('returns last-run/last-decay from underlying services', async () => {
    const t = 1700000000000;
    const service = new MemoryDiagnosticsService(
      makeLogger(),
      makeSqlite({}),
      makeCurator(t, [{ kind: 'curator-run', timestamp: t }]),
      makeDecay(t),
      makeWorkspace(),
      makeVecStatus(true),
    );
    const snap = await service.getSnapshot('/ws');
    expect(snap.lastRunAt).toBe(t);
    expect(snap.lastRunStats).toEqual({
      extracted: 3,
      merged: 1,
      created: 2,
      skipped: 0,
    });
    expect(snap.lastDecayAt).toBe(t);
    expect(snap.lastDecayStats).toEqual({
      scanned: 10,
      demoted: 1,
      archived: 1,
      expired: 0,
    });
    expect(snap.recentEvents).toHaveLength(1);
    expect(snap.triggers.idleMs).toBe(600000);
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
      makeDecay(),
      makeWorkspace(),
      makeVecStatus(true),
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
      makeDecay(),
      makeWorkspace(),
      makeVecStatus(true),
    );
    const snap = await service.getSnapshot('/ws');
    expect(snap.dbHealth.coherent).toBe(false);
    expect(snap.dbHealth.mismatches).toContain('code_symbols/code_symbols_vec');
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
      makeDecay(),
      makeWorkspace(),
      makeVecStatus(false),
    );
    const snap = await service.getSnapshot('/ws');
    expect(snap.dbHealth.coherent).toBe(true);
    expect(snap.dbHealth.memory_chunks_vec).toBe(0);
    expect(snap.dbHealth.code_symbols_vec).toBe(0);
  });
});
