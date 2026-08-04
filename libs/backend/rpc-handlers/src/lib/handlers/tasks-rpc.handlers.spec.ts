/**
 * TasksRpcHandlers — unit specs.
 *
 * Coverage:
 *   METHODS invariant       — exactly the 7 tasks:* names
 *   register()              — wires all 7 methods
 *   tasks:list              — Zod rejection (bad status) → INVALID_PARAMS
 *   tasks:list              — no workspace open → WORKSPACE_NOT_OPEN
 *   tasks:list              — normalizes workspaceRoot before delegating
 *   tasks:board             — groups into six always-present columns
 *   tasks:create            — folder collision surfaces structured error
 *   tasks:list              — sanitizes unexpected errors (no path leakage)
 *   constructor             — broadcasts tasks:changed on index events
 *
 * Source-under-test:
 *   libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.ts
 */
import 'reflect-metadata';
import * as path from 'path';

import type {
  Logger,
  RpcHandler,
  WebviewManager,
} from '@ptah-extension/vscode-core';
import {
  createMockRpcHandler,
  type MockRpcHandler,
} from '@ptah-extension/vscode-core/testing';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  createMockFileSystemProvider,
  createMockWorkspaceProvider,
  type MockFileSystemProvider,
  type MockWorkspaceProvider,
} from '@ptah-extension/platform-core/testing';
import {
  MIGRATIONS,
  type SqliteConnectionService,
} from '@ptah-extension/persistence-sqlite';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import {
  InMemoryTaskIndexStore,
  SqliteTaskIndexStore,
  TaskIndexService,
  TaskScannerService,
  normalizeWorkspaceRoot,
  type ITaskIndexStore,
  type TaskWriterService,
  type RegistryGeneratorService,
  type TaskIndexChangeEvent,
} from '@ptah-extension/task-specs';
import type {
  ExcludedTaskFolder,
  TaskSpecSummary,
} from '@ptah-extension/shared';

import { TasksRpcHandlers } from './tasks-rpc.handlers';

/** Minimal surface of the better-sqlite3 constructor used by these specs. */
interface BetterSqlite3Ctor {
  new (path: string): {
    exec(sql: string): unknown;
    prepare(sql: string): unknown;
    transaction<T extends (...a: unknown[]) => unknown>(fn: T): T;
    close(): void;
  };
}

/** Probe the native binding; null when its ABI does not match this runtime. */
function loadBetterSqlite3(): BetterSqlite3Ctor | null {
  try {
    const Ctor = require('better-sqlite3') as unknown as BetterSqlite3Ctor;
    const probe = new Ctor(':memory:');
    probe.close();
    return Ctor;
  } catch {
    return null;
  }
}

interface FakeIndex {
  onDidChangeIndex: jest.Mock;
  ensureStarted: jest.Mock;
  list: jest.Mock;
  getDetail: jest.Mock;
  reindex: jest.Mock;
  fire: (event: TaskIndexChangeEvent) => void;
}

function createFakeIndex(): FakeIndex {
  let listener: ((e: TaskIndexChangeEvent) => void) | undefined;
  return {
    onDidChangeIndex: jest.fn((l: (e: TaskIndexChangeEvent) => void) => {
      listener = l;
      return { dispose: jest.fn() };
    }),
    ensureStarted: jest.fn().mockResolvedValue(undefined),
    list: jest.fn().mockResolvedValue({
      tasks: [],
      excluded: [],
      excludedCount: 0,
      specsDirExists: true,
    }),
    getDetail: jest.fn().mockResolvedValue(null),
    reindex: jest
      .fn()
      .mockResolvedValue({ indexedCount: 0, excludedCount: 0, durationMs: 1 }),
    fire: (event) => listener?.(event),
  };
}

interface MockWebviewManager {
  broadcastMessage: jest.Mock;
}

interface Suite {
  handlers: TasksRpcHandlers;
  rpc: MockRpcHandler;
  workspace: MockWorkspaceProvider;
  index: FakeIndex;
  writer: { create: jest.Mock; updateStatus: jest.Mock };
  registry: { generate: jest.Mock };
  webviewManager: MockWebviewManager;
  logger: MockLogger;
}

