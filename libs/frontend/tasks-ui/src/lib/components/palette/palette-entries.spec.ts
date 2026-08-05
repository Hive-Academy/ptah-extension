import {
  EMPTY_TASK_FILTER,
  type SavedTaskView,
  type TaskSpecSummary,
} from '@ptah-extension/shared';
import {
  EMPTY_PALETTE_CONTEXT,
  buildPaletteEntries,
  type TaskPaletteContext,
  type TaskPaletteEntry,
} from './palette-entries';

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
    created: null,
    updated: null,
    frontmatterValid: true,
    validationIssues: [],
    ...overrides,
  };
}

function context(
  overrides: Partial<TaskPaletteContext> = {},
): TaskPaletteContext {
  return { ...EMPTY_PALETTE_CONTEXT, ...overrides };
}

function byId(
  entries: readonly TaskPaletteEntry[],
  id: string,
): TaskPaletteEntry {
  const found = entries.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`no palette entry with id ${id}`);
  return found;
}

describe('buildPaletteEntries', () => {
  // -------------------------------------------------------------------------
  // BR-8 / R12 — the omission, asserted rather than assumed
  // -------------------------------------------------------------------------
  it('registers no run action, under any context', () => {
    // Every branch of the catalogue at once: a selection, views, labels,
    // executors, estimates, exclusions. If a launch entry existed anywhere,
    // this is the context that would produce it.
    const selected = task('TASK_2026_200', { labels: ['licensing'] });
    const entries = buildPaletteEntries(
      context({
        tasks: [selected],
        views: [view('v1', 'Mine')],
        knownLabels: ['licensing'],
        knownExecutors: ['claude'],
        estimatesInUse: ['M'],
        selectedTask: selected,
        excludedCount: 3,
      }),
    );

    const kinds = new Set(entries.map((entry) => entry.action.kind));
    expect(kinds.has('openTask' as const)).toBe(true);
    // The negative, spelled out: no variant that could launch anything.
    for (const entry of entries) {
      expect(entry.action.kind).not.toBe('start');
      expect(entry.action.kind).not.toBe('startTask');
      expect(entry.label.toLowerCase()).not.toContain('start');
      expect(entry.label.toLowerCase()).not.toContain('run task');
    }
  });

  // -------------------------------------------------------------------------
  // FR-C6.2 — the minimum catalogue
  // -------------------------------------------------------------------------
  it('offers every command FR-C6.2 names', () => {
    const selected = task('TASK_2026_200');
    const entries = buildPaletteEntries(
      context({
        tasks: [selected],
        views: [view('v1', 'Mine')],
        knownLabels: ['licensing'],
        selectedTask: selected,
        excludedCount: 1,
      }),
    );
    const ids = entries.map((entry) => entry.id);

    expect(ids).toContain('task:TASK_2026_200'); // jump to a task
    expect(ids).toContain('view:v1'); // apply a saved view
    expect(ids).toContain('status:in_progress'); // set status on the selection
    expect(ids).toContain('label:licensing'); // add/remove a label
    expect(ids).toContain('board:create'); // create a task
    expect(ids).toContain('filter:clear'); // clear all filters
    expect(ids).toContain('filter:status:done'); // toggle one facet
    expect(ids).toContain('board:exclusions'); // open the exclusions drawer
    expect(ids).toContain('board:reindex'); // reindex
  });

  it('labels a task entry id-first so typing an id is a prefix match', () => {
    const entries = buildPaletteEntries(
      context({ tasks: [task('TASK_2026_200', { title: 'Board metadata' })] }),
    );
    expect(byId(entries, 'task:TASK_2026_200').label).toBe(
      'TASK_2026_200 — Board metadata',
    );
  });

  // -------------------------------------------------------------------------
  // FR-C6.6 — listed AND disabled, never hidden
  // -------------------------------------------------------------------------
  describe('with no task selected', () => {
    const entries = buildPaletteEntries(
      context({ knownLabels: ['licensing'] }),
    );

    it('still lists every selection-scoped action', () => {
      const scoped = entries.filter((entry) => entry.group === 'selection');
      // Six statuses (none excluded, because nothing is selected) + one label.
      expect(scoped).toHaveLength(7);
    });

    it('disables each of them with a stated reason', () => {
      for (const entry of entries.filter((e) => e.group === 'selection')) {
        expect(entry.disabledReason).not.toBeNull();
        expect(entry.disabledReason).toContain('No task is selected');
      }
    });
  });

  it('enables the selection-scoped actions once a task is selected', () => {
    const selected = task('TASK_2026_200');
    const entries = buildPaletteEntries(
      context({
        tasks: [selected],
        knownLabels: ['licensing'],
        selectedTask: selected,
      }),
    );
    for (const entry of entries.filter((e) => e.group === 'selection')) {
      expect(entry.disabledReason).toBeNull();
    }
  });

  it('omits the status the selected task already holds', () => {
    const selected = task('TASK_2026_200', { status: 'in_progress' });
    const entries = buildPaletteEntries(
      context({ tasks: [selected], selectedTask: selected }),
    );
    const ids = entries.map((entry) => entry.id);
    expect(ids).not.toContain('status:in_progress');
    expect(ids).toContain('status:done');
  });

  it('disables clear-all when no filter is active, and enables it when one is', () => {
    expect(
      byId(buildPaletteEntries(context()), 'filter:clear').disabledReason,
    ).toContain('No filter is active');

    expect(
      byId(
        buildPaletteEntries(
          context({ filter: { ...EMPTY_TASK_FILTER, statuses: ['done'] } }),
        ),
        'filter:clear',
      ).disabledReason,
    ).toBeNull();
  });

  it('disables the exclusions entry when nothing is being skipped', () => {
    expect(
      byId(buildPaletteEntries(context()), 'board:exclusions').disabledReason,
    ).toContain('Nothing is being skipped');
    expect(
      byId(
        buildPaletteEntries(context({ excludedCount: 2 })),
        'board:exclusions',
      ).disabledReason,
    ).toBeNull();
  });

  it('disables reindex while the board is busy', () => {
    expect(
      byId(buildPaletteEntries(context({ busy: true })), 'board:reindex')
        .disabledReason,
    ).toContain('already running');
  });

  // -------------------------------------------------------------------------
  // Facet toggles carry the WHOLE next spec, computed here
  // -------------------------------------------------------------------------
  it('adds a facet value that is not selected', () => {
    const action = byId(
      buildPaletteEntries(context()),
      'filter:status:done',
    ).action;
    expect(action).toEqual({
      kind: 'setFilter',
      filter: { ...EMPTY_TASK_FILTER, statuses: ['done'] },
    });
  });

  it('removes a facet value that IS selected, and says so in the label', () => {
    const entries = buildPaletteEntries(
      context({
        filter: { ...EMPTY_TASK_FILTER, statuses: ['done', 'backlog'] },
      }),
    );
    const entry = byId(entries, 'filter:status:done');

    expect(entry.label).toBe('Remove the status filter: Done');
    expect(entry.action).toEqual({
      kind: 'setFilter',
      filter: { ...EMPTY_TASK_FILTER, statuses: ['backlog'] },
    });
  });

  it('leaves every other facet standing when it toggles one', () => {
    const filter = {
      ...EMPTY_TASK_FILTER,
      text: 'metadata',
      types: ['BUGFIX' as const],
      hasValidationIssues: true,
    };
    const action = byId(
      buildPaletteEntries(context({ filter })),
      'filter:status:done',
    ).action;

    expect(action).toEqual({
      kind: 'setFilter',
      filter: { ...filter, statuses: ['done'] },
    });
  });

  it('lists only the estimate buckets that hold a task', () => {
    const ids = buildPaletteEntries(context({ estimatesInUse: ['M'] })).map(
      (entry) => entry.id,
    );
    expect(ids).toContain('filter:estimate:M');
    expect(ids).not.toContain('filter:estimate:XL');
    // "unestimated" is always offered: it is a facet about ABSENCE, so there
    // is no bucket whose emptiness could justify hiding it.
    expect(ids).toContain('filter:unestimated');
  });

  // -------------------------------------------------------------------------
  // Label add/remove — full replacement, folded on labelKey
  // -------------------------------------------------------------------------
  it('adds a label the selected task does not carry', () => {
    const selected = task('TASK_2026_200', { labels: ['existing'] });
    const entry = byId(
      buildPaletteEntries(
        context({
          knownLabels: ['licensing'],
          selectedTask: selected,
        }),
      ),
      'label:licensing',
    );

    expect(entry.label).toBe('Add label: licensing');
    expect(entry.action).toEqual({
      kind: 'setLabels',
      taskId: 'TASK_2026_200',
      labels: ['existing', 'licensing'],
    });
  });

  it('removes a label the task carries under a different spelling', () => {
    // `labelKey` folds case and surrounding whitespace, so ' Licensing ' and
    // 'licensing' are one label everywhere else on the board. An "Add" here
    // would write a duplicate the filter could never tell apart.
    const selected = task('TASK_2026_200', { labels: [' Licensing ', 'keep'] });
    const entry = byId(
      buildPaletteEntries(
        context({ knownLabels: ['licensing'], selectedTask: selected }),
      ),
      'label:licensing',
    );

    expect(entry.label).toBe('Remove label: licensing');
    expect(entry.action).toEqual({
      kind: 'setLabels',
      taskId: 'TASK_2026_200',
      labels: ['keep'],
    });
  });

  // -------------------------------------------------------------------------
  // Ordering — the catalogue's authored order IS the blank-query order
  // -------------------------------------------------------------------------
  it('puts the short board commands before the per-task jump list', () => {
    const entries = buildPaletteEntries(
      context({ tasks: [task('TASK_2026_200')] }),
    );
    const firstTaskEntry = entries.findIndex((e) => e.group === 'tasks');
    const lastBoardEntry = entries.map((e) => e.group).lastIndexOf('board');
    expect(lastBoardEntry).toBeLessThan(firstTaskEntry);
  });

  it('gives every entry a unique id', () => {
    const selected = task('TASK_2026_200', { labels: ['licensing'] });
    const entries = buildPaletteEntries(
      context({
        tasks: [selected, task('TASK_2026_201')],
        views: [view('v1', 'Mine'), view('v2', 'Theirs')],
        knownLabels: ['licensing', 'needs:design'],
        knownExecutors: ['claude', 'codex'],
        estimatesInUse: ['M', 'L'],
        selectedTask: selected,
        excludedCount: 1,
      }),
    );
    const ids = entries.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // -------------------------------------------------------------------------
  // Bulk entries (FR-C6.7) — the checked tasks, not the open one
  // -------------------------------------------------------------------------
  describe('bulk entries', () => {
    it('lists a bulk move for every status, disabled with a reason when nothing is checked', () => {
      const entries = buildPaletteEntries(context({ selectionCount: 0 }));
      const bulk = entries.filter((entry) => entry.group === 'bulk');

      expect(bulk).toHaveLength(6);
      for (const entry of bulk) {
        expect(entry.disabledReason).toContain('No tasks are checked');
      }
    });

    /**
     * The count is in the label, and it comes from `selectionCount` rather than
     * from `selectedTask`. Those are two different numbers: a user can have one
     * task open for reading and forty checked for writing, and an entry that
     * read the wrong one would offer to move a set of one.
     */
    it('names the checked count and stays enabled, independent of the open task', () => {
      const entries = buildPaletteEntries(
        context({ selectionCount: 42, selectedTask: null }),
      );
      const entry = byId(entries, 'bulk:status:done');

      expect(entry.disabledReason).toBeNull();
      expect(entry.label).toBe('Move 42 checked task(s) to Done');
      expect(entry.action).toEqual({ kind: 'bulkSetStatus', status: 'done' });
    });

    /**
     * Unlike the single-task status entries, the bulk list omits nothing.
     * There is no one "current status" across a set, and dropping a target
     * because part of the selection already holds it would remove the command
     * needed to consolidate a mixed selection.
     */
    it('offers every status, including one the open task already holds', () => {
      const selected = task('TASK_2026_200', { status: 'in_progress' });
      const entries = buildPaletteEntries(
        context({
          tasks: [selected],
          selectedTask: selected,
          selectionCount: 3,
        }),
      );
      const ids = entries.map((entry) => entry.id);

      expect(ids).not.toContain('status:in_progress');
      expect(ids).toContain('bulk:status:in_progress');
    });
  });

  it('builds nothing but the always-available commands from the empty context', () => {
    const entries = buildPaletteEntries(EMPTY_PALETTE_CONTEXT);
    expect(entries.some((e) => e.group === 'tasks')).toBe(false);
    expect(entries.some((e) => e.group === 'views')).toBe(false);
    expect(byId(entries, 'board:create').disabledReason).toBeNull();
  });
});

function view(id: string, name: string): SavedTaskView {
  return {
    id,
    name,
    filter: EMPTY_TASK_FILTER,
    sort: { field: 'updated', direction: 'desc' },
    order: 0,
  };
}
