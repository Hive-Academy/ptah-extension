/**
 * The command palette's entry catalogue (FR-C6.2, FR-C6.6).
 *
 * ## A pure projection, not a component concern
 *
 * {@link buildPaletteEntries} is a pure function from a board snapshot to a
 * list of entries. It reads no signal, injects no service and performs no
 * write, which is what lets the whole catalogue — including every
 * disabled-with-reason predicate — be tested without rendering anything.
 *
 * ## Actions are DATA, not closures
 *
 * Each entry carries a {@link TaskPaletteAction}: a discriminated union
 * describing what running it does, never a captured callback. Two reasons.
 * A closure over the store would make an entry impossible to assert on without
 * a store, and it would let the catalogue mutate — the catalogue's job is to
 * decide *what is offered*, and the view's job is to decide *what that means*.
 * The dispatcher lives in `tasks-view.component.ts` and is exhaustive over
 * `kind`, so an action added here without a dispatch arm fails typecheck.
 *
 * ## BR-8 / R12 — there is no run action, and no import of `TaskStartService`
 *
 * Families (A) and (D) are out of scope for this task. A palette entry that
 * launched orchestration would be the cheapest possible way to smuggle a
 * launch surface in, so the omission is stated here rather than merely
 * practised: this module imports nothing from `../../services/`, and
 * `TaskPaletteAction` carries no variant that could start anything.
 *
 * ## BR-10 — every label is untrusted text
 *
 * Task titles, saved-view names, labels and executor values all reach an entry
 * label verbatim. They are rendered as `{{ interpolation }}` by the palette
 * component and are matched with `String` comparisons only
 * (`palette-match.ts`) — never compiled into a `RegExp`, never joined into a
 * path or an RPC method name.
 */
import {
  EMPTY_TASK_FILTER,
  TASK_ESTIMATES,
  TASK_STATUSES,
  TASK_TYPES,
  isTaskFilterActive,
  labelKey,
  type SavedTaskView,
  type TaskEstimate,
  type TaskFilterSpec,
  type TaskSpecSummary,
  type TaskStatus,
  type TaskType,
} from '@ptah-extension/shared';
import {
  TASK_ESTIMATE_LABELS,
  TASK_STATUS_LABELS,
} from '../../task-presentation';

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * What running an entry does.
 *
 * Every variant is expressible against the store's existing public API — this
 * union introduces no new capability, it only names the ones a keyboard user
 * currently has to reach by mouse.
 */
export type TaskPaletteAction =
  | { readonly kind: 'openTask'; readonly taskId: string }
  | { readonly kind: 'applyView'; readonly viewId: string }
  | {
      readonly kind: 'setStatus';
      readonly taskId: string;
      readonly status: TaskStatus;
    }
  /** Full label replacement, already computed — see {@link labelEntries}. */
  | {
      readonly kind: 'setLabels';
      readonly taskId: string;
      readonly labels: readonly string[];
    }
  /**
   * Move the whole MULTI-SELECTION to one status (FR-C6.7).
   *
   * It carries no ids. The selection is the store's, and re-listing it here
   * would freeze a snapshot taken when the palette opened — a user who
   * Ctrl-clicked two more cards with the palette open would write the wrong
   * set. It also carries no consent: the dispatcher hands this to
   * `TasksStore.requestBulkStatus`, which is where the FR-C4.12 confirmation
   * lives, so a palette-launched move asks exactly as the bulk bar's picker
   * does. There is deliberately no way to express "and skip the confirmation".
   */
  | { readonly kind: 'bulkSetStatus'; readonly status: TaskStatus }
  | { readonly kind: 'createTask' }
  /** The whole next spec, already computed. The view only calls `setFilter`. */
  | { readonly kind: 'setFilter'; readonly filter: TaskFilterSpec }
  | { readonly kind: 'clearFilter' }
  | { readonly kind: 'openExclusions' }
  | { readonly kind: 'reindex' };

/** Presentation grouping — the palette renders one heading per group. */
export const TASK_PALETTE_GROUPS = [
  'tasks',
  'views',
  'selection',
  'bulk',
  'filters',
  'board',
] as const;
export type TaskPaletteGroup = (typeof TASK_PALETTE_GROUPS)[number];

