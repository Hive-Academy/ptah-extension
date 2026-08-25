/**
 * The task filter and sort contract (TASK_2026_181, family C).
 *
 * ## This module is THE filter predicate (FR-C1.5)
 *
 * `filterTasks` is the only implementation of "does this task match?" in the
 * repository. The webview board, the `tasks:list` RPC handler, the MCP
 * `ptah_task_list` path (via the index store) and the CLI all funnel through
 * this one function over the same `TaskSpecSummary` shape. There is deliberately
 * no SQL `WHERE` clause, no convenience `.filter()` beside a handler and no
 * bespoke match in the CLI: a second implementation agrees with this one exactly
 * until the day somebody patches one of them, and then the board and the index
 * disagree for reasons no user can reproduce.
 *
 * That claim is only worth stating because it is tested:
 * `tasks-rpc.handlers.spec.ts` runs the same `TaskFilterSpec` over the same
 * fixture through `filterTasks` directly and through the `tasks:list` handler,
 * and asserts an identical id list.
 *
 * ## Semantics, in one line
 *
 * **AND across facets, OR within a facet.** A task must satisfy every ACTIVE
 * facet; within one facet, matching any selected value is enough. The single
 * exception is `labels`, which carries its own ANY/ALL mode (FR-C1.1).
 *
 * ## Zero dependencies beyond Zod
 *
 * `libs/shared` is the one bridge between the backend and the webview, and both
 * sides must run identical code. This module imports nothing but its two
 * sibling type modules.
 */
import { buildTaskGraph, labelKey } from './task-graph';
import type { TaskGraph } from './task-graph';
import { TASK_ESTIMATES, TASK_STATUSES, TASK_TYPES } from './task-spec.types';
import type {
  TaskEstimate,
  TaskSpecSummary,
  TaskStatus,
  TaskType,
} from './task-spec.types';

// ---------------------------------------------------------------------------
// Facet vocabularies
// ---------------------------------------------------------------------------

/** How a multi-label selection is combined (FR-C1.1). */
export const TASK_LABEL_MATCH_MODES = ['any', 'all'] as const;
export type TaskLabelMatchMode = (typeof TASK_LABEL_MATCH_MODES)[number];

/**
 * Where a task sits in the parent/child structure.
 *
 * Read off the DERIVED graph, never off the declared `parent` string: a task
 * whose parent claim was rejected (cycle, dangling, two levels deep) is
 * `standalone` here, because that is what it actually is on the board. Reading
 * the raw field instead would file it under `child` and then show it in no
 * parent's child list.
 */
export const TASK_PARENTAGE_FACETS = ['parent', 'child', 'standalone'] as const;
export type TaskParentageFacet = (typeof TASK_PARENTAGE_FACETS)[number];

/** Relation-shaped facets (FR-C1.1). */
export const TASK_RELATION_FACETS = [
  /** At least one `depends_on` entry resolves to a task that is not finished. */
  'unmet_dependencies',
  /** The task declares that it duplicates another task. */
  'duplicate',
] as const;
export type TaskRelationFacet = (typeof TASK_RELATION_FACETS)[number];

/**
 * The longest free-text needle accepted over RPC.
 *
 * A bound, not a feature: the needle is compared with `String.includes` against
 * three fields of every indexed task, so an unbounded string is unbounded work.
 */
export const MAX_TASK_FILTER_TEXT_LENGTH = 200;

/**
 * The most values one facet may carry over RPC.
 *
 * Generous — the largest closed vocabulary here is eight (`TASK_TYPES`) and
 * label/executor sets are open — but finite, so a caller cannot hand the
 * predicate a million-entry array and make it walk it once per task.
 */
export const MAX_TASK_FILTER_VALUES = 64;

// ---------------------------------------------------------------------------
// TaskFilterSpec
// ---------------------------------------------------------------------------

/**
 * A complete filter selection.
 *
 * **Every field is required.** A partial spec would force each consumer to
 * decide what an absent facet means, and "absent" vs "empty array" is exactly
 * the kind of difference that makes two call sites disagree. Callers start from
 * {@link EMPTY_TASK_FILTER} and override what they need; partial input arriving
 * over the wire is completed by {@link TaskFilterSpecSchema}'s defaults at the
 * boundary.
 *
 * A facet is ACTIVE when it carries at least one value (`text` when it is
 * non-blank, `unestimated`/`hasValidationIssues` when `true`). Inactive facets
 * are skipped entirely — they do not exclude anything.
 */
