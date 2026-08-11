import { ApplicationRef } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ClaudeRpcService } from '@ptah-extension/core';
import {
  DEFAULT_TASK_SORT,
  EMPTY_TASK_FILTER,
  TASK_STATUSES,
  type ExcludedTaskFolder,
  type SavedTaskView,
  type TaskStatus,
  type TaskSpecSummary,
  type TasksBoardResult,
  type TasksGetViewsResult,
  type TasksSaveViewsResult,
} from '@ptah-extension/shared';
import { TasksStore } from '../services/tasks-store.service';
import { TaskViewsService } from '../services/task-views.service';
import { TasksViewComponent } from './tasks-view.component';
import type { TaskPaletteAction } from './palette/palette-entries';
import { TaskBulkBarComponent } from './bulk/task-bulk-bar.component';
import { TaskBulkSummaryComponent } from './bulk/task-bulk-summary.component';

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

/**
 * `tasks:board` payload. The named exclusion list rides alongside the count —
 * modelled here as an optional field so the store's defensive read is exercised
 * by the same helper that feeds the happy path.
 */
type BoardPayload = TasksBoardResult & {
  excluded?: readonly ExcludedTaskFolder[];
};

function board(
  partial: Partial<Record<TaskStatus, TaskSpecSummary[]>> = {},
  meta: Partial<Pick<TasksBoardResult, 'excludedCount' | 'specsDirExists'>> & {
    excluded?: readonly ExcludedTaskFolder[];
  } = {},
): BoardPayload {
  const columns = TASK_STATUSES.reduce(
    (acc, status) => {
      acc[status] = partial[status] ?? [];
      return acc;
    },
    {} as Record<TaskStatus, TaskSpecSummary[]>,
  );
  return {
    columns,
    excludedCount: meta.excludedCount ?? meta.excluded?.length ?? 0,
    specsDirExists: meta.specsDirExists ?? true,
    ...(meta.excluded ? { excluded: meta.excluded } : {}),
  };
}

/**
 * The exact twelve folders invisible to the board in the workspace that
 * prompted this drawer, with a spread of typed reasons across the shared union.
 */
const TWELVE_EXCLUDED: readonly ExcludedTaskFolder[] = [
  { folderName: 'TASK_2026_155', reason: 'no_carrier' },
  { folderName: 'TASK_2026_160', reason: 'no_carrier' },
  { folderName: 'TASK_2026_161', reason: 'no_frontmatter' },
  { folderName: 'TASK_2026_164', reason: 'no_carrier' },
  { folderName: 'TASK_2026_165', reason: 'yaml_unparseable' },
  { folderName: 'TASK_2026_166', reason: 'no_carrier' },
  { folderName: 'TASK_2026_167', reason: 'invalid_status' },
  { folderName: 'TASK_2026_168', reason: 'no_carrier' },
  { folderName: 'TASK_2026_169', reason: 'missing_title' },
  { folderName: 'TASK_2026_170', reason: 'unreadable' },
  { folderName: 'TASK_VOICE_PROVIDERS', reason: 'no_carrier' },
  { folderName: 'TASK_WORKSPACE_SCOPING_REVIEW', reason: 'no_carrier' },
];

const ok = <T>(data: T) => ({ success: true, isSuccess: () => true, data });

