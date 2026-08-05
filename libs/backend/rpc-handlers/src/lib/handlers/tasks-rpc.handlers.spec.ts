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
  TaskDoctorService,
  TaskWriterService as TaskWriterServiceClass,
  NoOpTaskIndexNotifier,
  type ITaskIndexStore,
  type TaskWriterService,
  type RegistryGeneratorService,
  type TaskIndexChangeEvent,
} from '@ptah-extension/task-specs';
import type { TasksSettings } from '@ptah-extension/settings-core';
import {
  CARRIER_FILE,
  DEFAULT_TASK_SORT,
  EMPTY_TASK_FILTER,
  MAX_SAVED_TASK_VIEWS,
  buildTaskGraph,
  filterTasks,
} from '@ptah-extension/shared';
import type {
  ExcludedTaskFolder,
  SavedTaskView,
  TaskFilterSpec,
  TaskSpecSummary,
  TasksAdoptResult,
  TasksDoctorPlanResult,
  TasksGetViewsResult,
  TasksListResult,
  TasksSaveViewsResult,
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

/**
 * A `TasksSettings` double backed by a mutable cell per key.
 *
 * Deliberately mirrors `BaseSettingsRepository.handleFor()`'s contract rather
 * than the file store beneath it: `get()` is synchronous and total, `set()` is
 * async. `savedViews.get` is a `jest.Mock` so a test can make the READ throw,
 * which is the "unreadable settings file" case the board must survive.
 */
interface MockTasksSettings {
  savedViews: { get: jest.Mock; set: jest.Mock };
  activeViewId: { get: jest.Mock; set: jest.Mock };
}

function createMockTasksSettings(
  storedViews: unknown[] = [],
  storedActiveViewId = '',
): MockTasksSettings {
  let views = storedViews;
  let activeViewId = storedActiveViewId;
  return {
    savedViews: {
      get: jest.fn(() => views),
      set: jest.fn(async (next: unknown[]) => {
        views = next;
      }),
    },
    activeViewId: {
      get: jest.fn(() => activeViewId),
      set: jest.fn(async (next: string) => {
        activeViewId = next;
      }),
    },
  };
}

/** A valid saved view; overrides let a test bend exactly one field. */
function makeView(overrides: Partial<SavedTaskView> = {}): SavedTaskView {
  return {
    id: 'view-1',
    name: 'In progress',
    filter: EMPTY_TASK_FILTER,
    sort: DEFAULT_TASK_SORT,
    order: 0,
    ...overrides,
  };
}

interface Suite {
  handlers: TasksRpcHandlers;
  rpc: MockRpcHandler;
  workspace: MockWorkspaceProvider;
  index: FakeIndex;
  writer: {
    create: jest.Mock;
    updateStatus: jest.Mock;
    updateMetadata: jest.Mock;
    adoptFolder: jest.Mock;
  };
  registry: { generate: jest.Mock };
  doctor: { plan: jest.Mock; apply: jest.Mock; undo: jest.Mock };
  webviewManager: MockWebviewManager;
  logger: MockLogger;
  tasksSettings: MockTasksSettings;
}

function buildSuite(
  wsRoot: string | null = 'D:\\workspace',
  tasksSettings: MockTasksSettings = createMockTasksSettings(),
): Suite {
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
    updateMetadata: jest.fn().mockResolvedValue({
      success: true,
      task: { id: 'TASK_2026_200' } as TaskSpecSummary,
    }),
    adoptFolder: jest.fn().mockResolvedValue({
      success: true,
      task: { id: 'TASK_2026_155' } as TaskSpecSummary,
    }),
  };
  const doctor = {
    plan: jest.fn().mockResolvedValue({
      ok: true,
      plan: {
        workspaceRoot: 'D:\\workspace',
        contractVersion: 1,
        stampVersion: null,
        actions: [],
        warnings: [],
      },
    }),
    apply: jest.fn(),
    undo: jest.fn(),
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
    doctor as unknown as TaskDoctorService,
    tasksSettings as unknown as TasksSettings,
  );
  handlers.register();

  return {
    handlers,
    rpc,
    workspace,
    index,
    writer,
    registry,
    doctor,
    webviewManager,
    logger,
    tasksSettings,
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
  it('owns exactly the 12 tasks:* methods', () => {
    expect([...TasksRpcHandlers.METHODS]).toEqual([
      'tasks:list',
      'tasks:get',
      'tasks:create',
      'tasks:updateStatus',
      'tasks:updateMetadata',
      'tasks:generateRegistry',
      'tasks:board',
      'tasks:reindex',
      'tasks:adopt',
      'tasks:doctorPlan',
      'tasks:getViews',
      'tasks:saveViews',
    ]);
  });
});