export interface TaskFilterSpec {
  /** Free text over `id`, `title` and `description` (FR-C1.1). */
  readonly text: string;
  readonly statuses: readonly TaskStatus[];
  readonly types: readonly TaskType[];
  /** Matched on {@link labelKey}, so `Licensing` and `licensing ` are one label. */
  readonly labels: readonly string[];
  readonly labelsMode: TaskLabelMatchMode;
  readonly estimates: readonly TaskEstimate[];
  /**
   * Include tasks carrying NO estimate.
   *
   * Its own field rather than a sentinel inside `estimates`, because "no
   * estimate" is not a size and a `TaskEstimate[]` that can also contain
   * `'none'` stops being a `TaskEstimate[]` for every other consumer. It shares
   * the estimate FACET with `estimates` — the two are OR-ed together.
   */
  readonly unestimated: boolean;
  /** Matched on the trimmed value; see {@link matchesExecutors}. */
  readonly executors: readonly string[];
  readonly parentage: readonly TaskParentageFacet[];
  /**
   * Only the children of these parents (FR-B3.3).
   *
   * ## Why this is a facet rather than something the board does for itself
   *
   * The card's child rollup is a control: clicking it narrows the board to that
   * parent's sub-tasks. "Is this task a child of X" is a comparison, and every
   * comparison a board makes about a task belongs in this one predicate — a
   * convenience `.filter()` beside the rollup handler would be the second
   * implementation of matching that FR-C1.5 exists to prevent, and it would
   * apply on the board while `tasks:list` and the CLI knew nothing about it.
   *
   * Matched against the DERIVED effective parent, exactly like
   * {@link TASK_PARENTAGE_FACETS}. That is what makes the count on the rollup
   * and the number of cards left after the click the same number: the graph's
   * `children` map is built from the same `effectiveParent` read here, so a
   * child whose parent claim was refused (cycle, dangling, two levels deep) is
   * absent from both.
   */
  readonly childrenOf: readonly string[];
  readonly relations: readonly TaskRelationFacet[];
  /** Only tasks carrying at least one validation issue. */
  readonly hasValidationIssues: boolean;
}

/** The neutral spec: every facet inactive, so every task matches. */
export const EMPTY_TASK_FILTER: TaskFilterSpec = {
  text: '',
  statuses: [],
  types: [],
  labels: [],
  labelsMode: 'any',
  estimates: [],
  unestimated: false,
  executors: [],
  parentage: [],
  childrenOf: [],
  relations: [],
  hasValidationIssues: false,
};

/**
 * True when the spec would exclude anything at all.
 *
 * The board needs this to tell "no tasks match your filter" from "there are no
 * tasks" (FR-C1.3) and to enable/disable clear-all (FR-C1.6). It is also
 * {@link filterTasks}'s own fast path, so the two can never disagree about what
 * "no filter" means.
 */
export function isTaskFilterActive(filter: TaskFilterSpec): boolean {
  return (
    filter.text.trim().length > 0 ||
    filter.statuses.length > 0 ||
    filter.types.length > 0 ||
    filter.labels.length > 0 ||
    filter.estimates.length > 0 ||
    filter.unestimated ||
    filter.executors.length > 0 ||
    filter.parentage.length > 0 ||
    filter.childrenOf.length > 0 ||
    filter.relations.length > 0 ||
    filter.hasValidationIssues
  );
}

// ---------------------------------------------------------------------------
// TaskSortSpec
// ---------------------------------------------------------------------------

export const TASK_SORT_FIELDS = [
  'updated',
  'created',
  'title',
  'status',
  'type',
  'estimate',
  'id',
] as const;
export type TaskSortField = (typeof TASK_SORT_FIELDS)[number];

export const TASK_SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type TaskSortDirection = (typeof TASK_SORT_DIRECTIONS)[number];

export interface TaskSortSpec {
  readonly field: TaskSortField;
  readonly direction: TaskSortDirection;
}

/** What the board opens on: most recently touched first. */
export const DEFAULT_TASK_SORT: TaskSortSpec = {
  field: 'updated',
  direction: 'desc',
};

// ---------------------------------------------------------------------------
// The predicate
// ---------------------------------------------------------------------------