/**
 * `selection` and `bulk` are two groups because they act on two different
 * things: `selection` writes the ONE task the detail panel is open on, `bulk`
 * writes every checked card. Filing them together would put "Set status: Done"
 * and "Move 42 selected tasks to Done" under one heading, one keystroke apart.
 */
export const TASK_PALETTE_GROUP_LABELS: Record<TaskPaletteGroup, string> = {
  tasks: 'Jump to a task',
  views: 'Saved views',
  selection: 'The selected task',
  bulk: 'The checked tasks',
  filters: 'Filters',
  board: 'Board',
};

/** One offered command. */
export interface TaskPaletteEntry {
  /** Stable within one build, and used as the `role="option"` element id. */
  readonly id: string;
  /** The matched and rendered text. May contain untrusted values (BR-10). */
  readonly label: string;
  readonly group: TaskPaletteGroup;
  /**
   * `null` when the entry can run. Otherwise the sentence explaining why it
   * cannot — FR-C6.6 requires the entry to stay LISTED and say why, because an
   * action that disappears when the precondition is unmet teaches a user that
   * the palette is incomplete rather than that their selection is empty.
   */
  readonly disabledReason: string | null;
  readonly action: TaskPaletteAction;
}

/** The board snapshot the catalogue is built from. */
export interface TaskPaletteContext {
  /** Every indexed task, unfiltered — the palette can jump to a hidden task. */
  readonly tasks: readonly TaskSpecSummary[];
  readonly views: readonly SavedTaskView[];
  readonly filter: TaskFilterSpec;
  readonly knownLabels: readonly string[];
  readonly knownExecutors: readonly string[];
  readonly estimatesInUse: readonly TaskEstimate[];
  /** The task the detail panel is open on, or `null`. */
  readonly selectedTask: TaskSpecSummary | null;
  /**
   * How many tasks are CHECKED (the multi-selection), which is a different
   * number from `selectedTask` being non-null. Only the count is needed: the
   * bulk action names no ids, so the catalogue only has to decide whether the
   * entry can run and what number to say.
   */
  readonly selectionCount: number;
  readonly excludedCount: number;
  /** True while a board-wide write or reindex is outstanding. */
  readonly busy: boolean;
}

const NO_SELECTION_REASON =
  'No task is selected — open a task first, then run this from the palette.';

const NO_CHECKED_TASKS_REASON =
  'No tasks are checked — tick a card, or use the checkbox and Shift-click on the board, then run this from the palette.';

// ---------------------------------------------------------------------------
// Filter-facet toggles (FR-C6.2: "toggle any single filter facet")
// ---------------------------------------------------------------------------

/**
 * Add or drop one value from an array facet, returning the WHOLE next spec.
 *
 * The next spec is computed here rather than in the dispatcher because
 * `TaskFilterSpec` has no optional fields on purpose: a partial update is
 * exactly where two callers start disagreeing about whether an absent facet
 * means "unconstrained" or "constrains everything". Computing it in the
 * catalogue also makes the toggle assertable without a store.
 */
function toggleValue<T extends string>(
  current: readonly T[],
  value: T,
): readonly T[] {
  return current.includes(value)
    ? current.filter((candidate) => candidate !== value)
    : [...current, value];
}

/** Whether a facet value is currently selected, for the entry's wording. */
function facetEntry(
  id: string,
  active: boolean,
  addLabel: string,
  removeLabel: string,
  filter: TaskFilterSpec,
): TaskPaletteEntry {
  return {
    id,
    // The label states what ACTIVATING it does, not what the facet currently
    // is. "Filter by status: Backlog" on an already-active facet would read as
    // a no-op to anyone who could not see the chip row behind the palette.
    label: active ? removeLabel : addLabel,
    group: 'filters',
    disabledReason: null,
    action: { kind: 'setFilter', filter },
  };
}

