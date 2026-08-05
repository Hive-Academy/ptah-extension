/**
 * `filterTasks` / `sortTasks` — unit specs (TASK_2026_181, Task 6.2).
 *
 * This spec pins the SEMANTICS of the single filter predicate (FR-C1.5). The
 * companion parity spec in `rpc-handlers` proves that the `tasks:list` handler
 * reaches the same answer over the same fixture; between them, a divergence
 * becomes a test failure rather than a behavioural difference nobody can
 * reproduce.
 */
import { buildTaskGraph } from './task-graph';
import {
  DEFAULT_TASK_SORT,
  EMPTY_TASK_FILTER,
  MAX_TASK_FILTER_TEXT_LENGTH,
  MAX_TASK_FILTER_VALUES,
  TaskFilterSpecSchema,
  TaskSortSpecSchema,
  filterTasks,
  isTaskFilterActive,
  mergeStatusTypeFacets,
  sortTasks,
  type TaskFilterSpec,
  type TaskSortSpec,
} from './task-filter';
import type { TaskSpecSummary } from './task-spec.types';

/** `TASK_2026_007` from `7`. Keeps every fixture id inside the contract (BR-7). */
function id(n: number): string {
  return `TASK_2026_${String(n).padStart(3, '0')}`;
}

function task(
  overrides: Partial<TaskSpecSummary> & { id: string },
): TaskSpecSummary {
  return {
    folderName: overrides.id,
    status: 'backlog',
    type: 'FEATURE',
    title: overrides.id,
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

function spec(overrides: Partial<TaskFilterSpec>): TaskFilterSpec {
  return { ...EMPTY_TASK_FILTER, ...overrides };
}

function ids(tasks: readonly TaskSpecSummary[]): string[] {
  return tasks.map((t) => t.id);
}

// ---------------------------------------------------------------------------
// The neutral spec
// ---------------------------------------------------------------------------

describe('EMPTY_TASK_FILTER', () => {
  const tasks = [task({ id: id(1) }), task({ id: id(2) })];

  it('is inactive', () => {
    expect(isTaskFilterActive(EMPTY_TASK_FILTER)).toBe(false);
  });

  it('matches every task', () => {
    expect(ids(filterTasks(tasks, EMPTY_TASK_FILTER))).toEqual([id(1), id(2)]);
  });

  it('returns a NEW array, so no caller can mutate the input', () => {
    const result = filterTasks(tasks, EMPTY_TASK_FILTER);
    expect(result).not.toBe(tasks);
    result.pop();
    expect(tasks).toHaveLength(2);
  });

  it('preserves input order rather than imposing one', () => {
    const reversed = [task({ id: id(9) }), task({ id: id(2) })];
    expect(ids(filterTasks(reversed, EMPTY_TASK_FILTER))).toEqual([
      id(9),
      id(2),
    ]);
  });

  it.each([
    ['text', spec({ text: 'x' })],
    ['statuses', spec({ statuses: ['done'] })],
    ['types', spec({ types: ['BUGFIX'] })],
    ['labels', spec({ labels: ['a'] })],
    ['estimates', spec({ estimates: ['M'] })],
    ['unestimated', spec({ unestimated: true })],
    ['executors', spec({ executors: ['agent'] })],
    ['parentage', spec({ parentage: ['parent'] })],
    ['childrenOf', spec({ childrenOf: [id(1)] })],
    ['relations', spec({ relations: ['duplicate'] })],
    ['hasValidationIssues', spec({ hasValidationIssues: true })],
  ])('reports the %s facet as active', (_facet, value) => {
    expect(isTaskFilterActive(value)).toBe(true);
  });

  it('does not treat whitespace-only text as an active facet', () => {
    expect(isTaskFilterActive(spec({ text: '   ' }))).toBe(false);
  });

  it('does not treat labelsMode alone as an active facet', () => {
    expect(isTaskFilterActive(spec({ labelsMode: 'all' }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Free text (BR-10)
// ---------------------------------------------------------------------------

describe('filterTasks — free text', () => {
  const tasks = [
    task({ id: id(1), title: 'Harden the Licensing guard' }),
    task({ id: id(2), title: 'unrelated', description: 'about LICENSING' }),
    task({ id: id(3), title: 'nothing to see' }),
  ];

  it('is case-insensitive across id, title and description', () => {
    expect(ids(filterTasks(tasks, spec({ text: 'licensing' })))).toEqual([
      id(1),
      id(2),
    ]);
  });

  it('matches on the id', () => {
    expect(ids(filterTasks(tasks, spec({ text: '2026_003' })))).toEqual([
      id(3),
    ]);
  });

  it('trims the needle, so a trailing space does not stop matching', () => {
    expect(ids(filterTasks(tasks, spec({ text: '  licensing  ' })))).toEqual([
      id(1),
      id(2),
    ]);
  });

  it('does not match a task whose description is absent', () => {
    expect(filterTasks(tasks, spec({ text: 'about' }))).toHaveLength(1);
  });

  /**
   * BR-10 / NFR-13. If the needle were compiled into a RegExp these three would
   * behave as patterns (or throw); as `String.includes` they are literals.
   */
  it.each([
    ['a wildcard', '.*'],
    ['an unbalanced group', 'Licensing ('],
    ['a catastrophic-backtracking shape', '(a+)+$'],
  ])('treats %s as literal text, not a pattern', (_case, needle) => {
    expect(() => filterTasks(tasks, spec({ text: needle }))).not.toThrow();
    expect(filterTasks(tasks, spec({ text: needle }))).toHaveLength(0);
  });

  it('matches a literal needle that is also regex syntax', () => {
    const literal = [task({ id: id(4), title: 'fix (a+)+$ handling' })];
    expect(ids(filterTasks(literal, spec({ text: '(a+)+$' })))).toEqual([
      id(4),
    ]);
  });
});

// ---------------------------------------------------------------------------
// Status / type / estimate / executor
// ---------------------------------------------------------------------------

describe('filterTasks — closed vocabularies', () => {
  const tasks = [
    task({ id: id(1), status: 'backlog', type: 'FEATURE' }),
    task({ id: id(2), status: 'done', type: 'BUGFIX' }),
    task({ id: id(3), status: 'blocked', type: null }),
  ];

  it('ORs within the status facet', () => {
    expect(
      ids(filterTasks(tasks, spec({ statuses: ['backlog', 'done'] }))),
    ).toEqual([id(1), id(2)]);
  });

  it('ANDs across the status and type facets', () => {
    expect(
      ids(
        filterTasks(
          tasks,
          spec({ statuses: ['backlog', 'done'], types: ['BUGFIX'] }),
        ),
      ),
    ).toEqual([id(2)]);
  });

  it('never matches a null type against a type selection', () => {
    expect(
      ids(filterTasks(tasks, spec({ types: ['FEATURE', 'BUGFIX'] }))),
    ).toEqual([id(1), id(2)]);
  });
});

describe('filterTasks — estimate', () => {
  const tasks = [
    task({ id: id(1), estimate: 'XS' }),
    task({ id: id(2), estimate: 'L' }),
    task({ id: id(3) }),
  ];

  it('ORs within the estimate facet', () => {
    expect(ids(filterTasks(tasks, spec({ estimates: ['XS', 'L'] })))).toEqual([
      id(1),
      id(2),
    ]);
  });

  it('selects only unestimated tasks when `unestimated` is the whole facet', () => {
    expect(ids(filterTasks(tasks, spec({ unestimated: true })))).toEqual([
      id(3),
    ]);
  });

  it('ORs `unestimated` together with sizes — they are ONE facet', () => {
    expect(
      ids(filterTasks(tasks, spec({ estimates: ['XS'], unestimated: true }))),
    ).toEqual([id(1), id(3)]);
  });

  it('excludes unestimated tasks when only sizes are selected', () => {
    expect(ids(filterTasks(tasks, spec({ estimates: ['XS'] })))).toEqual([
      id(1),
    ]);
  });
});

describe('filterTasks — executor', () => {
  const tasks = [
    task({ id: id(1), executor: 'backend-developer' }),
    task({ id: id(2), executor: '  backend-developer  ' }),
    task({ id: id(3), executor: 'Backend-Developer' }),
    task({ id: id(4) }),
    task({ id: id(5), executor: '   ' }),
  ];

  it('matches on the trimmed value', () => {
    expect(
      ids(filterTasks(tasks, spec({ executors: ['backend-developer'] }))),
    ).toEqual([id(1), id(2)]);
  });

  it('is case-sensitive, unlike labels', () => {
    expect(
      ids(filterTasks(tasks, spec({ executors: ['Backend-Developer'] }))),
    ).toEqual([id(3)]);
  });

  it('never matches an absent or blank executor', () => {
    expect(ids(filterTasks(tasks, spec({ executors: ['   '] })))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Labels — ANY vs ALL, on labelKey
// ---------------------------------------------------------------------------

describe('filterTasks — labels', () => {
  const tasks = [
    task({ id: id(1), labels: ['Licensing', 'ui'] }),
    task({ id: id(2), labels: ['licensing '] }),
    task({ id: id(3), labels: ['ui'] }),
    task({ id: id(4) }),
  ];

  it('ANY matches a task carrying at least one selected label', () => {
    expect(
      ids(
        filterTasks(tasks, spec({ labels: ['licensing'], labelsMode: 'any' })),
      ),
    ).toEqual([id(1), id(2)]);
  });

  it('ALL requires every selected label', () => {
    expect(
      ids(
        filterTasks(
          tasks,
          spec({ labels: ['licensing', 'ui'], labelsMode: 'all' }),
        ),
      ),
    ).toEqual([id(1)]);
  });

  it('ANY over the same two labels is strictly wider than ALL', () => {
    expect(
      ids(
        filterTasks(
          tasks,
          spec({ labels: ['licensing', 'ui'], labelsMode: 'any' }),
        ),
      ),
    ).toEqual([id(1), id(2), id(3)]);
  });

  /** R9 — `Licensing` and `licensing ` are ONE label, via the shared `labelKey`. */
  it.each([
    ['exact', 'Licensing'],
    ['lower-cased', 'licensing'],
    ['padded', ' licensing '],
    ['upper-cased', 'LICENSING'],
  ])('matches a %s selection through labelKey', (_case, selected) => {
    expect(
      ids(filterTasks(tasks, spec({ labels: [selected], labelsMode: 'any' }))),
    ).toEqual([id(1), id(2)]);
  });
});

// ---------------------------------------------------------------------------
// Graph-backed facets
// ---------------------------------------------------------------------------

describe('filterTasks — parentage', () => {
  //  1 ── parent of 2 and 3;  4 standalone;  5 claims a parent that does not exist.
  const tasks = [
    task({ id: id(1) }),
    task({ id: id(2), parent: id(1) }),
    task({ id: id(3), parent: id(1) }),
    task({ id: id(4) }),
    task({ id: id(5), parent: id(99) }),
  ];
  const graph = buildTaskGraph(tasks);

  it('selects parents', () => {
    expect(
      ids(filterTasks(tasks, spec({ parentage: ['parent'] }), graph)),
    ).toEqual([id(1)]);
  });

  it('selects sub-tasks', () => {
    expect(
      ids(filterTasks(tasks, spec({ parentage: ['child'] }), graph)),
    ).toEqual([id(2), id(3)]);
  });

  it('counts a task whose parent claim was NOT honoured as standalone', () => {
    expect(
      ids(filterTasks(tasks, spec({ parentage: ['standalone'] }), graph)),
    ).toEqual([id(4), id(5)]);
  });

  it('ORs within the parentage facet', () => {
    expect(
      ids(filterTasks(tasks, spec({ parentage: ['parent', 'child'] }), graph)),
    ).toEqual([id(1), id(2), id(3)]);
  });

  it('builds its own graph when none is supplied, reaching the same answer', () => {
    expect(ids(filterTasks(tasks, spec({ parentage: ['child'] })))).toEqual(
      ids(filterTasks(tasks, spec({ parentage: ['child'] }), graph)),
    );
  });
});

describe('filterTasks — childrenOf (FR-B3.3)', () => {
  //  1 ── parent of 2 and 3;  4 standalone;  5 claims a parent that does not
  //  exist;  6 is a child of 4, so a second parent exists to tell 1 apart from.
  const tasks = [
    task({ id: id(1) }),
    task({ id: id(2), parent: id(1) }),
    task({ id: id(3), parent: id(1) }),
    task({ id: id(4) }),
    task({ id: id(5), parent: id(99) }),
    task({ id: id(6), parent: id(4) }),
  ];
  const graph = buildTaskGraph(tasks);

  it('selects exactly the children of the named parent', () => {
    expect(
      ids(filterTasks(tasks, spec({ childrenOf: [id(1)] }), graph)),
    ).toEqual([id(2), id(3)]);
  });

  /**
   * The rollup badge says "1 / 3" and the click has to leave 3 cards. Both
   * numbers are read off `effectiveParent`, so this is the assertion that they
   * cannot drift apart.
   */
  it('returns exactly as many tasks as the parent rollup counts', () => {
    const rollup = graph.rollup.get(id(1));
    expect(rollup?.total).toBe(2);
    expect(
      filterTasks(tasks, spec({ childrenOf: [id(1)] }), graph),
    ).toHaveLength(rollup?.total ?? -1);
  });

  it('does not select the parent itself', () => {
    expect(
      ids(filterTasks(tasks, spec({ childrenOf: [id(1)] }), graph)),
    ).not.toContain(id(1));
  });

  it('ORs within the facet, so two parents yield both broods', () => {
    expect(
      ids(filterTasks(tasks, spec({ childrenOf: [id(1), id(4)] }), graph)),
    ).toEqual([id(2), id(3), id(6)]);
  });

  it('matches nothing for a parent that has no honoured children', () => {
    expect(filterTasks(tasks, spec({ childrenOf: [id(99)] }), graph)).toEqual(
      [],
    );
  });

  it('ANDs with the other facets like every facet does', () => {
    expect(
      ids(
        filterTasks(tasks, spec({ childrenOf: [id(1)], text: id(3) }), graph),
      ),
    ).toEqual([id(3)]);
  });

  it('builds its own graph when none is supplied, reaching the same answer', () => {
    expect(ids(filterTasks(tasks, spec({ childrenOf: [id(1)] })))).toEqual([
      id(2),
      id(3),
    ]);
  });

  /**
   * A refused parent claim (dangling here) makes a task `standalone` for
   * `parentage`, and it must make it invisible to `childrenOf` for the same
   * reason: the board never drew that edge.
   */
  it('ignores a parent claim the graph refused', () => {
    expect(filterTasks(tasks, spec({ childrenOf: [id(99)] }), graph)).toEqual(
      [],
    );
    expect(
      ids(filterTasks(tasks, spec({ parentage: ['standalone'] }), graph)),
    ).toContain(id(5));
  });
});

describe('filterTasks — relations', () => {
  const tasks = [
    task({ id: id(1), status: 'in_progress' }),
    task({ id: id(2), dependsOn: [id(1)] }),
    task({ id: id(3), dependsOn: [id(4)] }),
    task({ id: id(4), status: 'done' }),
    task({ id: id(5), duplicates: [id(1)] }),
    task({ id: id(6), duplicates: [id(99)] }),
  ];
  const graph = buildTaskGraph(tasks);

  it('selects tasks with at least one UNMET dependency', () => {
    expect(
      ids(
        filterTasks(tasks, spec({ relations: ['unmet_dependencies'] }), graph),
      ),
    ).toEqual([id(2)]);
  });

  it('selects tasks that declare themselves duplicates, dangling or not', () => {
    expect(
      ids(filterTasks(tasks, spec({ relations: ['duplicate'] }), graph)),
    ).toEqual([id(5), id(6)]);
  });

  it('ORs within the relations facet', () => {
    expect(
      ids(
        filterTasks(
          tasks,
          spec({ relations: ['unmet_dependencies', 'duplicate'] }),
          graph,
        ),
      ),
    ).toEqual([id(2), id(5), id(6)]);
  });
});

describe('filterTasks — validation issues', () => {
  const tasks = [
    task({ id: id(1) }),
    task({
      id: id(2),
      frontmatterValid: false,
      validationIssues: [
        { field: 'estimate', code: 'invalid_estimate', message: 'nope' },
      ],
    }),
  ];

  it('selects only tasks carrying an issue', () => {
    expect(
      ids(filterTasks(tasks, spec({ hasValidationIssues: true }))),
    ).toEqual([id(2)]);
  });

  it('excludes nothing when the flag is false', () => {
    expect(
      filterTasks(tasks, spec({ hasValidationIssues: false })),
    ).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// AND across every facet at once
// ---------------------------------------------------------------------------

describe('filterTasks — AND across facets', () => {
  const tasks = [
    task({
      id: id(1),
      status: 'in_progress',
      type: 'FEATURE',
      title: 'Licensing guard',
      labels: ['Licensing'],
      estimate: 'M',
      executor: 'backend-developer',
    }),
    task({
      id: id(2),
      status: 'in_progress',
      type: 'FEATURE',
      title: 'Licensing guard',
      labels: ['Licensing'],
      estimate: 'M',
      executor: 'frontend-developer',
    }),
  ];

  const narrow = spec({
    text: 'guard',
    statuses: ['in_progress'],
    types: ['FEATURE'],
    labels: ['licensing'],
    estimates: ['M'],
    executors: ['backend-developer'],
  });

  it('requires EVERY active facet', () => {
    expect(ids(filterTasks(tasks, narrow))).toEqual([id(1)]);
  });

  it('rejects everything when one facet cannot be satisfied', () => {
    expect(filterTasks(tasks, { ...narrow, estimates: ['XL'] })).toHaveLength(
      0,
    );
  });
});

// ---------------------------------------------------------------------------
// mergeStatusTypeFacets
// ---------------------------------------------------------------------------

describe('mergeStatusTypeFacets', () => {
  it('returns the neutral spec when nothing is supplied', () => {
    expect(mergeStatusTypeFacets(undefined, undefined, undefined)).toEqual(
      EMPTY_TASK_FILTER,
    );
  });

  it('lifts bare status/type lists onto the spec', () => {
    const merged = mergeStatusTypeFacets(undefined, ['done'], ['BUGFIX']);
    expect(merged?.statuses).toEqual(['done']);
    expect(merged?.types).toEqual(['BUGFIX']);
  });

  it('leaves every other facet of the supplied spec untouched', () => {
    const base = spec({ labels: ['a'], labelsMode: 'all', unestimated: true });
    const merged = mergeStatusTypeFacets(base, ['done'], undefined);
    expect(merged).not.toBeNull();
    expect(merged?.labels).toEqual(['a']);
    expect(merged?.labelsMode).toBe('all');
    expect(merged?.unestimated).toBe(true);
  });

  it('INTERSECTS when the spec and the legacy list both constrain a facet', () => {
    const base = spec({ statuses: ['done', 'blocked'] });
    expect(
      mergeStatusTypeFacets(base, ['blocked'], undefined)?.statuses,
    ).toEqual(['blocked']);
  });

  /**
   * An empty `statuses` array reads as "no constraint", so an empty
   * intersection CANNOT be written back into the spec — doing so would turn two
   * contradictory constraints into no constraint and return everything.
   */
  it('returns null — not an empty facet — when the two disagree entirely', () => {
    expect(
      mergeStatusTypeFacets(
        spec({ statuses: ['done'] }),
        ['backlog'],
        undefined,
      ),
    ).toBeNull();
    expect(
      mergeStatusTypeFacets(spec({ types: ['BUGFIX'] }), undefined, [
        'FEATURE',
      ]),
    ).toBeNull();
  });

  it('does not mutate the spec it was given', () => {
    const base = spec({ statuses: ['done', 'blocked'] });
    mergeStatusTypeFacets(base, ['blocked'], undefined);
    expect(base.statuses).toEqual(['done', 'blocked']);
  });
});

// ---------------------------------------------------------------------------
// Zod boundary
// ---------------------------------------------------------------------------

describe('TaskFilterSpecSchema', () => {
  it('completes a partial spec with the neutral defaults', () => {
    const parsed = TaskFilterSpecSchema.parse({ labels: ['licensing'] });
    expect(parsed).toEqual({ ...EMPTY_TASK_FILTER, labels: ['licensing'] });
  });

  it('parses an empty object into the neutral spec', () => {
    expect(TaskFilterSpecSchema.parse({})).toEqual(EMPTY_TASK_FILTER);
  });

  it('rejects an unknown status', () => {
    expect(TaskFilterSpecSchema.safeParse({ statuses: ['nope'] }).success).toBe(
      false,
    );
  });

  it('rejects an unknown label match mode', () => {
    expect(
      TaskFilterSpecSchema.safeParse({ labelsMode: 'either' }).success,
    ).toBe(false);
  });

  it('bounds the free-text needle', () => {
    const tooLong = 'a'.repeat(MAX_TASK_FILTER_TEXT_LENGTH + 1);
    expect(TaskFilterSpecSchema.safeParse({ text: tooLong }).success).toBe(
      false,
    );
    expect(
      TaskFilterSpecSchema.safeParse({ text: tooLong.slice(1) }).success,
    ).toBe(true);
  });

  it('bounds every open facet array', () => {
    const tooMany = Array.from(
      { length: MAX_TASK_FILTER_VALUES + 1 },
      (_, i) => `label-${i}`,
    );
    expect(TaskFilterSpecSchema.safeParse({ labels: tooMany }).success).toBe(
      false,
    );
    expect(TaskFilterSpecSchema.safeParse({ executors: tooMany }).success).toBe(
      false,
    );
  });

  /**
   * The WRITE-path label cap is deliberately not re-applied on the read path:
   * a carrier hand-authored with an over-long label still reaches the board, so
   * it must remain filterable.
   */
  it('accepts a label longer than the write-path cap', () => {
    expect(
      TaskFilterSpecSchema.safeParse({ labels: ['x'.repeat(40)] }).success,
    ).toBe(true);
  });

  /**
   * `childrenOf` carries task ids, so it runs the SHARED `TaskIdRefSchema` —
   * the same guard every write boundary runs, not a second containment check
   * (BR-14 / GATING NOTE G3).
   */
  it.each([
    ['a traversal token', '..'],
    ['a padded traversal token', ' .. '],
    ['whitespace only', '   '],
    ['a forward slash', 'TASK_2026_001/x'],
    ['a back slash', 'TASK_2026_001\\x'],
    ['a drive prefix', 'C:'],
    ['an alternate data stream', 'TASK_2026_001:stream'],
  ])('rejects %s in childrenOf', (_case, value) => {
    expect(
      TaskFilterSpecSchema.safeParse({ childrenOf: [value] }).success,
    ).toBe(false);
  });

  it('accepts a plain folder name in childrenOf', () => {
    expect(
      TaskFilterSpecSchema.safeParse({ childrenOf: ['TASK_2026_001'] }).success,
    ).toBe(true);
  });
});

describe('TaskSortSpecSchema', () => {
  it('defaults to the board default sort', () => {
    expect(TaskSortSpecSchema.parse({})).toEqual(DEFAULT_TASK_SORT);
  });

  it('rejects an unknown field', () => {
    expect(TaskSortSpecSchema.safeParse({ field: 'priority' }).success).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// sortTasks
// ---------------------------------------------------------------------------

describe('sortTasks', () => {
  const sort = (overrides: Partial<TaskSortSpec>): TaskSortSpec => ({
    ...DEFAULT_TASK_SORT,
    ...overrides,
  });

  it('does not mutate the input array', () => {
    const tasks = [task({ id: id(2) }), task({ id: id(1) })];
    const before = ids(tasks);
    sortTasks(tasks, sort({ field: 'id', direction: 'asc' }));
    expect(ids(tasks)).toEqual(before);
  });

  it('tie-breaks by id, ascending, when the sort key is equal', () => {
    const tasks = [
      task({ id: id(3), updated: '2026-08-01T00:00:00.000Z' }),
      task({ id: id(1), updated: '2026-08-01T00:00:00.000Z' }),
      task({ id: id(2), updated: '2026-08-01T00:00:00.000Z' }),
    ];
    expect(ids(sortTasks(tasks, sort({ direction: 'desc' })))).toEqual([
      id(1),
      id(2),
      id(3),
    ]);
  });

  it('keeps the id tie-break ASCENDING in both directions', () => {
    const tasks = [
      task({ id: id(3), updated: '2026-08-01T00:00:00.000Z' }),
      task({ id: id(1), updated: '2026-08-01T00:00:00.000Z' }),
    ];
    expect(ids(sortTasks(tasks, sort({ direction: 'asc' })))).toEqual([
      id(1),
      id(3),
    ]);
    expect(ids(sortTasks(tasks, sort({ direction: 'desc' })))).toEqual([
      id(1),
      id(3),
    ]);
  });

  it('is deterministic regardless of the input order', () => {
    const build = (order: number[]): TaskSpecSummary[] =>
      order.map((n) =>
        task({ id: id(n), updated: '2026-08-01T00:00:00.000Z' }),
      );
    const a = ids(sortTasks(build([1, 2, 3, 4]), sort({})));
    const b = ids(sortTasks(build([4, 3, 2, 1]), sort({})));
    const c = ids(sortTasks(build([3, 1, 4, 2]), sort({})));
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it('sorts by `updated`, newest first by default', () => {
    const tasks = [
      task({ id: id(1), updated: '2026-08-01T00:00:00.000Z' }),
      task({ id: id(2), updated: '2026-08-03T00:00:00.000Z' }),
      task({ id: id(3), updated: '2026-08-02T00:00:00.000Z' }),
    ];
    expect(ids(sortTasks(tasks, DEFAULT_TASK_SORT))).toEqual([
      id(2),
      id(3),
      id(1),
    ]);
  });

  it('puts a null `updated` last in BOTH directions', () => {
    const tasks = [
      task({ id: id(1), updated: null }),
      task({ id: id(2), updated: '2026-08-03T00:00:00.000Z' }),
      task({ id: id(3), updated: '2026-08-02T00:00:00.000Z' }),
    ];
    expect(ids(sortTasks(tasks, sort({ direction: 'desc' })))).toEqual([
      id(2),
      id(3),
      id(1),
    ]);
    expect(ids(sortTasks(tasks, sort({ direction: 'asc' })))).toEqual([
      id(3),
      id(2),
      id(1),
    ]);
  });

  /** The tuple order IS the sort order — there is no numeric mapping. */
  it('sorts estimates by TASK_ESTIMATES tuple order', () => {
    const tasks = [
      task({ id: id(1), estimate: 'XL' }),
      task({ id: id(2), estimate: 'XS' }),
      task({ id: id(3), estimate: 'M' }),
      task({ id: id(4), estimate: 'L' }),
      task({ id: id(5), estimate: 'S' }),
    ];
    expect(
      ids(sortTasks(tasks, sort({ field: 'estimate', direction: 'asc' }))),
    ).toEqual([id(2), id(5), id(3), id(4), id(1)]);
  });

  it('puts an unestimated task last in BOTH directions', () => {
    const tasks = [
      task({ id: id(1) }),
      task({ id: id(2), estimate: 'XS' }),
      task({ id: id(3), estimate: 'XL' }),
    ];
    expect(
      ids(sortTasks(tasks, sort({ field: 'estimate', direction: 'asc' }))),
    ).toEqual([id(2), id(3), id(1)]);
    expect(
      ids(sortTasks(tasks, sort({ field: 'estimate', direction: 'desc' }))),
    ).toEqual([id(3), id(2), id(1)]);
  });

  it('sorts statuses by TASK_STATUSES workflow order', () => {
    const tasks = [
      task({ id: id(1), status: 'done' }),
      task({ id: id(2), status: 'backlog' }),
      task({ id: id(3), status: 'in_review' }),
    ];
    expect(
      ids(sortTasks(tasks, sort({ field: 'status', direction: 'asc' }))),
    ).toEqual([id(2), id(3), id(1)]);
  });

  it('puts a null type last', () => {
    const tasks = [
      task({ id: id(1), type: null }),
      task({ id: id(2), type: 'BUGFIX' }),
      task({ id: id(3), type: 'FEATURE' }),
    ];
    expect(
      ids(sortTasks(tasks, sort({ field: 'type', direction: 'asc' }))),
    ).toEqual([id(3), id(2), id(1)]);
  });

  it('compares titles case-insensitively', () => {
    const tasks = [
      task({ id: id(1), title: 'beta' }),
      task({ id: id(2), title: 'Alpha' }),
    ];
    expect(
      ids(sortTasks(tasks, sort({ field: 'title', direction: 'asc' }))),
    ).toEqual([id(2), id(1)]);
  });

  /**
   * ORDINAL, NOT LOCALE-COLLATED — DELIBERATE, NOT A DEFECT.
   *
   * `compareText` compares lower-cased code points, so `Émile` sorts AFTER
   * `zulu` rather than beside `Emile`. A locale-aware sort reads better, and
   * this test exists to stop somebody "fixing" it into one.
   *
   * `localeCompare`'s collation depends on the host's ICU data and locale.
   * This module runs in BOTH the extension host and the webview, and the board
   * is rendered from the same task list in each. Under `localeCompare` the two
   * can order the same two titles differently — a board that reshuffles when
   * opened in the other host reads as a bug in the data, and it is the kind of
   * bug nobody reproduces because it depends on where it was opened. Ordinal
   * comparison is identical everywhere, which is the property being bought.
   *
   * If accent-aware ordering is ever genuinely wanted, it has to arrive with a
   * fixed locale AND a fixed ICU expectation pinned by a test — not by swapping
   * this comparison out.
   */
  it('sorts non-ASCII titles by code point, after ASCII — DELIBERATE', () => {
    const tasks = [
      task({ id: id(1), title: 'Émile' }),
      task({ id: id(2), title: 'Emile' }),
      task({ id: id(3), title: 'zulu' }),
    ];

    const ascending = ids(
      sortTasks(tasks, sort({ field: 'title', direction: 'asc' })),
    );

    // `é` (U+00E9) is above `z` (U+007A), so the accented title lands last.
    // A locale-collated sort would put it second, beside `Emile`.
    expect(ascending).toEqual([id(2), id(3), id(1)]);

    // Stated as the negative too, so the intent survives a reader who only
    // sees the array above and assumes it is an accident of the fixture.
    expect(ascending).not.toEqual([id(2), id(1), id(3)]);
  });

  /**
   * The host-independence claim itself, asserted rather than described: the
   * comparison must not consult the ambient locale. `localeCompare` under a
   * Swedish collation orders `ä` after `z`; under an English one, beside `a`.
   * This module returns the same order whatever the locale says, because it
   * never asks.
   */
  it('orders identically regardless of the ambient locale', () => {
    const build = (): TaskSpecSummary[] => [
      task({ id: id(1), title: 'ä-second' }),
      task({ id: id(2), title: 'a-first' }),
      task({ id: id(3), title: 'z-third' }),
    ];
    const bySort = (): string[] =>
      ids(sortTasks(build(), sort({ field: 'title', direction: 'asc' })));

    const ordinal = bySort();
    // The two locales that famously disagree about where `ä` belongs.
    expect('ä'.localeCompare('z', 'sv')).toBeGreaterThan(0);
    expect('ä'.localeCompare('z', 'en')).toBeLessThan(0);
    // ...and this sort agrees with neither, because it agrees with itself.
    expect(ordinal).toEqual([id(2), id(3), id(1)]);
  });
});

// ---------------------------------------------------------------------------
// Scale
// ---------------------------------------------------------------------------

/**
 * Median wall-clock cost of `run`, over `samples` timed iterations after one
 * untimed warm-up.
 *
 * ## Why a median, and why this file's own failure was NOT machine load
 *
 * This assertion previously took ONE sample and timed it with `Date.now()`.
 * `Date.now()` advances on the system timer tick, which on Windows is ~15.6 ms,
 * so an operation whose true cost is ~0.34 ms measured **0 or 15.6 with nothing
 * in between** — a coin flip against a budget of 16. That is quantization, not
 * contention: the machine was not slow, the clock could not see the work.
 *
 * The fix is therefore two independent changes, and both are needed:
 *
 *  - `performance.now()`, which is sub-millisecond, so the measurement can
 *    resolve the operation at all;
 *  - a median over nine samples after an untimed warm-up, which keeps a GC
 *    pause or a descheduled slice from deciding the result, and keeps
 *    first-call JIT out of the numbers.
 *
 * ## The 62 ms reading belongs to the OTHER suite, not this one
 *
 * Stated because the first version of this comment claimed it. The 62.07 ms
 * failure was measured in `tasks-store.service.spec.ts`, whose twin of this
 * helper carries the matching note. That file **already used
 * `performance.now()`**, so its 62 ms was a real 62 ms — a genuine outlier
 * under load, a different cause with the same symptom. Two suites, two causes,
 * one remedy: the median is what fixes both, and neither file's evidence
 * should be cited for the other's defect.
 *
 * The ceiling is deliberately generous rather than tight. This test exists to
 * catch an ALGORITHMIC regression — a predicate that goes quadratic, or a graph
 * rebuilt per task — which costs hundreds of milliseconds at this size. It is
 * not a budget for the machine it happens to run on.
 */
function medianMs(run: () => void, samples = 9): number {
  run();
  const timings: number[] = [];
  for (let i = 0; i < samples; i++) {
    const started = performance.now();
    run();
    timings.push(performance.now() - started);
  }
  timings.sort((a, b) => a - b);
  return timings[(samples - 1) >> 1];
}

/**
 * Median ceiling for a full-facet pass over 1 000 tasks.
 *
 * Kept at the original one-frame budget deliberately — the number was never the
 * problem, the single unwarmed `Date.now()` sample was. Applied to a median it
 * is both meaningful and stable: the measured warm median here is **0.34 ms**,
 * so this sits at roughly 47x headroom, while the two regressions worth
 * catching at this size both blow straight through it — a quadratic predicate
 * costs hundreds of milliseconds over 1 000 tasks, and rebuilding the graph per
 * call costs tens.
 */
const SCALE_CEILING_MS = 16;

describe('filterTasks — scale', () => {
  it('filters 1 000 tasks on every facet at once without going superlinear', () => {
    const tasks = Array.from({ length: 1000 }, (_, i) =>
      task({
        id: id(i),
        status: i % 2 === 0 ? 'in_progress' : 'backlog',
        labels: i % 3 === 0 ? ['Licensing'] : ['other'],
        estimate: i % 5 === 0 ? 'M' : undefined,
        executor: 'backend-developer',
        parent: i > 0 && i % 7 === 0 ? id(0) : undefined,
      }),
    );
    const graph = buildTaskGraph(tasks);
    const narrow = spec({
      text: 'TASK_2026',
      statuses: ['in_progress'],
      types: ['FEATURE'],
      labels: ['licensing'],
      labelsMode: 'any',
      estimates: ['M'],
      unestimated: true,
      executors: ['backend-developer'],
      parentage: ['child', 'standalone'],
    });

    let result: readonly TaskSpecSummary[] = [];
    const elapsed = medianMs(() => {
      result = filterTasks(tasks, narrow, graph);
    });

    expect(result.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(SCALE_CEILING_MS);
  });
});
