/**
 * TaskViewsService — saved-view CRUD over `tasks:getViews` / `tasks:saveViews`.
 *
 * The six contracts Batch 8 froze are each pinned here by a test that fails if
 * the contract is broken rather than by a comment claiming it is honoured:
 *
 *   1. the returned order is kept verbatim, and `order` is never the index
 *   2. `CAP_EXCEEDED` RESOLVES — a try/catch cannot see it
 *   3. `ACTIVE_VIEW_ID_NOT_SAVED` is a SUCCESS carrying a notice
 *   4. `activeViewId: null` clears; an omitted key leaves the pointer alone
 *   5. ids are client-generated and never collide
 *   6. `skipped: n` reaches the surface
 */
import { TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import {
  DEFAULT_TASK_SORT,
  EMPTY_TASK_FILTER,
  MAX_SAVED_TASK_VIEWS,
  TASK_STATUSES,
  type SavedTaskView,
  type TaskFilterSpec,
  type TaskSortSpec,
  type TaskSpecSummary,
  type TaskStatus,
  type TasksBoardResult,
  type TasksGetViewsResult,
  type TasksSaveViewsResult,
} from '@ptah-extension/shared';
import { TasksStore } from './tasks-store.service';
import {
  TaskViewsService,
  nextViewId,
  taskFilterEquals,
  taskSortEquals,
} from './task-views.service';

const ok = <T>(data: T) => ({ success: true, isSuccess: () => true, data });
const fail = (error: string) => ({
  success: false,
  isSuccess: () => false,
  error,
});

function task(
  id: string,
  overrides: Partial<TaskSpecSummary> = {},
): TaskSpecSummary {
  return {
    id,
    folderName: id,
    status: 'backlog',
    type: 'FEATURE',
    title: `Title ${id}`,
    dependsOn: [],
    labels: [],
    duplicates: [],
    relatesTo: [],
    created: '2026-08-01T00:00:00.000Z',
    updated: '2026-08-01T00:00:00.000Z',
    frontmatterValid: true,
    validationIssues: [],
    ...overrides,
  };
}

function board(
  partial: Partial<Record<TaskStatus, TaskSpecSummary[]>> = {},
): TasksBoardResult {
  const columns = TASK_STATUSES.reduce(
    (acc, status) => {
      acc[status] = partial[status] ?? [];
      return acc;
    },
    {} as Record<TaskStatus, TaskSpecSummary[]>,
  );
  return { columns, excludedCount: 0, specsDirExists: true };
}

function view(overrides: Partial<SavedTaskView> = {}): SavedTaskView {
  return {
    id: 'view-a',
    name: 'In progress',
    filter: EMPTY_TASK_FILTER,
    sort: DEFAULT_TASK_SORT,
    order: 0,
    ...overrides,
  };
}

interface Harness {
  readonly views: TaskViewsService;
  readonly store: TasksStore;
  readonly rpc: jest.Mock;
  /** Every `tasks:saveViews` param object, in the order they were issued. */
  readonly saves: Array<Record<string, unknown>>;
  setGetViews(result: TasksGetViewsResult): void;
  setSaveResult(result: TasksSaveViewsResult): void;
}

function setup(
  options: {
    readonly getViews?: TasksGetViewsResult;
    readonly board?: TasksBoardResult;
    readonly saveResult?: TasksSaveViewsResult;
  } = {},
): Harness {
  let getViews: TasksGetViewsResult = options.getViews ?? {
    views: [],
    activeViewId: null,
    skipped: 0,
  };
  let saveResult: TasksSaveViewsResult = options.saveResult ?? {
    success: true,
  };
  const boardPayload = options.board ?? board();
  const saves: Array<Record<string, unknown>> = [];

  const rpc = jest.fn(async (method: string, params: unknown) => {
    switch (method) {
      case 'tasks:getViews':
        return ok(getViews);
      case 'tasks:saveViews':
        saves.push(params as Record<string, unknown>);
        return ok(saveResult);
      case 'tasks:board':
        return ok(boardPayload);
      default:
        return ok({});
    }
  });

  TestBed.configureTestingModule({
    providers: [
      {
        provide: ClaudeRpcService,
        useValue: { call: rpc as unknown as ClaudeRpcService['call'] },
      },
    ],
  });

  return {
    views: TestBed.inject(TaskViewsService),
    store: TestBed.inject(TasksStore),
    rpc,
    saves,
    setGetViews: (next) => {
      getViews = next;
    },
    setSaveResult: (next) => {
      saveResult = next;
    },
  };
}

describe('TaskViewsService — reading the stored list', () => {
  /**
   * Contract 1. The handler sorts by `order` with a stable tie-break BEFORE it
   * answers, so the array as received is the presentation order. The fixture is
   * deliberately hostile to a client-side re-sort: the array order and the
   * `order` values disagree, exactly as they can after a hand edit.
   */
  it('keeps the order the backend returned and never re-sorts by `order`', async () => {
    const harness = setup({
      getViews: {
        views: [
          view({ id: 'v1', name: 'First', order: 9 }),
          view({ id: 'v2', name: 'Second', order: 3 }),
          view({ id: 'v3', name: 'Third', order: 7 }),
        ],
        activeViewId: null,
        skipped: 0,
      },
    });

    await harness.views.load();

    expect(harness.views.views().map((entry) => entry.id)).toEqual([
      'v1',
      'v2',
      'v3',
    ]);
  });

  /** Contract 6. A non-zero `skipped` means something the user saved is gone. */
  it('surfaces the skipped count rather than discarding it', async () => {
    const harness = setup({
      getViews: { views: [view()], activeViewId: null, skipped: 2 },
    });

    await harness.views.load();

    expect(harness.views.skipped()).toBe(2);
    expect(harness.views.views()).toHaveLength(1);
  });

  /** Contract 4. `null` is "no active view", not a failure. */
  it('treats a null activeViewId as no selection, not an error', async () => {
    const harness = setup({
      getViews: { views: [view()], activeViewId: null, skipped: 0 },
    });

    await harness.views.load();

    expect(harness.views.activeViewId()).toBeNull();
    expect(harness.views.activeView()).toBeNull();
    expect(harness.views.error()).toBeNull();
  });

  it('reconciles an active id that names no surviving view to null', async () => {
    const harness = setup({
      getViews: {
        views: [view({ id: 'v1' })],
        activeViewId: 'deleted-view',
        skipped: 1,
      },
    });

    await harness.views.load();

    expect(harness.views.activeViewId()).toBeNull();
  });

  it('applies the active view lens to the board on the first load', async () => {
    const filter: TaskFilterSpec = { ...EMPTY_TASK_FILTER, statuses: ['done'] };
    const sort: TaskSortSpec = { field: 'title', direction: 'asc' };
    const harness = setup({
      getViews: {
        views: [view({ id: 'v1', filter, sort })],
        activeViewId: 'v1',
        skipped: 0,
      },
    });

    await harness.views.load();

    expect(harness.store.filter().statuses).toEqual(['done']);
    expect(harness.store.sort()).toEqual(sort);
    expect(harness.views.modified()).toBe(false);
  });

  /**
   * A reload must not reach in and replace a filter the user is part-way
   * through editing — the lens is applied on the FIRST successful load only.
   */
  it('does not re-apply the active lens on a later load', async () => {
    const filter: TaskFilterSpec = { ...EMPTY_TASK_FILTER, statuses: ['done'] };
    const harness = setup({
      getViews: {
        views: [view({ id: 'v1', filter })],
        activeViewId: 'v1',
        skipped: 0,
      },
    });
    await harness.views.load();

    harness.store.setFilter({ ...EMPTY_TASK_FILTER, types: ['BUGFIX'] });
    await harness.views.load();

    expect(harness.store.filter().types).toEqual(['BUGFIX']);
    expect(harness.store.filter().statuses).toEqual([]);
  });

  it('reports a transport failure without emptying the menu', async () => {
    const harness = setup();
    harness.rpc.mockImplementation(async (method: string) =>
      method === 'tasks:getViews' ? fail('the host went away') : ok(board()),
    );

    await harness.views.load();

    expect(harness.views.error()).toBe('the host went away');
    expect(harness.views.views()).toEqual([]);
  });
});

describe('TaskViewsService — creating', () => {
  it('sends the whole list with the new view appended and made active', async () => {
    const harness = setup({
      getViews: {
        views: [view({ id: 'v1', order: 0 })],
        activeViewId: null,
        skipped: 0,
      },
    });
    await harness.views.load();
    harness.store.setFilter({ ...EMPTY_TASK_FILTER, labels: ['licensing'] });

    const saved = await harness.views.createView('  Licensing work  ');

    expect(saved).toBe(true);
    expect(harness.saves).toHaveLength(1);
    const sent = harness.saves[0]['views'] as SavedTaskView[];
    expect(sent).toHaveLength(2);
    expect(sent[1].name).toBe('Licensing work');
    expect(sent[1].filter.labels).toEqual(['licensing']);
    expect(harness.saves[0]['activeViewId']).toBe(sent[1].id);
    expect(harness.views.activeViewId()).toBe(sent[1].id);
  });

  /**
   * Contract 1, the write half. `order` is not the array index: a list whose
   * stored orders are sparse must still produce a new view that sorts LAST on
   * the next read, and `views.length` would have produced 2 — behind the
   * existing 7.
   */
  it('gives a new view max(order) + 1, not the array length', async () => {
    const harness = setup({
      getViews: {
        views: [view({ id: 'v1', order: 3 }), view({ id: 'v2', order: 7 })],
        activeViewId: null,
        skipped: 0,
      },
    });
    await harness.views.load();

    await harness.views.createView('Third');

    const sent = harness.saves[0]['views'] as SavedTaskView[];
    expect(sent[2].order).toBe(8);
  });

  /** Contract 5. The client owns id generation and the boundary refuses a clash. */
  it('never reuses an id already in the list', async () => {
    const harness = setup();
    await harness.views.load();

    await harness.views.createView('One');
    harness.setSaveResult({ success: true });
    await harness.views.createView('Two');

    const ids = (harness.saves[1]['views'] as SavedTaskView[]).map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('refuses a blank name without issuing a write', async () => {
    const harness = setup();
    await harness.views.load();

    expect(await harness.views.createView('   ')).toBe(false);
    expect(harness.saves).toHaveLength(0);
    expect(harness.views.error()).toBe('A view needs a name.');
  });

  it('says the list is full instead of issuing a doomed write', async () => {
    const full = Array.from({ length: MAX_SAVED_TASK_VIEWS }, (_, index) =>
      view({ id: `v${index}`, order: index }),
    );
    const harness = setup({
      getViews: { views: full, activeViewId: null, skipped: 0 },
    });
    await harness.views.load();

    expect(await harness.views.createView('One more')).toBe(false);
    expect(harness.saves).toHaveLength(0);
    expect(harness.views.error()).toContain(String(MAX_SAVED_TASK_VIEWS));
    expect(harness.views.atCap()).toBe(true);
  });
});

describe('TaskViewsService — the resolved failure results', () => {
  /**
   * Contract 2. The promise RESOLVES with the failure; a try/catch alone sees
   * nothing. The message is rendered verbatim because it already names the
   * limit and states that nothing was saved.
   */
  it('renders CAP_EXCEEDED verbatim and leaves the local list untouched', async () => {
    const harness = setup({
      getViews: {
        views: [view({ id: 'v1' })],
        activeViewId: null,
        skipped: 0,
      },
      saveResult: {
        success: false,
        error: {
          code: 'CAP_EXCEEDED',
          message:
            'You can save at most 50 views. This request carried 51. ' +
            'Nothing was saved — delete a view and try again.',
        },
      },
    });
    await harness.views.load();

    const saved = await harness.views.createView('Fifty-first');

    expect(saved).toBe(false);
    expect(harness.views.error()).toBe(
      'You can save at most 50 views. This request carried 51. ' +
        'Nothing was saved — delete a view and try again.',
    );
    expect(harness.views.views().map((v) => v.id)).toEqual(['v1']);
  });

  it('leaves the list untouched on WRITE_FAILED', async () => {
    const harness = setup({
      getViews: {
        views: [view({ id: 'v1', name: 'Original' })],
        activeViewId: null,
        skipped: 0,
      },
      saveResult: {
        success: false,
        error: {
          code: 'WRITE_FAILED',
          message: 'Failed to save views. Nothing was changed.',
        },
      },
    });
    await harness.views.load();

    expect(await harness.views.renameView('v1', 'Renamed')).toBe(false);
    expect(harness.views.views()[0].name).toBe('Original');
    expect(harness.views.notice()).toBeNull();
  });

  /**
   * Contract 3. The views ARE on disk; only the pointer did not record. It is a
   * notice, never an error, and the local list moves because the write landed.
   */
  it('treats ACTIVE_VIEW_ID_NOT_SAVED as a success carrying a notice', async () => {
    const harness = setup({
      getViews: {
        views: [view({ id: 'v1', name: 'Original' })],
        activeViewId: null,
        skipped: 0,
      },
      saveResult: {
        success: true,
        warning: {
          code: 'ACTIVE_VIEW_ID_NOT_SAVED',
          message:
            'Your views were saved. The active view could not be recorded, so ' +
            'the board may open on a different view than the one you selected. ' +
            'There is nothing to save again.',
        },
      },
    });
    await harness.views.load();

    expect(await harness.views.renameView('v1', 'Renamed')).toBe(true);
    expect(harness.views.error()).toBeNull();
    expect(harness.views.notice()).toContain('There is nothing to save again.');
    expect(harness.views.views()[0].name).toBe('Renamed');
  });

  it('turns a thrown transport error into a stated failure', async () => {
    const harness = setup();
    await harness.views.load();
    harness.rpc.mockImplementation(async (method: string) => {
      if (method === 'tasks:saveViews') throw new Error('bridge closed');
      return ok(board());
    });

    expect(await harness.views.createView('One')).toBe(false);
    expect(harness.views.error()).toBe('bridge closed');
  });
});

describe('TaskViewsService — deleting and the active pointer', () => {
  /** Contract 4, write half: `null` CLEARS, and it is sent only when meant. */
  it('sends activeViewId null when the deleted view was the active one', async () => {
    const harness = setup({
      getViews: {
        views: [view({ id: 'v1' }), view({ id: 'v2', order: 1 })],
        activeViewId: 'v1',
        skipped: 0,
      },
    });
    await harness.views.load();

    await harness.views.deleteView('v1');

    expect(harness.saves[0]['activeViewId']).toBeNull();
    expect(harness.views.activeViewId()).toBeNull();
    expect(harness.views.views().map((v) => v.id)).toEqual(['v2']);
  });

  /** Omitting the key leaves the stored pointer alone — a different request. */
  it('omits activeViewId entirely when another view is deleted', async () => {
    const harness = setup({
      getViews: {
        views: [view({ id: 'v1' }), view({ id: 'v2', order: 1 })],
        activeViewId: 'v1',
        skipped: 0,
      },
    });
    await harness.views.load();

    await harness.views.deleteView('v2');

    expect('activeViewId' in harness.saves[0]).toBe(false);
    expect(harness.views.activeViewId()).toBe('v1');
  });

  it('clears the pointer without touching the board filter', async () => {
    const filter: TaskFilterSpec = { ...EMPTY_TASK_FILTER, statuses: ['done'] };
    const harness = setup({
      getViews: {
        views: [view({ id: 'v1', filter })],
        activeViewId: 'v1',
        skipped: 0,
      },
    });
    await harness.views.load();

    await harness.views.clearActiveView();

    expect(harness.saves[0]['activeViewId']).toBeNull();
    expect(harness.views.activeViewId()).toBeNull();
    expect(harness.store.filter().statuses).toEqual(['done']);
  });
});

describe('TaskViewsService — reordering', () => {
  /**
   * The `order` values are rewritten for the WHOLE list rather than swapped.
   * The fixture gives both views the same stored `order`, which the handler's
   * position tie-break makes legitimate — swapping two equal numbers is a move
   * that appears to do nothing.
   */
  it('rewrites every order value to the new positions', async () => {
    const harness = setup({
      getViews: {
        views: [
          view({ id: 'v1', order: 4 }),
          view({ id: 'v2', order: 4 }),
          view({ id: 'v3', order: 4 }),
        ],
        activeViewId: null,
        skipped: 0,
      },
    });
    await harness.views.load();

    await harness.views.moveView('v3', 'up');

    const sent = harness.saves[0]['views'] as SavedTaskView[];
    expect(sent.map((v) => v.id)).toEqual(['v1', 'v3', 'v2']);
    expect(sent.map((v) => v.order)).toEqual([0, 1, 2]);
  });

  it('refuses to move the first view up or the last view down', async () => {
    const harness = setup({
      getViews: {
        views: [view({ id: 'v1' }), view({ id: 'v2', order: 1 })],
        activeViewId: null,
        skipped: 0,
      },
    });
    await harness.views.load();

    expect(await harness.views.moveView('v1', 'up')).toBe(false);
    expect(await harness.views.moveView('v2', 'down')).toBe(false);
    expect(harness.saves).toHaveLength(0);
  });
});

describe('TaskViewsService — modified tracking', () => {
  it('is false with no active view, whatever the filter says', async () => {
    const harness = setup({
      getViews: { views: [view()], activeViewId: null, skipped: 0 },
    });
    await harness.views.load();

    harness.store.setFilter({ ...EMPTY_TASK_FILTER, statuses: ['done'] });

    expect(harness.views.modified()).toBe(false);
  });

  it('turns true when the board filter leaves the saved lens', async () => {
    const harness = setup({
      getViews: {
        views: [view({ id: 'v1' })],
        activeViewId: 'v1',
        skipped: 0,
      },
    });
    await harness.views.load();
    expect(harness.views.modified()).toBe(false);

    harness.store.setFilter({ ...EMPTY_TASK_FILTER, statuses: ['done'] });
    expect(harness.views.modified()).toBe(true);

    harness.store.setFilter(EMPTY_TASK_FILTER);
    expect(harness.views.modified()).toBe(false);
  });

  it('turns true when only the sort moved', async () => {
    const harness = setup({
      getViews: {
        views: [view({ id: 'v1' })],
        activeViewId: 'v1',
        skipped: 0,
      },
    });
    await harness.views.load();

    harness.store.setSort({ field: 'title', direction: 'asc' });

    expect(harness.views.modified()).toBe(true);
  });

  it('goes back to false after the view is updated to match', async () => {
    const harness = setup({
      getViews: {
        views: [view({ id: 'v1' })],
        activeViewId: 'v1',
        skipped: 0,
      },
    });
    await harness.views.load();
    harness.store.setFilter({ ...EMPTY_TASK_FILTER, statuses: ['done'] });

    await harness.views.updateView('v1');

    expect(harness.views.modified()).toBe(false);
    const sent = harness.saves[0]['views'] as SavedTaskView[];
    expect(sent[0].filter.statuses).toEqual(['done']);
  });
});

describe('TaskViewsService — a view naming values the workspace lost (FR-C2.4)', () => {
  /**
   * The view still APPLIES. It matches nothing on the vanished facet, and the
   * board says so through the chip annotation — it is not repaired, and nothing
   * is written to disk in response.
   */
  it('applies, matches nothing, and prunes nothing', async () => {
    const stale: TaskFilterSpec = {
      ...EMPTY_TASK_FILTER,
      labels: ['retired-label'],
    };
    const harness = setup({
      board: board({ backlog: [task('TASK_2026_200', { labels: ['live'] })] }),
      getViews: {
        views: [view({ id: 'v1', name: 'Retired', filter: stale })],
        activeViewId: null,
        skipped: 0,
      },
    });
    await harness.store.loadBoard();
    await harness.views.load();

    await harness.views.applyView('v1');

    expect(harness.store.filter().labels).toEqual(['retired-label']);
    expect(harness.store.matchedCount()).toBe(0);
    expect(harness.store.totalIndexed()).toBe(1);
    // The pointer write carried the view back UNCHANGED — no facet was dropped.
    const sent = harness.saves[0]['views'] as SavedTaskView[];
    expect(sent[0].filter.labels).toEqual(['retired-label']);
    expect(harness.views.views()[0].filter.labels).toEqual(['retired-label']);
  });
});

describe('nextViewId', () => {
  it('returns an id nobody in the set already carries', () => {
    const taken = new Set(['a', 'b']);
    expect(taken.has(nextViewId(taken))).toBe(false);
  });

  /**
   * The collision branch, entered.
   *
   * An earlier version of this test let the real generator draw, which meant
   * the token was never in the taken set and the `for (let suffix = 1; ; )`
   * loop was never reached — deleting the entire branch and returning `base`
   * unconditionally still passed it. The token is STUBBED to a constant here so
   * the loop is the only thing that can produce the expected values, and each
   * step of the walk is pinned separately.
   *
   * The loop is unbounded by construction, so termination is the property that
   * matters: it holds because the suffix is monotonic over a FINITE set, not
   * because a redraw eventually gets lucky. Each case below would hang rather
   * than fail if that reasoning were wrong.
   */
  describe('when the drawn token is already taken', () => {
    let spy: jest.SpyInstance<string>;

    beforeEach(() => {
      spy = jest
        .spyOn(globalThis.crypto, 'randomUUID')
        .mockReturnValue('X' as ReturnType<Crypto['randomUUID']>);
    });

    afterEach(() => {
      spy.mockRestore();
    });

    it('returns the drawn token untouched when it is free', () => {
      expect(nextViewId(new Set())).toBe('X');
    });

    it('walks to the first free suffix', () => {
      expect(nextViewId(new Set(['X']))).toBe('X-1');
    });

    it('keeps walking while each suffix is taken', () => {
      expect(nextViewId(new Set(['X', 'X-1']))).toBe('X-2');
      expect(nextViewId(new Set(['X', 'X-1', 'X-2']))).toBe('X-3');
    });

    it('terminates over a taken set large enough to exhaust several steps', () => {
      const taken = new Set([
        'X',
        ...Array.from({ length: 20 }, (_, i) => `X-${i + 1}`),
      ]);
      expect(nextViewId(taken)).toBe('X-21');
    });

    it('never draws twice for one id', () => {
      nextViewId(new Set(['X', 'X-1']));
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });
});

describe('taskFilterEquals / taskSortEquals', () => {
  it('ignores the order values were selected in', () => {
    expect(
      taskFilterEquals(
        { ...EMPTY_TASK_FILTER, statuses: ['done', 'backlog'] },
        { ...EMPTY_TASK_FILTER, statuses: ['backlog', 'done'] },
      ),
    ).toBe(true);
  });

  it('folds labels exactly as the shared predicate folds them (R9)', () => {
    expect(
      taskFilterEquals(
        { ...EMPTY_TASK_FILTER, labels: ['Licensing'] },
        { ...EMPTY_TASK_FILTER, labels: ['licensing '] },
      ),
    ).toBe(true);
  });

  it('does not fold executors, which are case-sensitive (FR-C1.1)', () => {
    expect(
      taskFilterEquals(
        { ...EMPTY_TASK_FILTER, executors: ['Alice'] },
        { ...EMPTY_TASK_FILTER, executors: ['alice'] },
      ),
    ).toBe(false);
  });

  it('separates every scalar facet', () => {
    expect(
      taskFilterEquals(EMPTY_TASK_FILTER, {
        ...EMPTY_TASK_FILTER,
        hasValidationIssues: true,
      }),
    ).toBe(false);
    expect(
      taskFilterEquals(EMPTY_TASK_FILTER, {
        ...EMPTY_TASK_FILTER,
        unestimated: true,
      }),
    ).toBe(false);
    expect(
      taskFilterEquals(EMPTY_TASK_FILTER, {
        ...EMPTY_TASK_FILTER,
        labelsMode: 'all',
      }),
    ).toBe(false);
    expect(
      taskFilterEquals(EMPTY_TASK_FILTER, { ...EMPTY_TASK_FILTER, text: 'x' }),
    ).toBe(false);
  });

  it('separates field from direction', () => {
    expect(taskSortEquals(DEFAULT_TASK_SORT, DEFAULT_TASK_SORT)).toBe(true);
    expect(
      taskSortEquals(DEFAULT_TASK_SORT, {
        ...DEFAULT_TASK_SORT,
        direction: 'asc',
      }),
    ).toBe(false);
    expect(
      taskSortEquals(DEFAULT_TASK_SORT, { ...DEFAULT_TASK_SORT, field: 'id' }),
    ).toBe(false);
  });
});