function buildSuite(wsRoot: string | null = 'D:\\workspace'): Suite {
  const logger = createMockLogger();
  const rpc = createMockRpcHandler();
  const workspace = createMockWorkspaceProvider(
    wsRoot ? { folders: [wsRoot] } : { folders: [] },
  );
  if (!wsRoot) workspace.getWorkspaceRoot.mockReturnValue(undefined);
  else workspace.getWorkspaceRoot.mockReturnValue(wsRoot);

  const index = createFakeIndex();
  const writer = {
    create: jest.fn().mockResolvedValue({
      success: true,
      task: { id: 'TASK_2026_200' } as TaskSpecSummary,
    }),
    updateStatus: jest.fn().mockResolvedValue({
      success: true,
      task: { id: 'TASK_2026_200' } as TaskSpecSummary,
    }),
  };
  const registry = {
    generate: jest.fn().mockResolvedValue({
      registryPath: '.ptah/specs/registry.md',
      includedCount: 3,
      excludedCount: 85,
      changed: true,
    }),
  };
  const webviewManager: MockWebviewManager = {
    broadcastMessage: jest.fn().mockResolvedValue(undefined),
  };

  const handlers = new TasksRpcHandlers(
    logger as unknown as Logger,
    rpc as unknown as RpcHandler,
    webviewManager as unknown as WebviewManager,
    workspace as unknown as IWorkspaceProvider,
    index as unknown as TaskIndexService,
    writer as unknown as TaskWriterService,
    registry as unknown as RegistryGeneratorService,
  );
  handlers.register();

  return {
    handlers,
    rpc,
    workspace,
    index,
    writer,
    registry,
    webviewManager,
    logger,
  };
}

function getHandler(
  rpc: MockRpcHandler,
  method: string,
): (params: unknown) => Promise<unknown> {
  const calls = (rpc.registerMethod as jest.Mock).mock.calls as Array<
    [string, (p: unknown) => Promise<unknown>]
  >;
  const match = calls.find(([name]) => name === method);
  if (!match) throw new Error(`Method '${method}' was not registered`);
  return match[1];
}

describe('TasksRpcHandlers.METHODS', () => {
  it('owns exactly the 7 tasks:* methods', () => {
    expect([...TasksRpcHandlers.METHODS]).toEqual([
      'tasks:list',
      'tasks:get',
      'tasks:create',
      'tasks:updateStatus',
      'tasks:generateRegistry',
      'tasks:board',
      'tasks:reindex',
    ]);
  });
});

describe('TasksRpcHandlers.register', () => {
  it('wires all 7 methods into the RpcHandler', () => {
    const { rpc } = buildSuite();
    for (const method of TasksRpcHandlers.METHODS) {
      expect(() => getHandler(rpc, method)).not.toThrow();
    }
  });
});

describe('tasks:list', () => {
  it('rejects an invalid status filter with INVALID_PARAMS', async () => {
    const { rpc } = buildSuite();
    const handler = getHandler(rpc, 'tasks:list');
    await expect(handler({ status: ['not-a-status'] })).rejects.toMatchObject({
      errorCode: 'INVALID_PARAMS',
    });
  });

  it('throws WORKSPACE_NOT_OPEN when no workspace is open', async () => {
    const { rpc } = buildSuite(null);
    const handler = getHandler(rpc, 'tasks:list');
    await expect(handler({})).rejects.toMatchObject({
      errorCode: 'WORKSPACE_NOT_OPEN',
    });
  });

  it('normalizes the workspace root before warming + delegating', async () => {
    const { rpc, index } = buildSuite();
    const handler = getHandler(rpc, 'tasks:list');
    await handler({ workspaceRoot: 'D:\\Workspace\\' });
    const expected = normalizeWorkspaceRoot('D:\\Workspace\\');
    expect(index.ensureStarted).toHaveBeenCalledWith(expected);
    expect(index.list).toHaveBeenCalledWith(
      expected,
      expect.objectContaining({}),
    );
  });

  it('sanitizes unexpected failures (no absolute-path leakage, R4.4)', async () => {
    const { rpc, index } = buildSuite();
    index.list.mockRejectedValue(
      new Error('ENOENT: no such file, open D:\\workspace\\.ptah\\specs'),
    );
    const handler = getHandler(rpc, 'tasks:list');
    const error = await handler({}).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toBe('Failed to list tasks.');
    expect(error?.message).not.toMatch(/ENOENT|\.ptah|D:\\/);
  });
});

