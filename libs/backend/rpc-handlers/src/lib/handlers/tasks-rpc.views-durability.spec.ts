/**
 * R7 — saved views survive a reindex (TASK_2026_181, Phase 5 gate).
 *
 * ## What this file exists to prove, and why it is not a unit test
 *
 * D2 decided that saved views live in `~/.ptah/settings.json` rather than in
 * the SQLite index. That decision only pays for itself under ONE event: a
 * routine reindex, which destroys and rebuilds everything the index holds. A
 * test that stubbed the settings layer could not tell the two storage choices
 * apart, so this suite uses the REAL `TasksSettings` over a REAL file-backed
 * `ISettingsStore` writing a real JSON file on disk, and a task index whose
 * entire state is a real file that the test deletes.
 *
 * Three assertions carry the weight, and each fails if the storage were wrong:
 *
 *  1. after a save, the view id is in the SETTINGS file and is NOT in the index
 *     database file;
 *  2. deleting the database and reindexing rebuilds the index — and the rebuilt
 *     database still carries no view;
 *  3. a COLD read, through a freshly constructed store and repository with no
 *     in-memory cache, still returns the view.
 *
 * (3) is what makes this more than a cache test: `ReactiveSettingsStore` keeps
 * a read-through cache, so a same-process read after the save proves nothing
 * about the disk. Nothing in the cold reader shares state with the writer.
 *
 * ## Verified to bite
 *
 * The whole rig was re-run with the settings storage repointed at the index
 * database file — the exact defect D2 exists to prevent. Assertion (1) and the
 * cold read both went red; the same-process read did not, which is why the cold
 * read is part of the survival test rather than a separate one beside it.
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as os from 'os';
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
import type {
  IDisposable,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type {
  RegistryGeneratorService,
  TaskDoctorService,
  TaskIndexService,
  TaskSweepService,
  TaskWriterService,
} from '@ptah-extension/task-specs';
import {
  ReactiveSettingsStore,
  TasksSettings,
  type ISettingsStore,
} from '@ptah-extension/settings-core';
import {
  DEFAULT_TASK_SORT,
  EMPTY_TASK_FILTER,
  type SavedTaskView,
  type TasksGetViewsResult,
  type TasksReindexResult,
  type TasksSaveViewsResult,
} from '@ptah-extension/shared';

import { TasksRpcHandlers } from './tasks-rpc.handlers';

/**
 * A genuinely file-backed settings store.
 *
 * Not a double for the settings layer — it is the I/O adapter the settings
 * layer is defined against, written against a temp file instead of the user's
 * home directory. `TasksSettings` and `ReactiveSettingsStore` above it are the
 * real production classes.
 */
class JsonFileSettingsStore implements ISettingsStore {
  public constructor(private readonly file: string) {}

  public readGlobal<T>(key: string): T | undefined {
    const all = this.readAll();
    return all[key] as T | undefined;
  }

  public async writeGlobal<T>(key: string, value: T): Promise<void> {
    const all = this.readAll();
    all[key] = value;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(all, null, 2), 'utf8');
  }

  public async readSecret(): Promise<string | undefined> {
    return undefined;
  }

  public async writeSecret(): Promise<void> {
    /* no secrets are involved in saved views */
  }

  public async deleteSecret(): Promise<void> {
    /* no secrets are involved in saved views */
  }

  public watchGlobal(): IDisposable {
    return { dispose: () => undefined };
  }

  public watchSecret(): IDisposable {
    return { dispose: () => undefined };
  }

  public flushSync(): void {
    /* every write above is already synchronous */
  }

  private readAll(): Record<string, unknown> {
    if (!fs.existsSync(this.file)) return {};
    const raw = fs.readFileSync(this.file, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  }
}

/**
 * A task index whose ENTIRE state is one file on disk.
 *
 * This is the property the test needs and the only one it models: an index is
 * derived data, it lives in a database file, and deleting that file loses
 * everything in it until a reindex rebuilds it from the carriers. Using the
 * real `SqliteTaskIndexStore` here would put the suite behind the
 * `better-sqlite3` ABI gate (BR-13) and it would SELF-SKIP inside the batch
 * gate — a check that cannot fail is not a check.
 */
