import { TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import {
  EMPTY_TASK_FILTER,
  TASK_STATUSES,
  type ExcludedTaskFolder,
  type TaskStatus,
  type TaskSpecSummary,
  type TasksBoardResult,
} from '@ptah-extension/shared';
import { TasksStore } from '../services/tasks-store.service';
import { TasksViewComponent } from './tasks-view.component';

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

  function setup(payload: BoardPayload = board({}, { specsDirExists: false })) {
    rpcCall = jest.fn().mockResolvedValue(ok(payload));
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

  async function render(payload?: BoardPayload) {
    setup(payload);
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
});
