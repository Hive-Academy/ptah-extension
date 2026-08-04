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
import { CARRIER_FILE } from '@ptah-extension/shared';
import type {
  ExcludedTaskFolder,
  TaskSpecSummary,
  TasksAdoptResult,
  TasksDoctorPlanResult,
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
  it('owns exactly the 10 tasks:* methods', () => {
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