function createFileBackedIndex(dbPath: string, indexedIds: readonly string[]) {
  const readRows = (): string[] => {
    if (!fs.existsSync(dbPath)) return [];
    return JSON.parse(fs.readFileSync(dbPath, 'utf8')) as string[];
  };
  const writeRows = (rows: readonly string[]): void => {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.writeFileSync(dbPath, JSON.stringify(rows), 'utf8');
  };
  writeRows(indexedIds);

  return {
    onDidChangeIndex: jest.fn(() => ({ dispose: jest.fn() })),
    ensureStarted: jest.fn(async () => undefined),
    list: jest.fn(async () => ({
      tasks: readRows().map((id) => ({ id })),
      excluded: [],
      excludedCount: 0,
      specsDirExists: true,
    })),
    getDetail: jest.fn(async () => null),
    reindex: jest.fn(async (): Promise<TasksReindexResult> => {
      // A reindex rebuilds the database from the carriers on disk. Nothing it
      // rebuilds from mentions a saved view, because a view was never in here.
      writeRows(indexedIds);
      return {
        success: true,
        indexedCount: indexedIds.length,
        excludedCount: 0,
        durationMs: 1,
      };
    }),
    readRows,
  };
}

interface Rig {
  readonly settingsFile: string;
  readonly dbPath: string;
  readonly rpc: MockRpcHandler;
  readonly index: ReturnType<typeof createFileBackedIndex>;
  readonly call: <T>(method: string, params: unknown) => Promise<T>;
}

const WORKSPACE_ROOT = 'D:\\workspace';
const INDEXED_IDS = ['TASK_2026_200', 'TASK_2026_201'] as const;

function buildHandlers(
  settingsFile: string,
  index: ReturnType<typeof createFileBackedIndex>,
): MockRpcHandler {
  const rpc = createMockRpcHandler();
  const workspace = createMockWorkspaceProvider({ folders: [WORKSPACE_ROOT] });
  workspace.getWorkspaceRoot.mockReturnValue(WORKSPACE_ROOT);

  const settings = new TasksSettings(
    new ReactiveSettingsStore(new JsonFileSettingsStore(settingsFile)),
  );

  const noopWriter = {
    create: jest.fn(),
    updateStatus: jest.fn(),
    updateMetadata: jest.fn(),
    adoptFolder: jest.fn(),
  };

  const handlers = new TasksRpcHandlers(
    createMockLogger() as unknown as Logger,
    rpc as unknown as RpcHandler,
    { broadcastMessage: jest.fn() } as unknown as WebviewManager,
    workspace as unknown as IWorkspaceProvider,
    index as unknown as unknown as TaskIndexService,
    noopWriter as unknown as TaskWriterService,
    { generate: jest.fn() } as unknown as RegistryGeneratorService,
    { plan: jest.fn() } as unknown as TaskDoctorService,
    createInertSweep() as unknown as TaskSweepService,
    settings,
  );
  handlers.register();
  return rpc;
}

function callerFor(rpc: MockRpcHandler) {
  return async <T>(method: string, params: unknown): Promise<T> => {
    const calls = (rpc.registerMethod as jest.Mock).mock.calls as Array<
      [string, (p: unknown) => Promise<unknown>]
    >;
    const match = calls.find(([name]) => name === method);
    if (!match) throw new Error(`Method '${method}' was not registered`);
    return (await match[1](params)) as T;
  };
}

const VIEW: SavedTaskView = {
  id: 'view-durability-1',
  name: 'Blocked work',
  filter: { ...EMPTY_TASK_FILTER, statuses: ['blocked'] },
  sort: DEFAULT_TASK_SORT,
  order: 0,
};

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