describe('tasks:board', () => {
  it('groups tasks into six always-present columns', async () => {
    const { rpc, index } = buildSuite();
    index.list.mockResolvedValueOnce({
      tasks: [
        { status: 'backlog' } as TaskSpecSummary,
        { status: 'done' } as TaskSpecSummary,
        { status: 'done' } as TaskSpecSummary,
      ],
      excluded: [],
      excludedCount: 2,
      specsDirExists: true,
    });
    const handler = getHandler(rpc, 'tasks:board');
    const result = (await handler({})) as {
      columns: Record<string, unknown[]>;
      excludedCount: number;
    };
    expect(Object.keys(result.columns).sort()).toEqual(
      [
        'backlog',
        'blocked',
        'cancelled',
        'done',
        'in_progress',
        'in_review',
      ].sort(),
    );
    expect(result.columns['done']).toHaveLength(2);
    expect(result.columns['backlog']).toHaveLength(1);
    expect(result.columns['in_review']).toHaveLength(0);
    expect(result.excludedCount).toBe(2);
  });
});

// ── tasks:board over a REAL index + REAL stores ──────────────────────────────
//
// The fake index above cannot prove the exclusion rows survive the store
// boundary — that boundary is exactly where they used to be dropped (only
// `excluded_count` was persisted). These cases therefore wire the real
// `TaskScannerService` + `TaskIndexService` over an in-memory filesystem and
// run the SAME assertions against BOTH `ITaskIndexStore` impls, because the DI
// factory picks between them lazily and the user never sees which one won.

const REAL_ROOT = normalizeWorkspaceRoot('D:\\real-ws');

/** Folder name → the carrier content that makes it excluded (or valid). */
const CARRIER_FIXTURES: ReadonlyArray<
  readonly [folder: string, carrier: string | null]
> = [
  ['TASK_2026_001', '---\nstatus: backlog\ntype: FEATURE\ntitle: One\n---\nb'],
  ['TASK_2026_002', '---\nstatus: done\ntype: BUGFIX\ntitle: Two\n---\nb'],
  // no carrier at all — the 12-folder case in this workspace.
  ['TASK_2026_155', null],
  ['TASK_2026_160', null],
  ['VOICE_PROVIDERS', null],
  // carrier present, but the frontmatter cannot yield a task.
  ['TASK_2026_161', 'no frontmatter at all, just prose'],
  ['TASK_2026_162', '---\nstatus: nope\ntype: FEATURE\ntitle: Bad\n---\n'],
  ['TASK_2026_163', '---\nstatus: backlog\ntype: FEATURE\n---\n'],
];

function seedRealWorkspace(fs: MockFileSystemProvider): void {
  const specsDir = path.join(REAL_ROOT, '.ptah', 'specs');
  for (const [folder, carrier] of CARRIER_FIXTURES) {
    const target =
      carrier === null
        ? path.join(specsDir, folder, 'context.md')
        : path.join(specsDir, folder, 'task.md');
    fs.__state.files.set(
      target,
      new TextEncoder().encode(carrier ?? 'agent prose'),
    );
    fs.__state.directories.add(path.join(specsDir, folder).replace(/\\/g, '/'));
  }
  fs.__state.directories.add(specsDir.replace(/\\/g, '/'));
}

function buildRealSuite(store: ITaskIndexStore): {
  rpc: MockRpcHandler;
  dispose: () => void;
} {
  const logger = createMockLogger();
  const rpc = createMockRpcHandler();
  const workspace = createMockWorkspaceProvider({ folders: [REAL_ROOT] });
  workspace.getWorkspaceRoot.mockReturnValue(REAL_ROOT);

  const fs = createMockFileSystemProvider();
  seedRealWorkspace(fs);

  const scanner = new TaskScannerService(fs, logger as unknown as Logger);
  const index = new TaskIndexService(
    logger as unknown as Logger,
    fs,
    scanner,
    store,
  );

  const handlers = new TasksRpcHandlers(
    logger as unknown as Logger,
    rpc as unknown as RpcHandler,
    {
      broadcastMessage: jest.fn().mockResolvedValue(undefined),
    } as unknown as WebviewManager,
    workspace as unknown as IWorkspaceProvider,
    index,
    {
      create: jest.fn(),
      updateStatus: jest.fn(),
    } as unknown as TaskWriterService,
    { generate: jest.fn() } as unknown as RegistryGeneratorService,
  );
  handlers.register();

  return { rpc, dispose: () => index.dispose() };
}