function filterEntries(context: TaskPaletteContext): TaskPaletteEntry[] {
  const filter = context.filter;
  const entries: TaskPaletteEntry[] = [];

  entries.push({
    id: 'filter:clear',
    label: 'Clear all filters',
    group: 'filters',
    disabledReason: isTaskFilterActive(filter)
      ? null
      : 'No filter is active — there is nothing to clear.',
    action: { kind: 'clearFilter' },
  });

  for (const status of TASK_STATUSES) {
    const active = filter.statuses.includes(status);
    const name = TASK_STATUS_LABELS[status];
    entries.push(
      facetEntry(
        `filter:status:${status}`,
        active,
        `Filter by status: ${name}`,
        `Remove the status filter: ${name}`,
        { ...filter, statuses: toggleValue(filter.statuses, status) },
      ),
    );
  }

  for (const type of TASK_TYPES) {
    const active = filter.types.includes(type);
    entries.push(
      facetEntry(
        `filter:type:${type}`,
        active,
        `Filter by type: ${type}`,
        `Remove the type filter: ${type}`,
        { ...filter, types: toggleValue<TaskType>(filter.types, type) },
      ),
    );
  }

  for (const label of context.knownLabels) {
    const active = filter.labels.some(
      (candidate) => labelKey(candidate) === labelKey(label),
    );
    entries.push(
      facetEntry(
        `filter:label:${labelKey(label)}`,
        active,
        `Filter by label: ${label}`,
        `Remove the label filter: ${label}`,
        {
          ...filter,
          labels: active
            ? filter.labels.filter(
                (candidate) => labelKey(candidate) !== labelKey(label),
              )
            : [...filter.labels, label],
        },
      ),
    );
  }

  for (const executor of context.knownExecutors) {
    const active = filter.executors.includes(executor);
    entries.push(
      facetEntry(
        `filter:executor:${executor}`,
        active,
        `Filter by executor: ${executor}`,
        `Remove the executor filter: ${executor}`,
        { ...filter, executors: toggleValue(filter.executors, executor) },
      ),
    );
  }

  for (const estimate of TASK_ESTIMATES) {
    if (!context.estimatesInUse.includes(estimate)) continue;
    const active = filter.estimates.includes(estimate);
    const name = `${estimate} — ${TASK_ESTIMATE_LABELS[estimate]}`;
    entries.push(
      facetEntry(
        `filter:estimate:${estimate}`,
        active,
        `Filter by estimate: ${name}`,
        `Remove the estimate filter: ${name}`,
        { ...filter, estimates: toggleValue(filter.estimates, estimate) },
      ),
    );
  }

  entries.push(
    facetEntry(
      'filter:unestimated',
      filter.unestimated,
      'Filter by estimate: unestimated',
      'Remove the estimate filter: unestimated',
      { ...filter, unestimated: !filter.unestimated },
    ),
  );

  return entries;
}

// ---------------------------------------------------------------------------
// Selection-scoped entries (FR-C6.6)
// ---------------------------------------------------------------------------

function statusEntries(selected: TaskSpecSummary | null): TaskPaletteEntry[] {
  return TASK_STATUSES.filter((status) => status !== selected?.status).map(
    (status) => ({
      id: `status:${status}`,
      label: `Set status: ${TASK_STATUS_LABELS[status]}`,
      group: 'selection' as const,
      disabledReason: selected === null ? NO_SELECTION_REASON : null,
      action: {
        kind: 'setStatus' as const,
        // The empty string is never dispatched: an entry carrying it always
        // also carries a disabledReason, and the view refuses disabled
        // entries. It exists so the union stays total rather than optional.
        taskId: selected?.id ?? '',
        status,
      },
    }),
  );
}

/**
 * Bulk status moves over the checked tasks (FR-C6.7).
 *
 * Every status is offered, including the one some checked tasks already hold —
 * unlike {@link statusEntries}, which omits the open task's own status. With a
 * set there is no single current status to omit, and hiding a target because
 * *some* of the selection is already in it would remove the command a user
 * needs precisely when they are consolidating a mixed selection.
 *
 * The count is in the label so the palette says what the bulk bar says. A
 * command that reads "Move the checked tasks to Done" tells a user nothing
 * about whether they checked three cards or ninety.
 */
function bulkStatusEntries(selectionCount: number): TaskPaletteEntry[] {
  return TASK_STATUSES.map((status) => ({
    id: `bulk:status:${status}`,
    label:
      selectionCount === 0
        ? `Move the checked tasks to ${TASK_STATUS_LABELS[status]}`
        : `Move ${selectionCount} checked task(s) to ${TASK_STATUS_LABELS[status]}`,
    group: 'bulk' as const,
    disabledReason: selectionCount === 0 ? NO_CHECKED_TASKS_REASON : null,
    action: { kind: 'bulkSetStatus' as const, status },
  }));
}