describe('TasksViewComponent', () => {
  let rpcCall: jest.Mock;

  /**
   * The RPC double routes by METHOD rather than answering every call with the
   * board payload.
   *
   * The surface now issues two independent reads on creation — `tasks:board`
   * and `tasks:getViews` — and they carry unrelated shapes. A single blanket
   * `mockResolvedValue` hands a board payload to the views reader, which is a
   * response no host can produce and which would let a real defect in that
   * reader pass unnoticed.
   */
  function setup(
    payload: BoardPayload = board({}, { specsDirExists: false }),
    views: TasksGetViewsResult = { views: [], activeViewId: null, skipped: 0 },
    saveResult: TasksSaveViewsResult = { success: true },
  ) {
    rpcCall = jest.fn(async (method: string) => {
      if (method === 'tasks:getViews') return ok(views);
      if (method === 'tasks:saveViews') return ok(saveResult);
      return ok(payload);
    });
    TestBed.configureTestingModule({
      imports: [TasksViewComponent],
      providers: [
        {
          provide: ClaudeRpcService,
          useValue: { call: rpcCall as unknown as ClaudeRpcService['call'] },
        },
      ],
    });
  }

  async function render(
    payload?: BoardPayload,
    views?: TasksGetViewsResult,
    saveResult?: TasksSaveViewsResult,
  ) {
    setup(payload, views, saveResult);
    const fixture = TestBed.createComponent(TasksViewComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('loads the board on creation', async () => {
    await render();
    expect(rpcCall).toHaveBeenCalledWith('tasks:board', {});
  });

  it('shows the empty-state create CTA when there are no tasks', async () => {
    const fixture = await render();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Create your first task');
  });

  it('renders the header actions', async () => {
    const fixture = await render();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('New Task');
    expect(text).toContain('Reindex');
    expect(text).toContain('Registry');
  });

  // -------------------------------------------------------------------------
  // The filter surface (Tasks 7.3 / 7.4)
  // -------------------------------------------------------------------------
  describe('filter surface', () => {
    const populated = board({
      backlog: [
        task('TASK_2026_200', { labels: ['licensing'] }),
        task('TASK_2026_201', { parent: 'TASK_2026_200' }),
        task('TASK_2026_202', { parent: 'TASK_2026_200' }),
      ],
      done: [task('TASK_2026_203', { status: 'done' })],
    });

    it('renders no filter bar for a workspace with no tasks', async () => {
      const fixture = await render();
      expect(
        (fixture.nativeElement as HTMLElement).querySelector(
          '[data-testid="task-filter-text"]',
        ),
      ).toBeNull();
    });

    it('renders the filter bar once the board holds anything', async () => {
      const fixture = await render(populated);
      const host = fixture.nativeElement as HTMLElement;
      expect(
        host.querySelector('[data-testid="task-filter-text"]'),
      ).not.toBeNull();
      // No filter is active, so the counter states the board size rather than
      // the redundant "4 of 4" — the same rule the column counter follows.
      expect(
        host
          .querySelector('[data-testid="task-filter-count"]')
          ?.textContent?.trim(),
      ).toBe('4');
    });

    it('states the filtered count beside the indexed one per column', async () => {
      const fixture = await render(populated);
      TestBed.inject(TasksStore).setFilter({
        ...EMPTY_TASK_FILTER,
        labels: ['licensing'],
      });
      fixture.detectChanges();

      const counts = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll(
          '[data-testid="task-column-count"]',
        ),
      ).map((el) => el.textContent?.replace(/\s+/g, ' ').trim());

      // Backlog holds 3 indexed, 1 matching; Done holds 1 indexed, 0 matching.
      expect(counts).toContain('1 of 3');
      expect(counts).toContain('0 of 1');
    });

    /**
     * FR-C1.3. The distinction is the whole point: "nothing matches" offers the
     * control that undoes it, "nothing exists" offers the one that creates a
     * task, and showing the wrong one is how a user with 181 hidden tasks is
     * invited to make a 182nd.
     */
    it('shows the filtered-empty state — and NOT the create CTA — when nothing matches', async () => {
      const fixture = await render(populated);
      TestBed.inject(TasksStore).setFilter({
        ...EMPTY_TASK_FILTER,
        text: 'matches-nothing-at-all',
      });
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      const empty = host.querySelector('[data-testid="tasks-filtered-empty"]');
      expect(empty).not.toBeNull();
      expect(empty?.textContent).toContain('No tasks match the current filter');
      expect(host.textContent).not.toContain('Create your first task');
    });

    it('clears the filter from the filtered-empty state', async () => {
      const fixture = await render(populated);
      const store = TestBed.inject(TasksStore);
      store.setFilter({ ...EMPTY_TASK_FILTER, text: 'matches-nothing-at-all' });
      fixture.detectChanges();

      (fixture.nativeElement as HTMLElement)
        .querySelector<HTMLButtonElement>(
          '[data-testid="tasks-filtered-empty-clear"]',
        )
        ?.click();
      fixture.detectChanges();

      expect(store.filterActive()).toBe(false);
      expect(
        (fixture.nativeElement as HTMLElement).querySelector(
          '[data-testid="tasks-filtered-empty"]',
        ),
      ).toBeNull();
    });

    /** FR-B3.3 — the rollup is a control, and this is what it controls. */
    it('narrows the board to a parent’s sub-tasks when its rollup is clicked', async () => {
      const fixture = await render(populated);
      const store = TestBed.inject(TasksStore);

      const rollup = (
        fixture.nativeElement as HTMLElement
      ).querySelector<HTMLButtonElement>('[data-testid="task-card-rollup"]');
      expect(rollup).not.toBeNull();
      rollup?.click();
      fixture.detectChanges();

      expect(store.filter().childrenOf).toEqual(['TASK_2026_200']);
      expect(store.filtered().map((t) => t.id)).toEqual([
        'TASK_2026_201',
        'TASK_2026_202',
      ]);
      // The click is undoable from the bar, like every other facet value.
      expect(
        (fixture.nativeElement as HTMLElement).querySelector(
          '[data-testid="task-filter-chips"]',
        )?.textContent,
      ).toContain('TASK_2026_200');
    });

    it('issues no further RPC when the board is filtered', async () => {
      const fixture = await render(populated);
      rpcCall.mockClear();

      TestBed.inject(TasksStore).setFilter({
        ...EMPTY_TASK_FILTER,
        statuses: ['done'],
      });
      fixture.detectChanges();
      await fixture.whenStable();

      expect(rpcCall).not.toHaveBeenCalled();
    });
  });

  describe('exclusions drawer', () => {
    async function openDrawer(payload: BoardPayload) {
      const fixture = await render(payload);
      const trigger = (
        fixture.nativeElement as HTMLElement
      ).querySelector<HTMLButtonElement>(
        '[data-testid="tasks-excluded-trigger"]',
      );
      expect(trigger).not.toBeNull();
      trigger?.click();
      fixture.detectChanges();
      return fixture;
    }

    it('lists all twelve excluded folders by name with a typed reason', async () => {
      const fixture = await openDrawer(
        board({}, { excluded: TWELVE_EXCLUDED }),
      );
      const host = fixture.nativeElement as HTMLElement;

      const rows = Array.from(
        host.querySelectorAll('[data-testid="tasks-excluded-row"]'),
      );
      expect(rows).toHaveLength(12);

      const names = rows.map(
        (row) =>
          row
            .querySelector('[data-testid="tasks-excluded-name"]')
            ?.textContent?.trim() ?? '',
      );
      expect(names).toEqual(TWELVE_EXCLUDED.map((f) => f.folderName));

      // Every row must carry a non-empty explanation of WHY it was skipped —
      // a name with no reason is only marginally better than a bare count.
      rows.forEach((row, index) => {
        const reason =
          row
            .querySelector('[data-testid="tasks-excluded-reason"]')
            ?.textContent?.trim() ?? '';
        expect(reason.length).toBeGreaterThan(0);
        // The raw typed token is rendered alongside the sentence.
        expect(row.textContent).toContain(TWELVE_EXCLUDED[index].reason);
      });
    });

    it('keeps the drawer closed until the trigger is used', async () => {
      const fixture = await render(board({}, { excluded: TWELVE_EXCLUDED }));
      const host = fixture.nativeElement as HTMLElement;
      expect(
        host.querySelectorAll('[data-testid="tasks-excluded-row"]'),
      ).toHaveLength(0);
    });

    it('says so out loud when the host reports a count but no names', async () => {
      const fixture = await openDrawer(board({}, { excludedCount: 12 }));
      const host = fixture.nativeElement as HTMLElement;

      expect(
        host.querySelectorAll('[data-testid="tasks-excluded-row"]'),
      ).toHaveLength(0);
      expect(
        host.querySelector('[data-testid="tasks-excluded-unnamed"]')
          ?.textContent,
      ).toContain('did not name them');
    });

    it('drops malformed exclusion entries instead of rendering them', async () => {
      const malformed = [
        { folderName: 'TASK_2026_155', reason: 'no_carrier' },
        { folderName: '', reason: 'no_carrier' },
        { folderName: 'TASK_2026_160', reason: 'not_a_real_reason' },
        null,
        'TASK_2026_161',
      ] as unknown as readonly ExcludedTaskFolder[];

      const fixture = await openDrawer(
        board({}, { excludedCount: 5, excluded: malformed }),
      );
      const host = fixture.nativeElement as HTMLElement;

      const rows = host.querySelectorAll('[data-testid="tasks-excluded-row"]');
      expect(rows).toHaveLength(1);
      expect(rows[0].textContent).toContain('TASK_2026_155');
    });

    it('shows no trigger at all when nothing was excluded', async () => {
      const fixture = await render(board());
      const host = fixture.nativeElement as HTMLElement;
      expect(
        host.querySelector('[data-testid="tasks-excluded-trigger"]'),
      ).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Saved views (Task 9.3)
  // -------------------------------------------------------------------------
  describe('the saved-views menu', () => {
    const populated = board({
      backlog: [task('TASK_2026_200', { labels: ['licensing'] })],
      done: [task('TASK_2026_203', { status: 'done' })],
    });

    function savedView(overrides: Partial<SavedTaskView> = {}): SavedTaskView {
      return {
        id: 'view-a',
        name: 'Done work',
        filter: { ...EMPTY_TASK_FILTER, statuses: ['done'] },
        sort: DEFAULT_TASK_SORT,
        order: 0,
        ...overrides,
      };
    }

    it('reads the stored views on creation, alongside the board', async () => {
      await render(populated);
      expect(rpcCall).toHaveBeenCalledWith('tasks:getViews', {});
      expect(rpcCall).toHaveBeenCalledWith('tasks:board', {});
    });

    it('renders the menu once the board holds anything', async () => {
      const fixture = await render(populated, {
        views: [savedView()],
        activeViewId: null,
        skipped: 0,
      });
      const host = fixture.nativeElement as HTMLElement;

      expect(
        host.querySelector('[data-testid="task-view-menu"]'),
      ).not.toBeNull();
      expect(
        host.querySelector('[data-testid="task-view-apply"]')?.textContent,
      ).toContain('Done work');
    });

    /**
     * NFR-11. Saved views live in `~/.ptah/settings.json`, the board lives in
     * the task index, and neither read gates the other. A settings store that
     * cannot be read must still leave a full board on screen.
     */
    it('renders the whole board when the views read fails outright', async () => {
      setup(populated);
      rpcCall.mockImplementation(async (method: string) =>
        method === 'tasks:getViews'
          ? { success: false, isSuccess: () => false, error: 'unreadable' }
          : ok(populated),
      );
      const fixture = TestBed.createComponent(TasksViewComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      expect(host.textContent).toContain('TASK_2026_200');
      expect(host.textContent).toContain('TASK_2026_203');
      expect(
        host
          .querySelector('[data-testid="task-filter-count"]')
          ?.textContent?.trim(),
      ).toBe('2');
      expect(TestBed.inject(TaskViewsService).error()).toBe('unreadable');
    });

    it('reports entries that could not be read, and still lists the rest', async () => {
      const fixture = await render(populated, {
        views: [savedView()],
        activeViewId: null,
        skipped: 2,
      });
      const host = fixture.nativeElement as HTMLElement;

      expect(
        host.querySelector('[data-testid="task-view-skipped"]')?.textContent,
      ).toContain('2 stored view(s) could not be read');
      expect(
        host.querySelectorAll('[data-testid="task-view-row"]'),
      ).toHaveLength(1);
    });

    it('opens on the stored active view and narrows the board to it', async () => {
      const fixture = await render(populated, {
        views: [savedView()],
        activeViewId: 'view-a',
        skipped: 0,
      });

      const store = TestBed.inject(TasksStore);
      expect(store.filter().statuses).toEqual(['done']);
      expect(store.matchedCount()).toBe(1);
      expect(
        (fixture.nativeElement as HTMLElement).querySelector(
          '[data-testid="task-view-modified-badge"]',
        ),
      ).toBeNull();
    });

    it('badges the menu once the board filter leaves the saved lens', async () => {
      const fixture = await render(populated, {
        views: [savedView()],
        activeViewId: 'view-a',
        skipped: 0,
      });

      TestBed.inject(TasksStore).setFilter(EMPTY_TASK_FILTER);
      fixture.detectChanges();

      expect(
        (fixture.nativeElement as HTMLElement).querySelector(
          '[data-testid="task-view-modified-badge"]',
        ),
      ).not.toBeNull();
    });

    /**
     * FR-C2.4, end to end on the real surface. The view applies, the facet
     * matches nothing, the chip says why, and no `tasks:saveViews` rewrites the
     * spec to drop the dead label.
     */
    it('applies a view naming a vanished label, annotates it, and prunes nothing', async () => {
      const stale = savedView({
        id: 'view-stale',
        name: 'Retired label',
        filter: { ...EMPTY_TASK_FILTER, labels: ['retired-label'] },
      });
      const fixture = await render(populated, {
        views: [stale],
        activeViewId: 'view-stale',
        skipped: 0,
      });
      const host = fixture.nativeElement as HTMLElement;

      expect(TestBed.inject(TasksStore).matchedCount()).toBe(0);
      expect(
        host.querySelector('[data-testid="task-filter-chip-note"]')
          ?.textContent,
      ).toContain('no longer present in this workspace');
      expect(
        host.querySelector('[data-testid="tasks-filtered-empty"]'),
      ).not.toBeNull();
      expect(TestBed.inject(TaskViewsService).views()[0].filter.labels).toEqual(
        ['retired-label'],
      );
      expect(rpcCall).not.toHaveBeenCalledWith(
        'tasks:saveViews',
        expect.anything(),
      );
    });

    /**
     * The chip's "vanished" test and the predicate's "matches" test have to
     * agree. `matchesExecutors` trims both sides and `knownExecutors` is stored
     * trimmed, so a view carrying `' gemini '` MATCHES a task whose executor is
     * `gemini` — and a raw comparison in the chip labelled that same chip "no
     * longer present in this workspace" at the same time.
     *
     * This runs both halves over one fixture, which is the only place the
     * contradiction is visible.
     */
    it('never calls an executor vanished while it is still matching tasks', async () => {
      const withExecutor = board({
        backlog: [task('TASK_2026_210', { executor: 'gemini' })],
      });
      const fixture = await render(withExecutor, {
        views: [
          savedView({
            id: 'view-exec',
            name: 'Gemini work',
            filter: { ...EMPTY_TASK_FILTER, executors: [' gemini '] },
          }),
        ],
        activeViewId: 'view-exec',
        skipped: 0,
      });
      const host = fixture.nativeElement as HTMLElement;

      // The predicate matches it…
      expect(TestBed.inject(TasksStore).matchedCount()).toBe(1);
      // …so the chip must not claim the opposite.
      expect(
        host.querySelector('[data-testid="task-filter-chip-note"]'),
      ).toBeNull();
    });

    it('routes a create from the menu into one whole-list write', async () => {
      const fixture = await render(populated, {
        views: [savedView()],
        activeViewId: null,
        skipped: 0,
      });
      const host = fixture.nativeElement as HTMLElement;

      const name = host.querySelector<HTMLInputElement>(
        '[data-testid="task-view-create-input"]',
      );
      if (name === null) throw new Error('the create input did not render');
      name.value = 'Licensing';
      name.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      host
        .querySelector<HTMLButtonElement>('[data-testid="task-view-create"]')
        ?.click();
      await fixture.whenStable();

      const call = rpcCall.mock.calls.find(
        ([method]) => method === 'tasks:saveViews',
      );
      expect(call).toBeDefined();
      const params = call?.[1] as { views: SavedTaskView[] };
      expect(params.views).toHaveLength(2);
      expect(params.views[1].name).toBe('Licensing');
    });

    async function typeAndSave(fixture: ComponentFixture<TasksViewComponent>) {
      const host = fixture.nativeElement as HTMLElement;
      const input = host.querySelector<HTMLInputElement>(
        '[data-testid="task-view-create-input"]',
      );
      if (input === null) throw new Error('the create input did not render');
      input.value = 'Fifty-first';
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      host
        .querySelector<HTMLButtonElement>('[data-testid="task-view-create"]')
        ?.click();
      await fixture.whenStable();
      fixture.detectChanges();
      return host;
    }

    it('clears the typed name once the save has landed', async () => {
      const fixture = await render(populated, {
        views: [savedView()],
        activeViewId: null,
        skipped: 0,
      });

      const host = await typeAndSave(fixture);

      expect(
        host.querySelector<HTMLInputElement>(
          '[data-testid="task-view-create-input"]',
        )?.value,
      ).toBe('');
    });

    /**
     * `CAP_EXCEEDED` resolves rather than throwing, and it is the case a user
     * reaches after deliberately naming one more view. Discarding the name at
     * that moment is the worst possible time to do it.
     */
    async function renameTo(
      fixture: ComponentFixture<TasksViewComponent>,
      name: string,
    ) {
      const host = fixture.nativeElement as HTMLElement;
      host
        .querySelector<HTMLButtonElement>('[data-testid="task-view-rename"]')
        ?.click();
      fixture.detectChanges();
      const input = host.querySelector<HTMLInputElement>(
        '[data-testid="task-view-rename-input"]',
      );
      if (input === null) throw new Error('the rename input did not render');
      input.value = name;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      host
        .querySelector<HTMLButtonElement>(
          '[data-testid="task-view-rename-confirm"]',
        )
        ?.click();
      await fixture.whenStable();
      fixture.detectChanges();
      return host;
    }

    it('closes the rename row once the save has landed', async () => {
      const fixture = await render(populated, {
        views: [savedView()],
        activeViewId: null,
        skipped: 0,
      });

      const host = await renameTo(fixture, 'Renamed');

      expect(
        host.querySelector('[data-testid="task-view-rename-input"]'),
      ).toBeNull();
      const call = rpcCall.mock.calls.find(
        ([method]) => method === 'tasks:saveViews',
      );
      const params = call?.[1] as { views: SavedTaskView[] };
      expect(params.views[0].name).toBe('Renamed');
    });

    /** The rename twin of the create case — one rule for both controls. */
    it('keeps the rename row open and filled when the save was refused', async () => {
      const fixture = await render(
        populated,
        { views: [savedView()], activeViewId: null, skipped: 0 },
        {
          success: false,
          error: {
            code: 'WRITE_FAILED',
            message: 'Failed to save views. Nothing was changed.',
          },
        },
      );

      const host = await renameTo(fixture, 'Renamed');

      expect(
        host.querySelector<HTMLInputElement>(
          '[data-testid="task-view-rename-input"]',
        )?.value,
      ).toBe('Renamed');
      expect(
        host.querySelector('[data-testid="task-view-error"]')?.textContent,
      ).toContain('Nothing was changed.');
      // The list did not move, so the row still shows the original name.
      expect(
        host.querySelector('[data-testid="task-view-apply"]')?.textContent,
      ).toContain('Done work');
    });

    it('keeps the typed name when the save was refused, and says why', async () => {
      const capMessage =
        'You can save at most 50 views. This request carried 51. ' +
        'Nothing was saved — delete a view and try again.';
      const fixture = await render(
        populated,
        { views: [savedView()], activeViewId: null, skipped: 0 },
        {
          success: false,
          error: { code: 'CAP_EXCEEDED', message: capMessage },
        },
      );

      const host = await typeAndSave(fixture);

      expect(
        host.querySelector<HTMLInputElement>(
          '[data-testid="task-view-create-input"]',
        )?.value,
      ).toBe('Fifty-first');
      expect(
        host.querySelector('[data-testid="task-view-error"]')?.textContent,
      ).toContain(capMessage);
    });
  });

  // -------------------------------------------------------------------------
  // The command palette (FR-C6) and the host-scoped shortcut (R10)
  //
  // Every keyboard assertion here dispatches a real event on a real element
  // inside the surface, so it proves the `host:` BINDING as well as the
  // handler. A test that called `onKeyDown` directly would pass identically
  // whether the binding existed, was on `window`, or had been deleted.
  // -------------------------------------------------------------------------
  describe('command palette', () => {
    const populated = board({
      backlog: [
        task('TASK_2026_200', { labels: ['licensing'] }),
        task('TASK_2026_201'),
      ],
      done: [task('TASK_2026_203', { status: 'done' })],
    });

    function press(
      fixture: ComponentFixture<TasksViewComponent>,
      target: Element,
      key: string,
      modifiers: {
        ctrlKey?: boolean;
        metaKey?: boolean;
        altKey?: boolean;
      } = {},
    ): KeyboardEvent {
      const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        ...modifiers,
      });
      target.dispatchEvent(event);
      fixture.detectChanges();
      return event;
    }

    const dialog = (fixture: ComponentFixture<TasksViewComponent>) =>
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="task-palette-dialog"]',
      );

    it('opens from the always-visible toolbar button', async () => {
      const fixture = await render(populated);
      const host = fixture.nativeElement as HTMLElement;
      const trigger = host.querySelector<HTMLButtonElement>(
        '[data-testid="tasks-palette-trigger"]',
      );

      expect(trigger).not.toBeNull();
      expect(dialog(fixture)).toBeNull();

      trigger?.click();
      fixture.detectChanges();

      expect(dialog(fixture)).not.toBeNull();
      expect(trigger?.getAttribute('aria-expanded')).toBe('true');
    });

    it('opens on Ctrl+K raised inside the surface, and consumes it', async () => {
      const fixture = await render(populated);
      const card = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-task-id="TASK_2026_200"]',
      );
      expect(card).not.toBeNull();

      const event = press(fixture, card as Element, 'k', { ctrlKey: true });

      expect(dialog(fixture)).not.toBeNull();
      expect(event.defaultPrevented).toBe(true);
    });

    it('opens on Cmd+K too', async () => {
      const fixture = await render(populated);
      press(fixture, fixture.nativeElement as HTMLElement, 'K', {
        metaKey: true,
      });
      expect(dialog(fixture)).not.toBeNull();
    });

    it('ignores Ctrl+K raised inside a text field (R10)', async () => {
      // The filter bar's free-text box lives inside this host, so a
      // window-scoped or unguarded handler would steal the keystroke from
      // whatever the host application binds it to while a user was typing.
      const fixture = await render(populated);
      const text = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="task-filter-text"]',
      );
      expect(text).not.toBeNull();

      const event = press(fixture, text as Element, 'k', { ctrlKey: true });

      expect(dialog(fixture)).toBeNull();
      expect(event.defaultPrevented).toBe(false);
    });

    it('leaves every other combination alone', async () => {
      const fixture = await render(populated);
      const host = fixture.nativeElement as HTMLElement;

      // Bare k, Alt+Ctrl+K, and Ctrl+P are all somebody else's keys.
      expect(press(fixture, host, 'k').defaultPrevented).toBe(false);
      expect(
        press(fixture, host, 'k', { ctrlKey: true, altKey: true })
          .defaultPrevented,
      ).toBe(false);
      expect(
        press(fixture, host, 'p', { ctrlKey: true }).defaultPrevented,
      ).toBe(false);
      expect(dialog(fixture)).toBeNull();
    });

    it('is bound to the host element, not to the document (R10)', async () => {
      const fixture = await render(populated);

      // The same keystroke, raised OUTSIDE the Tasks surface. If the handler
      // were on `window` or `document` this would open the palette, and the
      // shortcut would be stolen from every other webview surface for as long
      // as this component was alive.
      const outside = document.createElement('div');
      document.body.appendChild(outside);
      try {
        press(fixture, outside, 'k', { ctrlKey: true });
        expect(dialog(fixture)).toBeNull();
      } finally {
        outside.remove();
      }
    });

    it('lists the selection-scoped actions disabled when nothing is selected', async () => {
      const fixture = await render(populated);
      (fixture.nativeElement as HTMLElement)
        .querySelector<HTMLButtonElement>(
          '[data-testid="tasks-palette-trigger"]',
        )
        ?.click();
      fixture.detectChanges();

      const disabled = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll(
          '[data-testid="task-palette-option-disabled"]',
        ),
      );
      expect(disabled.length).toBeGreaterThan(0);
      expect(
        disabled.some((option) =>
          option.textContent?.includes('No task is selected'),
        ),
      ).toBe(true);
    });

    it('runs a filter toggle from the palette and closes', async () => {
      const fixture = await render(populated);
      const store = TestBed.inject(TasksStore);
      (fixture.nativeElement as HTMLElement)
        .querySelector<HTMLButtonElement>(
          '[data-testid="tasks-palette-trigger"]',
        )
        ?.click();
      fixture.detectChanges();

      const input = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="task-palette-dialog"] input',
      ) as HTMLInputElement;
      input.value = 'Filter by status: Done';
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      press(fixture, input, 'Enter');

      expect(store.filter().statuses).toEqual(['done']);
      expect(dialog(fixture)).toBeNull();
    });

    it('jumps to a task by id from the palette', async () => {
      const fixture = await render(populated);
      const store = TestBed.inject(TasksStore);
      (fixture.nativeElement as HTMLElement)
        .querySelector<HTMLButtonElement>(
          '[data-testid="tasks-palette-trigger"]',
        )
        ?.click();
      fixture.detectChanges();

      const input = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="task-palette-dialog"] input',
      ) as HTMLInputElement;
      input.value = 'TASK_2026_203';
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      press(fixture, input, 'Enter');
      await fixture.whenStable();

      expect(store.selectedTaskId()).toBe('TASK_2026_203');
    });

    it('registers no run action anywhere in the catalogue (BR-8)', async () => {
      const fixture = await render(populated);
      (fixture.nativeElement as HTMLElement)
        .querySelector<HTMLButtonElement>(
          '[data-testid="tasks-palette-trigger"]',
        )
        ?.click();
      fixture.detectChanges();

      const rendered = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll(
          '[data-testid="task-palette-dialog"] [role="option"]',
        ),
      ).map((option) => option.textContent?.toLowerCase() ?? '');

      expect(rendered.length).toBeGreaterThan(0);
      for (const label of rendered) {
        expect(label).not.toContain('start task');
        expect(label).not.toContain('run task');
      }
    });

    it('issues no RPC at all while it is opened, typed into and navigated', async () => {
      // The palette is a `computed()` over a payload already in hand (FR-C1.4)
      // and R4's "rendering the board writes nothing" applies to it too: not
      // "no WRITE", no call. A catalogue that fetched would put an RPC on every
      // keystroke of a surface designed to be typed into fast.
      const fixture = await render(populated);
      rpcCall.mockClear();

      const host = fixture.nativeElement as HTMLElement;
      host
        .querySelector<HTMLButtonElement>(
          '[data-testid="tasks-palette-trigger"]',
        )
        ?.click();
      fixture.detectChanges();

      const input = host.querySelector(
        '[data-testid="task-palette-dialog"] input',
      ) as HTMLInputElement;
      input.value = 'filter';
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      press(fixture, input, 'ArrowDown');
      press(fixture, input, 'Escape');
      await fixture.whenStable();

      expect(rpcCall).not.toHaveBeenCalled();
    });

    it('closes on Escape and gives focus back to the trigger', async () => {
      const fixture = await render(populated);
      const trigger = (
        fixture.nativeElement as HTMLElement
      ).querySelector<HTMLButtonElement>(
        '[data-testid="tasks-palette-trigger"]',
      );
      trigger?.focus();
      trigger?.click();
      fixture.detectChanges();
      TestBed.inject(ApplicationRef).tick();

      const input = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="task-palette-dialog"] input',
      ) as HTMLInputElement;
      expect(document.activeElement).toBe(input);

      press(fixture, input, 'Escape');

      expect(dialog(fixture)).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });
  });

  // -------------------------------------------------------------------------
  // Board keyboard activation (FR-C7.2 / FR-C7.3), through the real surface
  // -------------------------------------------------------------------------
  describe('board keyboard', () => {
    const populated = board({
      backlog: [task('TASK_2026_200'), task('TASK_2026_201')],
    });

    const card = (fixture: ComponentFixture<TasksViewComponent>, id: string) =>
      (fixture.nativeElement as HTMLElement).querySelector(
        `[data-task-id="${id}"]`,
      ) as HTMLElement;

    function key(
      fixture: ComponentFixture<TasksViewComponent>,
      target: Element,
      value: string,
    ): void {
      target.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: value,
          bubbles: true,
          cancelable: true,
        }),
      );
      fixture.detectChanges();
    }

    it('opens the detail panel with Enter on the focused card', async () => {
      const fixture = await render(populated);
      const store = TestBed.inject(TasksStore);

      key(fixture, card(fixture, 'TASK_2026_200'), 'Enter');
      await fixture.whenStable();

      expect(store.selectedTaskId()).toBe('TASK_2026_200');
    });

    /**
     * The Space seam, re-pointed by FR-C4 (Batch 12).
     *
     * Until the multi-select model existed, Space toggled the DETAIL PANEL,
     * because that was the only selection there was. This asserts what it does
     * now AND what it must no longer do: the panel stays shut. The second half
     * is the half worth having — a re-point that added the selection while
     * still opening the panel would pass an assertion that only checked the
     * selection, and would be exactly the conflation `checked` and `selected`
     * exist to prevent.
     */
    it('toggles the MULTI-SELECTION with Space, and opens no detail panel', async () => {
      const fixture = await render(populated);
      const store = TestBed.inject(TasksStore);

      key(fixture, card(fixture, 'TASK_2026_200'), ' ');
      await fixture.whenStable();
      expect([...store.selection()]).toEqual(['TASK_2026_200']);
      expect(store.selectedTaskId()).toBeNull();

      key(fixture, card(fixture, 'TASK_2026_200'), ' ');
      await fixture.whenStable();
      expect([...store.selection()]).toEqual([]);
      expect(store.selectedTaskId()).toBeNull();
    });

    it('closes the detail panel with Escape when nothing is selected', async () => {
      const fixture = await render(populated);
      const store = TestBed.inject(TasksStore);

      key(fixture, card(fixture, 'TASK_2026_200'), 'Enter');
      await fixture.whenStable();
      fixture.detectChanges();
      expect(store.selectedTaskId()).toBe('TASK_2026_200');

      key(fixture, card(fixture, 'TASK_2026_200'), 'Escape');
      await fixture.whenStable();

      expect(store.selectedTaskId()).toBeNull();
    });

    /**
     * The Escape seam, re-pointed by FR-C7.3's two branches.
     *
     * Both are open here, which is the only arrangement that can tell the
     * branches apart: the FIRST Escape must clear the selection and leave the
     * panel alone, and only the second closes the panel. A reducer that cleared
     * both at once, or that closed the panel first, fails this — and either
     * would discard the twelve-click artefact in preference to the one-click
     * one.
     */
    it('clears the selection with Escape BEFORE it closes the detail panel', async () => {
      const fixture = await render(populated);
      const store = TestBed.inject(TasksStore);

      key(fixture, card(fixture, 'TASK_2026_200'), 'Enter');
      await fixture.whenStable();
      fixture.detectChanges();
      key(fixture, card(fixture, 'TASK_2026_200'), ' ');
      await fixture.whenStable();
      fixture.detectChanges();
      expect(store.selectedTaskId()).toBe('TASK_2026_200');
      expect(store.selectionCount()).toBe(1);

      key(fixture, card(fixture, 'TASK_2026_200'), 'Escape');
      await fixture.whenStable();
      fixture.detectChanges();
      expect(store.selectionCount()).toBe(0);
      expect(store.selectedTaskId()).toBe('TASK_2026_200');

      key(fixture, card(fixture, 'TASK_2026_200'), 'Escape');
      await fixture.whenStable();
      expect(store.selectedTaskId()).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Bulk (FR-C4 / FR-C6.7) — the view's half: what is rendered, and where a
  // palette-launched move goes.
  // -------------------------------------------------------------------------
  describe('bulk', () => {
    const populated = board({
      backlog: [task('TASK_2026_200'), task('TASK_2026_201')],
    });

    const bar = (fixture: ComponentFixture<TasksViewComponent>) =>
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="task-bulk-bar"]',
      );

    /**
     * THE BINDINGS THEMSELVES (`tasks-view.component.ts`, the bulk-bar block).
     *
     * ## Why this test exists, stated plainly
     *
     * Every other test in this batch exercises logic that lives in a method.
     * The template's output→store wiring is not a method: it is six bindings,
     * and `cancelRun`, `selectAllMatching`, `clearSelection`, `confirmRequest`
     * and `cancelRequest` all take no argument and return void. **Swap any two
     * of them and typecheck passes, because their signatures are identical.**
     *
     * The concrete failure that motivates it: a swapped `(cancelRun)` makes
     * Cancel a silent no-op on a live 120-task run. The user presses the one
     * control that exists to stop the operation and nothing stops — no error,
     * no log, and the writes keep landing. A same-signature swap is exactly the
     * class of defect a compiler cannot see, so it needs an assertion that
     * names which output reaches which method.
     *
     * Each output is emitted through the real child component instance, so the
     * binding under test is the one the template actually declares.
     */
    it('wires every bulk-bar output to its own store method', async () => {
      const fixture = await render(populated);
      const store = TestBed.inject(TasksStore);
      store.toggleSelection('TASK_2026_200');
      fixture.detectChanges();

      const bar = fixture.debugElement.query(By.directive(TaskBulkBarComponent))
        .componentInstance as TaskBulkBarComponent;

      const spies = {
        requestBulkStatus: jest
          .spyOn(store, 'requestBulkStatus')
          .mockImplementation(() => undefined),
        requestBulkLabel: jest
          .spyOn(store, 'requestBulkLabel')
          .mockImplementation(() => undefined),
        confirmBulkRequest: jest
          .spyOn(store, 'confirmBulkRequest')
          .mockImplementation(() => undefined),
        cancelBulkRequest: jest
          .spyOn(store, 'cancelBulkRequest')
          .mockImplementation(() => undefined),
        cancelBulk: jest
          .spyOn(store, 'cancelBulk')
          .mockImplementation(() => undefined),
        selectAllMatching: jest
          .spyOn(store, 'selectAllMatching')
          .mockImplementation(() => undefined),
        clearSelection: jest
          .spyOn(store, 'clearSelection')
          .mockImplementation(() => undefined),
      };

      const emissions: Array<[() => void, keyof typeof spies]> = [
        [() => bar.statusPicked.emit('done'), 'requestBulkStatus'],
        [
          () => bar.labelPicked.emit({ label: 'licensing', mode: 'add' }),
          'requestBulkLabel',
        ],
        [() => bar.confirmRequest.emit(), 'confirmBulkRequest'],
        [() => bar.cancelRequest.emit(), 'cancelBulkRequest'],
        [() => bar.cancelRun.emit(), 'cancelBulk'],
        [() => bar.selectAllMatching.emit(), 'selectAllMatching'],
        [() => bar.clearSelection.emit(), 'clearSelection'],
      ];

      for (const [emit, expected] of emissions) {
        for (const spy of Object.values(spies)) spy.mockClear();
        emit();
        fixture.detectChanges();

        // The named method ran…
        expect(spies[expected]).toHaveBeenCalledTimes(1);
        // …and NO other did. This half is what catches a swap: a wrong
        // binding still calls exactly one store method, so counting only the
        // expected one would pass against every permutation.
        for (const [name, spy] of Object.entries(spies)) {
          if (name === expected) continue;
          expect(spy).not.toHaveBeenCalled();
        }
      }

      // The one output that carries a VALUE forwards it unchanged. A binding
      // that dropped or hard-coded the status would satisfy every assertion
      // above, because those only count calls.
      for (const spy of Object.values(spies)) spy.mockClear();
      bar.statusPicked.emit('in_review');
      fixture.detectChanges();
      expect(spies.requestBulkStatus).toHaveBeenCalledWith('in_review');

      // The label pick carries TWO values, and the binding unpacks them. A
      // binding that swapped or dropped `mode` would still have satisfied the
      // call-counting above — and "add" where "remove" was meant writes the
      // label onto every selected carrier instead of taking it off.
      for (const spy of Object.values(spies)) spy.mockClear();
      bar.labelPicked.emit({ label: 'licensing', mode: 'remove' });
      fixture.detectChanges();
      expect(spies.requestBulkLabel).toHaveBeenCalledWith(
        'licensing',
        'remove',
      );
    });

    /**
     * The summary's Retry reaches the ONE entry point with the whole operation.
     *
     * Bound to `requestBulkStatus` — the shape it had before labels existed —
     * this would not compile for a label operation; bound to `runBulk` it would
     * compile fine and skip the confirmation on a 40-task retry. Only
     * `requestBulk` is both.
     */
    it('routes the summary Retry through the confirming entry point', async () => {
      const fixture = await render(populated);
      const store = TestBed.inject(TasksStore);
      store.toggleSelection('TASK_2026_200');
      fixture.detectChanges();

      rpcCall.mockImplementation((method: string, params: unknown) => {
        if (method === 'tasks:bulkUpdateLabel') {
          const ids = (params as { taskIds: string[] }).taskIds;
          return Promise.resolve(
            ok({
              results: ids.map((taskId) => ({
                taskId,
                ok: false,
                error: { code: 'WRITE_FAILED', message: 'the write failed' },
              })),
            }),
          );
        }
        return Promise.resolve(ok(populated));
      });
      await store.runBulk({
        kind: 'label',
        label: 'licensing',
        mode: 'remove',
      });
      fixture.detectChanges();

      const requestBulk = jest
        .spyOn(store, 'requestBulk')
        .mockImplementation(() => undefined);
      const summary = fixture.debugElement.query(
        By.directive(TaskBulkSummaryComponent),
      ).componentInstance as TaskBulkSummaryComponent;
      summary.retry.emit({ kind: 'label', label: 'licensing', mode: 'remove' });
      fixture.detectChanges();

      expect(requestBulk).toHaveBeenCalledWith({
        kind: 'label',
        label: 'licensing',
        mode: 'remove',
      });
    });

    /**
     * A pending confirmation must not be read against the PREVIOUS run's
     * failure list.
     *
     * Both halves matter and they pull in opposite directions. Left visible,
     * the user confirming a Retry sees two sets of numbers on screen and cannot
     * tell which run they describe. But CLEARED on the request, a user who then
     * declines loses the very list they were consulting in order to decide — so
     * the summary must come back intact.
     */
    it('hides a stale summary under a confirmation, and restores it on decline', async () => {
      const many = board({
        backlog: Array.from({ length: 11 }, (_, index) =>
          task(`TASK_2026_2${String(index).padStart(2, '0')}`),
        ),
      });
      const fixture = await render(many);
      const store = TestBed.inject(TasksStore);
      const panel = () =>
        (fixture.nativeElement as HTMLElement).querySelector(
          '[data-testid="task-bulk-summary"]',
        );

      // Stage a finished run that left failures behind.
      rpcCall.mockImplementation((method: string, params: unknown) => {
        if (method === 'tasks:bulkUpdateStatus') {
          const ids = (params as { taskIds: string[] }).taskIds;
          return Promise.resolve(
            ok({
              results: ids.map((taskId) => ({
                taskId,
                ok: false,
                error: { code: 'WRITE_FAILED', message: 'the write failed' },
              })),
            }),
          );
        }
        return Promise.resolve(ok(many));
      });
      store.selectAllMatching();
      await store.runBulk({ kind: 'status', status: 'done' });
      fixture.detectChanges();
      expect(panel()).not.toBeNull();

      // A retry over 11 tasks needs confirming — the old summary steps aside.
      store.requestBulkStatus('done');
      fixture.detectChanges();
      expect(store.bulkRequest()).toEqual({ kind: 'status', status: 'done' });
      expect(panel()).toBeNull();

      // Declining brings it back rather than having destroyed it.
      store.cancelBulkRequest();
      fixture.detectChanges();
      expect(panel()).not.toBeNull();
      expect(store.bulkSummary()?.failures).toHaveLength(11);
    });

    it('shows no bulk bar until something is selected', async () => {
      const fixture = await render(populated);
      expect(bar(fixture)).toBeNull();

      TestBed.inject(TasksStore).toggleSelection('TASK_2026_200');
      fixture.detectChanges();

      expect(bar(fixture)?.textContent).toContain('1 selected');
    });

    /**
     * FR-C6.7 — the palette does not get its own consent path.
     *
     * Eleven tasks are selected (one over BULK_CONFIRM_THRESHOLD) and the bulk
     * entry is run from the palette catalogue. The assertion is that NO write
     * was issued and a confirmation is pending instead: if the dispatcher
     * called `bulkUpdateStatus` directly — the obvious, wrong wiring — the RPC
     * spy would show a `tasks:bulkUpdateStatus` call here.
     */
    it('routes a palette bulk action through the same confirmation', async () => {
      const many = board({
        backlog: Array.from({ length: 11 }, (_, index) =>
          task(`TASK_2026_2${String(index).padStart(2, '0')}`),
        ),
      });
      const fixture = await render(many);
      const store = TestBed.inject(TasksStore);
      store.selectAllMatching();
      fixture.detectChanges();
      expect(store.selectionCount()).toBe(11);

      const entry = fixture.componentInstance as unknown as {
        onPaletteRun(action: TaskPaletteAction): void;
      };
      entry.onPaletteRun({ kind: 'bulkSetStatus', status: 'done' });
      fixture.detectChanges();

      expect(store.bulkRequest()).toEqual({ kind: 'status', status: 'done' });
      expect(
        rpcCall.mock.calls.filter(
          (call) => call[0] === 'tasks:bulkUpdateStatus',
        ),
      ).toEqual([]);
      expect(bar(fixture)?.textContent).toContain('Move 11 task(s) to Done?');
    });
  });
});