/**
 * Case-insensitive containment.
 *
 * **BR-10 / NFR-13: `String.includes`, never a constructed `RegExp`.** The
 * needle is user input; compiling it into a pattern makes `.*` a wildcard the
 * user never asked for, turns `(` into a syntax error, and opens a ReDoS
 * surface on a string typed into a filter box.
 */
function includesFold(haystack: string | undefined, needle: string): boolean {
  if (haystack === undefined) return false;
  return haystack.toLowerCase().includes(needle);
}

function matchesText(task: TaskSpecSummary, needle: string): boolean {
  return (
    includesFold(task.id, needle) ||
    includesFold(task.title, needle) ||
    includesFold(task.description, needle)
  );
}

/**
 * Label matching, on {@link labelKey} for both sides.
 *
 * The normalization is IMPORTED from the graph module rather than re-derived,
 * so a filter chip, the label union that produced it and the colour hash behind
 * it can never disagree about what one label is (R9).
 */
function matchesLabels(
  task: TaskSpecSummary,
  selected: readonly string[],
  mode: TaskLabelMatchMode,
): boolean {
  const carried = new Set(task.labels.map(labelKey));
  return mode === 'all'
    ? selected.every((label) => carried.has(labelKey(label)))
    : selected.some((label) => carried.has(labelKey(label)));
}

/**
 * Executor matching: trimmed, case-SENSITIVE equality.
 *
 * Deliberately unlike labels. `labelKey` exists because labels are free text
 * typed differently by the same person on different days; an executor is an
 * agent NAME chosen from a known set, `TaskGraph.knownExecutors` offers exactly
 * those values, and folding case there would merge two agents whose names
 * differ only in case into one filter entry.
 */
function matchesExecutors(
  task: TaskSpecSummary,
  selected: readonly string[],
): boolean {
  const executor = task.executor?.trim();
  if (executor === undefined || executor.length === 0) return false;
  return selected.some((value) => value.trim() === executor);
}

function matchesParentage(
  task: TaskSpecSummary,
  selected: readonly TaskParentageFacet[],
  graph: TaskGraph,
): boolean {
  const isParent = (graph.children.get(task.id)?.length ?? 0) > 0;
  const isChild = graph.effectiveParent.has(task.id);
  return selected.some((facet) => {
    if (facet === 'parent') return isParent;
    if (facet === 'child') return isChild;
    return !isParent && !isChild;
  });
}

/**
 * "Is this task a child of one of these parents?"
 *
 * Read off `effectiveParent`, so the answer agrees with `graph.children` and
 * therefore with the rollup count the click came from. `undefined` — no
 * honoured parent at all — matches nothing, and cannot collide with a selected
 * id because it is checked before the lookup.
 */
function matchesChildrenOf(
  task: TaskSpecSummary,
  selected: readonly string[],
  graph: TaskGraph,
): boolean {
  const parent = graph.effectiveParent.get(task.id);
  return parent !== undefined && selected.includes(parent);
}

function matchesRelations(
  task: TaskSpecSummary,
  selected: readonly TaskRelationFacet[],
  graph: TaskGraph,
): boolean {
  return selected.some((facet) =>
    facet === 'unmet_dependencies'
      ? (graph.unmetDependencies.get(task.id)?.length ?? 0) > 0
      : // "is a duplicate" is what the task DECLARES about itself. A dangling
        // `duplicates` entry still says it, so this reads the authored array
        // rather than the resolved graph edge.
        task.duplicates.length > 0,
  );
}

/**
 * Apply a filter spec to a set of task summaries.
 *
 * Input order is preserved (this filters, it does not sort — see
 * {@link sortTasks}) and the input array is never mutated.
 *
 * @param graph the derived graph for the parentage and relation facets. It MUST
 * be built from the SAME complete task set, otherwise a task's parentage is
 * judged against a graph that does not contain its parent. Omit it and one is
 * built on demand, and only if a facet that needs it is actually active — which
 * is why the backend, where no graph is memoized, can leave it off without
 * paying for one on every list call.
 */
