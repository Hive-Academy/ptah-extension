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
  parseTaskFile,
  updateFrontmatter,
  type ITaskIndexStore,
  type TaskWriterService,
  type RegistryGeneratorService,
  type TaskIndexChangeEvent,
  type TaskSweepService,
} from '@ptah-extension/task-specs';
import type { TasksSettings } from '@ptah-extension/settings-core';
import {
  BULK_CHUNK_SIZE,
  CARRIER_FILE,
  DEFAULT_TASK_SORT,
  DOC_FILES,
  EMPTY_TASK_FILTER,
  MAX_LABEL_LENGTH,
  MAX_LABELS_PER_TASK,
  MAX_SAVED_TASK_VIEWS,
  buildTaskGraph,
  filterTasks,
  renderTaskMd,
} from '@ptah-extension/shared';
import type {
  ExcludedTaskFolder,
  SavedTaskView,
  TaskFilterSpec,
  TaskSpecSummary,
  TasksAdoptResult,
  TasksBulkUpdateStatusResult,
  TasksBulkUpdateLabelResult,
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
  readArtifact: jest.Mock;
  readRoundJudge: jest.Mock;
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
    readArtifact: jest.fn().mockResolvedValue(null),
    readRoundJudge: jest.fn().mockResolvedValue(null),
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

/**
 * A sweep double that matches nothing and deletes nothing.
 *
 * The default for every suite: a DESTRUCTIVE collaborator must be inert unless
 * a spec explicitly arms it, so no unrelated test can reach a delete path.
 */
function createInertSweep(): { sweep: jest.Mock } {
  return {
    sweep: jest.fn().mockResolvedValue({
      candidates: [],
      deleted: [],
      skipped: [],
      previewOnly: true,
    }),
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
  sweep: { sweep: jest.Mock };
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
  // Default: matches nothing and deletes nothing. A destructive collaborator
  // whose test double is inert by default cannot delete anything a spec did
  // not explicitly ask it to.
  const sweep = {
    sweep: jest.fn().mockResolvedValue({
      candidates: [],
      deleted: [],
      skipped: [],
      previewOnly: true,
    }),
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
    sweep as unknown as TaskSweepService,
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
    sweep,
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
  it('owns exactly the 17 tasks:* methods', () => {
    expect([...TasksRpcHandlers.METHODS]).toEqual([
      'tasks:list',
      'tasks:get',
      'tasks:getArtifact',
      'tasks:getRoundJudge',
      'tasks:create',
      'tasks:sweepFinished',
      'tasks:updateStatus',
      'tasks:updateMetadata',
      'tasks:bulkUpdateStatus',
      'tasks:bulkUpdateLabel',
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

describe('tasks:getArtifact', () => {
  it('returns the document markdown and echoes the file back', async () => {
    const { rpc, index } = buildSuite();
    index.readArtifact.mockResolvedValue('# Plan\n\nStep one.');
    const handler = getHandler(rpc, 'tasks:getArtifact');

    await expect(
      handler({ taskId: 'TASK_2026_401', file: 'implementation-plan.md' }),
    ).resolves.toEqual({
      file: 'implementation-plan.md',
      content: '# Plan\n\nStep one.',
    });
  });

  /**
   * Absent is the ORDINARY case, not a fault: most tasks carry a handful of
   * the fifteen recognised documents. A task with no plan has not been planned
   * yet, and reporting that as an error sends the user looking for a break
   * that is not there.
   */
  it('reports a missing document as content: null, not an error', async () => {
    const { rpc, index } = buildSuite();
    index.readArtifact.mockResolvedValue(null);
    const handler = getHandler(rpc, 'tasks:getArtifact');

    await expect(
      handler({ taskId: 'TASK_2026_401', file: 'implementation-plan.md' }),
    ).resolves.toEqual({ file: 'implementation-plan.md', content: null });
  });

  /**
   * THE security boundary for this method. `file` is joined onto a folder path
   * on the other side, so the enum is what keeps it a document reader rather
   * than an arbitrary-file read primitive pointed at the user's disk. Each of
   * these must die at Zod, before `readArtifact` is ever reached.
   */
  it.each([
    ['traversal', '../../../../etc/passwd'],
    ['absolute path', '/etc/passwd'],
    ['windows absolute path', 'C:\\Windows\\win.ini'],
    ['a nested path inside the folder', 'sub/context.md'],
    ['an unrecognised filename', 'secrets.md'],
    ['the carrier itself', 'task.md'],
  ])('refuses %s with INVALID_PARAMS', async (_label, file) => {
    const { rpc, index } = buildSuite();
    const handler = getHandler(rpc, 'tasks:getArtifact');

    await expect(
      handler({ taskId: 'TASK_2026_401', file }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(index.readArtifact).not.toHaveBeenCalled();
  });

  it('accepts every document the contract recognises', async () => {
    const { rpc } = buildSuite();
    const handler = getHandler(rpc, 'tasks:getArtifact');
    for (const file of DOC_FILES) {
      await expect(
        handler({ taskId: 'TASK_2026_401', file }),
      ).resolves.toMatchObject({ file });
    }
  });

  it('normalizes the workspace root before delegating', async () => {
    const { rpc, index } = buildSuite();
    const handler = getHandler(rpc, 'tasks:getArtifact');
    await handler({
      taskId: 'TASK_2026_401',
      file: 'context.md',
      workspaceRoot: 'D:\\workspace\\',
    });
    expect(index.readArtifact).toHaveBeenCalledWith(
      normalizeWorkspaceRoot('D:\\workspace\\'),
      'TASK_2026_401',
      'context.md',
    );
  });
});

describe('tasks:getRoundJudge', () => {
  it('returns the report markdown and echoes the round back', async () => {
    const { rpc, index } = buildSuite();
    index.readRoundJudge.mockResolvedValue('## VERDICT\n\nREVISE');
    const handler = getHandler(rpc, 'tasks:getRoundJudge');

    await expect(
      handler({ taskId: 'TASK_2026_401', round: 2 }),
    ).resolves.toEqual({ round: 2, content: '## VERDICT\n\nREVISE' });
  });

  /**
   * An unjudged round is the ORDINARY state of a Crucible in progress: round 2
   * has no report while round 1 is still being revised. Reporting that as an
   * error would make every live run look broken and send the user hunting a
   * fault that is not there.
   */
  it('reports an unjudged round as content: null, not an error', async () => {
    const { rpc, index } = buildSuite();
    index.readRoundJudge.mockResolvedValue(null);
    const handler = getHandler(rpc, 'tasks:getRoundJudge');

    await expect(
      handler({ taskId: 'TASK_2026_401', round: 1 }),
    ).resolves.toEqual({ round: 1, content: null });
  });

  /**
   * THE boundary for this method. `getArtifact` is kept safe by a closed enum;
   * `round-N-judge.md` cannot be enumerated, so safety comes from the shape of
   * the parameter instead — a NUMBER, from which no separator or `..` can be
   * expressed. Each of these must die at Zod, before `readRoundJudge` runs.
   */
  it.each([
    ['a filename', 'round-1-judge.md'],
    ['a traversal string', '../../../../etc/passwd'],
    ['a numeric string', '1'],
    ['a fraction', 1.5],
    ['zero', 0],
    ['a negative round', -1],
    ['null', null],
  ])('refuses %s as `round` with INVALID_PARAMS', async (_label, round) => {
    const { rpc, index } = buildSuite();
    const handler = getHandler(rpc, 'tasks:getRoundJudge');

    await expect(
      handler({ taskId: 'TASK_2026_401', round }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(index.readRoundJudge).not.toHaveBeenCalled();
  });

  /**
   * The ceiling is 4 and NOT the panel's cap of 2, deliberately. The Conductor
   * may run a third round when the user explicitly authorises one
   * (`crucible.md:153`), and a fourth is a skill violation that must surface in
   * the UI as a visible anomaly — not be swallowed as an RPC error nobody sees.
   */
  it('accepts rounds 1..4 and refuses 5', async () => {
    const { rpc } = buildSuite();
    const handler = getHandler(rpc, 'tasks:getRoundJudge');
    for (const round of [1, 2, 3, 4]) {
      await expect(
        handler({ taskId: 'TASK_2026_401', round }),
      ).resolves.toMatchObject({ round });
    }
    await expect(
      handler({ taskId: 'TASK_2026_401', round: 5 }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
  });

  it('refuses a taskId that is a path rather than a folder name', async () => {
    const { rpc, index } = buildSuite();
    const handler = getHandler(rpc, 'tasks:getRoundJudge');

    await expect(
      handler({ taskId: '../../../etc', round: 1 }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(index.readRoundJudge).not.toHaveBeenCalled();
  });

  it('normalizes the workspace root before delegating', async () => {
    const { rpc, index } = buildSuite();
    const handler = getHandler(rpc, 'tasks:getRoundJudge');
    await handler({
      taskId: 'TASK_2026_401',
      round: 1,
      workspaceRoot: 'D:\\workspace\\',
    });
    expect(index.readRoundJudge).toHaveBeenCalledWith(
      normalizeWorkspaceRoot('D:\\workspace\\'),
      'TASK_2026_401',
      1,
    );
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

  // Segment case is deliberately NOT varied here. `normalizeWorkspaceRoot`
  // lower-cases only the drive letter, while the `resolveRoot` guard's
  // `isPathWithinRoots` folds case on win32 ONLY — so a `D:\Workspace` request
  // against a `D:\workspace` folder is authorized on Windows and rejected on
  // the Linux CI runner. Drive-letter case + trailing separator still prove
  // normalization ran; segment-case behaviour is pinned by
  // `normalize-workspace-root.spec.ts`.
  it('normalizes the workspace root before warming + delegating', async () => {
    const { rpc, index } = buildSuite();
    const handler = getHandler(rpc, 'tasks:list');
    await handler({ workspaceRoot: 'D:\\workspace\\' });
    const expected = normalizeWorkspaceRoot('D:\\workspace\\');
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
    createInertSweep() as unknown as TaskSweepService,
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
        // `isOpen` is not decoration. These suites drive the store through
        // `TaskIndexService.rebuild`, which since TASK_2026_306 task 4.4 asks
        // `store.isReady()` first and SKIPS the write when it is false —
        // `SqliteTaskIndexStore.isReady()` forwards this exact property. A
        // double carrying only `db` reports `undefined`, the rebuild writes
        // nothing, and the board comes back with zero exclusions.
        createMockLogger() as unknown as Logger,
        { db, isOpen: true } as unknown as SqliteConnectionService,
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
      createInertSweep() as unknown as TaskSweepService,
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
      // No `expectLabels` was stated, so no precondition is forwarded. A
      // caller that did not say what it believed must not have a belief
      // invented for it: `{ expectLabels: [] }` here would refuse every write
      // to a task that carries any label at all.
      undefined,
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
      undefined,
    );
  });

  /**
   * `expectLabels` — the optimistic-concurrency precondition, on the wire.
   *
   * `patch.labels` is a full replacement, so a caller that means "add b" sends
   * `[...whatItLastSaw, 'b']`. The writer's own pre-write re-read cannot catch
   * a third party that moved the labels since that read: the re-read agrees
   * with itself, and the caller's stale array silently wins.
   *
   * `tasks:bulkUpdateLabel` has stated the precondition internally since it
   * shipped. This method could not state it at all, which left the board's
   * OTHER full-replacement label writer — the detail panel — unprotected
   * against exactly the run the bulk path was protecting itself from.
   */
  it('forwards expectLabels to the writer as a precondition', async () => {
    const { rpc, writer } = buildSuite();

    await getHandler(
      rpc,
      'tasks:updateMetadata',
    )({
      taskId: 'TASK_2026_181',
      patch: { labels: ['b'] },
      expectLabels: ['a', 'b'],
    });

    expect(writer.updateMetadata).toHaveBeenCalledWith(
      normalizeWorkspaceRoot('D:\\workspace'),
      'TASK_2026_181',
      { labels: ['b'] },
      { expectLabels: ['a', 'b'] },
    );
  });

  it('accepts an expectLabels entry LabelSchema itself would refuse', async () => {
    const { rpc, writer } = buildSuite();

    // The read boundary admits a hand-authored 40-character label as a
    // warning, so a carrier can legitimately hold one. `expectLabels`
    // describes what is already on disk rather than proposing a write, so
    // validating it as a label would make the one carrier that most needs the
    // precondition the one carrier that cannot use it.
    await getHandler(
      rpc,
      'tasks:updateMetadata',
    )({
      taskId: 'TASK_2026_181',
      patch: { labels: [] },
      expectLabels: ['x'.repeat(40)],
    });

    expect(writer.updateMetadata).toHaveBeenCalledWith(
      normalizeWorkspaceRoot('D:\\workspace'),
      'TASK_2026_181',
      { labels: [] },
      { expectLabels: ['x'.repeat(40)] },
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
      createInertSweep() as unknown as TaskSweepService,
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
    createInertSweep() as unknown as TaskSweepService,
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
        // `isOpen: true` for the same reason as the exclusions fixture above:
        // `TaskIndexService.rebuild` consults `store.isReady()` before writing.
        createMockLogger() as unknown as Logger,
        { db, isOpen: true } as unknown as SqliteConnectionService,
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

// ---------------------------------------------------------------------------
// tasks:bulkUpdateStatus (TASK_2026_181, FR-C4 / R2)
// ---------------------------------------------------------------------------

/**
 * The bulk path, end to end against a REAL writer, a REAL index and real
 * carriers on a mock filesystem.
 *
 * ## Why this is not a mocked-writer test
 *
 * Every claim this block makes is about something that happens BELOW the
 * handler: that the pre-write re-read refuses exactly the contended task, that
 * `deferNotify` keeps the funnel silent so one rebuild suffices, and that the
 * enrichment reports what is genuinely on disk after the other writer finished.
 * A `jest.fn()` writer would satisfy all three by construction and prove none
 * of them.
 *
 * ## Why five ids, with the conflict in the middle
 *
 * A fixture that narrows to one item cannot tell "reported the conflict and
 * carried on" from "stopped at the conflict" — both yield one failing entry, so
 * the buggy and the correct implementation give the same answer and the test
 * cannot fail. The contended id is third of five precisely so the two ids after
 * it have to succeed.
 */
const BULK_ROOT = normalizeWorkspaceRoot('D:\\bulk-workspace');
const BULK_TASK_IDS = [
  'TASK_2026_181',
  'TASK_2026_182',
  'TASK_2026_183',
  'TASK_2026_184',
  'TASK_2026_185',
] as const;
/** Third of five — deliberately neither first nor last. */
const BULK_CONTENDED_ID = BULK_TASK_IDS[2];

function bulkCarrierPath(taskId: string): string {
  return path.join(BULK_ROOT, '.ptah', 'specs', taskId, CARRIER_FILE);
}

/**
 * Make a mock filesystem behave like NTFS: two paths differing only in case
 * resolve to ONE file.
 *
 * The mock is a `Map` keyed on the exact path string, so by default it is
 * case-sensitive and cannot express the hazard canonical dedupe exists to
 * prevent. This rewrites an incoming path to whichever existing key matches it
 * case-insensitively, leaving everything else — including the pre-write
 * re-read that detects conflicts — completely untouched.
 *
 * Applied per-test rather than globally: the other bulk fixtures rely on
 * ordinary case-sensitive behaviour, and quietly changing it for all of them
 * would alter what they prove.
 */
function makeCaseInsensitive(fs: MockFileSystemProvider): void {
  const resolve = (p: string): string => {
    if (fs.__state.files.has(p)) return p;
    const folded = p.toLowerCase();
    for (const key of fs.__state.files.keys()) {
      if (key.toLowerCase() === folded) return key;
    }
    return p;
  };

  const readFile = fs.readFile.getMockImplementation() as (
    p: string,
  ) => Promise<string>;
  const writeFile = fs.writeFile.getMockImplementation() as (
    p: string,
    content: string,
  ) => Promise<void>;
  const exists = fs.exists.getMockImplementation() as (
    p: string,
  ) => Promise<boolean>;

  fs.readFile.mockImplementation((p: string) => readFile(resolve(p)));
  fs.writeFile.mockImplementation((p: string, content: string) =>
    writeFile(resolve(p), content),
  );
  fs.exists.mockImplementation((p: string) => exists(resolve(p)));
}

function readBulkCarrier(fs: MockFileSystemProvider, taskId: string): string {
  const bytes = fs.__state.files.get(bulkCarrierPath(taskId));
  if (!bytes) throw new Error(`no carrier on disk for ${taskId}`);
  return new TextDecoder().decode(bytes as Uint8Array);
}

interface BulkSuite {
  rpc: MockRpcHandler;
  fs: MockFileSystemProvider;
  applyFolderChange: jest.SpyInstance;
  updateMetadata: jest.SpyInstance;
  externalWrites: () => number;
  dispose: () => void;
}

/**
 * Seed five backlog carriers, warm the index, then arm ONE external whole-file
 * write inside the contended task's read → write window.
 *
 * The arming happens AFTER `ensureStarted`, because the initial index scan
 * reads every carrier and would otherwise consume the trap before the writer
 * ever ran — the interleave has to land inside the WRITER's window, not the
 * scanner's.
 *
 * @param interleave false disarms the external write entirely (the control).
 * @param throwOnTaskId make the writer THROW (not return a typed failure) for
 *   this one id, standing in for an unexpected fault mid-loop.
 */
async function buildBulkSuite(
  interleave = true,
  throwOnTaskId?: string,
): Promise<BulkSuite> {
  const logger = createMockLogger();
  const rpc = createMockRpcHandler();
  const workspace = createMockWorkspaceProvider({ folders: [BULK_ROOT] });
  workspace.getWorkspaceRoot.mockReturnValue(BULK_ROOT);

  const fs = createMockFileSystemProvider();
  for (const taskId of BULK_TASK_IDS) {
    await fs.writeFile(
      bulkCarrierPath(taskId),
      renderTaskMd({
        id: taskId,
        title: `Bulk member ${taskId}`,
        type: 'FEATURE',
        status: 'backlog',
        now: '2026-08-04T00:00:00.000Z',
      }),
    );
    fs.__state.directories.add(
      path.join(BULK_ROOT, '.ptah', 'specs', taskId).replace(/\\/g, '/'),
    );
  }
  fs.__state.directories.add(
    path.join(BULK_ROOT, '.ptah', 'specs').replace(/\\/g, '/'),
  );

  const scanner = new TaskScannerService(fs, logger as unknown as Logger);
  const store = new InMemoryTaskIndexStore(
    createMockLogger() as unknown as Logger,
  );
  const index = new TaskIndexService(
    logger as unknown as Logger,
    fs,
    scanner,
    store,
  );
  // The writer's notifier is the SAME index the handler holds, because that is
  // how DI wires it in production (`register.ts` points
  // `TASK_INDEX_NOTIFIER_TOKEN` at `TaskIndexService`). A `NoOpTaskIndexNotifier`
  // here would be more convenient and would quietly destroy the R5 assertion
  // below: with a no-op notifier the rebuild count is 1 whether or not
  // `deferNotify` is passed, so the "exactly one" test would pass against a
  // handler that had dropped the flag entirely.
  const writer = new TaskWriterServiceClass(
    fs,
    logger as unknown as Logger,
    index,
  );

  if (throwOnTaskId !== undefined) {
    const passthrough = writer.updateMetadata.bind(writer);
    // The message carries an absolute path on purpose, so the assertions can
    // also prove it is NOT forwarded to the client (R4.4).
    writer.updateMetadata = (async (
      ...args: Parameters<typeof passthrough>
    ) => {
      if (args[1] === throwOnTaskId) {
        throw new Error(`EBUSY: D:\\secrets\\${throwOnTaskId}\\task.md locked`);
      }
      return passthrough(...args);
    }) as typeof writer.updateMetadata;
  }

  const handlers = new TasksRpcHandlers(
    logger as unknown as Logger,
    rpc as unknown as RpcHandler,
    {
      broadcastMessage: jest.fn().mockResolvedValue(undefined),
    } as unknown as WebviewManager,
    workspace as unknown as IWorkspaceProvider,
    index,
    writer,
    { generate: jest.fn() } as unknown as RegistryGeneratorService,
    { plan: jest.fn() } as unknown as TaskDoctorService,
    createInertSweep() as unknown as TaskSweepService,
    createMockTasksSettings() as unknown as TasksSettings,
  );
  handlers.register();

  // Warm the index BEFORE arming, so the trap belongs to the writer's window.
  await index.ensureStarted(BULK_ROOT);

  const contendedCarrier = bulkCarrierPath(BULK_CONTENDED_ID);
  const externalContent = `${updateFrontmatter(
    readBulkCarrier(fs, BULK_CONTENDED_ID),
    { status: 'in_review' },
  )}\nAn external agent appended this paragraph.\n`;

  const defaultReadFile = fs.readFile.getMockImplementation() as (
    p: string,
  ) => Promise<string>;
  const defaultWriteFile = fs.writeFile.getMockImplementation() as (
    p: string,
    content: string,
  ) => Promise<void>;

  let armed = interleave;
  let externalWrites = 0;
  fs.readFile.mockImplementation(async (p: string): Promise<string> => {
    const content = await defaultReadFile(p);
    if (p === contendedCarrier && armed) {
      armed = false;
      externalWrites++;
      await defaultWriteFile(contendedCarrier, externalContent);
    }
    return content;
  });

  return {
    rpc,
    fs,
    applyFolderChange: jest.spyOn(index, 'applyFolderChange'),
    updateMetadata: jest.spyOn(writer, 'updateMetadata'),
    externalWrites: () => externalWrites,
    dispose: () => index.dispose(),
  };
}

async function callBulk(
  suite: BulkSuite,
  status = 'done',
  taskIds: readonly string[] = BULK_TASK_IDS,
): Promise<TasksBulkUpdateStatusResult> {
  return (await getHandler(
    suite.rpc,
    'tasks:bulkUpdateStatus',
  )({ taskIds: [...taskIds], status })) as TasksBulkUpdateStatusResult;
}

describe('tasks:bulkUpdateStatus — five ids, one interleaved external write', () => {
  it('returns one TASK_CONFLICT carrying currentStatus, and four successes', async () => {
    const suite = await buildBulkSuite();
    try {
      const result = await callBulk(suite);

      // The interleaving really happened — otherwise everything below is
      // vacuous, which is exactly how a bulk test passes while proving nothing.
      expect(suite.externalWrites()).toBe(1);

      // Whole-shape equality over all five entries, in request order. Counting
      // successes would let a conflict on the WRONG task pass; asserting only
      // the failing entry would let a silently-dropped entry pass.
      expect(result.results).toEqual([
        { taskId: 'TASK_2026_181', ok: true },
        { taskId: 'TASK_2026_182', ok: true },
        {
          taskId: BULK_CONTENDED_ID,
          ok: false,
          error: {
            code: 'TASK_CONFLICT',
            message: expect.stringContaining(BULK_CONTENDED_ID),
          },
          // FR-C4.7 — what the OTHER writer left, not what we attempted
          // (`done`) and not what we read before it landed (`backlog`).
          currentStatus: 'in_review',
        },
        { taskId: 'TASK_2026_184', ok: true },
        { taskId: 'TASK_2026_185', ok: true },
      ]);
    } finally {
      suite.dispose();
    }
  });

  it('issues exactly ONE index rebuild for the whole call (R5 / FR-C4.10)', async () => {
    const suite = await buildBulkSuite();
    try {
      await callBulk(suite);

      // Not "at most one" — exactly one. Four carriers changed, so zero would
      // leave the board stale, and the pre-`deferNotify` behaviour would be
      // four (one per successful write) plus this one.
      expect(suite.applyFolderChange).toHaveBeenCalledTimes(1);
    } finally {
      suite.dispose();
    }
  });

  it('passes deferNotify on every write, which is what makes that one rebuild possible', async () => {
    const suite = await buildBulkSuite();
    try {
      await callBulk(suite);

      expect(suite.updateMetadata).toHaveBeenCalledTimes(5);
      for (const call of suite.updateMetadata.mock.calls) {
        expect(call[3]).toEqual({ deferNotify: true });
      }
    } finally {
      suite.dispose();
    }
  });

  it('writes the two tasks that come AFTER the refusal', async () => {
    const suite = await buildBulkSuite();
    try {
      await callBulk(suite);

      // Only reachable if the loop continued past the conflict.
      for (const taskId of ['TASK_2026_184', 'TASK_2026_185']) {
        const raw = readBulkCarrier(suite.fs, taskId);
        expect(raw).toContain('status: done');
      }
    } finally {
      suite.dispose();
    }
  });

  it('leaves the contended carrier exactly as the external writer left it', async () => {
    const suite = await buildBulkSuite();
    try {
      await callBulk(suite);

      const raw = readBulkCarrier(suite.fs, BULK_CONTENDED_ID);
      expect(raw).toContain('status: in_review');
      expect(raw).toContain('An external agent appended this paragraph.');
    } finally {
      suite.dispose();
    }
  });

  it('with no interleaving, all five succeed and still cost ONE rebuild', async () => {
    // The control: without it, an implementation that refused every task would
    // satisfy the conflict assertions above for entirely the wrong reason.
    const suite = await buildBulkSuite(false);
    try {
      const result = await callBulk(suite);

      expect(suite.externalWrites()).toBe(0);
      expect(result.results).toEqual(
        BULK_TASK_IDS.map((taskId) => ({ taskId, ok: true })),
      );
      expect(suite.applyFolderChange).toHaveBeenCalledTimes(1);
    } finally {
      suite.dispose();
    }
  });

  it('rebuilds NOTHING when no write landed', async () => {
    const suite = await buildBulkSuite(false);
    try {
      const result = await callBulk(suite, 'done', ['TASK_2026_999']);

      expect(result.results).toEqual([
        {
          taskId: 'TASK_2026_999',
          ok: false,
          error: {
            code: 'TASK_NOT_FOUND',
            message: expect.stringContaining('TASK_2026_999'),
          },
        },
      ]);
      // A rebuild is a full rescan of every folder. Buying one when nothing
      // changed is the per-task-reload cost R5 exists to remove, re-entering
      // through the empty case.
      expect(suite.applyFolderChange).not.toHaveBeenCalled();
    } finally {
      suite.dispose();
    }
  });

  it('enriches ONLY a conflict — a missing task carries no currentStatus', async () => {
    const suite = await buildBulkSuite(false);
    try {
      const result = await callBulk(suite, 'done', ['TASK_2026_999']);

      expect(result.results[0]).not.toHaveProperty('currentStatus');
    } finally {
      suite.dispose();
    }
  });

  it('collapses a repeated id to one entry and one write', async () => {
    const suite = await buildBulkSuite(false);
    try {
      const result = await callBulk(suite, 'done', [
        'TASK_2026_181',
        'TASK_2026_181',
        'TASK_2026_182',
      ]);

      // FR-C4.3 is one entry per TASK, not one per array slot.
      expect(result.results).toEqual([
        { taskId: 'TASK_2026_181', ok: true },
        { taskId: 'TASK_2026_182', ok: true },
      ]);
      expect(suite.updateMetadata).toHaveBeenCalledTimes(2);
    } finally {
      suite.dispose();
    }
  });

  /**
   * A differently-cased duplicate names the SAME task, so it must collapse to
   * ONE entry and ONE write.
   *
   * ## What this test does and does not prove
   *
   * `createMockFileSystemProvider` is backed by a `Map` keyed on the exact path
   * string, so it is case-SENSITIVE — unlike the Windows filesystem this
   * project primarily runs on. Under exact-string dedupe this fixture
   * therefore produces a spurious `TASK_NOT_FOUND` for the second casing,
   * not the `TASK_CONFLICT` that a real case-insensitive volume would produce.
   *
   * So the pin here is the DEDUPE itself — one entry, one write — which is the
   * property the fix actually establishes and which fails loudly either way.
   * Asserting "no `TASK_CONFLICT` appears" would look like it covered the
   * hazard while being satisfied trivially by this mock, so it is deliberately
   * NOT asserted here. The conflict mechanism is pinned in the next test, on a
   * filesystem that can express it.
   */
  it('treats a differently-cased duplicate as ONE task and ONE write', async () => {
    const suite = await buildBulkSuite(false);
    try {
      const result = await callBulk(suite, 'done', [
        'TASK_2026_181',
        'task_2026_181',
      ]);

      // One entry, carrying the casing the caller sent first.
      expect(result.results).toEqual([{ taskId: 'TASK_2026_181', ok: true }]);
      expect(suite.updateMetadata).toHaveBeenCalledTimes(1);
    } finally {
      suite.dispose();
    }
  });

  /**
   * The hazard itself, on a filesystem that can express it.
   *
   * `makeCaseInsensitive` folds path lookups the way NTFS does, so
   * `TASK_2026_181` and `task_2026_181` resolve to ONE file.
   *
   * ## What exact-string dedupe actually costs here — measured, not assumed
   *
   * It is tempting to say the second write's pre-write re-read sees the first
   * write's bytes and reports `TASK_CONFLICT` against a write that succeeded.
   * **That is not what happens, and this test was corrected after the mutation
   * disproved it.** The conflict check is `current !== raw`, where `raw` is
   * that call's OWN snapshot (`task-writer.service.ts`). The duplicate runs
   * after the first write finished, so it snapshots the already-updated file
   * and its re-read agrees with it. No conflict fires.
   *
   * The real cost is quieter and still worth refusing: the caller gets TWO
   * result entries for ONE task, which FR-C4.3 forbids outright, and the
   * carrier is written TWICE — a second `updated` refresh on a gitignored file
   * with no undo, for a change nobody asked for.
   */
  it('writes one file once when two casings name the same task', async () => {
    const suite = await buildBulkSuite(false);
    makeCaseInsensitive(suite.fs);
    const carrier = bulkCarrierPath('TASK_2026_181');
    const writesToCarrier = (): number =>
      suite.fs.writeFile.mock.calls.filter(([p]) => p === carrier).length;
    const before = writesToCarrier();
    try {
      const result = await callBulk(suite, 'done', [
        'TASK_2026_181',
        'task_2026_181',
      ]);

      // One entry — FR-C4.3 is one result per TASK, and these two ids are one
      // task on this filesystem.
      expect(result.results).toEqual([{ taskId: 'TASK_2026_181', ok: true }]);
      // ONE write to the single underlying file. Without canonical dedupe this
      // is 2: a redundant rewrite that only refreshes `updated`.
      expect(writesToCarrier() - before).toBe(1);
    } finally {
      suite.dispose();
    }
  });

  /**
   * An UNEXPECTED throw (not a typed writer failure) must not convert a
   * complete result list into an exception.
   *
   * The throw is placed at item 4 of 5 so there are three landed writes before
   * it and one task after it. Those three `ok: true` entries are the difference
   * between "retry the two that failed" and "retry all five" — and retrying a
   * write that already landed is how a bulk operation manufactures conflicts.
   */
  it('preserves the results of writes that already landed when item 4 throws', async () => {
    const suite = await buildBulkSuite(false, 'TASK_2026_184');
    try {
      const result = await callBulk(suite);

      expect(result.results).toEqual([
        { taskId: 'TASK_2026_181', ok: true },
        { taskId: 'TASK_2026_182', ok: true },
        { taskId: 'TASK_2026_183', ok: true },
        {
          taskId: 'TASK_2026_184',
          ok: false,
          error: { code: 'WRITE_FAILED', message: expect.any(String) },
        },
        // The loop carried on past the unexpected fault, exactly as it does
        // past a typed one.
        { taskId: 'TASK_2026_185', ok: true },
      ]);
    } finally {
      suite.dispose();
    }
  });

  it('does not leak the raw error text of an unexpected throw to the client', async () => {
    const suite = await buildBulkSuite(false, 'TASK_2026_184');
    try {
      const result = await callBulk(suite);

      const failed = result.results.find((r) => !r.ok);
      // R4.4 — the thrown message carried `D:\secrets\...`; the wire must not.
      expect(failed?.error?.message).not.toContain('D:\\secrets');
      expect(failed?.error?.message).not.toContain('EBUSY');
    } finally {
      suite.dispose();
    }
  });

  it('still rebuilds once when a mid-loop throw follows landed writes', async () => {
    const suite = await buildBulkSuite(false, 'TASK_2026_184');
    try {
      await callBulk(suite);

      // Four carriers changed around the fault; the index must learn about
      // them, and must do so exactly once.
      expect(suite.applyFolderChange).toHaveBeenCalledTimes(1);
    } finally {
      suite.dispose();
    }
  });
});

describe('tasks:bulkUpdateStatus — boundary', () => {
  it('rejects a selection larger than BULK_CHUNK_SIZE', async () => {
    const { rpc, writer } = buildSuite();
    const tooMany = Array.from(
      { length: BULK_CHUNK_SIZE + 1 },
      (_v, i) => `TASK_2026_${200 + i}`,
    );

    await expect(
      getHandler(
        rpc,
        'tasks:bulkUpdateStatus',
      )({ taskIds: tooMany, status: 'done' }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(writer.updateMetadata).not.toHaveBeenCalled();
  });

  it('rejects an empty selection', async () => {
    const { rpc, writer } = buildSuite();
    await expect(
      getHandler(
        rpc,
        'tasks:bulkUpdateStatus',
      )({ taskIds: [], status: 'done' }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(writer.updateMetadata).not.toHaveBeenCalled();
  });

  it.each(REJECTED_IDS)(
    'rejects %s among the taskIds, writing nothing',
    async (_label, value) => {
      const { rpc, writer } = buildSuite();
      await expect(
        getHandler(
          rpc,
          'tasks:bulkUpdateStatus',
        )({ taskIds: ['TASK_2026_181', value], status: 'done' }),
      ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
      // The whole call is refused — a bad entry does not get nineteen writes
      // issued around it.
      expect(writer.updateMetadata).not.toHaveBeenCalled();
    },
  );
});

// ---------------------------------------------------------------------------
// tasks:bulkUpdateLabel (FR-C5) — the method that gives `noop` a producer
// ---------------------------------------------------------------------------

/**
 * Label bulk fixture: a REAL `TaskWriterService` over a mock filesystem, with
 * the real `TaskIndexService` as its notifier.
 *
 * Not a mocked writer, for the same reason the status bulk block is not: every
 * claim here is about something that happens BELOW the handler — that a no-op
 * leaves the carrier's bytes alone, that removing the last label removes the
 * KEY rather than writing `labels: []`, that `expectLabels` refuses a write the
 * whole-file re-read provably cannot refuse, and that `deferNotify` keeps the
 * funnel quiet enough for one rebuild to suffice. A `jest.fn()` writer would
 * satisfy every one of them by construction.
 */
const LABEL_ROOT = normalizeWorkspaceRoot('D:\\label-workspace');
/** Fixed so a restamped `updated:` is visible as a byte difference. */
const LABEL_SEED_NOW = '2026-08-04T00:00:00.000Z';

interface LabelSeed {
  readonly id: string;
  readonly labels?: readonly string[];
  /** Seed raw bytes instead of a rendered carrier (for the excluded case). */
  readonly raw?: string;
}

function labelCarrierPath(taskId: string): string {
  return path.join(LABEL_ROOT, '.ptah', 'specs', taskId, CARRIER_FILE);
}

function readLabelCarrier(fs: MockFileSystemProvider, taskId: string): string {
  const bytes = fs.__state.files.get(labelCarrierPath(taskId));
  if (!bytes) throw new Error(`no carrier on disk for ${taskId}`);
  return new TextDecoder().decode(bytes as Uint8Array);
}

/**
 * The labels ON DISK, read through the real parser.
 *
 * Deliberately not a regex over the raw text: `renderTaskMd` emits a YAML block
 * list while `updateFrontmatter` re-serializes through `gray-matter`, so the two
 * can differ in quoting and layout. A regex tuned to one of them would quietly
 * report `[]` for the other and turn a wrong-labels failure into a passing test.
 */
function labelsOf(fs: MockFileSystemProvider, taskId: string): string[] {
  const parsed = parseTaskFile(taskId, readLabelCarrier(fs, taskId));
  if (parsed.kind !== 'task') {
    throw new Error(`carrier excluded: ${parsed.excluded.reason}`);
  }
  return parsed.task.labels;
}

/**
 * The `updated:` stamp's VALUE, independent of how it is quoted.
 *
 * `renderTaskMd` double-quotes an ISO timestamp (it contains colons, so it is
 * not a plain-safe YAML scalar) while `gray-matter` re-serializes it its own
 * way. Comparing the raw line would therefore fail on a quoting difference that
 * no reader can see, and — worse — could be "fixed" by loosening it to a
 * substring match that no longer notices a REFRESHED stamp, which is the only
 * thing it is here to notice.
 */
function updatedStampOf(raw: string): string {
  const match = /^updated:\s*(.*)$/m.exec(raw);
  if (!match) throw new Error('carrier has no updated: line');
  return match[1].trim().replace(/^['"]|['"]$/g, '');
}

interface LabelSuite {
  rpc: MockRpcHandler;
  fs: MockFileSystemProvider;
  index: TaskIndexService;
  writer: TaskWriterServiceClass;
  applyFolderChange: jest.SpyInstance;
  updateMetadata: jest.SpyInstance;
  dispose: () => void;
}

async function buildLabelSuite(
  seeds: readonly LabelSeed[],
): Promise<LabelSuite> {
  const logger = createMockLogger();
  const rpc = createMockRpcHandler();
  const workspace = createMockWorkspaceProvider({ folders: [LABEL_ROOT] });
  workspace.getWorkspaceRoot.mockReturnValue(LABEL_ROOT);

  const fs = createMockFileSystemProvider();
  for (const seed of seeds) {
    await fs.writeFile(
      labelCarrierPath(seed.id),
      seed.raw ??
        renderTaskMd({
          id: seed.id,
          title: `Label member ${seed.id}`,
          type: 'FEATURE',
          status: 'backlog',
          labels: seed.labels,
          now: LABEL_SEED_NOW,
        }),
    );
    fs.__state.directories.add(
      path.join(LABEL_ROOT, '.ptah', 'specs', seed.id).replace(/\\/g, '/'),
    );
  }
  fs.__state.directories.add(
    path.join(LABEL_ROOT, '.ptah', 'specs').replace(/\\/g, '/'),
  );

  const scanner = new TaskScannerService(fs, logger as unknown as Logger);
  const store = new InMemoryTaskIndexStore(
    createMockLogger() as unknown as Logger,
  );
  const index = new TaskIndexService(
    logger as unknown as Logger,
    fs,
    scanner,
    store,
  );
  // The SAME index is the writer's notifier, exactly as `register.ts` wires it.
  // A `NoOpTaskIndexNotifier` here would make the "exactly one rebuild"
  // assertion pass whether or not the handler passes `deferNotify`.
  const writer = new TaskWriterServiceClass(
    fs,
    logger as unknown as Logger,
    index,
  );

  const handlers = new TasksRpcHandlers(
    logger as unknown as Logger,
    rpc as unknown as RpcHandler,
    {
      broadcastMessage: jest.fn().mockResolvedValue(undefined),
    } as unknown as WebviewManager,
    workspace as unknown as IWorkspaceProvider,
    index,
    writer,
    { generate: jest.fn() } as unknown as RegistryGeneratorService,
    { plan: jest.fn() } as unknown as TaskDoctorService,
    createInertSweep() as unknown as TaskSweepService,
    createMockTasksSettings() as unknown as TasksSettings,
  );
  handlers.register();

  // Warm the index BEFORE any test arms an interceptor, so the initial scan's
  // reads belong to the scanner's window rather than the writer's.
  await index.ensureStarted(LABEL_ROOT);
  fs.writeFile.mockClear();

  return {
    rpc,
    fs,
    index,
    writer,
    applyFolderChange: jest.spyOn(index, 'applyFolderChange'),
    updateMetadata: jest.spyOn(writer, 'updateMetadata'),
    dispose: () => index.dispose(),
  };
}

async function callLabel(
  suite: LabelSuite,
  mode: 'add' | 'remove',
  label: string,
  taskIds: readonly string[],
): Promise<TasksBulkUpdateLabelResult> {
  return (await getHandler(
    suite.rpc,
    'tasks:bulkUpdateLabel',
  )({
    taskIds: [...taskIds],
    label,
    mode,
  })) as TasksBulkUpdateLabelResult;
}

/**
 * Fire an external whole-file write as a side effect of the FIRST read of
 * `taskId` after arming.
 *
 * That first read is the HANDLER's `getDetail`, so the external write lands
 * between the handler's read and the writer's — the exact window the writer's
 * pre-write re-read cannot see, because by the time the writer reads, the other
 * writer's bytes are already in its own snapshot and its re-read agrees.
 * `expectLabels` is the only thing standing between that window and a silent
 * overwrite.
 */
function armExternalLabelWrite(
  fs: MockFileSystemProvider,
  taskId: string,
  external: string,
): () => number {
  const carrier = labelCarrierPath(taskId);
  const readFile = fs.readFile.getMockImplementation() as (
    p: string,
  ) => Promise<string>;
  const writeFile = fs.writeFile.getMockImplementation() as (
    p: string,
    content: string,
  ) => Promise<void>;

  let armed = true;
  let fired = 0;
  fs.readFile.mockImplementation(async (p: string): Promise<string> => {
    const content = await readFile(p);
    if (p === carrier && armed) {
      armed = false;
      fired++;
      await writeFile(carrier, external);
    }
    return content;
  });
  return () => fired;
}

describe('tasks:bulkUpdateLabel — add', () => {
  it('adds the label to a task that lacks it and reports a plain success', async () => {
    const suite = await buildLabelSuite([
      { id: 'TASK_2026_401', labels: ['licensing'] },
    ]);
    try {
      const result = await callLabel(suite, 'add', 'security', [
        'TASK_2026_401',
      ]);

      // Whole-shape equality: `noop` must be ABSENT, not merely falsy. An
      // implementation that set `noop: false` on every success would pass a
      // `toBeFalsy` assertion and make the field meaningless.
      expect(result.results).toEqual([{ taskId: 'TASK_2026_401', ok: true }]);
      // Appended at the END — existing order is preserved.
      expect(labelsOf(suite.fs, 'TASK_2026_401')).toEqual([
        'licensing',
        'security',
      ]);
    } finally {
      suite.dispose();
    }
  });

  /**
   * The whole point of `noop`, and the assertion that makes it mean something.
   *
   * A "success" that quietly rewrote the carrier would be indistinguishable
   * from this one on `ok` alone. The byte comparison is what separates them:
   * `updateMetadata` refreshes `updated` on EVERY write, so a write that landed
   * here shows up as a changed `updated:` line even though the label set is
   * identical — a modification stamp recording a change that did not happen, on
   * a gitignored file with no undo.
   */
  it('reports a task that ALREADY carries the label as a no-op and leaves its bytes untouched', async () => {
    const suite = await buildLabelSuite([
      { id: 'TASK_2026_401', labels: ['licensing', 'security'] },
    ]);
    const before = readLabelCarrier(suite.fs, 'TASK_2026_401');
    try {
      const result = await callLabel(suite, 'add', 'security', [
        'TASK_2026_401',
      ]);

      expect(result.results).toEqual([
        { taskId: 'TASK_2026_401', ok: true, noop: true },
      ]);
      // Byte-identical — including the `updated:` stamp, asserted separately so
      // a failure names the actual defect rather than dumping the whole file.
      const after = readLabelCarrier(suite.fs, 'TASK_2026_401');
      expect(updatedStampOf(after)).toBe(LABEL_SEED_NOW);
      expect(after).toBe(before);
      // No write was even attempted. Without this, a writer that wrote
      // byte-identical content would pass the comparison above.
      expect(suite.fs.writeFile).not.toHaveBeenCalled();
      expect(suite.updateMetadata).not.toHaveBeenCalled();
    } finally {
      suite.dispose();
    }
  });

  /**
   * Labels match through the shared `labelKey` (`trim().toLowerCase()`), so a
   * differently-cased label is the SAME label. Adding it must not plant a
   * second casing.
   */
  it('treats a differently-cased label as already present', async () => {
    const suite = await buildLabelSuite([
      { id: 'TASK_2026_401', labels: ['Licensing'] },
    ]);
    try {
      const result = await callLabel(suite, 'add', 'licensing', [
        'TASK_2026_401',
      ]);

      expect(result.results).toEqual([
        { taskId: 'TASK_2026_401', ok: true, noop: true },
      ]);
      // The AUTHORED casing survives — matching is folded, storage is not.
      expect(labelsOf(suite.fs, 'TASK_2026_401')).toEqual(['Licensing']);
    } finally {
      suite.dispose();
    }
  });
});

describe('tasks:bulkUpdateLabel — remove', () => {
  it('removes a label that is present', async () => {
    const suite = await buildLabelSuite([
      { id: 'TASK_2026_401', labels: ['licensing', 'security'] },
    ]);
    try {
      const result = await callLabel(suite, 'remove', 'licensing', [
        'TASK_2026_401',
      ]);

      expect(result.results).toEqual([{ taskId: 'TASK_2026_401', ok: true }]);
      expect(labelsOf(suite.fs, 'TASK_2026_401')).toEqual(['security']);
    } finally {
      suite.dispose();
    }
  });

  it('reports removing a label the task does NOT carry as a no-op', async () => {
    const suite = await buildLabelSuite([
      { id: 'TASK_2026_401', labels: ['licensing'] },
    ]);
    const before = readLabelCarrier(suite.fs, 'TASK_2026_401');
    try {
      const result = await callLabel(suite, 'remove', 'security', [
        'TASK_2026_401',
      ]);

      expect(result.results).toEqual([
        { taskId: 'TASK_2026_401', ok: true, noop: true },
      ]);
      expect(readLabelCarrier(suite.fs, 'TASK_2026_401')).toBe(before);
      expect(suite.fs.writeFile).not.toHaveBeenCalled();
    } finally {
      suite.dispose();
    }
  });

  /** The removal test folds case exactly as the presence test does. */
  it('removes a differently-cased match', async () => {
    const suite = await buildLabelSuite([
      { id: 'TASK_2026_401', labels: ['Licensing', 'security'] },
    ]);
    try {
      const result = await callLabel(suite, 'remove', 'LICENSING', [
        'TASK_2026_401',
      ]);

      expect(result.results).toEqual([{ taskId: 'TASK_2026_401', ok: true }]);
      expect(labelsOf(suite.fs, 'TASK_2026_401')).toEqual(['security']);
    } finally {
      suite.dispose();
    }
  });

  /**
   * `[]` means REMOVE THE KEY on the write funnel, and that is the intended
   * outcome here rather than an edge to guard against.
   *
   * Asserted on the rendered TEXT: a `labels: []` line on disk parses back as
   * `[]` and would satisfy any value-only assertion while leaving a line the
   * author never wrote in a file the author owns.
   */
  it('removing the only label removes the labels: key entirely', async () => {
    const suite = await buildLabelSuite([
      { id: 'TASK_2026_401', labels: ['licensing'] },
    ]);
    try {
      const result = await callLabel(suite, 'remove', 'licensing', [
        'TASK_2026_401',
      ]);

      expect(result.results).toEqual([{ taskId: 'TASK_2026_401', ok: true }]);
      expect(readLabelCarrier(suite.fs, 'TASK_2026_401')).not.toContain(
        'labels:',
      );
    } finally {
      suite.dispose();
    }
  });
});

describe('tasks:bulkUpdateLabel — the limits live in TaskMetadataPatchSchema', () => {
  /**
   * The per-task cap constrains the MERGED array, which does not exist until
   * the handler has read the task's current labels — the request schema saw one
   * label and had nothing to count. So the enforcement has to happen in the
   * handler, and it happens by running the merged array through the ONE
   * definition of the limit rather than restating `12` there.
   */
  it('refuses a merged array over MAX_LABELS_PER_TASK with the schema’s own message', async () => {
    const full = Array.from(
      { length: MAX_LABELS_PER_TASK },
      (_v, i) => `label-${i}`,
    );
    const suite = await buildLabelSuite([
      { id: 'TASK_2026_401', labels: full },
    ]);
    const before = readLabelCarrier(suite.fs, 'TASK_2026_401');
    try {
      const result = await callLabel(suite, 'add', 'one-too-many', [
        'TASK_2026_401',
      ]);

      expect(result.results).toEqual([
        {
          taskId: 'TASK_2026_401',
          ok: false,
          error: {
            code: 'INVALID_PARAMS',
            // The limit is NAMED, from where it is defined. A generic "invalid
            // parameters" leaves a user who just hit the cap nothing to act on.
            message: `a task may carry at most ${MAX_LABELS_PER_TASK} labels`,
          },
        },
      ]);
      // Refused BEFORE the funnel — the writer was never asked.
      expect(suite.updateMetadata).not.toHaveBeenCalled();
      expect(readLabelCarrier(suite.fs, 'TASK_2026_401')).toBe(before);
      expect(suite.applyFolderChange).not.toHaveBeenCalled();
    } finally {
      suite.dispose();
    }
  });

  it('a task already AT the cap can still have a label removed', async () => {
    const full = Array.from(
      { length: MAX_LABELS_PER_TASK },
      (_v, i) => `label-${i}`,
    );
    const suite = await buildLabelSuite([
      { id: 'TASK_2026_401', labels: full },
    ]);
    try {
      const result = await callLabel(suite, 'remove', 'label-0', [
        'TASK_2026_401',
      ]);

      // The control for the test above: without it, an implementation that
      // refused every write once a task reached the cap would look correct.
      expect(result.results).toEqual([{ taskId: 'TASK_2026_401', ok: true }]);
      expect(labelsOf(suite.fs, 'TASK_2026_401')).toHaveLength(
        MAX_LABELS_PER_TASK - 1,
      );
    } finally {
      suite.dispose();
    }
  });
});

describe('tasks:bulkUpdateLabel — tasks the writer refuses', () => {
  it('reports a task with no carrier on disk as TASK_NOT_FOUND', async () => {
    const suite = await buildLabelSuite([
      { id: 'TASK_2026_401', labels: ['licensing'] },
    ]);
    try {
      const result = await callLabel(suite, 'add', 'security', [
        'TASK_2026_999',
      ]);

      expect(result.results).toEqual([
        {
          taskId: 'TASK_2026_999',
          ok: false,
          error: {
            code: 'TASK_NOT_FOUND',
            message: expect.stringContaining('TASK_2026_999'),
          },
        },
      ]);
      expect(suite.applyFolderChange).not.toHaveBeenCalled();
    } finally {
      suite.dispose();
    }
  });

  /**
   * `index.getDetail` collapses "no carrier" and "carrier that no longer
   * parses" into the same `null`, so a handler that answered `TASK_NOT_FOUND`
   * from that `null` would tell a user their BROKEN task does not exist.
   *
   * Delegating the null case to the writer is what keeps the two apart, and
   * this is the test that proves the distinction survives.
   */
  it('reports an unparseable carrier as TASK_EXCLUDED, not TASK_NOT_FOUND', async () => {
    const suite = await buildLabelSuite([
      { id: 'TASK_2026_402', raw: 'no frontmatter here at all\n' },
    ]);
    try {
      const result = await callLabel(suite, 'add', 'security', [
        'TASK_2026_402',
      ]);

      expect(result.results).toEqual([
        {
          taskId: 'TASK_2026_402',
          ok: false,
          error: {
            code: 'TASK_EXCLUDED',
            message: expect.stringContaining('TASK_2026_402'),
          },
        },
      ]);
      expect(suite.fs.writeFile).not.toHaveBeenCalled();
    } finally {
      suite.dispose();
    }
  });

  /**
   * THE reason `expectLabels` exists.
   *
   * The external write lands between the HANDLER's read and the WRITER's read.
   * The writer's own pre-write re-read cannot possibly catch it: by the time
   * the writer reads, the other writer's bytes ARE its snapshot, and its
   * re-read agrees with that snapshot. Without the precondition this call
   * writes `['security']` over the external writer's `['licensing',
   * 'urgent']` and reports `ok: true` — a silent discard with no undo.
   */
  it('refuses with TASK_CONFLICT when the labels changed between the read and the write', async () => {
    const suite = await buildLabelSuite([
      { id: 'TASK_2026_401', labels: ['licensing'] },
    ]);
    const external = updateFrontmatter(
      readLabelCarrier(suite.fs, 'TASK_2026_401'),
      { labels: ['licensing', 'urgent'] },
    );
    const fired = armExternalLabelWrite(suite.fs, 'TASK_2026_401', external);
    try {
      const result = await callLabel(suite, 'add', 'security', [
        'TASK_2026_401',
      ]);

      // The interleaving really happened — otherwise everything below is
      // vacuous, which is exactly how a concurrency test passes proving nothing.
      expect(fired()).toBe(1);
      expect(result.results).toEqual([
        {
          taskId: 'TASK_2026_401',
          ok: false,
          error: {
            code: 'TASK_CONFLICT',
            message: expect.stringContaining('TASK_2026_401'),
          },
        },
      ]);
      // The other writer's labels survive intact, and OURS is nowhere on disk.
      expect(labelsOf(suite.fs, 'TASK_2026_401')).toEqual([
        'licensing',
        'urgent',
      ]);
      expect(readLabelCarrier(suite.fs, 'TASK_2026_401')).toBe(external);
      expect(suite.applyFolderChange).not.toHaveBeenCalled();
    } finally {
      suite.dispose();
    }
  });

  /**
   * `currentStatus` enriches a STATUS conflict, because that user asked to
   * change the status and "changed to what?" has an answer. This user asked
   * about labels; a status they never mentioned is not that answer, and the
   * field is typed and documented as the status the carrier holds.
   */
  it('does not enrich a label conflict with currentStatus', async () => {
    const suite = await buildLabelSuite([
      { id: 'TASK_2026_401', labels: ['licensing'] },
    ]);
    const external = updateFrontmatter(
      readLabelCarrier(suite.fs, 'TASK_2026_401'),
      { labels: ['licensing', 'urgent'] },
    );
    armExternalLabelWrite(suite.fs, 'TASK_2026_401', external);
    try {
      const result = await callLabel(suite, 'add', 'security', [
        'TASK_2026_401',
      ]);

      expect(result.results[0]).not.toHaveProperty('currentStatus');
    } finally {
      suite.dispose();
    }
  });
});

describe('tasks:bulkUpdateLabel — the result list and the single rebuild', () => {
  const FIVE: readonly LabelSeed[] = [
    { id: 'TASK_2026_401', labels: ['licensing'] },
    { id: 'TASK_2026_402' },
    { id: 'TASK_2026_403', labels: ['security'] },
    { id: 'TASK_2026_404' },
    { id: 'TASK_2026_405', labels: ['licensing', 'security'] },
  ];

  it('returns one entry per requested id, in request order, mixing writes and no-ops', async () => {
    const suite = await buildLabelSuite(FIVE);
    try {
      // Reversed request order, so a handler that iterated the seed order (or
      // any sorted order) produces a visibly different list.
      const requested = [
        'TASK_2026_405',
        'TASK_2026_404',
        'TASK_2026_403',
        'TASK_2026_402',
        'TASK_2026_401',
      ];
      const result = await callLabel(suite, 'add', 'security', requested);

      expect(result.results).toEqual([
        // already carries `security`
        { taskId: 'TASK_2026_405', ok: true, noop: true },
        { taskId: 'TASK_2026_404', ok: true },
        { taskId: 'TASK_2026_403', ok: true, noop: true },
        { taskId: 'TASK_2026_402', ok: true },
        { taskId: 'TASK_2026_401', ok: true },
      ]);
      expect(result.results.map((entry) => entry.taskId)).toEqual(requested);
    } finally {
      suite.dispose();
    }
  });

  it('collapses a repeated id to ONE entry and ONE write', async () => {
    const suite = await buildLabelSuite(FIVE);
    try {
      const result = await callLabel(suite, 'add', 'security', [
        'TASK_2026_401',
        'TASK_2026_401',
        'TASK_2026_402',
      ]);

      expect(result.results).toEqual([
        { taskId: 'TASK_2026_401', ok: true },
        { taskId: 'TASK_2026_402', ok: true },
      ]);
      expect(suite.updateMetadata).toHaveBeenCalledTimes(2);
    } finally {
      suite.dispose();
    }
  });

  it('issues exactly ONE index rebuild for the whole call', async () => {
    const suite = await buildLabelSuite(FIVE);
    try {
      await callLabel(
        suite,
        'add',
        'security',
        FIVE.map((seed) => seed.id),
      );

      // Not "at most one" — exactly one. Three carriers changed, so zero would
      // leave the board stale, and dropping `deferNotify` would make it four.
      expect(suite.applyFolderChange).toHaveBeenCalledTimes(1);
    } finally {
      suite.dispose();
    }
  });

  it('passes deferNotify AND expectLabels on every write', async () => {
    const suite = await buildLabelSuite(FIVE);
    try {
      await callLabel(
        suite,
        'add',
        'security',
        FIVE.map((seed) => seed.id),
      );

      // Three writes — the two tasks that already carry `security` are no-ops
      // and never reach the funnel at all.
      expect(suite.updateMetadata).toHaveBeenCalledTimes(3);
      for (const call of suite.updateMetadata.mock.calls) {
        expect(call[3]).toEqual({
          deferNotify: true,
          expectLabels: expect.any(Array),
        });
      }
    } finally {
      suite.dispose();
    }
  });

  /**
   * The case the `written.length > 0` guard exists for, reached through the
   * door only this method has: every task was already in the requested state.
   * A rebuild here is a full rescan of every folder bought for no change.
   */
  it('rebuilds NOTHING when every task was a no-op', async () => {
    const suite = await buildLabelSuite([
      { id: 'TASK_2026_401', labels: ['security'] },
      { id: 'TASK_2026_403', labels: ['security', 'licensing'] },
    ]);
    try {
      const result = await callLabel(suite, 'add', 'security', [
        'TASK_2026_401',
        'TASK_2026_403',
      ]);

      expect(result.results).toEqual([
        { taskId: 'TASK_2026_401', ok: true, noop: true },
        { taskId: 'TASK_2026_403', ok: true, noop: true },
      ]);
      expect(suite.applyFolderChange).not.toHaveBeenCalled();
      expect(suite.fs.writeFile).not.toHaveBeenCalled();
    } finally {
      suite.dispose();
    }
  });

  /**
   * An UNEXPECTED throw must not convert a complete result list into an
   * exception. Placed at item 4 of 5, so three writes have landed before it and
   * one task follows it.
   */
  it('preserves landed writes when the funnel throws mid-loop, and still rebuilds once', async () => {
    const suite = await buildLabelSuite(FIVE);
    // Bound off the PROTOTYPE, not off the instance: `suite.updateMetadata` is
    // already a spy on the instance, so binding that would make this
    // implementation call itself forever.
    const passthrough = TaskWriterServiceClass.prototype.updateMetadata.bind(
      suite.writer,
    );
    suite.updateMetadata.mockImplementation((async (
      ...args: Parameters<typeof passthrough>
    ) => {
      if (args[1] === 'TASK_2026_404') {
        throw new Error('EBUSY: D:\\secrets\\TASK_2026_404\\task.md locked');
      }
      return passthrough(...args);
    }) as typeof passthrough);
    try {
      const result = await callLabel(suite, 'add', 'urgent', [
        'TASK_2026_401',
        'TASK_2026_402',
        'TASK_2026_403',
        'TASK_2026_404',
        'TASK_2026_405',
      ]);

      expect(result.results).toEqual([
        { taskId: 'TASK_2026_401', ok: true },
        { taskId: 'TASK_2026_402', ok: true },
        { taskId: 'TASK_2026_403', ok: true },
        {
          taskId: 'TASK_2026_404',
          ok: false,
          error: { code: 'WRITE_FAILED', message: expect.any(String) },
        },
        // The loop carried on past the unexpected fault.
        { taskId: 'TASK_2026_405', ok: true },
      ]);
      // R4.4 — the thrown message carried an absolute path; the wire must not.
      const failed = result.results.find((entry) => !entry.ok);
      expect(failed?.error?.message).not.toContain('D:\\secrets');
      expect(suite.applyFolderChange).toHaveBeenCalledTimes(1);
    } finally {
      suite.dispose();
    }
  });
});

describe('tasks:bulkUpdateLabel — boundary', () => {
  it('rejects a selection larger than BULK_CHUNK_SIZE', async () => {
    const { rpc, writer } = buildSuite();
    const tooMany = Array.from(
      { length: BULK_CHUNK_SIZE + 1 },
      (_v, i) => `TASK_2026_${200 + i}`,
    );

    await expect(
      getHandler(
        rpc,
        'tasks:bulkUpdateLabel',
      )({ taskIds: tooMany, label: 'security', mode: 'add' }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(writer.updateMetadata).not.toHaveBeenCalled();
  });

  it('accepts a selection of exactly BULK_CHUNK_SIZE', async () => {
    // The other half of the boundary: without it, a schema that capped at 19 —
    // or at 0 — would satisfy the rejection test above.
    const suite = await buildLabelSuite(
      Array.from({ length: BULK_CHUNK_SIZE }, (_v, i) => ({
        id: `TASK_2026_5${String(i).padStart(2, '0')}`,
      })),
    );
    try {
      const ids = Array.from(
        { length: BULK_CHUNK_SIZE },
        (_v, i) => `TASK_2026_5${String(i).padStart(2, '0')}`,
      );
      const result = await callLabel(suite, 'add', 'security', ids);

      expect(result.results).toHaveLength(BULK_CHUNK_SIZE);
      expect(result.results.every((entry) => entry.ok)).toBe(true);
    } finally {
      suite.dispose();
    }
  });

  it('rejects an empty selection', async () => {
    const { rpc, writer } = buildSuite();
    await expect(
      getHandler(
        rpc,
        'tasks:bulkUpdateLabel',
      )({ taskIds: [], label: 'security', mode: 'add' }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(writer.updateMetadata).not.toHaveBeenCalled();
  });

  it('rejects an unknown mode, writing nothing', async () => {
    const { rpc, writer } = buildSuite();
    await expect(
      getHandler(
        rpc,
        'tasks:bulkUpdateLabel',
      )({ taskIds: ['TASK_2026_401'], label: 'security', mode: 'toggle' }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(writer.updateMetadata).not.toHaveBeenCalled();
  });

  /**
   * An illegal label is refused as a RESULT LIST, not as a throw.
   *
   * These three used to reach the caller as `parse`'s single generic
   * "Invalid task request parameters." — and `callBulkChunk` on the board
   * expands a throw into ONE WRITE_FAILED ENTRY PER TASK in the chunk. So
   * selecting twelve tasks and typing a 40-character label produced a summary
   * reading "0 task(s) got the label; 12 were refused", stamped with a
   * write-failure code on twelve carriers nothing had tried to write, and with
   * no mention of the one thing the user could act on. The ≤12-per-task limit
   * already answered correctly, because it is enforced in `applyBulkLabel`
   * where a result list exists to put it in; these are the other two thirds of
   * the same contract.
   *
   * The asserted message is `LabelSchema`'s own, character for character.
   * `TaskBulkBarComponent` states in its doc-block that the label field ships
   * with NO `maxlength` precisely because the boundary's sentence comes back
   * per task — this is what makes that true rather than aspirational.
   */
  it.each([
    ['a blank label', '   ', 'a label may not be blank'],
    ['a label with a newline', 'a\nb', 'a label may not contain a newline'],
    [
      'an over-long label',
      'x'.repeat(MAX_LABEL_LENGTH + 1),
      `a label may be at most ${MAX_LABEL_LENGTH} characters`,
    ],
  ] as const)(
    'refuses %s per task, in the schema own words, writing nothing',
    async (_name, label, message) => {
      const { rpc, writer } = buildSuite();

      const result = (await getHandler(
        rpc,
        'tasks:bulkUpdateLabel',
      )({
        taskIds: ['TASK_2026_401', 'TASK_2026_402'],
        label,
        mode: 'add',
      })) as TasksBulkUpdateLabelResult;

      // One entry per requested id (FR-C4.3), each carrying the code that
      // describes what actually happened: the request was refused, nothing was
      // written, and retrying it unchanged cannot help.
      expect(result.results).toEqual([
        {
          taskId: 'TASK_2026_401',
          ok: false,
          error: { code: 'INVALID_PARAMS', message },
        },
        {
          taskId: 'TASK_2026_402',
          ok: false,
          error: { code: 'INVALID_PARAMS', message },
        },
      ]);
      expect(writer.updateMetadata).not.toHaveBeenCalled();
    },
  );

  it.each(REJECTED_IDS)(
    'rejects %s among the taskIds, writing nothing',
    async (_label, value) => {
      const { rpc, writer } = buildSuite();
      await expect(
        getHandler(
          rpc,
          'tasks:bulkUpdateLabel',
        )({
          taskIds: ['TASK_2026_401', value],
          label: 'security',
          mode: 'add',
        }),
      ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
      expect(writer.updateMetadata).not.toHaveBeenCalled();
    },
  );
});

// ── The namespace-wide workspace guard ───────────────────────────────────────
//
// `resolveRoot` is the ONE place a `tasks:*` root becomes a filesystem path, so
// the guard lives there and this block asserts it namespace-wide rather than
// method-by-method. A new `tasks:*` method that forgets the guard cannot exist:
// it either routes through `resolveRoot` (and is covered by the sweep below,
// which is driven off `TasksRpcHandlers.METHODS`) or it fails the "every method
// is exercised" assertion.
describe('tasks:* workspace authorization', () => {
  const OUTSIDE = 'D:\\somewhere-else';

  /**
   * Schema-valid params for every method in `METHODS`, minus `workspaceRoot`.
   *
   * Required because `parse()` runs BEFORE `resolveRoot`, so a sweep with empty
   * params would prove only that Zod rejects them. Keyed by method name and
   * asserted exhaustive against `METHODS` below, so adding a method to the
   * namespace without adding its params here fails HERE rather than silently
   * shrinking the sweep.
   */
  const VALID_PARAMS: Record<string, Record<string, unknown>> = {
    'tasks:list': {},
    'tasks:get': { taskId: 'TASK_2026_401' },
    'tasks:getArtifact': {
      taskId: 'TASK_2026_401',
      file: 'implementation-plan.md',
    },
    'tasks:getRoundJudge': { taskId: 'TASK_2026_401', round: 1 },
    'tasks:create': { title: 'T', type: 'BUGFIX' },
    'tasks:sweepFinished': { olderThanDays: 7, apply: false },
    'tasks:updateStatus': { taskId: 'TASK_2026_401', status: 'done' },
    'tasks:updateMetadata': {
      taskId: 'TASK_2026_401',
      patch: { labels: ['security'] },
    },
    'tasks:bulkUpdateStatus': {
      taskIds: ['TASK_2026_401'],
      status: 'done',
    },
    'tasks:bulkUpdateLabel': {
      taskIds: ['TASK_2026_401'],
      label: 'security',
      mode: 'add',
    },
    'tasks:generateRegistry': {},
    'tasks:board': {},
    'tasks:reindex': {},
    'tasks:adopt': {
      folderName: 'TASK_2026_401',
      title: 'T',
      type: 'BUGFIX',
      status: 'done',
    },
    'tasks:doctorPlan': {},
    'tasks:getViews': {},
    'tasks:saveViews': { views: [] },
  };

  it('has sweep params for every method in METHODS', () => {
    expect(Object.keys(VALID_PARAMS).sort()).toEqual(
      [...TasksRpcHandlers.METHODS].sort(),
    );
  });

  it.each([...TasksRpcHandlers.METHODS])(
    '%s rejects a workspaceRoot outside every open folder',
    async (method) => {
      const { rpc } = buildSuite();
      const handler = getHandler(rpc, method);
      await expect(
        handler({ ...VALID_PARAMS[method], workspaceRoot: OUTSIDE }),
      ).rejects.toMatchObject({ errorCode: 'UNAUTHORIZED_WORKSPACE' });
    },
  );

  it('rejects before warming the index or writing anything', async () => {
    const { rpc, index, writer, registry, doctor } = buildSuite();
    await expect(
      getHandler(
        rpc,
        'tasks:bulkUpdateLabel',
      )({
        taskIds: ['TASK_2026_401', 'TASK_2026_402'],
        label: 'security',
        mode: 'add',
        workspaceRoot: OUTSIDE,
      }),
    ).rejects.toMatchObject({ errorCode: 'UNAUTHORIZED_WORKSPACE' });
    expect(index.ensureStarted).not.toHaveBeenCalled();
    expect(index.reindex).not.toHaveBeenCalled();
    expect(writer.updateMetadata).not.toHaveBeenCalled();
    expect(registry.generate).not.toHaveBeenCalled();
    expect(doctor.plan).not.toHaveBeenCalled();
  });

  it('admits the implicit root when no workspaceRoot is supplied', async () => {
    const { rpc, index } = buildSuite();
    await expect(getHandler(rpc, 'tasks:board')({})).resolves.toBeDefined();
    expect(index.ensureStarted).toHaveBeenCalledWith(
      normalizeWorkspaceRoot('D:\\workspace'),
    );
  });

  it('admits the open folder itself', async () => {
    const { rpc, index } = buildSuite();
    await expect(
      getHandler(rpc, 'tasks:board')({ workspaceRoot: 'D:\\workspace' }),
    ).resolves.toBeDefined();
    expect(index.ensureStarted).toHaveBeenCalledWith(
      normalizeWorkspaceRoot('D:\\workspace'),
    );
  });

  // The CLI/TUI transport is a real non-webview caller: `ptah spec *` passes
  // `workspaceRoot: globals.cwd`, and `with-engine.ts` hands that SAME value to
  // `CliWorkspaceProvider` as its single folder. So the CLI's explicit root is
  // always the authorized folder or a descendant of it — this pins the second
  // case, which is what `ptah spec` run from a subdirectory produces.
  it('admits a path inside the open folder (CLI cwd case)', async () => {
    const { rpc, index } = buildSuite();
    await expect(
      getHandler(rpc, 'tasks:board')({ workspaceRoot: 'D:\\workspace\\apps' }),
    ).resolves.toBeDefined();
    expect(index.ensureStarted).toHaveBeenCalledWith(
      normalizeWorkspaceRoot('D:\\workspace\\apps'),
    );
  });

  it('rejects a sibling folder that shares a name prefix', async () => {
    const { rpc } = buildSuite();
    await expect(
      getHandler(rpc, 'tasks:board')({ workspaceRoot: 'D:\\workspace-evil' }),
    ).rejects.toMatchObject({ errorCode: 'UNAUTHORIZED_WORKSPACE' });
  });
});