/**
 * Add/remove entries for every label in the workspace union (FR-C6.2).
 *
 * The action carries the FULL replacement list rather than a delta, because
 * `TaskMetadataPatch.labels` is a whole-array replacement — computing the
 * next list here keeps the one place that decides "what does the carrier hold
 * after this" testable in isolation.
 *
 * Membership is decided on {@link labelKey}, matching the rest of the board:
 * `Licensing` and `licensing ` are one label, so an "Add label" offered for a
 * label the task already carries under a different spelling would write a
 * duplicate the filter could never tell apart.
 */
function labelEntries(
  selected: TaskSpecSummary | null,
  knownLabels: readonly string[],
): TaskPaletteEntry[] {
  return knownLabels.map((label) => {
    const held =
      selected?.labels.some(
        (candidate) => labelKey(candidate) === labelKey(label),
      ) ?? false;
    const next = held
      ? (selected?.labels ?? []).filter(
          (candidate) => labelKey(candidate) !== labelKey(label),
        )
      : [...(selected?.labels ?? []), label];

    return {
      id: `label:${labelKey(label)}`,
      label: held ? `Remove label: ${label}` : `Add label: ${label}`,
      group: 'selection' as const,
      disabledReason: selected === null ? NO_SELECTION_REASON : null,
      action: {
        kind: 'setLabels' as const,
        taskId: selected?.id ?? '',
        labels: next,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

/**
 * Build every entry the palette offers, in presentation order.
 *
 * The order matters: {@link rankPaletteMatches} keeps equal-scoring entries in
 * authored order, so this list IS what a blank query shows. Board commands
 * come first because they are the short, memorable ones; the per-task jump
 * list comes last because it is the long one and a user reaching for it is
 * always typing.
 */
export function buildPaletteEntries(
  context: TaskPaletteContext,
): TaskPaletteEntry[] {
  const entries: TaskPaletteEntry[] = [
    {
      id: 'board:create',
      label: 'Create a task',
      group: 'board',
      disabledReason: null,
      action: { kind: 'createTask' },
    },
    {
      id: 'board:reindex',
      label: 'Reindex the workspace tasks',
      group: 'board',
      disabledReason: context.busy
        ? 'A board operation is already running — wait for it to finish.'
        : null,
      action: { kind: 'reindex' },
    },
    {
      id: 'board:exclusions',
      label: 'Show the folders skipped by the board',
      group: 'board',
      disabledReason:
        context.excludedCount > 0
          ? null
          : 'Nothing is being skipped — every task folder on disk is on the board.',
      action: { kind: 'openExclusions' },
    },
  ];

  entries.push(...filterEntries(context));

  for (const view of context.views) {
    entries.push({
      id: `view:${view.id}`,
      label: `Apply view: ${view.name}`,
      group: 'views',
      disabledReason: null,
      action: { kind: 'applyView', viewId: view.id },
    });
  }

  entries.push(...statusEntries(context.selectedTask));
  entries.push(...labelEntries(context.selectedTask, context.knownLabels));
  entries.push(...bulkStatusEntries(context.selectionCount));

  for (const task of context.tasks) {
    entries.push({
      id: `task:${task.id}`,
      // Id first so typing an id is a PREFIX match; the title follows so the
      // same entry is still reachable by typing what the task is called.
      label: `${task.id} — ${task.title}`,
      group: 'tasks',
      disabledReason: null,
      action: { kind: 'openTask', taskId: task.id },
    });
  }

  return entries;
}

/**
 * The neutral context, for a board that has not loaded yet.
 *
 * Exported so the view has one place to express "nothing is known" rather than
 * assembling an empty snapshot inline and drifting from this shape.
 */
export const EMPTY_PALETTE_CONTEXT: TaskPaletteContext = {
  tasks: [],
  views: [],
  filter: EMPTY_TASK_FILTER,
  knownLabels: [],
  knownExecutors: [],
  estimatesInUse: [],
  selectedTask: null,
  selectionCount: 0,
  excludedCount: 0,
  busy: false,
};
