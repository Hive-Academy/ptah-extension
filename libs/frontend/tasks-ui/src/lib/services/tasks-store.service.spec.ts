/**
 * TasksStore — signal store tests.
 *
 * Stubs `ClaudeRpcService.call` so board load, push-triggered refresh, and the
 * (non-optimistic) status-change path are exercised against the real `tasks:*`
 * RPC names without the message bus.
 */
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AppStateManager, ClaudeRpcService } from '@ptah-extension/core';
import {
  TASK_STATUSES,
  type TaskSpecSummary,
  type TaskStatus,
  type TasksBoardResult,
} from '@ptah-extension/shared';
import {
  TasksStore,
  TASKS_CHANGED_MESSAGE_TYPE,
  normalizeRootKey,
} from './tasks-store.service';

function makeTask(
  id: string,
  status: TaskStatus,
  overrides: Partial<TaskSpecSummary> = {},
): TaskSpecSummary {
  return {
    id,
    folderName: id,
    status,
    type: 'FEATURE',
    title: `Title ${id}`,
    dependsOn: [],
    created: '2026-07-14T10:00:00.000Z',
    updated: '2026-07-14T10:00:00.000Z',
    frontmatterValid: true,
    validationIssues: [],
    ...overrides,
  };
}

function makeBoard(
  partial: Partial<Record<TaskStatus, TaskSpecSummary[]>>,
  meta: Partial<
    Pick<TasksBoardResult, 'excludedCount' | 'specsDirExists'>
  > = {},
): TasksBoardResult {
  const columns = TASK_STATUSES.reduce(
    (acc, status) => {
      acc[status] = partial[status] ?? [];
      return acc;
    },
    {} as Record<TaskStatus, TaskSpecSummary[]>,
  );
  return {
    columns,
    excludedCount: meta.excludedCount ?? 0,
    specsDirExists: meta.specsDirExists ?? true,
  };
}

const ok = <T>(data: T) => ({
  success: true,
  isSuccess: () => true,
  data,
});
const err = (error: string) => ({
  success: false,
  isSuccess: () => false,
  error,
});