describe('R7 — a saved view survives deleting the index and reindexing', () => {
  let tmp: string;
  let rig: Rig;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-views-r7-'));
    const settingsFile = path.join(tmp, '.ptah', 'settings.json');
    const dbPath = path.join(tmp, '.ptah', 'ptah.db');
    const index = createFileBackedIndex(dbPath, INDEXED_IDS);
    const rpc = buildHandlers(settingsFile, index);
    rig = { settingsFile, dbPath, rpc, index, call: callerFor(rpc) };
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('stores the view in the settings file and not in the index database', async () => {
    const saved = await rig.call<TasksSaveViewsResult>('tasks:saveViews', {
      workspaceRoot: WORKSPACE_ROOT,
      views: [VIEW],
      activeViewId: VIEW.id,
    });

    expect(saved.success).toBe(true);
    // The load-bearing assertion of D2. Reverse the storage decision and the
    // first of these goes red immediately.
    expect(fs.readFileSync(rig.settingsFile, 'utf8')).toContain(VIEW.id);
    expect(fs.readFileSync(rig.dbPath, 'utf8')).not.toContain(VIEW.id);
  });

  it('keeps the view after the database is deleted and rebuilt', async () => {
    await rig.call('tasks:saveViews', {
      workspaceRoot: WORKSPACE_ROOT,
      views: [VIEW],
      activeViewId: VIEW.id,
    });

    // Delete the index database, exactly as a corrupted-index recovery does.
    fs.rmSync(rig.dbPath);
    expect(fs.existsSync(rig.dbPath)).toBe(false);
    expect(rig.index.readRows()).toEqual([]);

    const reindexed = await rig.call<TasksReindexResult>('tasks:reindex', {
      workspaceRoot: WORKSPACE_ROOT,
    });

    // The index genuinely lost and rebuilt its contents — this is what makes
    // the surviving view meaningful rather than a no-op.
    expect(reindexed.success).toBe(true);
    expect(rig.index.readRows()).toEqual([...INDEXED_IDS]);
    expect(fs.readFileSync(rig.dbPath, 'utf8')).not.toContain(VIEW.id);

    const read = await rig.call<TasksGetViewsResult>('tasks:getViews', {
      workspaceRoot: WORKSPACE_ROOT,
    });

    expect(read.views).toHaveLength(1);
    expect(read.views[0].id).toBe(VIEW.id);
    expect(read.views[0].name).toBe('Blocked work');
    expect(read.views[0].filter.statuses).toEqual(['blocked']);
    expect(read.activeViewId).toBe(VIEW.id);
    expect(read.skipped).toBe(0);

    // The COLD read, and it is inside this test rather than beside it on
    // purpose. `ReactiveSettingsStore` keeps a read-through cache, so the
    // assertion above is satisfiable by a process that never touched the disk
    // at all — verified directly: with the storage repointed at the database
    // file, everything above still passed and only this read went red. A
    // second store, repository and handler set share no memory with the
    // writer, so the only surviving route from the save to here is the file.
    const coldRead = await callerFor(
      buildHandlers(
        rig.settingsFile,
        createFileBackedIndex(rig.dbPath, INDEXED_IDS),
      ),
    )<TasksGetViewsResult>('tasks:getViews', {
      workspaceRoot: WORKSPACE_ROOT,
    });

    expect(coldRead.views.map((view) => view.id)).toEqual([VIEW.id]);
    expect(coldRead.activeViewId).toBe(VIEW.id);
  });

  /**
   * FR-C2.3 against the real settings file rather than a stubbed handle: one
   * malformed entry is dropped and counted, and the rest still load.
   */
  it('skips a malformed stored entry, counts it, and loads the rest', async () => {
    fs.mkdirSync(path.dirname(rig.settingsFile), { recursive: true });
    fs.writeFileSync(
      rig.settingsFile,
      JSON.stringify({
        'tasks.savedViews': [VIEW, 42, { id: 'no-name-here' }],
        'tasks.activeViewId': VIEW.id,
      }),
      'utf8',
    );

    const read = await rig.call<TasksGetViewsResult>('tasks:getViews', {
      workspaceRoot: WORKSPACE_ROOT,
    });

    expect(read.views.map((view) => view.id)).toEqual([VIEW.id]);
    expect(read.skipped).toBe(2);
    expect(read.activeViewId).toBe(VIEW.id);
  });

  /**
   * NFR-11 against the real file: a settings file that is not JSON at all
   * still yields a readable answer, so the board renders.
   */
  it('answers with an empty list when the settings file cannot be parsed', async () => {
    fs.mkdirSync(path.dirname(rig.settingsFile), { recursive: true });
    fs.writeFileSync(rig.settingsFile, 'this is not json', 'utf8');

    const read = await rig.call<TasksGetViewsResult>('tasks:getViews', {
      workspaceRoot: WORKSPACE_ROOT,
    });

    expect(read).toEqual({ views: [], activeViewId: null, skipped: 0 });
  });
});