/** Folder names that must appear as exclusions, with their expected reason. */
const EXPECTED_EXCLUSIONS: ReadonlyArray<ExcludedTaskFolder> = [
  { folderName: 'TASK_2026_155', reason: 'no_carrier' },
  { folderName: 'TASK_2026_160', reason: 'no_carrier' },
  { folderName: 'VOICE_PROVIDERS', reason: 'no_carrier' },
  { folderName: 'TASK_2026_161', reason: 'no_frontmatter' },
  { folderName: 'TASK_2026_162', reason: 'invalid_status' },
  { folderName: 'TASK_2026_163', reason: 'missing_title' },
];

function runBoardExclusionContract(makeStore: () => ITaskIndexStore): void {
  it('returns one named row per excluded folder, with its typed reason', async () => {
    const { rpc, dispose } = buildRealSuite(makeStore());
    try {
      const result = (await getHandler(rpc, 'tasks:board')({})) as {
        excluded: ExcludedTaskFolder[];
        excludedCount: number;
        columns: Record<string, unknown[]>;
      };

      expect([...result.excluded].sort(byFolder)).toEqual(
        [...EXPECTED_EXCLUSIONS].sort(byFolder),
      );
      expect(result.excludedCount).toBe(EXPECTED_EXCLUSIONS.length);
      // The valid folders still land on the board — exclusions are additive.
      expect(result.columns['backlog']).toHaveLength(1);
      expect(result.columns['done']).toHaveLength(1);
    } finally {
      dispose();
    }
  });

  it('names every excluded folder rather than only counting them', async () => {
    const { rpc, dispose } = buildRealSuite(makeStore());
    try {
      const result = (await getHandler(rpc, 'tasks:board')({})) as {
        excluded: ExcludedTaskFolder[];
        excludedCount: number;
      };
      expect(result.excluded).toHaveLength(result.excludedCount);
      for (const row of result.excluded) {
        expect(row.folderName.length).toBeGreaterThan(0);
      }
    } finally {
      dispose();
    }
  });
}

function byFolder(a: ExcludedTaskFolder, b: ExcludedTaskFolder): number {
  return a.folderName.localeCompare(b.folderName);
}

describe('tasks:board exclusions — InMemoryTaskIndexStore', () => {
  runBoardExclusionContract(
    () => new InMemoryTaskIndexStore(createMockLogger() as unknown as Logger),
  );
});

describe('tasks:board exclusions — SqliteTaskIndexStore', () => {
  // The native binding may `require` fine yet throw on instantiation when the
  // ABI mismatches — probe it and skip rather than fail the whole suite.
  const Database = loadBetterSqlite3();
  const maybe = Database ? describe : describe.skip;

  maybe(':memory: + migration 0029', () => {
    runBoardExclusionContract(() => {
      const db = new (Database as BetterSqlite3Ctor)(':memory:');
      db.exec(MIGRATIONS.find((m) => m.version === 29)?.sql ?? '');
      return new SqliteTaskIndexStore(
        createMockLogger() as unknown as Logger,
        { db } as unknown as SqliteConnectionService,
      );
    });
  });
});

describe('tasks:create', () => {
  it('surfaces a folder collision as a structured error', async () => {
    const { rpc, writer } = buildSuite();
    writer.create.mockResolvedValueOnce({
      success: false,
      error: { code: 'TASK_FOLDER_EXISTS', message: 'Task folder exists.' },
    });
    const handler = getHandler(rpc, 'tasks:create');
    const result = (await handler({ title: 'X', type: 'FEATURE' })) as {
      success: boolean;
      error?: { code: string };
    };
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('TASK_FOLDER_EXISTS');
  });

  it('rejects a missing title with INVALID_PARAMS', async () => {
    const { rpc } = buildSuite();
    const handler = getHandler(rpc, 'tasks:create');
    await expect(handler({ type: 'FEATURE' })).rejects.toMatchObject({
      errorCode: 'INVALID_PARAMS',
    });
  });
});

describe('tasks:changed broadcast', () => {
  it('rebroadcasts index changes as tasks:changed', () => {
    const { index, webviewManager } = buildSuite();
    index.fire({
      workspaceRoot: 'd:\\workspace',
      reason: 'write',
      folderNames: ['TASK_2026_200'],
    });
    expect(webviewManager.broadcastMessage).toHaveBeenCalledWith(
      'tasks:changed',
      {
        workspaceRoot: 'd:\\workspace',
        reason: 'write',
        folderNames: ['TASK_2026_200'],
      },
    );
  });
});