describe('TasksRpcHandlers.register', () => {
  it('wires every method into the RpcHandler', () => {
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
      adoptFolder: jest.fn(),
    } as unknown as TaskWriterService,
    { generate: jest.fn() } as unknown as RegistryGeneratorService,
    {
      plan: jest.fn(),
      apply: jest.fn(),
      undo: jest.fn(),
    } as unknown as TaskDoctorService,
    createMockTasksSettings() as unknown as TasksSettings,
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

  maybe(':memory: + migrations 0029 and 0031', () => {
    runBoardExclusionContract(() => {
      const db = new (Database as BetterSqlite3Ctor)(':memory:');
      // BOTH migrations, in order. 0029 creates `task_specs`; 0031 adds the
      // five metadata columns that `SqliteTaskIndexStore.insertSql()` has
      // written since TASK_2026_181 Batch 1. Seeding from 0029 alone gives this
      // suite a schema no shipped database has ever had, so every insert throws
      // on a missing column and the board comes back empty — which stayed
      // invisible because this block self-skips whenever the native addon's ABI
      // does not match the runner. Same fix, same reason, as
      // `task-index.store.spec.ts`.
      for (const version of [29, 31]) {
        db.exec(MIGRATIONS.find((m) => m.version === version)?.sql ?? '');
      }
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

  /**
   * The five metadata fields reach the writer.
   *
   * `TasksCreateParamsSchema` validated them for a whole batch while this
   * handler mapped its fields explicitly and never listed them — so a
   * `tasks:create` carrying `labels` succeeded and silently discarded them.
   * That is a SILENT failure on a tree with no undo, which is why it is
   * asserted at the call boundary and again, below, against a real carrier.
   */
  it('passes the five metadata fields to the writer', async () => {
    const { rpc, writer } = buildSuite();
    const handler = getHandler(rpc, 'tasks:create');

    await handler({
      title: 'Created with metadata',
      type: 'FEATURE',
      labels: ['licensing', 'needs:design'],
      estimate: 'L',
      parent: 'TASK_2026_300',
      duplicates: ['TASK_2026_310'],
      relatesTo: ['TASK_2026_311'],
    });

    expect(writer.create).toHaveBeenCalledWith(
      normalizeWorkspaceRoot('D:\\workspace'),
      expect.objectContaining({
        labels: ['licensing', 'needs:design'],
        estimate: 'L',
        parent: 'TASK_2026_300',
        duplicates: ['TASK_2026_310'],
        relatesTo: ['TASK_2026_311'],
      }),
    );
  });

  /**
   * The same claim proven end to end against a REAL writer and a real carrier:
   * a mock `create` that merely receives the fields would still be green if the
   * writer dropped them one layer down.
   */
  it('round-trips labels onto the carrier on disk', async () => {
    const wsRoot = normalizeWorkspaceRoot('D:\\workspace');
    const fsMock = createMockFileSystemProvider();
    const logger = createMockLogger();
    const realWriter = new TaskWriterServiceClass(
      fsMock,
      logger as unknown as Logger,
      new NoOpTaskIndexNotifier(),
    );

    const rpc = createMockRpcHandler();
    const workspace = createMockWorkspaceProvider({ folders: [wsRoot] });
    workspace.getWorkspaceRoot.mockReturnValue(wsRoot);
    const handlers = new TasksRpcHandlers(
      logger as unknown as Logger,
      rpc as unknown as RpcHandler,
      { broadcastMessage: jest.fn() } as unknown as WebviewManager,
      workspace as unknown as IWorkspaceProvider,
      createFakeIndex() as unknown as TaskIndexService,
      realWriter,
      { generate: jest.fn() } as unknown as RegistryGeneratorService,
      { plan: jest.fn() } as unknown as TaskDoctorService,
      createMockTasksSettings() as unknown as TasksSettings,
    );
    handlers.register();

    const result = (await getHandler(
      rpc,
      'tasks:create',
    )({
      title: 'Created with metadata',
      type: 'FEATURE',
      labels: ['licensing', 'needs:design'],
      estimate: 'L',
    })) as { success: boolean; task?: TaskSpecSummary };

    expect(result.success).toBe(true);
    expect(result.task?.labels).toEqual(['licensing', 'needs:design']);
    expect(result.task?.estimate).toBe('L');

    const carrier = path.join(
      wsRoot,
      '.ptah',
      'specs',
      result.task?.id ?? '',
      // Never a filename literal — every per-task name flows from the contract
      // module, which is what the `.ptah/specs` ratchet enforces (BR-7).
      CARRIER_FILE,
    );
    const raw = new TextDecoder().decode(
      fsMock.__state.files.get(carrier) as Uint8Array,
    );
    expect(raw).toContain('labels:');
    expect(raw).toContain('needs:design');
    expect(raw).toContain('estimate: L');
  });
});

// ---------------------------------------------------------------------------
// tasks:updateMetadata (TASK_2026_181)
// ---------------------------------------------------------------------------

describe('tasks:updateMetadata', () => {
  it('delegates the whole patch to the writer', async () => {
    const { rpc, writer } = buildSuite();

    const result = (await getHandler(
      rpc,
      'tasks:updateMetadata',
    )({
      taskId: 'TASK_2026_181',
      patch: { labels: ['licensing'], estimate: 'M' },
    })) as { success: boolean };

    expect(result.success).toBe(true);
    expect(writer.updateMetadata).toHaveBeenCalledWith(
      normalizeWorkspaceRoot('D:\\workspace'),
      'TASK_2026_181',
      { labels: ['licensing'], estimate: 'M' },
    );
  });

  it('forwards a removal (null / []) rather than dropping it', async () => {
    const { rpc, writer } = buildSuite();

    await getHandler(
      rpc,
      'tasks:updateMetadata',
    )({
      taskId: 'TASK_2026_181',
      patch: { estimate: null, labels: [] },
    });

    // `[]` and `null` are the REMOVE signals. A handler that stripped falsy
    // values would turn "clear my labels" into a no-op.
    expect(writer.updateMetadata).toHaveBeenCalledWith(
      normalizeWorkspaceRoot('D:\\workspace'),
      'TASK_2026_181',
      { estimate: null, labels: [] },
    );
  });

  it('surfaces TASK_CONFLICT as a structured error', async () => {
    const { rpc, writer } = buildSuite();
    writer.updateMetadata.mockResolvedValueOnce({
      success: false,
      error: { code: 'TASK_CONFLICT', message: 'changed on disk' },
    });

    const result = (await getHandler(
      rpc,
      'tasks:updateMetadata',
    )({ taskId: 'TASK_2026_181', patch: { status: 'done' } })) as {
      success: boolean;
      error?: { code: string };
    };

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('TASK_CONFLICT');
  });

  it('rejects a patch that changes nothing, before reaching the writer', async () => {
    const { rpc, writer } = buildSuite();

    await expect(
      getHandler(
        rpc,
        'tasks:updateMetadata',
      )({
        taskId: 'TASK_2026_181',
        patch: {},
      }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(writer.updateMetadata).not.toHaveBeenCalled();
  });

  it.each([
    ['a newline inside a label', { labels: ['multi\nline'] }],
    ['a label over 32 characters', { labels: ['x'.repeat(33)] }],
    [
      'more than 12 labels',
      { labels: Array.from({ length: 13 }, (_v, i) => `label-${i}`) },
    ],
    ['an unrecognised estimate', { estimate: 'Medium' }],
  ] as const)('rejects %s with INVALID_PARAMS', async (_label, patch) => {
    const { rpc, writer } = buildSuite();

    await expect(
      getHandler(
        rpc,
        'tasks:updateMetadata',
      )({
        taskId: 'TASK_2026_181',
        patch,
      }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(writer.updateMetadata).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The shared single-path-segment guard, on every tasks: write boundary
// ---------------------------------------------------------------------------

/**
 * Every shape that must NOT survive as a task id or folder name. Mirrors the
 * `REJECTED_PARENTS` table in `task-specs`' `contract.guard.spec.ts` — these
 * guards decide the same question about the same class of value, and the whole
 * reason they were unified onto one implementation is that they used to
 * disagree. Everything below except the four leading-separator/traversal-path
 * shapes was accepted by the previous local checks.
 */
const REJECTED_IDS: ReadonlyArray<[label: string, value: string]> = [
  ['a traversal token', '..'],
  ['a PADDED traversal token', ' .. '],
  ['a current-directory token', '.'],
  ['a relative path', '../TASK_2026_100'],
  ['a backslash-separated path', '..\\TASK_2026_100'],
  ['an absolute POSIX path', '/etc/passwd'],
  ['an absolute Windows path', 'C:\\Windows\\System32'],
  ['a bare Windows drive letter', 'C:'],
  ['a drive-RELATIVE Windows path', 'C:TASK_2026_100'],
  ['an NTFS alternate-data-stream name', 'TASK_2026_100:stream'],
  ['an embedded NUL', 'TASK_2026_100\u0000'],
  ['whitespace only', '   '],
];

describe('tasks: path-segment guard', () => {
  it.each(REJECTED_IDS)(
    'tasks:updateMetadata rejects %s as a taskId, writing nothing',
    async (_label, value) => {
      const { rpc, writer } = buildSuite();
      await expect(
        getHandler(
          rpc,
          'tasks:updateMetadata',
        )({
          taskId: value,
          patch: { status: 'done' },
        }),
      ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
      expect(writer.updateMetadata).not.toHaveBeenCalled();
    },
  );

  it.each(REJECTED_IDS)(
    'tasks:updateStatus rejects %s as a taskId, writing nothing',
    async (_label, value) => {
      const { rpc, writer } = buildSuite();
      await expect(
        getHandler(
          rpc,
          'tasks:updateStatus',
        )({
          taskId: value,
          status: 'done',
        }),
      ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
      expect(writer.updateStatus).not.toHaveBeenCalled();
    },
  );

  it.each(REJECTED_IDS)(
    'tasks:adopt rejects %s as a folderName, writing nothing',
    async (_label, value) => {
      const { rpc, writer } = buildSuite();
      await expect(
        getHandler(
          rpc,
          'tasks:adopt',
        )({
          folderName: value,
          title: 'T',
          type: 'FEATURE',
          status: 'done',
        }),
      ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
      expect(writer.adoptFolder).not.toHaveBeenCalled();
    },
  );

  it.each(REJECTED_IDS)(
    'tasks:create rejects %s as a parent, writing nothing',
    async (_label, value) => {
      const { rpc, writer } = buildSuite();
      await expect(
        getHandler(
          rpc,
          'tasks:create',
        )({
          title: 'T',
          type: 'FEATURE',
          parent: value,
        }),
      ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
      expect(writer.create).not.toHaveBeenCalled();
    },
  );

  it.each(REJECTED_IDS)(
    'tasks:updateMetadata rejects %s inside a relation array',
    async (_label, value) => {
      const { rpc, writer } = buildSuite();
      await expect(
        getHandler(
          rpc,
          'tasks:updateMetadata',
        )({
          taskId: 'TASK_2026_181',
          patch: { relatesTo: [value] },
        }),
      ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
      expect(writer.updateMetadata).not.toHaveBeenCalled();
    },
  );

  it('still accepts an ordinary folder name on every boundary', async () => {
    const { rpc, writer } = buildSuite();
    await getHandler(
      rpc,
      'tasks:updateMetadata',
    )({
      taskId: 'TASK_2026_181',
      patch: { status: 'done' },
    });
    await getHandler(
      rpc,
      'tasks:updateStatus',
    )({
      taskId: 'TASK_2026_181',
      status: 'done',
    });
    await getHandler(
      rpc,
      'tasks:adopt',
    )({
      folderName: 'TASK_2026_181',
      title: 'T',
      type: 'FEATURE',
      status: 'done',
    });
    expect(writer.updateMetadata).toHaveBeenCalled();
    expect(writer.updateStatus).toHaveBeenCalled();
    expect(writer.adoptFolder).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// tasks:adopt (TASK_2026_179, step 18)
// ---------------------------------------------------------------------------

describe('tasks:adopt', () => {
  it('delegates to adoptFolder with the folder name as the canonical id', async () => {
    const { rpc, writer } = buildSuite();
    const handler = getHandler(rpc, 'tasks:adopt');
    const result = (await handler({
      folderName: 'TASK_2026_155',
      title: 'Recovered work',
      type: 'FEATURE',
      status: 'done',
      statusInferred: true,
    })) as TasksAdoptResult;

    expect(result.success).toBe(true);
    expect(writer.adoptFolder).toHaveBeenCalledWith(
      normalizeWorkspaceRoot('D:\\workspace'),
      'TASK_2026_155',
      expect.objectContaining({
        title: 'Recovered work',
        type: 'FEATURE',
        status: 'done',
        statusInferred: true,
      }),
    );
  });

  /**
   * The load-bearing case. Adoption onto an occupied folder must come back as a
   * typed refusal — NOT as a freshly allocated id, and NOT as an overwrite. A
   * silent re-allocation would leave two folders claiming one task, which is
   * exactly the failure this task set exists to remove.
   */
  it('returns a typed CARRIER_EXISTS error instead of allocating a new id', async () => {
    const { rpc, writer } = buildSuite();
    writer.adoptFolder.mockResolvedValue({
      success: false,
      error: {
        code: 'CARRIER_EXISTS',
        message: 'Folder already has a carrier; adoption aborted.',
      },
    });

    const handler = getHandler(rpc, 'tasks:adopt');
    const result = (await handler({
      folderName: 'TASK_2026_155',
      title: 'Recovered work',
      type: 'FEATURE',
      status: 'backlog',
    })) as TasksAdoptResult;

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('CARRIER_EXISTS');
    expect(result.task).toBeUndefined();
    // No id was minted: `create` is the only allocator path and it stayed untouched.
    expect(writer.create).not.toHaveBeenCalled();
  });

  it('rejects a folderName that escapes the spec root', async () => {
    const { rpc, writer } = buildSuite();
    const handler = getHandler(rpc, 'tasks:adopt');
    await expect(
      handler({
        folderName: '../../etc',
        title: 'Escape',
        type: 'FEATURE',
        status: 'backlog',
      }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(writer.adoptFolder).not.toHaveBeenCalled();
  });

  it('rejects a missing status with INVALID_PARAMS', async () => {
    const { rpc } = buildSuite();
    const handler = getHandler(rpc, 'tasks:adopt');
    await expect(
      handler({ folderName: 'TASK_2026_155', title: 'x', type: 'FEATURE' }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
  });
});

// ---------------------------------------------------------------------------
// tasks:doctorPlan (TASK_2026_179, step 18) — READ-ONLY
// ---------------------------------------------------------------------------

describe('tasks:doctorPlan', () => {
  it('reduces rename paths to bare filenames (no absolute-path leakage, R4.4)', async () => {
    const { rpc, doctor } = buildSuite();
    doctor.plan.mockResolvedValue({
      ok: true,
      plan: {
        workspaceRoot: 'D:\\workspace',
        contractVersion: 1,
        stampVersion: null,
        actions: [
          {
            kind: 'renameLegacyBatches',
            folderName: 'TASK_2026_155',
            from: path.join('D:', 'workspace', '.ptah', 'specs', 'x', 'a.md'),
            to: path.join('D:', 'workspace', '.ptah', 'specs', 'x', 'b.md'),
          },
        ],
        warnings: [],
      },
    });

    const handler = getHandler(rpc, 'tasks:doctorPlan');
    const result = (await handler({})) as TasksDoctorPlanResult;

    expect(result.ok).toBe(true);
    expect(result.plan?.actions[0]).toEqual({
      kind: 'renameLegacyBatches',
      folderName: 'TASK_2026_155',
      from: 'a.md',
      to: 'b.md',
    });
    expect(JSON.stringify(result)).not.toContain('workspace');
  });

  it('surfaces a fail-closed stamp refusal as a typed error', async () => {
    const { rpc, doctor } = buildSuite();
    doctor.plan.mockResolvedValue({
      ok: false,
      error: { code: 'STAMP_UNREADABLE', message: 'stamp is corrupt' },
    });

    const handler = getHandler(rpc, 'tasks:doctorPlan');
    const result = (await handler({})) as TasksDoctorPlanResult;
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('STAMP_UNREADABLE');
    expect(result.plan).toBeUndefined();
  });

  /**
   * The acceptance test for step 18: a plan is only a plan.
   *
   * Runs the REAL `TaskDoctorService` and the REAL `TaskWriterService` against a
   * seeded in-memory filesystem, so this asserts the behaviour of the shipping
   * code rather than of a stub. Two distinct things are checked:
   *
   *   1. No mutating filesystem call happened at all.
   *   2. `index.ensureStarted` was NOT called. That is the easy regression:
   *      every other method in this class calls it, and it writes
   *      `.ptah/specs/README.md` when the hash differs — warming the index here
   *      would make the read-only method mutate the directory it reports on.
   */
  it('performs ZERO writes against a real doctor over a seeded tree', async () => {
    const wsRoot = normalizeWorkspaceRoot('D:\\workspace');
    const fsMock = createMockFileSystemProvider();
    const specsDir = path.join(wsRoot, '.ptah', 'specs');

    // A carrier-less folder (an adoption candidate) carrying a completion
    // artifact, plus a legacy batch breakdown to rename. Seeding via `writeFile`
    // rather than by touching `__state.directories` directly: the mock registers
    // the whole parent chain on write, and a pre-added leaf directory would
    // short-circuit that walk and leave `.ptah/specs` itself unregistered.
    await fsMock.writeFile(
      path.join(specsDir, 'TASK_2026_155', 'test-report.md'),
      '# report',
    );
    await fsMock.writeFile(
      path.join(specsDir, 'TASK_2026_155', 'tasks.md'),
      '# batches',
    );

    const logger = createMockLogger();
    const realWriter = new TaskWriterServiceClass(
      fsMock,
      logger as unknown as Logger,
      new NoOpTaskIndexNotifier(),
    );
    const realDoctor = new TaskDoctorService(
      fsMock,
      logger as unknown as Logger,
      realWriter,
    );

    const rpc = createMockRpcHandler();
    const workspace = createMockWorkspaceProvider({ folders: [wsRoot] });
    workspace.getWorkspaceRoot.mockReturnValue(wsRoot);
    const index = createFakeIndex();
    const handlers = new TasksRpcHandlers(
      logger as unknown as Logger,
      rpc as unknown as RpcHandler,
      { broadcastMessage: jest.fn() } as unknown as WebviewManager,
      workspace as unknown as IWorkspaceProvider,
      index as unknown as TaskIndexService,
      realWriter,
      { generate: jest.fn() } as unknown as RegistryGeneratorService,
      realDoctor,
      createMockTasksSettings() as unknown as TasksSettings,
    );
    handlers.register();

    // Seeding used the mock's own writes — clear them so the assertion below
    // measures only what the handler itself did.
    fsMock.writeFile.mockClear();
    fsMock.writeFileBytes.mockClear();
    fsMock.delete.mockClear();
    fsMock.createDirectory.mockClear();
    fsMock.createDirectoryExclusive.mockClear();

    const snapshot = new Map(fsMock.__state.files);

    const result = (await getHandler(
      rpc,
      'tasks:doctorPlan',
    )({})) as TasksDoctorPlanResult;

    expect(result.ok).toBe(true);
    // It found real work to propose — otherwise "zero writes" would be vacuous.
    expect(result.plan?.actions.length).toBeGreaterThan(0);

    expect(fsMock.writeFile).not.toHaveBeenCalled();
    expect(fsMock.writeFileBytes).not.toHaveBeenCalled();
    expect(fsMock.delete).not.toHaveBeenCalled();
    expect(fsMock.createDirectory).not.toHaveBeenCalled();
    expect(fsMock.createDirectoryExclusive).not.toHaveBeenCalled();
    expect(index.ensureStarted).not.toHaveBeenCalled();

    // Byte-for-byte: the tree is exactly what it was.
    expect([...fsMock.__state.files.keys()].sort()).toEqual(
      [...snapshot.keys()].sort(),
    );
    for (const [key, bytes] of snapshot) {
      expect(fsMock.__state.files.get(key)).toEqual(bytes);
    }
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

// ── FR-C1.5 — the parity block ───────────────────────────────────────────────
//
// The claim under test is that there is exactly ONE filter predicate. That is
// only checkable end to end: `filterTasks` is asserted against `tasks:list`
// over the SAME fixture and the SAME spec, and the two must return an identical
// id list — same members, same order.
//
// The client side of each case is computed the way the board computes it (plan
// §6.1): `filterTasks(allTasks, spec, buildTaskGraph(allTasks))` over the full,
// unfiltered listing. The server side is a real handler over a real scanner,
// index and store. Nothing here re-implements a comparison; if anybody adds a
// second predicate on either side, these cases stop agreeing.

const PARITY_ROOT = normalizeWorkspaceRoot('D:\\parity-ws');

/**
 * Eight carriers exercising every facet at once.
 *
 * `TASK_2026_301` is the parent; `302`/`303` are its children; `304` claims a
 * parent that does not exist (so it is standalone in the graph while still
 * carrying a `parent` string); `305` duplicates `301`; `306` depends on the
 * unfinished `301`; `307` depends only on the finished `303`; `308` carries an
 * unrecognised estimate, so it lands with a validation issue and no size.
 */
const PARITY_CARRIERS: ReadonlyArray<readonly [folder: string, body: string]> =
  [
    [
      'TASK_2026_301',
      [
        '---',
        'status: in_progress',
        'type: FEATURE',
        'title: Filter bar',
        'description: the multi-axis filter surface',
        'executor: backend-developer',
        'labels: [Licensing, ui]',
        'estimate: L',
        'created: 2026-08-01T00:00:00.000Z',
        'updated: 2026-08-05T00:00:00.000Z',
        '---',
        'body',
      ].join('\n'),
    ],
    [
      'TASK_2026_302',
      [
        '---',
        'status: backlog',
        'type: BUGFIX',
        'title: Chip contrast',
        'executor: frontend-developer',
        'labels: [licensing]',
        'estimate: XS',
        'parent: TASK_2026_301',
        'created: 2026-08-02T00:00:00.000Z',
        'updated: 2026-08-04T00:00:00.000Z',
        '---',
        'body',
      ].join('\n'),
    ],
    [
      'TASK_2026_303',
      [
        '---',
        'status: done',
        'type: FEATURE',
        'title: Sort order',
        'labels: [ui]',
        'parent: TASK_2026_301',
        'created: 2026-08-03T00:00:00.000Z',
        'updated: 2026-08-03T00:00:00.000Z',
        '---',
        'body',
      ].join('\n'),
    ],
    [
      'TASK_2026_304',
      [
        '---',
        'status: blocked',
        'type: RESEARCH',
        'title: Vanished parent',
        'parent: TASK_2026_999',
        'estimate: XL',
        'created: 2026-08-04T00:00:00.000Z',
        'updated: 2026-08-02T00:00:00.000Z',
        '---',
        'body',
      ].join('\n'),
    ],
    [
      'TASK_2026_305',
      [
        '---',
        'status: cancelled',
        'type: FEATURE',
        'title: Duplicate of the filter bar',
        'duplicates: [TASK_2026_301]',
        'created: 2026-08-05T00:00:00.000Z',
        'updated: 2026-08-01T00:00:00.000Z',
        '---',
        'body',
      ].join('\n'),
    ],
    [
      'TASK_2026_306',
      [
        '---',
        'status: in_review',
        'type: DEVOPS',
        'title: Waiting on the filter bar',
        'depends_on: [TASK_2026_301]',
        'executor: backend-developer',
        'estimate: M',
        'created: 2026-08-06T00:00:00.000Z',
        'updated: 2026-08-06T00:00:00.000Z',
        '---',
        'body',
      ].join('\n'),
    ],
    [
      'TASK_2026_307',
      [
        '---',
        'status: backlog',
        'type: DOCUMENTATION',
        'title: Document the LICENSING facet',
        'depends_on: [TASK_2026_303]',
        'labels: [" Licensing "]',
        'estimate: S',
        'created: 2026-08-07T00:00:00.000Z',
        'updated: 2026-08-07T00:00:00.000Z',
        '---',
        'body',
      ].join('\n'),
    ],
    [
      'TASK_2026_308',
      [
        '---',
        'status: backlog',
        'type: CREATIVE',
        'title: Bad size',
        'estimate: HUGE',
        'created: 2026-08-08T00:00:00.000Z',
        'updated: 2026-08-08T00:00:00.000Z',
        '---',
        'body',
      ].join('\n'),
    ],
  ];

function seedParityWorkspace(fs: MockFileSystemProvider): void {
  const specsDir = path.join(PARITY_ROOT, '.ptah', 'specs');
  for (const [folder, carrier] of PARITY_CARRIERS) {
    fs.__state.files.set(
      path.join(specsDir, folder, 'task.md'),
      new TextEncoder().encode(carrier),
    );
    fs.__state.directories.add(path.join(specsDir, folder).replace(/\\/g, '/'));
  }
  fs.__state.directories.add(specsDir.replace(/\\/g, '/'));
}

function buildParitySuite(store: ITaskIndexStore): {
  rpc: MockRpcHandler;
  dispose: () => void;
} {
  const logger = createMockLogger();
  const rpc = createMockRpcHandler();
  const workspace = createMockWorkspaceProvider({ folders: [PARITY_ROOT] });
  workspace.getWorkspaceRoot.mockReturnValue(PARITY_ROOT);

  const fs = createMockFileSystemProvider();
  seedParityWorkspace(fs);

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
      updateMetadata: jest.fn(),
      adoptFolder: jest.fn(),
    } as unknown as TaskWriterService,
    { generate: jest.fn() } as unknown as RegistryGeneratorService,
    {
      plan: jest.fn(),
      apply: jest.fn(),
      undo: jest.fn(),
    } as unknown as TaskDoctorService,
    createMockTasksSettings() as unknown as TasksSettings,
  );
  handlers.register();

  return { rpc, dispose: () => index.dispose() };
}

/** Every facet, exercised alone and then in combination. */
const PARITY_CASES: ReadonlyArray<
  readonly [name: string, spec: TaskFilterSpec]
> = [
  ['the neutral spec', { ...EMPTY_TASK_FILTER }],
  ['free text over title', { ...EMPTY_TASK_FILTER, text: 'licensing' }],
  ['free text over id', { ...EMPTY_TASK_FILTER, text: '2026_306' }],
  [
    'free text that is regex syntax, matching nothing on both sides',
    { ...EMPTY_TASK_FILTER, text: '(a+)+$' },
  ],
  [
    'status, OR-within',
    { ...EMPTY_TASK_FILTER, statuses: ['backlog', 'done'] },
  ],
  ['type', { ...EMPTY_TASK_FILTER, types: ['FEATURE'] }],
  [
    'labels ANY, matched on labelKey',
    { ...EMPTY_TASK_FILTER, labels: ['LICENSING'], labelsMode: 'any' },
  ],
  [
    'labels ALL',
    { ...EMPTY_TASK_FILTER, labels: ['licensing', 'ui'], labelsMode: 'all' },
  ],
  ['estimates', { ...EMPTY_TASK_FILTER, estimates: ['XS', 'L'] }],
  ['unestimated', { ...EMPTY_TASK_FILTER, unestimated: true }],
  [
    'estimates OR unestimated',
    { ...EMPTY_TASK_FILTER, estimates: ['M'], unestimated: true },
  ],
  ['executor', { ...EMPTY_TASK_FILTER, executors: ['backend-developer'] }],
  ['parentage: parent', { ...EMPTY_TASK_FILTER, parentage: ['parent'] }],
  ['parentage: child', { ...EMPTY_TASK_FILTER, parentage: ['child'] }],
  [
    'parentage: standalone, including an unhonoured claim',
    { ...EMPTY_TASK_FILTER, parentage: ['standalone'] },
  ],
  [
    // The card's rollup click (FR-B3.3). It travels as a facet on the SAME
    // spec, so the board and `tasks:list` answer it with the same predicate —
    // which is the whole reason it is not a `.filter()` beside the handler.
    'childrenOf: the parent rollup click',
    { ...EMPTY_TASK_FILTER, childrenOf: ['TASK_2026_301'] },
  ],
  [
    'relations: unmet dependencies',
    { ...EMPTY_TASK_FILTER, relations: ['unmet_dependencies'] },
  ],
  ['relations: duplicate', { ...EMPTY_TASK_FILTER, relations: ['duplicate'] }],
  ['validation issues', { ...EMPTY_TASK_FILTER, hasValidationIssues: true }],
  [
    'every facet at once',
    {
      ...EMPTY_TASK_FILTER,
      text: 'filter',
      statuses: ['in_progress'],
      types: ['FEATURE'],
      labels: ['licensing'],
      labelsMode: 'any',
      estimates: ['L'],
      executors: ['backend-developer'],
      parentage: ['parent'],
    },
  ],
  [
    'a combination that matches nothing',
    { ...EMPTY_TASK_FILTER, statuses: ['done'], estimates: ['XL'] },
  ],
];

/** The cases that are deliberately at an extreme of the fixture. */
const NON_DISCRIMINATING = new Set([
  'the neutral spec',
  'free text that is regex syntax, matching nothing on both sides',
  'a combination that matches nothing',
]);

function runFilterParityContract(makeStore: () => ITaskIndexStore): void {
  /** The unfiltered listing — the exact payload the board holds client-side. */
  async function loadAllTasks(rpc: MockRpcHandler): Promise<TaskSpecSummary[]> {
    const result = (await getHandler(rpc, 'tasks:list')({})) as TasksListResult;
    return result.tasks;
  }

  async function listIds(
    rpc: MockRpcHandler,
    params: Record<string, unknown>,
  ): Promise<string[]> {
    const result = (await getHandler(
      rpc,
      'tasks:list',
    )(params)) as TasksListResult;
    return result.tasks.map((task) => task.id);
  }

  it('indexes the whole parity fixture', async () => {
    const { rpc, dispose } = buildParitySuite(makeStore());
    try {
      const all = await loadAllTasks(rpc);
      expect(all.map((task) => task.id).sort()).toEqual(
        PARITY_CARRIERS.map(([folder]) => folder).sort(),
      );
    } finally {
      dispose();
    }
  });

  it.each(PARITY_CASES)(
    'returns an identical id list from filterTasks and tasks:list — %s',
    async (name, spec) => {
      const { rpc, dispose } = buildParitySuite(makeStore());
      try {
        const all = await loadAllTasks(rpc);
        const clientSide = filterTasks(all, spec, buildTaskGraph(all)).map(
          (task) => task.id,
        );
        const serverSide = await listIds(rpc, { filter: spec });

        expect(serverSide).toEqual(clientSide);
        // A case that matches everything, or nothing, proves nothing about the
        // predicate — so the fixture is asserted to be discriminating.
        if (!NON_DISCRIMINATING.has(name)) {
          expect(clientSide.length).toBeGreaterThan(0);
          expect(clientSide.length).toBeLessThan(PARITY_CARRIERS.length);
        }
      } finally {
        dispose();
      }
    },
  );

  it('folds the legacy status list into the same facet', async () => {
    const { rpc, dispose } = buildParitySuite(makeStore());
    try {
      const all = await loadAllTasks(rpc);
      const viaLegacy = await listIds(rpc, { status: ['backlog', 'done'] });
      const viaSpec = filterTasks(all, {
        ...EMPTY_TASK_FILTER,
        statuses: ['backlog', 'done'],
      }).map((task) => task.id);
      expect(viaLegacy).toEqual(viaSpec);
      expect(viaLegacy.length).toBeGreaterThan(0);
    } finally {
      dispose();
    }
  });

  it('ANDs the legacy type list with a spec constraining other facets', async () => {
    const { rpc, dispose } = buildParitySuite(makeStore());
    try {
      const all = await loadAllTasks(rpc);
      const spec: TaskFilterSpec = {
        ...EMPTY_TASK_FILTER,
        labels: ['ui'],
        labelsMode: 'any',
      };
      const serverSide = await listIds(rpc, {
        type: ['FEATURE'],
        filter: spec,
      });
      const clientSide = filterTasks(all, { ...spec, types: ['FEATURE'] }).map(
        (task) => task.id,
      );
      expect(serverSide).toEqual(clientSide);
      expect(serverSide.length).toBeGreaterThan(0);
    } finally {
      dispose();
    }
  });

  it('returns nothing when the legacy list and the spec contradict', async () => {
    const { rpc, dispose } = buildParitySuite(makeStore());
    try {
      const ids = await listIds(rpc, {
        status: ['backlog'],
        filter: { ...EMPTY_TASK_FILTER, statuses: ['done'] },
      });
      // The empty intersection is NOT written back as `[]` — that would read as
      // "no constraint" and hand back every task.
      expect(ids).toEqual([]);
    } finally {
      dispose();
    }
  });

  it('completes a PARTIAL filter with the neutral defaults', async () => {
    const { rpc, dispose } = buildParitySuite(makeStore());
    try {
      const all = await loadAllTasks(rpc);
      const serverSide = await listIds(rpc, { filter: { unestimated: true } });
      const clientSide = filterTasks(all, {
        ...EMPTY_TASK_FILTER,
        unestimated: true,
      }).map((task) => task.id);
      expect(serverSide).toEqual(clientSide);
      expect(serverSide.length).toBeGreaterThan(0);
    } finally {
      dispose();
    }
  });

  it('rejects a malformed filter rather than ignoring it', async () => {
    const { rpc, dispose } = buildParitySuite(makeStore());
    try {
      await expect(
        getHandler(rpc, 'tasks:list')({ filter: { labelsMode: 'either' } }),
      ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    } finally {
      dispose();
    }
  });
}

describe('tasks:list filter parity (FR-C1.5) — InMemoryTaskIndexStore', () => {
  runFilterParityContract(
    () => new InMemoryTaskIndexStore(createMockLogger() as unknown as Logger),
  );
});

describe('tasks:list filter parity (FR-C1.5) — SqliteTaskIndexStore', () => {
  const Database = loadBetterSqlite3();
  const maybe = Database ? describe : describe.skip;

  maybe(':memory: + migrations 0029 and 0031', () => {
    runFilterParityContract(() => {
      const db = new (Database as BetterSqlite3Ctor)(':memory:');
      // 0031 adds the five metadata columns the parity fixture exercises, so
      // both are applied — 0029 alone cannot hold `labels` or `estimate`.
      for (const version of [29, 31]) {
        db.exec(MIGRATIONS.find((m) => m.version === version)?.sql ?? '');
      }
      return new SqliteTaskIndexStore(
        createMockLogger() as unknown as Logger,
        { db } as unknown as SqliteConnectionService,
      );
    });
  });
});

// ---------------------------------------------------------------------------
// tasks:getViews / tasks:saveViews — saved board views (FR-C2)
// ---------------------------------------------------------------------------

describe('tasks:getViews', () => {
  it('returns the stored views with skipped: 0 when all of them parse', async () => {
    const stored = [
      makeView({ id: 'a', order: 0 }),
      makeView({ id: 'b', order: 1 }),
    ];
    const { rpc } = buildSuite(
      'D:\\workspace',
      createMockTasksSettings(stored, 'b'),
    );

    const result = (await getHandler(
      rpc,
      'tasks:getViews',
    )({})) as TasksGetViewsResult;

    expect(result.views.map((v) => v.id)).toEqual(['a', 'b']);
    expect(result.activeViewId).toBe('b');
    expect(result.skipped).toBe(0);
  });

  /**
   * The BR-4 / F4 behaviour, asserted end to end.
   *
   * This is the case a strict per-item schema in settings-core would have
   * turned into ZERO surviving views: `handleFor()` safeParses the WHOLE array
   * and falls back to its default, so one bad entry would have discarded the
   * good one alongside it. Here the good view survives and the two bad entries
   * are counted rather than hidden.
   */
  it('skips malformed entries, keeps the rest, and reports how many it dropped', async () => {
    const good = makeView({ id: 'keeper' });
    const { rpc, logger } = buildSuite(
      'D:\\workspace',
      createMockTasksSettings([good, 42, { bad: 1 }]),
    );

    const result = (await getHandler(
      rpc,
      'tasks:getViews',
    )({})) as TasksGetViewsResult;

    expect(result.views).toHaveLength(1);
    expect(result.views[0].id).toBe('keeper');
    expect(result.skipped).toBe(2);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('renders an empty board rather than throwing when the store cannot be read', async () => {
    const settings = createMockTasksSettings();
    settings.savedViews.get.mockImplementation(() => {
      throw new Error('EACCES: permission denied, open settings.json');
    });
    const { rpc } = buildSuite('D:\\workspace', settings);

    const result = (await getHandler(
      rpc,
      'tasks:getViews',
    )({})) as TasksGetViewsResult;

    expect(result).toEqual({ views: [], activeViewId: null, skipped: 0 });
  });

  it('survives an active-view-id read that throws', async () => {
    const settings = createMockTasksSettings([makeView({ id: 'a' })]);
    settings.activeViewId.get.mockImplementation(() => {
      throw new Error('EACCES');
    });
    const { rpc } = buildSuite('D:\\workspace', settings);

    const result = (await getHandler(
      rpc,
      'tasks:getViews',
    )({})) as TasksGetViewsResult;

    expect(result.views).toHaveLength(1);
    expect(result.activeViewId).toBeNull();
  });

  it('reports nothing skipped when the store held no readable array at all', async () => {
    // `z.array(z.unknown())` rejects a non-array whole value, so `handleFor`
    // hands back the definition default. Nothing was parseable, so nothing was
    // SKIPPED — an empty list is not two dropped views.
    const { rpc } = buildSuite('D:\\workspace', createMockTasksSettings([]));

    const result = (await getHandler(
      rpc,
      'tasks:getViews',
    )({})) as TasksGetViewsResult;

    expect(result).toEqual({ views: [], activeViewId: null, skipped: 0 });
  });

  it('sorts by order, not by stored array position', async () => {
    const stored = [
      makeView({ id: 'third', order: 2 }),
      makeView({ id: 'first', order: 0 }),
      makeView({ id: 'second', order: 1 }),
    ];
    const { rpc } = buildSuite(
      'D:\\workspace',
      createMockTasksSettings(stored),
    );

    const result = (await getHandler(
      rpc,
      'tasks:getViews',
    )({})) as TasksGetViewsResult;

    expect(result.views.map((v) => v.id)).toEqual(['first', 'second', 'third']);
  });

  it('reports no active view when the stored id names none of the survivors', async () => {
    const { rpc } = buildSuite(
      'D:\\workspace',
      createMockTasksSettings([makeView({ id: 'a' })], 'deleted-view'),
    );

    const result = (await getHandler(
      rpc,
      'tasks:getViews',
    )({})) as TasksGetViewsResult;

    expect(result.activeViewId).toBeNull();
  });

  it('rejects the call when no workspace is open', async () => {
    const { rpc } = buildSuite(null);
    await expect(getHandler(rpc, 'tasks:getViews')({})).rejects.toMatchObject({
      errorCode: 'WORKSPACE_NOT_OPEN',
    });
  });
});

describe('tasks:saveViews', () => {
  it('replaces the whole list and stores the active id', async () => {
    const settings = createMockTasksSettings();
    const { rpc } = buildSuite('D:\\workspace', settings);
    const views = [makeView({ id: 'a' }), makeView({ id: 'b', order: 1 })];

    const result = (await getHandler(
      rpc,
      'tasks:saveViews',
    )({
      views,
      activeViewId: 'b',
    })) as TasksSaveViewsResult;

    expect(result).toEqual({ success: true });
    expect(settings.savedViews.set).toHaveBeenCalledWith(views);
    expect(settings.activeViewId.set).toHaveBeenCalledWith('b');
  });

  it('names the limit in a CAP_EXCEEDED error and writes NOTHING', async () => {
    const settings = createMockTasksSettings();
    const { rpc } = buildSuite('D:\\workspace', settings);
    const views = Array.from({ length: MAX_SAVED_TASK_VIEWS + 1 }, (_, i) =>
      makeView({ id: `view-${i}`, order: i }),
    );

    const result = (await getHandler(
      rpc,
      'tasks:saveViews',
    )({
      views,
    })) as TasksSaveViewsResult;

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('CAP_EXCEEDED');
    expect(result.error?.message).toContain(String(MAX_SAVED_TASK_VIEWS));
    // A clear message, not a silent truncation.
    expect(settings.savedViews.set).not.toHaveBeenCalled();
  });

  it('accepts exactly the cap', async () => {
    const settings = createMockTasksSettings();
    const { rpc } = buildSuite('D:\\workspace', settings);
    const views = Array.from({ length: MAX_SAVED_TASK_VIEWS }, (_, i) =>
      makeView({ id: `view-${i}`, order: i }),
    );

    const result = (await getHandler(
      rpc,
      'tasks:saveViews',
    )({
      views,
    })) as TasksSaveViewsResult;

    expect(result).toEqual({ success: true });
  });

  it('clears an active id that names no view in the new list', async () => {
    // What deleting the active view looks like: a normal action, reconciled
    // rather than rejected, so the board never reports an active view it has
    // no way to show.
    const settings = createMockTasksSettings(
      [makeView({ id: 'gone' })],
      'gone',
    );
    const { rpc } = buildSuite('D:\\workspace', settings);

    const result = (await getHandler(
      rpc,
      'tasks:saveViews',
    )({
      views: [makeView({ id: 'kept' })],
    })) as TasksSaveViewsResult;

    expect(result).toEqual({ success: true });
    expect(settings.activeViewId.set).toHaveBeenCalledWith('');
  });

  it('preserves the stored active id when the key is omitted', async () => {
    const settings = createMockTasksSettings([makeView({ id: 'a' })], 'a');
    const { rpc } = buildSuite('D:\\workspace', settings);

    await getHandler(
      rpc,
      'tasks:saveViews',
    )({ views: [makeView({ id: 'a' })] });

    expect(settings.activeViewId.set).toHaveBeenCalledWith('a');
  });

  it('clears the active id when the caller sends null', async () => {
    const settings = createMockTasksSettings([makeView({ id: 'a' })], 'a');
    const { rpc } = buildSuite('D:\\workspace', settings);

    await getHandler(
      rpc,
      'tasks:saveViews',
    )({
      views: [makeView({ id: 'a' })],
      activeViewId: null,
    });

    expect(settings.activeViewId.set).toHaveBeenCalledWith('');
  });

  it('rejects duplicate view ids', async () => {
    const settings = createMockTasksSettings();
    const { rpc } = buildSuite('D:\\workspace', settings);

    await expect(
      getHandler(
        rpc,
        'tasks:saveViews',
      )({
        views: [makeView({ id: 'same' }), makeView({ id: 'same', order: 1 })],
      }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(settings.savedViews.set).not.toHaveBeenCalled();
  });

  it('rejects a view carrying an unknown filter facet value', async () => {
    const settings = createMockTasksSettings();
    const { rpc } = buildSuite('D:\\workspace', settings);

    await expect(
      getHandler(
        rpc,
        'tasks:saveViews',
      )({
        views: [
          makeView({
            filter: {
              ...EMPTY_TASK_FILTER,
              statuses: ['not_a_status'],
            } as unknown as TaskFilterSpec,
          }),
        ],
      }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(settings.savedViews.set).not.toHaveBeenCalled();
  });

  it('returns WRITE_FAILED without leaking the underlying path', async () => {
    const settings = createMockTasksSettings();
    settings.savedViews.set.mockRejectedValue(
      new Error(
        'EACCES: permission denied, open D:\\Users\\me\\.ptah\\settings.json',
      ),
    );
    const { rpc, logger } = buildSuite('D:\\workspace', settings);

    const result = (await getHandler(
      rpc,
      'tasks:saveViews',
    )({
      views: [makeView()],
    })) as TasksSaveViewsResult;

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('WRITE_FAILED');
    expect(result.error?.message).not.toContain('.ptah');
    expect(result.warning).toBeUndefined();
    // The list write is the one that failed, so the active id is never
    // attempted — a pointer must not outlive the list it points into.
    expect(settings.activeViewId.set).not.toHaveBeenCalled();
    // The real error is kept server-side, where the path is not a leak.
    expect(logger.error).toHaveBeenCalled();
  });

  /**
   * `views` and `activeViewId` are two settings keys and therefore two separate
   * whole-file writes, which cannot be made one atomic act. When the second
   * fails the first has ALREADY LANDED, and reporting that as `WRITE_FAILED`
   * tells the user to redo work that is already on disk.
   */
  describe('when the active-view write fails after the views landed', () => {
    function buildPartialFailure(): {
      settings: MockTasksSettings;
      rpc: MockRpcHandler;
      logger: MockLogger;
    } {
      const settings = createMockTasksSettings();
      settings.activeViewId.set.mockRejectedValue(
        new Error(
          'EACCES: permission denied, open D:\\Users\\me\\.ptah\\settings.json',
        ),
      );
      const { rpc, logger } = buildSuite('D:\\workspace', settings);
      return { settings, rpc, logger };
    }

    async function save(rpc: MockRpcHandler): Promise<TasksSaveViewsResult> {
      return (await getHandler(
        rpc,
        'tasks:saveViews',
      )({
        views: [makeView({ id: 'kept' })],
        activeViewId: 'kept',
      })) as TasksSaveViewsResult;
    }

    it('does NOT report the save as failed — the views genuinely persisted', async () => {
      const { settings, rpc } = buildPartialFailure();

      const result = await save(rpc);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(settings.savedViews.set).toHaveBeenCalledTimes(1);
    });

    it('says what actually happened instead of staying silent', async () => {
      const { rpc } = buildPartialFailure();

      const result = await save(rpc);

      expect(result.warning?.code).toBe('ACTIVE_VIEW_ID_NOT_SAVED');
      // Names the real outcome: views saved, active view not recorded, and no
      // reason to try again.
      expect(result.warning?.message).toMatch(/views were saved/i);
      expect(result.warning?.message).toMatch(/active view/i);
      expect(result.warning?.message).toMatch(/nothing to save again/i);
      // Still no absolute path on the wire (R4.4).
      expect(result.warning?.message).not.toContain('.ptah');
    });

    it('logs the real failure server-side', async () => {
      const { rpc, logger } = buildPartialFailure();

      await save(rpc);

      expect(logger.error).toHaveBeenCalled();
    });

    it('self-heals on the next read rather than leaving wrong data', async () => {
      // The stale pointer needs no repair path: `readViews` reconciles the
      // stored id against the views it actually read, so a pointer that names
      // nothing surfaces as `activeViewId: null` — never as a view the board
      // cannot show.
      const settings = createMockTasksSettings(
        [makeView({ id: 'stale-pointer-target' })],
        'stale-pointer-target',
      );
      settings.activeViewId.set.mockRejectedValue(new Error('EACCES'));
      const { rpc } = buildSuite('D:\\workspace', settings);

      const saved = (await getHandler(
        rpc,
        'tasks:saveViews',
      )({
        views: [makeView({ id: 'brand-new' })],
        activeViewId: 'brand-new',
      })) as TasksSaveViewsResult;
      expect(saved.success).toBe(true);
      expect(saved.warning?.code).toBe('ACTIVE_VIEW_ID_NOT_SAVED');

      const reread = (await getHandler(
        rpc,
        'tasks:getViews',
      )({})) as TasksGetViewsResult;

      expect(reread.views.map((v) => v.id)).toEqual(['brand-new']);
      expect(reread.activeViewId).toBeNull();
    });
  });

  it('round-trips a saved view back through tasks:getViews', async () => {
    const settings = createMockTasksSettings();
    const { rpc } = buildSuite('D:\\workspace', settings);
    const view = makeView({
      id: 'roundtrip',
      name: 'Unestimated bugs',
      filter: { ...EMPTY_TASK_FILTER, types: ['BUGFIX'], unestimated: true },
      sort: { field: 'title', direction: 'asc' },
      order: 0,
    });

    await getHandler(
      rpc,
      'tasks:saveViews',
    )({
      views: [view],
      activeViewId: 'roundtrip',
    });
    const result = (await getHandler(
      rpc,
      'tasks:getViews',
    )({})) as TasksGetViewsResult;

    expect(result.skipped).toBe(0);
    expect(result.activeViewId).toBe('roundtrip');
    expect(result.views[0]).toEqual(view);
  });
});