describe('TasksStore', () => {
  let store: TasksStore;
  let rpcCall: jest.Mock;

  beforeEach(() => {
    rpcCall = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        TasksStore,
        {
          provide: ClaudeRpcService,
          useValue: { call: rpcCall as unknown as ClaudeRpcService['call'] },
        },
      ],
    });
    store = TestBed.inject(TasksStore);
  });

  it('loadBoard() populates columns, excluded count, and specsDirExists', async () => {
    rpcCall.mockResolvedValue(
      ok(
        makeBoard(
          { backlog: [makeTask('TASK_2026_200', 'backlog')] },
          { excludedCount: 85, specsDirExists: true },
        ),
      ),
    );

    await store.loadBoard();

    expect(rpcCall).toHaveBeenCalledWith('tasks:board', {});
    expect(store.columns().backlog).toHaveLength(1);
    expect(store.excludedCount()).toBe(85);
    expect(store.specsDirExists()).toBe(true);
    expect(store.totalCount()).toBe(1);
    expect(store.isEmpty()).toBe(false);
  });

  it('board() computed exposes all six columns in canonical order', async () => {
    rpcCall.mockResolvedValue(ok(makeBoard({})));

    await store.loadBoard();

    expect(store.board().map((c) => c.status)).toEqual([...TASK_STATUSES]);
  });

  it('isEmpty() is true after a load when the specs dir is absent', async () => {
    rpcCall.mockResolvedValue(ok(makeBoard({}, { specsDirExists: false })));

    await store.loadBoard();

    expect(store.isEmpty()).toBe(true);
  });

  it('records an error when the board load fails', async () => {
    rpcCall.mockResolvedValue(err('scan-failed'));

    await store.loadBoard();

    expect(store.error()).toBe('scan-failed');
  });

  it('handleMessage refreshes the board on a tasks:changed push', async () => {
    rpcCall.mockResolvedValue(ok(makeBoard({})));

    store.handleMessage({ type: TASKS_CHANGED_MESSAGE_TYPE });
    await Promise.resolve();
    await Promise.resolve();

    expect(rpcCall).toHaveBeenCalledWith('tasks:board', {});
  });

  it('handleMessage ignores unrelated message types', () => {
    store.handleMessage({ type: 'something:else' });
    expect(rpcCall).not.toHaveBeenCalled();
  });

  it('updateStatus does NOT optimistically move the card before re-fetch', async () => {
    rpcCall.mockResolvedValueOnce(
      ok(makeBoard({ backlog: [makeTask('TASK_2026_200', 'backlog')] })),
    );
    await store.loadBoard();
    expect(store.columns().backlog).toHaveLength(1);

    // updateStatus success, then an authoritative re-fetch that moves the card.
    rpcCall.mockResolvedValueOnce(
      ok({ success: true, task: makeTask('TASK_2026_200', 'in_progress') }),
    );
    rpcCall.mockResolvedValueOnce(
      ok(
        makeBoard({ in_progress: [makeTask('TASK_2026_200', 'in_progress')] }),
      ),
    );

    await store.updateStatus('TASK_2026_200', 'in_progress');

    expect(rpcCall).toHaveBeenCalledWith('tasks:updateStatus', {
      taskId: 'TASK_2026_200',
      status: 'in_progress',
    });
    // The board reflects the server-authoritative re-fetch, not a local guess.
    expect(store.columns().backlog).toHaveLength(0);
    expect(store.columns().in_progress).toHaveLength(1);
  });

  it('updateStatus surfaces the structured backend error', async () => {
    rpcCall.mockResolvedValueOnce(
      ok({
        success: false,
        error: { code: 'TASK_EXCLUDED', message: 'excluded' },
      }),
    );

    await store.updateStatus('TASK_2026_200', 'done');

    expect(store.error()).toBe('excluded');
  });

  it('createTask reloads the board on success', async () => {
    rpcCall.mockResolvedValueOnce(
      ok({ success: true, task: makeTask('TASK_2026_201', 'backlog') }),
    );
    rpcCall.mockResolvedValueOnce(
      ok(makeBoard({ backlog: [makeTask('TASK_2026_201', 'backlog')] })),
    );

    const result = await store.createTask({ title: 'New', type: 'FEATURE' });

    expect(rpcCall).toHaveBeenCalledWith('tasks:create', {
      title: 'New',
      type: 'FEATURE',
    });
    expect(result?.success).toBe(true);
    expect(store.columns().backlog).toHaveLength(1);
  });

  it('reindex sets an action message and reloads', async () => {
    rpcCall.mockResolvedValueOnce(
      ok({ success: true, indexedCount: 3, excludedCount: 85, durationMs: 12 }),
    );
    rpcCall.mockResolvedValueOnce(ok(makeBoard({})));

    await store.reindex();

    expect(rpcCall).toHaveBeenCalledWith('tasks:reindex', {});
    expect(store.actionMessage()).toContain('3');
  });

  describe('visibility/focus staleness reconcile', () => {
    it('re-fetches the board on window focus after an initial load', async () => {
      rpcCall.mockResolvedValue(ok(makeBoard({})));
      await store.loadBoard();
      expect(rpcCall).toHaveBeenCalledTimes(1);

      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
      await Promise.resolve();

      expect(rpcCall).toHaveBeenCalledTimes(2);
      expect(rpcCall).toHaveBeenLastCalledWith('tasks:board', {});
    });

    it('re-fetches on visibilitychange when the document becomes visible', async () => {
      rpcCall.mockResolvedValue(ok(makeBoard({})));
      await store.loadBoard();
      expect(rpcCall).toHaveBeenCalledTimes(1);

      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();

      // jsdom default visibilityState is 'visible' → reconcile fires.
      expect(rpcCall).toHaveBeenCalledTimes(2);
    });

    it('does NOT reconcile on focus before the first load has completed', async () => {
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();

      expect(rpcCall).not.toHaveBeenCalled();
    });

    it('stops reconciling once the injector is destroyed', async () => {
      rpcCall.mockResolvedValue(ok(makeBoard({})));
      await store.loadBoard();
      expect(rpcCall).toHaveBeenCalledTimes(1);

      TestBed.resetTestingModule();

      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();

      // Listener was torn down with the root injector — no extra fetch.
      expect(rpcCall).toHaveBeenCalledTimes(1);
    });
  });

  it('openTask fetches and stores the detail', async () => {
    const detail = {
      ...makeTask('TASK_2026_200', 'backlog'),
      body: '# body',
      artifacts: ['task.md'],
    };
    rpcCall.mockResolvedValueOnce(ok({ task: detail }));

    await store.openTask('TASK_2026_200');

    expect(rpcCall).toHaveBeenCalledWith('tasks:get', {
      taskId: 'TASK_2026_200',
    });
    expect(store.selectedTaskId()).toBe('TASK_2026_200');
    expect(store.taskDetail()?.body).toBe('# body');
  });
});