export function filterTasks(
  tasks: readonly TaskSpecSummary[],
  filter: TaskFilterSpec,
  graph?: TaskGraph,
): TaskSpecSummary[] {
  if (!isTaskFilterActive(filter)) return [...tasks];

  const needle = filter.text.trim().toLowerCase();
  let resolvedGraph = graph;
  const graphOf = (): TaskGraph => (resolvedGraph ??= buildTaskGraph(tasks));

  return tasks.filter((task) => {
    // AND across facets: the first unsatisfied ACTIVE facet rejects the task.
    if (needle.length > 0 && !matchesText(task, needle)) return false;
    if (filter.statuses.length > 0 && !filter.statuses.includes(task.status)) {
      return false;
    }
    if (filter.types.length > 0) {
      // `type: null` means the frontmatter `type` failed validation. It is not
      // a ninth type and must not match a type selection.
      if (task.type === null || !filter.types.includes(task.type)) return false;
    }
    if (
      filter.labels.length > 0 &&
      !matchesLabels(task, filter.labels, filter.labelsMode)
    ) {
      return false;
    }
    // `estimates` and `unestimated` are ONE facet, OR-ed within.
    if (filter.estimates.length > 0 || filter.unestimated) {
      const sized =
        task.estimate !== undefined && filter.estimates.includes(task.estimate);
      const unsized = filter.unestimated && task.estimate === undefined;
      if (!sized && !unsized) return false;
    }
    if (
      filter.executors.length > 0 &&
      !matchesExecutors(task, filter.executors)
    ) {
      return false;
    }
    if (
      filter.parentage.length > 0 &&
      !matchesParentage(task, filter.parentage, graphOf())
    ) {
      return false;
    }
    if (
      filter.childrenOf.length > 0 &&
      !matchesChildrenOf(task, filter.childrenOf, graphOf())
    ) {
      return false;
    }
    if (
      filter.relations.length > 0 &&
      !matchesRelations(task, filter.relations, graphOf())
    ) {
      return false;
    }
    if (filter.hasValidationIssues && task.validationIssues.length === 0) {
      return false;
    }
    return true;
  });
}

/**
 * Fold the legacy `status` / `type` list parameters into a filter spec.
 *
 * `tasks:list` and `ptah_task_list` accepted `status[]` and `type[]` long
 * before this module existed, and both keep working. Rather than run a second
 * comparison for them beside the predicate, they are folded into the SAME two
 * facets here, so there is one path through `filterTasks` instead of two.
 *
 * Both spellings express the same facet, so combining them is an INTERSECTION:
 * a task satisfies `status: ['done']` AND `filter.statuses: ['backlog']` only
 * if its status is in both. Letting one silently override the other would drop
 * a constraint the caller stated.
 *
 * ## Why this can return `null`
 *
 * An empty `statuses` array means "this facet is inactive" — that is what makes
 * {@link EMPTY_TASK_FILTER} neutral. So an EMPTY INTERSECTION has no
 * representation inside a `TaskFilterSpec`: writing it back as `[]` would turn
 * two contradictory constraints into no constraint at all and return every
 * task, which is the exact opposite of the answer. `null` means "no task can
 * satisfy this", and the one caller that can produce it says so by returning an
 * empty list. It is unreachable from any caller that uses one spelling or the
 * other, which is every caller today.
 */
export function mergeStatusTypeFacets(
  filter: TaskFilterSpec | undefined,
  statuses: readonly TaskStatus[] | undefined,
  types: readonly TaskType[] | undefined,
): TaskFilterSpec | null {
  const base = filter ?? EMPTY_TASK_FILTER;
  const mergedStatuses = intersectFacet(base.statuses, statuses);
  const mergedTypes = intersectFacet(base.types, types);
  if (mergedStatuses === null || mergedTypes === null) return null;
  return { ...base, statuses: mergedStatuses, types: mergedTypes };
}

/**
 * Intersect two optional facet selections.
 *
 * An empty or absent side means "no constraint" and yields the other side;
 * `null` is the empty intersection of two real constraints.
 */
