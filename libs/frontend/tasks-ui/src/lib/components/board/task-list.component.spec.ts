import { TestBed } from '@angular/core/testing';
import type {
  TaskGraph,
  TaskSpecSummary,
  TaskStatus,
} from '@ptah-extension/shared';
import type { TaskBoardColumn } from '../../services/tasks-store.service';
import { TaskListComponent } from './task-list.component';

function makeTask(
  id: string,
  status: TaskStatus = 'backlog',
  overrides: Partial<TaskSpecSummary> = {},
): TaskSpecSummary {
  return {
    id,
    folderName: id,
    status,
    type: 'FEATURE',
    title: `Title ${id}`,
    dependsOn: [],
    labels: [],
    duplicates: [],
    relatesTo: [],
    created: null,
    updated: null,
    frontmatterValid: true,
    validationIssues: [],
    ...overrides,
  };
}

function column(
  status: TaskStatus,
  tasks: TaskSpecSummary[],
  total = tasks.length,
): TaskBoardColumn {
  return { status, tasks, total };
}

function makeGraph(rollup: TaskGraph['rollup']): TaskGraph {
  return {
    effectiveParent: new Map(),
    children: new Map(),
    rollup,
  } as TaskGraph;
}

describe('TaskListComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TaskListComponent] });
  });

  function render(
    columns: TaskBoardColumn[],
    inputs: Record<string, unknown> = {},
  ) {
    const fixture = TestBed.createComponent(TaskListComponent);
    fixture.componentRef.setInput('columns', columns);
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      host,
      rows: () => Array.from(host.querySelectorAll('tbody tr')),
      rowIds: () =>
        Array.from(host.querySelectorAll('tbody tr')).map((row) =>
          row.getAttribute('data-task-id'),
        ),
      headers: () =>
        Array.from(host.querySelectorAll('thead th')).map((cell) =>
          (cell.textContent ?? '').trim(),
        ),
      count: (status: TaskStatus) =>
        host
          .querySelector(`[data-testid="task-list-count-${status}"]`)
          ?.textContent?.replace(/\s+/g, ' ')
          .trim(),
      groupToggle: (status: TaskStatus) =>
        host.querySelector<HTMLButtonElement>(
          `[data-testid="task-list-group-${status}"]`,
        ),
      empty: (status: TaskStatus) =>
        host
          .querySelector(`[data-testid="task-list-empty-${status}"]`)
          ?.textContent?.replace(/\s+/g, ' ')
          .trim(),
    };
  }

  // ---------------------------------------------------------------------------
  // Grouping and counts — the same rules the Kanban column already holds to
  // ---------------------------------------------------------------------------

  it('renders one group per column, in the order supplied', () => {
    const view = render([
      column('backlog', [makeTask('TASK_2026_200')]),
      column('in_progress', [makeTask('TASK_2026_201', 'in_progress')]),
    ]);
    expect(view.rowIds()).toEqual(['TASK_2026_200', 'TASK_2026_201']);
  });

  it('shows the bare count when the filter is hiding nothing', () => {
    const view = render([column('backlog', [makeTask('TASK_2026_200')])]);
    expect(view.count('backlog')).toBe('1');
  });

  it('shows filtered over indexed once the filter hides something', () => {
    const view = render([column('backlog', [makeTask('TASK_2026_200')], 3)]);
    expect(view.count('backlog')).toBe('1 of 3');
  });

  /**
   * An empty group says WHY it is empty. "No tasks" under an active filter is a
   * false statement about the workspace.
   */
  it('names the filter as the reason an emptied group is empty', () => {
    const view = render([column('backlog', [], 4)]);
    expect(view.empty('backlog')).toBe('4 hidden by the filter');
  });

  it('says "No tasks" when nothing is hidden', () => {
    expect(render([column('backlog', [], 0)]).empty('backlog')).toBe(
      'No tasks',
    );
  });

  // ---------------------------------------------------------------------------
  // Collapsing
  // ---------------------------------------------------------------------------

  it('folds a group away and brings it back', () => {
    const view = render([column('backlog', [makeTask('TASK_2026_200')])]);
    expect(view.rows()).toHaveLength(1);

    view.groupToggle('backlog')?.click();
    view.fixture.detectChanges();
    expect(view.rows()).toHaveLength(0);
    expect(view.groupToggle('backlog')?.getAttribute('aria-expanded')).toBe(
      'false',
    );

    view.groupToggle('backlog')?.click();
    view.fixture.detectChanges();
    expect(view.rows()).toHaveLength(1);
  });

  /**
   * A collapsed group's rows are not merely hidden — they leave the navigation
   * order, so the roving tab stop cannot land on something with no rendered
   * element behind it.
   */
  it('moves the roving tab stop out of a group it just folded away', () => {
    const view = render([
      column('backlog', [makeTask('TASK_2026_200')]),
      column('in_progress', [makeTask('TASK_2026_201', 'in_progress')]),
    ]);
    expect(view.rows()[0].getAttribute('tabindex')).toBe('0');

    view.groupToggle('backlog')?.click();
    view.fixture.detectChanges();

    const remaining = view.rows();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].getAttribute('data-task-id')).toBe('TASK_2026_201');
    expect(remaining[0].getAttribute('tabindex')).toBe('0');
  });

  /**
   * The per-group `+` names the status it creates in. A plus that dropped
   * everything into Backlog regardless of which group it sat on would be an
   * affordance that lies about where it puts things.
   */
  it('creates in the status of the group whose plus was pressed', () => {
    const view = render([
      column('backlog', [makeTask('TASK_2026_200')]),
      column('in_review', [makeTask('TASK_2026_201', 'in_review')]),
    ]);
    const requested: string[] = [];
    view.fixture.componentInstance.createInStatus.subscribe((status) =>
      requested.push(status),
    );

    view.host
      .querySelector<HTMLButtonElement>(
        '[data-testid="task-list-add-in_review"]',
      )
      ?.click();

    expect(requested).toEqual(['in_review']);
  });

  // ---------------------------------------------------------------------------
  // Compact mode
  // ---------------------------------------------------------------------------

  it('drops the scanning columns in compact mode, keeping Task and Type', () => {
    const columns = [column('backlog', [makeTask('TASK_2026_200')])];
    expect(render(columns).headers()).toEqual([
      'Select',
      'Task',
      'Description',
      'Type',
      // "Size", not "Estimate" — the longer word clipped at this column's
      // width in the Electron pass.
      'Size',
      'Updated',
      'Executor',
      'Progress',
      'Actions',
    ]);
    expect(render(columns, { compact: true }).headers()).toEqual([
      'Select',
      'Task',
      'Type',
      'Actions',
    ]);
  });

  // ---------------------------------------------------------------------------
  // The three selection intents, kept apart exactly as the card keeps them
  // ---------------------------------------------------------------------------

  it('opens a task on a plain click', () => {
    const view = render([column('backlog', [makeTask('TASK_2026_200')])]);
    const opened: string[] = [];
    view.fixture.componentInstance.taskSelect.subscribe((id) =>
      opened.push(id),
    );

    view.rows()[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(opened).toEqual(['TASK_2026_200']);
  });

  it('toggles the selection on Ctrl-click WITHOUT opening the task', () => {
    const view = render([column('backlog', [makeTask('TASK_2026_200')])]);
    const opened: string[] = [];
    const toggled: Array<{ taskId: string; range: boolean }> = [];
    view.fixture.componentInstance.taskSelect.subscribe((id) =>
      opened.push(id),
    );
    view.fixture.componentInstance.selectionToggle.subscribe((event) =>
      toggled.push(event),
    );

    view
      .rows()[0]
      .dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));

    expect(toggled).toEqual([{ taskId: 'TASK_2026_200', range: false }]);
    expect(opened).toEqual([]);
  });

  it('carries the Shift modifier as a range request', () => {
    const view = render([column('backlog', [makeTask('TASK_2026_200')])]);
    const toggled: Array<{ taskId: string; range: boolean }> = [];
    view.fixture.componentInstance.selectionToggle.subscribe((event) =>
      toggled.push(event),
    );

    view
      .rows()[0]
      .dispatchEvent(
        new MouseEvent('click', { bubbles: true, shiftKey: true }),
      );

    expect(toggled).toEqual([{ taskId: 'TASK_2026_200', range: true }]);
  });

  it('treats a checkbox click as a selection gesture, never an open', () => {
    const view = render([column('backlog', [makeTask('TASK_2026_200')])]);
    const opened: string[] = [];
    const toggled: string[] = [];
    view.fixture.componentInstance.taskSelect.subscribe((id) =>
      opened.push(id),
    );
    view.fixture.componentInstance.selectionToggle.subscribe((event) =>
      toggled.push(event.taskId),
    );

    view.host
      .querySelector<HTMLInputElement>('[data-testid="task-row-select"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(toggled).toEqual(['TASK_2026_200']);
    expect(opened).toEqual([]);
  });

  it('disables the checkbox while that row’s own write is in flight', () => {
    const view = render([column('backlog', [makeTask('TASK_2026_200')])], {
      pending: new Set(['TASK_2026_200']),
    });
    expect(
      view.host.querySelector<HTMLInputElement>(
        '[data-testid="task-row-select"]',
      )?.disabled,
    ).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Launch controls
  // ---------------------------------------------------------------------------

  it('starts a task without isolation from the row button', () => {
    const view = render([column('backlog', [makeTask('TASK_2026_200')])]);
    const started: Array<{ taskId: string; isolate: boolean }> = [];
    view.fixture.componentInstance.startTask.subscribe((event) =>
      started.push(event),
    );

    view.host
      .querySelector<HTMLButtonElement>('[data-testid="task-row-start"]')
      ?.click();

    expect(started).toEqual([{ taskId: 'TASK_2026_200', isolate: false }]);
  });

  /**
   * Isolation is carried by the ACTION, not by a toggle whose value survives
   * between clicks — the one behavioural difference from the card.
   */
  it('carries isolation on the menu action rather than a row toggle', () => {
    const view = render([column('backlog', [makeTask('TASK_2026_200')])]);
    const started: Array<{ taskId: string; isolate: boolean }> = [];
    view.fixture.componentInstance.startTask.subscribe((event) =>
      started.push(event),
    );

    view.host
      .querySelector<HTMLButtonElement>(
        '[data-testid="task-row-start-isolated"]',
      )
      ?.click();

    expect(started).toEqual([{ taskId: 'TASK_2026_200', isolate: true }]);
  });

  it('offers no launch control on a terminal row', () => {
    const view = render([column('done', [makeTask('TASK_2026_200', 'done')])]);
    expect(
      view.host.querySelector('[data-testid="task-row-start"]'),
    ).toBeNull();
    expect(
      view.host.querySelector('[data-testid="task-row-start-isolated"]'),
    ).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // The rollup is a control, not a readout
  // ---------------------------------------------------------------------------

  it('narrows the board to a parent’s sub-tasks from the progress cell', () => {
    const view = render([column('backlog', [makeTask('TASK_2026_200')])], {
      graph: makeGraph(
        new Map([
          ['TASK_2026_200', { done: 1, open: 2, cancelled: 0, total: 3 }],
        ]),
      ),
    });
    const filtered: string[] = [];
    view.fixture.componentInstance.filterChildren.subscribe((id) =>
      filtered.push(id),
    );

    const rollup = view.host.querySelector<HTMLButtonElement>(
      '[data-testid="task-row-rollup"]',
    );
    expect(
      view.host.querySelector('[data-testid="task-row-rollup-glyph"]')
        ?.textContent,
    ).toContain('1/3');

    rollup?.click();
    expect(filtered).toEqual(['TASK_2026_200']);
  });

  /**
   * A control named only by its value tells a screen-reader user what it says
   * and nothing about what pressing it will do.
   */
  it('names the rollup with the counts AND what activating it does', () => {
    const view = render([column('backlog', [makeTask('TASK_2026_200')])], {
      graph: makeGraph(
        new Map([
          ['TASK_2026_200', { done: 1, open: 2, cancelled: 0, total: 3 }],
        ]),
      ),
    });
    expect(
      view.host
        .querySelector('[data-testid="task-row-rollup"]')
        ?.getAttribute('title'),
    ).toContain('show only these sub-tasks');
  });

  // ---------------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------------

  it('is ONE tab stop: exactly one row carries tabindex 0', () => {
    const view = render([
      column('backlog', [makeTask('TASK_2026_200'), makeTask('TASK_2026_201')]),
      column('in_progress', [makeTask('TASK_2026_202', 'in_progress')]),
    ]);
    const zeroes = view
      .rows()
      .filter((row) => row.getAttribute('tabindex') === '0');
    expect(zeroes).toHaveLength(1);
  });

  it('walks Down across a group boundary', () => {
    const view = render([
      column('backlog', [makeTask('TASK_2026_200')]),
      column('in_progress', [makeTask('TASK_2026_201', 'in_progress')]),
    ]);

    view.host.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );
    view.fixture.detectChanges();

    expect(view.rows()[1].getAttribute('tabindex')).toBe('0');
  });

  it('emits Escape for the host to interpret', () => {
    const view = render([column('backlog', [makeTask('TASK_2026_200')])]);
    let escaped = 0;
    view.fixture.componentInstance.escapePressed.subscribe(() => {
      escaped += 1;
    });

    view.host.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(escaped).toBe(1);
  });

  /**
   * The row wraps Start, the actions menu and the rollup. A keyboard activation
   * on any of them bubbles here BEFORE the synthesised click their own handlers
   * stop — so without the guard, Enter on the rollup would narrow the board AND
   * open a detail panel for a row that narrowing just hid.
   */
  it('does not open the row when Enter lands on a descendant control', () => {
    const view = render([column('backlog', [makeTask('TASK_2026_200')])]);
    const opened: string[] = [];
    view.fixture.componentInstance.taskSelect.subscribe((id) =>
      opened.push(id),
    );

    view.host
      .querySelector<HTMLButtonElement>('[data-testid="task-row-start"]')
      ?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );

    expect(opened).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Cell rendering
  // ---------------------------------------------------------------------------

  it('renders an em dash rather than "Invalid Date" for an unparseable updated', () => {
    const view = render([
      column('backlog', [
        makeTask('TASK_2026_200', 'backlog', { updated: 'not-a-date' }),
      ]),
    ]);
    expect(
      view.host.querySelector('[data-testid="task-row-updated"]')?.textContent,
    ).toContain('—');
  });

  /**
   * ISO, not a localized format. It is the shortest unambiguous form — the
   * localized "Aug 10, 2026" wrapped this column onto two lines and put dead
   * height on every row — it sorts lexicographically like the column it labels,
   * and it renders identically regardless of the host locale, which the
   * localized form did not.
   */
  it('renders the updated date as YYYY-MM-DD, locale-independently', () => {
    const view = render([
      column('backlog', [
        makeTask('TASK_2026_200', 'backlog', {
          updated: '2026-08-09T11:15:00.000Z',
        }),
      ]),
    ]);
    expect(
      view.host
        .querySelector('[data-testid="task-row-updated"]')
        ?.textContent?.trim(),
    ).toBe('2026-08-09');
  });

  /**
   * ONE chip, against the card's three. The row shares a single cell with the
   * id and the title, and every chip is taken straight off the title — three
   * of them cut the title down to "The sta…" in the Electron pass. The overflow
   * chip still names every label it stands for, so nothing is hidden outright.
   */
  it('shows one label chip and names every label it rolled up', () => {
    const view = render([
      column('backlog', [
        makeTask('TASK_2026_200', 'backlog', {
          labels: ['one', 'two', 'three', 'four'],
        }),
      ]),
    ]);
    expect(
      view.host.querySelectorAll('[data-testid="task-row-labels-overflow"]'),
    ).toHaveLength(1);
    const overflow = view.host.querySelector(
      '[data-testid="task-row-labels-overflow"]',
    );
    expect(overflow?.textContent?.trim()).toBe('+3');
    expect(overflow?.getAttribute('title')).toContain('two, three, four');
  });

  /**
   * "refused" and "not attempted" are the WORD, never the colour: a cancelled
   * run leaves both states looking identical otherwise, and the user cannot
   * tell which of them Retry is for.
   */
  it('states a bulk outcome in words', () => {
    const view = render([column('backlog', [makeTask('TASK_2026_200')])], {
      outcomes: new Map([['TASK_2026_200', 'failed']]),
    });
    expect(
      view.host
        .querySelector('[data-testid="task-row-outcome-failed"]')
        ?.textContent?.trim(),
    ).toBe('refused');
  });
});