// ---------------------------------------------------------------------------
// TasksStore — workspace awareness
//
// The Electron shell keeps this page mounted across workspace switches. These
// tests cover: explicit `workspaceRoot` on every scoped RPC, board reload on
// switch, instant cached repaint on switch-back, the switched-away race guard,
// and `tasks:changed` push routing by workspace root.
// ---------------------------------------------------------------------------

type Ws = { path: string; name: string; type: string };

describe('TasksStore — workspace awareness', () => {
  let store: TasksStore;
  let rpcCall: jest.Mock;
  let workspaceInfo: ReturnType<typeof signal<Ws | null>>;

  const wsA: Ws = { path: 'D:/ws-a', name: 'a', type: 'workspace' };
  const wsB: Ws = { path: 'D:/ws-b', name: 'b', type: 'workspace' };

  function configure(): void {
    TestBed.configureTestingModule({
      providers: [
        TasksStore,
        {
          provide: ClaudeRpcService,
          useValue: { call: rpcCall as unknown as ClaudeRpcService['call'] },
        },
        { provide: AppStateManager, useValue: { workspaceInfo } },
      ],
    });
    store = TestBed.inject(TasksStore);
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    rpcCall = jest.fn().mockResolvedValue(ok(makeBoard({})));
    workspaceInfo = signal<Ws | null>(wsA);
  });

  const flush = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  it('sends the active workspaceRoot on every tasks RPC that supports it', async () => {
    configure();

    await store.loadBoard();
    expect(rpcCall).toHaveBeenLastCalledWith('tasks:board', {
      workspaceRoot: 'D:/ws-a',
    });

    rpcCall.mockClear();
    rpcCall.mockResolvedValueOnce(ok({ task: null }));
    await store.openTask('TASK_2026_200');
    expect(rpcCall).toHaveBeenCalledWith('tasks:get', {
      taskId: 'TASK_2026_200',
      workspaceRoot: 'D:/ws-a',
    });

    rpcCall.mockClear();
    rpcCall.mockResolvedValueOnce(ok({ success: true }));
    rpcCall.mockResolvedValueOnce(ok(makeBoard({})));
    await store.updateStatus('TASK_2026_200', 'done');
    expect(rpcCall).toHaveBeenNthCalledWith(1, 'tasks:updateStatus', {
      taskId: 'TASK_2026_200',
      status: 'done',
      workspaceRoot: 'D:/ws-a',
    });

    rpcCall.mockClear();
    rpcCall.mockResolvedValueOnce(
      ok({ success: true, task: makeTask('TASK_2026_201', 'backlog') }),
    );
    rpcCall.mockResolvedValueOnce(ok(makeBoard({})));
    await store.createTask({ title: 'New', type: 'FEATURE' });
    expect(rpcCall).toHaveBeenNthCalledWith(1, 'tasks:create', {
      title: 'New',
      type: 'FEATURE',
      workspaceRoot: 'D:/ws-a',
    });

    rpcCall.mockClear();
    rpcCall.mockResolvedValueOnce(
      ok({ success: true, indexedCount: 1, excludedCount: 0, durationMs: 5 }),
    );
    rpcCall.mockResolvedValueOnce(ok(makeBoard({})));
    await store.reindex();
    expect(rpcCall).toHaveBeenNthCalledWith(1, 'tasks:reindex', {
      workspaceRoot: 'D:/ws-a',
    });
  });

  it('reloads the board with the new workspaceRoot when the workspace switches', async () => {
    configure();
    TestBed.tick(); // first effect run only records the current key
    await store.loadBoard();
    expect(rpcCall).toHaveBeenLastCalledWith('tasks:board', {
      workspaceRoot: 'D:/ws-a',
    });

    rpcCall.mockClear();
    rpcCall.mockResolvedValue(ok(makeBoard({ done: [makeTask('B', 'done')] })));
    workspaceInfo.set(wsB);
    TestBed.tick();
    await flush();

    expect(rpcCall).toHaveBeenCalledWith('tasks:board', {
      workspaceRoot: 'D:/ws-b',
    });
    expect(store.columns().done).toHaveLength(1);
  });

  it('paints the cached board instantly on switch-back, before the refetch resolves', async () => {
    configure();
    TestBed.tick();

    rpcCall.mockResolvedValue(
      ok(makeBoard({ backlog: [makeTask('A', 'backlog')] })),
    );
    await store.loadBoard(); // ws-a → backlog A (cached)
    expect(store.columns().backlog).toHaveLength(1);

    rpcCall.mockResolvedValue(ok(makeBoard({ done: [makeTask('B', 'done')] })));
    workspaceInfo.set(wsB);
    TestBed.tick();
    await flush();
    expect(store.columns().done).toHaveLength(1);
    expect(store.columns().backlog).toHaveLength(0);

    // Switch back to ws-a: the refetch is deferred so we can assert the cached
    // slice is painted synchronously by the effect tick.
    let resolveA: (v: unknown) => void = () => undefined;
    rpcCall.mockImplementation(
      () =>
        new Promise((r) => {
          resolveA = r;
        }),
    );
    workspaceInfo.set(wsA);
    TestBed.tick();
    expect(store.columns().backlog).toHaveLength(1);
    expect(store.columns().done).toHaveLength(0);

    resolveA(ok(makeBoard({ backlog: [makeTask('A', 'backlog')] })));
    await flush();
  });

  it('does not let a slow response for a switched-away workspace overwrite the active board', async () => {
    configure();
    TestBed.tick();

    let resolveB: (v: unknown) => void = () => undefined;
    rpcCall.mockImplementation(
      (_method: string, params: { workspaceRoot?: string }) => {
        if (params.workspaceRoot === 'D:/ws-b') {
          return new Promise((r) => {
            resolveB = r;
          });
        }
        return Promise.resolve(
          ok(makeBoard({ backlog: [makeTask('A', 'backlog')] })),
        );
      },
    );

    await store.loadBoard(); // ws-a → backlog A
    expect(store.columns().backlog).toHaveLength(1);

    workspaceInfo.set(wsB); // ws-b response is deferred
    TestBed.tick();
    await flush();

    workspaceInfo.set(wsA); // switch back before ws-b resolves
    TestBed.tick();
    await flush();
    expect(store.columns().backlog).toHaveLength(1);

    // The late ws-b response applies to ws-b's cache slice only — not the view.
    resolveB(ok(makeBoard({ done: [makeTask('B', 'done')] })));
    await flush();
    expect(store.columns().done).toHaveLength(0);
    expect(store.columns().backlog).toHaveLength(1);
  });

  it('routes a tasks:changed push to the correct workspace slice', async () => {
    configure();
    TestBed.tick();

    rpcCall.mockResolvedValue(
      ok(makeBoard({ backlog: [makeTask('A', 'backlog')] })),
    );
    await store.loadBoard(); // ws-a (cached)
    workspaceInfo.set(wsB);
    TestBed.tick();
    await flush(); // ws-b (cached)
    workspaceInfo.set(wsA);
    TestBed.tick();
    await flush(); // back on ws-a

    // A background (ws-b) change refreshes only ws-b's slice.
    rpcCall.mockClear();
    store.handleMessage({
      type: TASKS_CHANGED_MESSAGE_TYPE,
      payload: { workspaceRoot: 'D:/ws-b', reason: 'watcher' },
    });
    await flush();
    expect(rpcCall).toHaveBeenCalledWith('tasks:board', {
      workspaceRoot: 'D:/ws-b',
    });
    expect(rpcCall).not.toHaveBeenCalledWith('tasks:board', {
      workspaceRoot: 'D:/ws-a',
    });

    // A change for the active workspace refreshes the visible board.
    rpcCall.mockClear();
    store.handleMessage({
      type: TASKS_CHANGED_MESSAGE_TYPE,
      payload: { workspaceRoot: 'D:/ws-a', reason: 'write' },
    });
    await flush();
    expect(rpcCall).toHaveBeenCalledWith('tasks:board', {
      workspaceRoot: 'D:/ws-a',
    });
  });

  // Issue 4 — same-workspace out-of-order board responses: the older one loses.
  it('drops an older same-workspace board response so it cannot overwrite a newer one', async () => {
    configure();
    TestBed.tick(); // first effect flush only records the baseline

    // Two concurrent fetches for the SAME workspace (ws-a) — capture both
    // resolvers so we can settle the newer one first, then the older late.
    const resolvers: ((v: unknown) => void)[] = [];
    rpcCall.mockImplementation(
      () =>
        new Promise((r) => {
          resolvers.push(r);
        }),
    );

    const first = store.loadBoard(); // ws-a seq 1
    const second = store.loadBoard(); // ws-a seq 2
    expect(resolvers).toHaveLength(2);

    // The NEWER (second) request resolves first with board B.
    resolvers[1](ok(makeBoard({ done: [makeTask('B', 'done')] })));
    await second;
    expect(store.columns().done).toHaveLength(1);

    // The OLDER (first) request resolves late with board A — must be ignored.
    resolvers[0](ok(makeBoard({ backlog: [makeTask('A', 'backlog')] })));
    await first;
    expect(store.columns().done).toHaveLength(1);
    expect(store.columns().backlog).toHaveLength(0);
  });

  // Issue 2 — double-click openTask: the slower (earlier) response is dropped.
  it('drops a slower detail response when a newer task was opened (double-click)', async () => {
    configure();
    const resolvers: Record<string, (v: unknown) => void> = {};
    rpcCall.mockImplementation(
      (method: string, params: { taskId?: string }) => {
        if (method === 'tasks:get' && params.taskId) {
          return new Promise((r) => {
            resolvers[params.taskId as string] = r;
          });
        }
        return Promise.resolve(ok(makeBoard({})));
      },
    );

    const p1 = store.openTask('T1');
    const p2 = store.openTask('T2');
    expect(store.selectedTaskId()).toBe('T2');

    // Resolve the newer request (T2) first — its detail must land.
    resolvers['T2'](
      ok({ task: { ...makeTask('T2', 'backlog'), body: 'B2', artifacts: [] } }),
    );
    await p2;
    expect(store.taskDetail()?.body).toBe('B2');

    // The older request (T1) resolves late — it must NOT clobber T2's detail.
    resolvers['T1'](
      ok({ task: { ...makeTask('T1', 'backlog'), body: 'B1', artifacts: [] } }),
    );
    await p1;
    expect(store.selectedTaskId()).toBe('T2');
    expect(store.taskDetail()?.body).toBe('B2');
  });

  // Issue 2 — a detail response that lands after closeTask() must be dropped
  // (covers the workspace-switch-mid-fetch case: onWorkspaceSwitch → closeTask).
  it('drops a detail response that resolves after closeTask()', async () => {
    configure();
    let resolveGet: (v: unknown) => void = () => undefined;
    rpcCall.mockImplementation((method: string) => {
      if (method === 'tasks:get') {
        return new Promise((r) => {
          resolveGet = r;
        });
      }
      return Promise.resolve(ok(makeBoard({})));
    });

    const p = store.openTask('T1');
    store.closeTask();
    expect(store.selectedTaskId()).toBeNull();

    resolveGet(
      ok({ task: { ...makeTask('T1', 'backlog'), body: 'B1', artifacts: [] } }),
    );
    await p;
    expect(store.taskDetail()).toBeNull();
    expect(store.selectedTaskId()).toBeNull();
  });

  // Issue 7 — baseline-mismatch-at-first-flush: a switch that lands between
  // construction and the effect's first flush is a real switch, not a silent
  // baseline recording.
  it('fetches for the post-switch workspace when a switch races the first flush', async () => {
    configure(); // constructs the store, seeding the baseline key from ws-a

    // Switch BEFORE the effect's first flush. The pre-fix code recorded the new
    // key on first emission and returned (no fetch); the fix seeds the baseline
    // at construction so the mismatch is treated as a switch.
    workspaceInfo.set(wsB);
    rpcCall.mockClear();
    rpcCall.mockResolvedValue(ok(makeBoard({ done: [makeTask('B', 'done')] })));

    TestBed.tick();
    await flush();

    expect(rpcCall).toHaveBeenCalledWith('tasks:board', {
      workspaceRoot: 'D:/ws-b',
    });
    expect(store.columns().done).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// normalizeRootKey — backend parity (Issue 6)
//
// The frontend key mirrors the *equivalence classes* of the backend
// `normalizeWorkspaceRoot`
// (libs/backend/task-specs/src/lib/normalize-workspace-root.ts): the same
// workspace, however its path string arrives, must collapse to one key. It is
// NOT a byte-identical string — the backend keeps the OS-native separator via
// `path.resolve`, while the frontend cannot import node `path`, so it unifies
// separators to `/`. Only the grouping must stay in parity; if the backend
// normalization changes, update these expectations to match.
// ---------------------------------------------------------------------------
describe('normalizeRootKey — backend parity', () => {
  const CANONICAL = 'd:/projects/ws';

  it.each([
    ['D:\\projects\\ws', 'back-slashed, upper drive'],
    ['D:\\projects\\ws\\', 'trailing separator'],
    ['D:/projects/ws', 'forward slashes'],
    ['d:\\projects\\ws', 'lower drive'],
    ['d:/projects/ws/', 'lower drive + trailing'],
    ['D:\\projects/ws', 'mixed separators'],
  ])('collapses "%s" (%s) to the shared workspace key', (input) => {
    expect(normalizeRootKey(input)).toBe(CANONICAL);
  });

  it('is idempotent on an already-canonical key', () => {
    expect(normalizeRootKey(CANONICAL)).toBe(CANONICAL);
  });
});