function intersectFacet<T>(
  current: readonly T[],
  incoming: readonly T[] | undefined,
): readonly T[] | null {
  if (incoming === undefined || incoming.length === 0) return current;
  if (current.length === 0) return [...incoming];
  const both = current.filter((value) => incoming.includes(value));
  return both.length === 0 ? null : both;
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

/**
 * Whether the task has a value for this sort field at all.
 *
 * Absence is ranked BEFORE the direction is applied (see {@link sortTasks}), so
 * tasks with no value sort last in both directions. An unsized task is not
 * "smaller than XS", it is unanswered — and flipping the sort direction should
 * not promote every unanswered task to the top of the board.
 */
function hasSortValue(task: TaskSpecSummary, field: TaskSortField): boolean {
  switch (field) {
    case 'updated':
      return task.updated !== null;
    case 'created':
      return task.created !== null;
    case 'type':
      return task.type !== null;
    case 'estimate':
      return task.estimate !== undefined;
    case 'title':
    case 'status':
    case 'id':
      return true;
  }
}

/**
 * Case-insensitive text comparison, WITHOUT `localeCompare`.
 *
 * `localeCompare`'s collation depends on the host's ICU data and locale, so the
 * extension host and the webview can order the same two titles differently.
 * A board that reorders itself when opened in the other host reads as a bug in
 * the data, so the comparison is a plain ordinal one over the folded string and
 * is identical everywhere.
 */
function compareText(a: string, b: string): number {
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  if (al === bl) return 0;
  return al < bl ? -1 : 1;
}

/** Position in a canonical tuple; `-1` for absent, which cannot be reached. */
function tupleIndex<T extends string>(
  order: readonly T[],
  value: T | null | undefined,
): number {
  return value === null || value === undefined ? -1 : order.indexOf(value);
}

/**
 * Compare two tasks on one field.
 *
 * Only ever called when {@link hasSortValue} is true for BOTH, so no branch
 * here decides what an absent value means — that decision belongs to
 * {@link sortTasks}, ahead of the direction. The neutral fallbacks (`''`, `-1`)
 * exist to satisfy the narrowing and are unreachable.
 */
function compareByField(
  a: TaskSpecSummary,
  b: TaskSpecSummary,
  field: TaskSortField,
): number {
  switch (field) {
    // ISO 8601 sorts correctly as text, which is the whole reason it is stored
    // that way — no Date parsing and no timezone re-interpretation.
    case 'updated':
      return compareText(a.updated ?? '', b.updated ?? '');
    case 'created':
      return compareText(a.created ?? '', b.created ?? '');
    case 'title':
      return compareText(a.title, b.title);
    case 'status':
      return (
        tupleIndex(TASK_STATUSES, a.status) -
        tupleIndex(TASK_STATUSES, b.status)
      );
    case 'type':
      return tupleIndex(TASK_TYPES, a.type) - tupleIndex(TASK_TYPES, b.type);
    case 'estimate':
      // TASK_ESTIMATES' TUPLE ORDER is the sort order. There is no numeric
      // mapping for a t-shirt size anywhere in this codebase and none is
      // introduced here (see TASK_ESTIMATES' own note).
      return (
        tupleIndex(TASK_ESTIMATES, a.estimate) -
        tupleIndex(TASK_ESTIMATES, b.estimate)
      );
    case 'id':
      return compareText(a.id, b.id);
  }
}

/**
 * Sort a task list. Pure — the input array is not mutated.
 *
 * ## Stable, and stable for a reason that does not depend on the engine
 *
 * Every comparison falls through to an ascending `id` tie-break, and ids are
 * folder names, so the comparator is a TOTAL order: no two distinct tasks ever
 * compare equal. The result is therefore identical on any `Array.prototype.sort`
 * implementation, which is a stronger guarantee than relying on the spec's
 * stability — and it is what makes a re-sorted board stop shuffling rows that
 * share an `updated` timestamp.
 *
 * The tie-break is ascending in BOTH directions on purpose: it exists to make
 * the order deterministic, not to be a second sort key the user chose.
 *
 * ## Absence is ranked BEFORE the direction is applied
 *
 * Tasks with no value for the sort field go last whichever way the arrow
 * points. Multiplying their comparison by the direction sign instead would put
 * every unsized task at the top of a descending estimate sort, which reads as
 * "these are the biggest" rather than "these have no answer".
 */
export function sortTasks(
  tasks: readonly TaskSpecSummary[],
  sort: TaskSortSpec,
): TaskSpecSummary[] {
  const sign = sort.direction === 'desc' ? -1 : 1;
  return [...tasks].sort((a, b) => {
    const aHas = hasSortValue(a, sort.field);
    const bHas = hasSortValue(b, sort.field);
    if (aHas !== bHas) return aHas ? -1 : 1;
    if (aHas) {
      const primary = compareByField(a, b, sort.field);
      if (primary !== 0) return primary * sign;
    }
    return compareText(a.id, b.id);
  });
}
