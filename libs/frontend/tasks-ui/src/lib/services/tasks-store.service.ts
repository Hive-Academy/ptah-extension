import {
  DestroyRef,
  Injectable,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import {
  AppStateManager,
  ClaudeRpcService,
  type MessageHandler,
} from '@ptah-extension/core';
import {
  DEFAULT_TASK_SORT,
  EMPTY_TASK_FILTER,
  TASK_ESTIMATES,
  TASK_STATUSES,
  TaskMetadataPatchSchema,
  buildTaskGraph,
  filterTasks,
  isTaskFilterActive,
  sortTasks,
  type ExcludedTaskFolder,
  type TaskEstimate,
  type TaskFilterSpec,
  type TaskGraph,
  type TaskMetadataPatch,
  type TaskSortSpec,
  type TaskSpecDetail,
  type TaskSpecSummary,
  type TaskStatus,
  type TaskType,
  type TasksBoardResult,
  type TasksChangedNotification,
  type TasksCreateParams,
  type TasksCreateResult,
  type TasksUpdateMetadataResult,
} from '@ptah-extension/shared';
import { isTaskExclusionReason } from '../task-presentation';

/**
 * Raw webview message type broadcast by the backend `TasksRpcHandlers` whenever
 * the on-disk `.ptah/specs` index changes (write / watcher / reindex). Dispatched
 * by `MessageRouterService` purely by type string — mirrors `git:worktreeChanged`.
 */
export const TASKS_CHANGED_MESSAGE_TYPE = 'tasks:changed';

/**
 * One rendered board column: a status, the tasks currently visible in it, and
 * how many the workspace holds for that status regardless of the filter.
 *
 * Both counts, because a column that says `3` while the header says `181 total`
 * cannot be read: the user cannot tell a nearly-empty status from a heavily
 * filtered one. `total` is what makes `3 of 12` sayable per column, the same
 * contract the header states for the board (FR-C1.2).
 */
export interface TaskBoardColumn {
  status: TaskStatus;
  tasks: TaskSpecSummary[];
  /** Indexed count for this status — unfiltered, straight off the payload. */
  total: number;
}

/**
 * How many tasks carry each estimate, plus how many carry none.
 *
 * Counted over the INDEXED set, never the filtered one: these numbers label the
 * choices in the estimate menu, and a menu whose counts collapse as you select
 * from it cannot tell you what selecting the next entry would do.
 */
export interface TaskEstimateBuckets {
  readonly sized: Readonly<Record<TaskEstimate, number>>;
  readonly unestimated: number;
}

/**
 * Cached, per-workspace board snapshot. The store keeps one of these per
 * workspace key so a workspace switch can paint the last-known board instantly
 * (stale-while-revalidate) instead of flashing empty while the refetch lands.
 */
interface BoardSlice {
  columns: Record<TaskStatus, TaskSpecSummary[]>;
  /** Every folder the scan refused, by name and typed reason. */
  excluded: readonly ExcludedTaskFolder[];
  excludedCount: number;
  specsDirExists: boolean;
}

/**
 * Read the typed exclusion list off a `tasks:board` payload.
 *
 * The board result declares `excludedCount` for the header total and carries
 * the named list as an `excluded` array. Both halves are read defensively
 * rather than trusted: this is an external boundary (the payload crosses the
 * host bridge), the field is optional on hosts that predate the named-exclusion
 * contract, and a malformed entry must never reach the template. Anything that
 * is not a non-empty folder name paired with a reason from the shared union is
 * dropped.
 */
export function readExcludedFolders(
  data: TasksBoardResult,
): readonly ExcludedTaskFolder[] {
  const raw = (data as TasksBoardResult & { readonly excluded?: unknown })
    .excluded;
  if (!Array.isArray(raw)) return [];

  const parsed: ExcludedTaskFolder[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { folderName, reason } = entry as {
      folderName?: unknown;
      reason?: unknown;
    };
    if (typeof folderName !== 'string' || folderName.trim().length === 0) {
      continue;
    }
    if (!isTaskExclusionReason(reason)) continue;
    parsed.push({ folderName, reason });
  }
  return parsed;
}

/**
 * Guarantee the four array-valued relation fields on a summary that crossed the
 * host bridge.
 *
 * The contract says `dependsOn`, `labels`, `duplicates` and `relatesTo` are
 * ALWAYS arrays — absent, malformed and empty all collapse to `[]` at the parse
 * boundary — and `buildTaskGraph` iterates all four unconditionally. A payload
 * missing any of them takes the whole board down with a `TypeError` on the
 * first render.
 *
 * ## Why this is not dead code
 *
 * It is NOT a version-skew guard. The extension ships host and webview as one
 * artifact, so a webview can never meet a host built from different sources —
 * that scenario was investigated and is impossible here.
 *
 * The reason is narrower and it still holds: **`tasks:board` crosses the
 * postMessage bridge and nothing on that path validates it.** There is no Zod
 * schema, no runtime narrowing, no assertion anywhere between the host's
 * `JSON.stringify` and this function — the payload is `as`-cast into
 * `TasksBoardResult` and trusted. BR-9 puts validation at every external
 * boundary; this is one, and this is the only validation on it. Until that
 * boundary gets a real schema, deleting this line means any malformed frame —
 * a truncated message, a bug in a future host handler, a replayed frame — is a
 * blank board rather than a card with no metadata on it.
 *
 * The task object is returned UNCHANGED when it is already well-formed, so the
 * normal path allocates nothing and object identity survives a reload.
 */
function withRelationArrays(task: TaskSpecSummary): TaskSpecSummary {
  if (
    Array.isArray(task.dependsOn) &&
    Array.isArray(task.labels) &&
    Array.isArray(task.duplicates) &&
    Array.isArray(task.relatesTo)
  ) {
    return task;
  }
  return {
    ...task,
    dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn : [],
    labels: Array.isArray(task.labels) ? task.labels : [],
    duplicates: Array.isArray(task.duplicates) ? task.duplicates : [],
    relatesTo: Array.isArray(task.relatesTo) ? task.relatesTo : [],
  };
}

/** Options for {@link TasksStore.applyMetadata}. */
export interface ApplyMetadataOptions {
  /**
   * Re-read the authoritative board (and the open detail, when it is this
   * task) once the write succeeds. Defaults to `true`.
   *
   * The bulk paths pass `false` and issue exactly ONE reload for the whole
   * run instead of one per carrier.
   */
  readonly reload?: boolean;
}

/** Empty six-key column map — every status key is always present (R4). */
function emptyColumns(): Record<TaskStatus, TaskSpecSummary[]> {
  return TASK_STATUSES.reduce(
    (acc, status) => {
      acc[status] = [];
      return acc;
    },
    {} as Record<TaskStatus, TaskSpecSummary[]>,
  );
}

/**
 * Browser-safe workspace-root key used ONLY for cache lookups and for matching
 * the active workspace against a `tasks:changed` push root. Mirrors the intent
 * of the backend `normalizeWorkspaceRoot` (which we cannot import — it lives in
 * a backend lib and pulls in node `path`) without needing Node:
 *
 *  - unify `\` / `/` separators to `/` (the push root is `path.resolve`d, so it
 *    is back-slashed on Windows; `workspaceInfo().path` may use either),
 *  - strip a trailing separator,
 *  - lower-case a leading Windows drive letter (`D:` and `d:` are one root).
 *
 * Both roots are already absolute, so we skip resolution. This is a comparison
 * key only — the raw `workspaceInfo().path` is still sent as the RPC param (the
 * backend re-normalizes it on receipt). The empty string is the "no workspace"
 * key (RPC falls back to the backend's active workspace).
 */
export function normalizeRootKey(root: string): string {
  return root
    .replace(/[\\/]+/g, '/')
    .replace(/\/+$/, '')
    .replace(/^([a-zA-Z]):/, (_m, drive: string) => `${drive.toLowerCase()}:`);
}

/**
 * TasksStore
 *
 * Root-provided signal store for the standalone Tasks board. All data flows
 * through {@link ClaudeRpcService} (`tasks:*`); there is NO optimistic local
 * mutation (R5.7) — status changes and creates re-fetch the authoritative board
 * from the backend, and the `tasks:changed` push (handled here as a
 * {@link MessageHandler}) refreshes the board whenever the file index moves.
 *
 * Workspace-aware (TASK follow-up): the Electron shell keeps this page mounted
 * across workspace switches. Every `tasks:*` call carries the active workspace
 * root, a constructor {@link effect} reloads the board when the active workspace
 * changes, and a per-workspace {@link boardCache} paints the target board
 * instantly on switch (stale-while-revalidate). A slow response is stamped with
 * the workspace it was issued for so it can never overwrite a board the user has
 * since switched away from.
 */
@Injectable({ providedIn: 'root' })
export class TasksStore implements MessageHandler {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly appState = inject(AppStateManager);
  private readonly destroyRef = inject(DestroyRef);

  /** Consumed by `MessageRouterService` — refresh on backend index changes. */
  public readonly handledMessageTypes = [TASKS_CHANGED_MESSAGE_TYPE] as const;

  private readonly _columns =
    signal<Record<TaskStatus, TaskSpecSummary[]>>(emptyColumns());
  private readonly _excludedFolders = signal<readonly ExcludedTaskFolder[]>([]);
  private readonly _excludedCount = signal(0);
  private readonly _specsDirExists = signal(true);
  private readonly _loading = signal(false);
  private readonly _loaded = signal(false);
  private readonly _busy = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _actionMessage = signal<string | null>(null);
  private readonly _selectedTaskId = signal<string | null>(null);
  private readonly _taskDetail = signal<TaskSpecDetail | null>(null);
  private readonly _detailLoading = signal(false);

  /**
   * The active filter and sort. SESSION STATE — never persisted, never sent.
   *
   * Nothing writes these to disk or to settings, and no `tasks:*` call carries
   * them: the whole retrieval layer is `computed()` over the payload the board
   * already holds, so changing a facet issues NO RPC and triggers NO reload
   * (FR-C1.4, NFR-10). Saved views are a separate, explicit act.
   *
   * They survive a reload for free, and deliberately without machinery:
   * `loadBoard` replaces `_columns` and touches nothing else, so a board that
   * refreshes under an active filter comes back filtered (FR-C1.7).
   */
  private readonly _filter = signal<TaskFilterSpec>(EMPTY_TASK_FILTER);
  private readonly _sort = signal<TaskSortSpec>(DEFAULT_TASK_SORT);

  /**
   * Last-known board per workspace, keyed by {@link normalizeRootKey}. Used to
   * repaint the target board instantly on switch and to update background
   * workspaces from `tasks:changed` pushes without touching the visible board.
   *
   * Insertion-ordered (LRU): {@link cacheBoard} re-inserts the touched key so
   * the oldest non-active entry is the first eviction candidate once the map
   * exceeds {@link BOARD_CACHE_CAP}. This bounds retained workspaces without
   * coupling to `TabManagerService` (mirrors canvas's `RETAINED_WORKSPACE_CAP`).
   */
  private readonly boardCache = new Map<string, BoardSlice>();

  /** Max retained per-workspace board slices before LRU eviction kicks in. */
  private static readonly BOARD_CACHE_CAP = 8;

  /**
   * Per-key monotonic board-request stamps. Each {@link fetchBoard} bumps its
   * key's counter before firing; on resolve only the latest stamp for that key
   * may write the cache slice or the visible board — so two in-flight fetches
   * for the *same* workspace (switch-revalidate racing a manual reload, or an
   * A→B→A double fetch) can never let the older response win (Issue 4).
   */
  private readonly boardReqSeq = new Map<string, number>();

  /**
   * Per-task write queue: the tail of the promise chain currently outstanding
   * for a task id. Consumed by {@link enqueueWrite}; the entry is removed once
   * its own tail settles and nothing newer has replaced it.
   */
  private readonly writeTails = new Map<string, Promise<unknown>>();

  /**
   * Monotonic detail-request stamp. {@link openTask} bumps it before firing and
   * re-checks it after the await so a slower `tasks:get` for an earlier-clicked
   * task (double-click) can never overwrite a fresher selection's detail;
   * {@link closeTask} bumps it too so a late response after a workspace switch
   * (which clears the selection) can never repopulate the detail panel (Issue 2).
   */
  private detailReqSeq = 0;

  /**
   * Workspace key the switch effect last observed. Seeded synchronously at
   * construction with the same key the component's initial `loadBoard()` uses,
   * so a switch that lands between construction and the effect's first flush is
   * treated as a real switch (fetch) rather than silently recorded (Issue 7).
   */
  private lastWorkspaceKey = '';

  /** Board columns keyed by status (all six keys always present). */
  public readonly columns = this._columns.asReadonly();
  /**
   * Folders the scan refused, each with the typed reason it was refused for.
   * The board is a lie without this: a folder missing from every column is
   * otherwise indistinguishable from a folder that was never created.
   */
  public readonly excludedFolders = this._excludedFolders.asReadonly();
  public readonly excludedCount = this._excludedCount.asReadonly();
  public readonly specsDirExists = this._specsDirExists.asReadonly();
  public readonly loading = this._loading.asReadonly();
  /**
   * True once at least one board load has resolved for the *current* visible
   * board. The template gates its neutral loading spinner on `loading && !loaded`
   * so a cache-miss switch shows a spinner (not a transient empty board) until
   * the authoritative fetch lands (Issue 8).
   */
  public readonly loaded = this._loaded.asReadonly();
  public readonly busy = this._busy.asReadonly();
  public readonly error = this._error.asReadonly();
  public readonly actionMessage = this._actionMessage.asReadonly();
  public readonly selectedTaskId = this._selectedTaskId.asReadonly();
  public readonly taskDetail = this._taskDetail.asReadonly();
  public readonly detailLoading = this._detailLoading.asReadonly();

  /** The active filter spec — read-only; mutate through {@link setFilter}. */
  public readonly filter = this._filter.asReadonly();
  /** The active sort spec — read-only; mutate through {@link setSort}. */
  public readonly sort = this._sort.asReadonly();

  /**
   * Every board-visible task, flattened in canonical column order.
   *
   * The flattening order is `TASK_STATUSES`, which is fixed, so the graph built
   * from it is deterministic. (`buildTaskGraph` re-sorts by id internally, so
   * this order is a convenience for other consumers rather than a correctness
   * dependency.)
   */
  public readonly allTasks = computed<readonly TaskSpecSummary[]>(() => {
    const columns = this._columns();
    return TASK_STATUSES.flatMap((status) => columns[status]);
  });

  /**
   * The derived task graph — parentage, child rollups, inverse relations, the
   * label union — over the ALREADY-LOADED board payload.
   *
   * ## One computed, invalidated only by the payload (NFR-10)
   *
   * Its only reactive dependency is `_columns`, which is written exactly once
   * per resolved `tasks:board` response. Nothing a user types, selects, filters
   * or hovers touches it, so the graph is built once per board load and every
   * reader after that gets the memoized value.
   *
   * ## It is derived here rather than fetched
   *
   * `TasksGetResult` is unchanged and gains no relation fields. The detail
   * panel's inverse relations (Blocks, Duplicated by, the derived half of
   * Related) and the card's child rollup all read THIS, not the RPC — the
   * inverses are a property of the whole board, and a per-task fetch cannot see
   * them without the backend re-deriving and re-sending them on every open.
   *
   * ## It cannot produce a write
   *
   * `buildTaskGraph` is a pure function in `libs/shared` with no filesystem
   * access of any kind (FR-B3.2). A parent's carrier is never touched when a
   * child appears — children are read out of each CHILD's frontmatter.
   */
  public readonly graph = computed<TaskGraph>(() =>
    buildTaskGraph(this.allTasks()),
  );

  /**
   * Every distinct label in the workspace, as canonical display text in
   * first-seen order.
   *
   * A projection of the memoized {@link graph}, so label completion costs one
   * map read per keystroke rather than a rebuild (FR-B1.5, NFR-10). There is no
   * label registry file and no persisted list — the union IS the completion
   * source.
   */
  public readonly knownLabels = computed<readonly string[]>(
    () => this.graph().knownLabels,
  );

  /**
   * Every distinct executor named on the board, for the executor facet menu.
   *
   * A projection of the memoized {@link graph}, exactly like
   * {@link knownLabels}. Executors are NOT case-folded (unlike labels) — see
   * `matchesExecutors` in the shared predicate for why.
   */
  public readonly knownExecutors = computed<readonly string[]>(
    () => this.graph().knownExecutors,
  );

  // -------------------------------------------------------------------------
  // The filter path (FR-C1) — `computed()` over an ALREADY-LOADED payload
  //
  // Nothing below issues an RPC, and nothing below is a second predicate. The
  // shared `filterTasks` decides what matches; `sortTasks` decides what order;
  // this store only decides WHICH payload they run over and memoizes the
  // result. A comparison written here that a `TaskFilterSpec` field already
  // describes would be the second implementation FR-C1.5 exists to prevent.
  //
  // The dependency direction is deliberate and one-way: `filtered` reads
  // `graph`, `graph` reads NOTHING a user types. Reading a filter signal inside
  // the graph computed would rebuild the whole graph on every keystroke — the
  // 1 000-task budget in the store spec is the guard on that.
  // -------------------------------------------------------------------------

  /** The tasks matching the active filter, in payload order (unsorted). */
  public readonly filtered = computed<readonly TaskSpecSummary[]>(() =>
    filterTasks(this.allTasks(), this._filter(), this.graph()),
  );

  /**
   * Match set as ids, so {@link board} can partition the columns with a set
   * membership test instead of running the predicate once per column.
   */
  public readonly filteredIds = computed<ReadonlySet<string>>(
    () => new Set(this.filtered().map((task) => task.id)),
  );

  /**
   * Ordered board columns (canonical `TASK_STATUSES` / B1 order), narrowed to
   * the filter and sorted by the active sort.
   *
   * Each column keeps its INDEXED total beside its filtered task list — the
   * per-column half of the `23 of 181` contract (FR-C1.2).
   */
  public readonly board = computed<TaskBoardColumn[]>(() => {
    const columns = this._columns();
    const keep = this.filteredIds();
    const sort = this._sort();
    return TASK_STATUSES.map((status) => ({
      status,
      tasks: sortTasks(
        columns[status].filter((task) => keep.has(task.id)),
        sort,
      ),
      total: columns[status].length,
    }));
  });

  /** How many tasks the active filter matches — the `23` of `23 of 181`. */
  public readonly matchedCount = computed(() => this.filtered().length);

  /**
   * How many tasks are indexed — the `181` of `23 of 181`.
   *
   * Deliberately NOT the same number as {@link matchedCount} when a filter is
   * on, and deliberately the same signal the header counters
   * ({@link totalCount}, {@link statusCounts}, {@link doneCount},
   * {@link activeCount}) read: those report INDEXED totals while the columns
   * report FILTERED counts. That asymmetry is the contract, not an oversight —
   * "23 of 181" is unsayable if both halves move together.
   */
  public readonly totalIndexed = computed(() => this.allTasks().length);

  /** True when the active spec would exclude anything at all (FR-C1.6). */
  public readonly filterActive = computed(() =>
    isTaskFilterActive(this._filter()),
  );

  /**
   * Per-estimate counts over the indexed set, plus the unestimated tally.
   *
   * Counted here rather than in the filter bar because the bar is
   * presentational and because this is one memoized pass over a payload that
   * changes once per board load — recounting it per keystroke is exactly the
   * NFR-10 failure the filter path is built to avoid.
   */
  public readonly estimateBuckets = computed<TaskEstimateBuckets>(() => {
    const sized = TASK_ESTIMATES.reduce(
      (acc, estimate) => {
        acc[estimate] = 0;
        return acc;
      },
      {} as Record<TaskEstimate, number>,
    );
    let unestimated = 0;
    for (const task of this.allTasks()) {
      const estimate = task.estimate;
      if (estimate === undefined) unestimated++;
      else sized[estimate]++;
    }
    return { sized, unestimated };
  });

  /**
   * "Your filter matches nothing" — as distinct from "there are no tasks".
   *
   * The two need different words and different actions: one is fixed by
   * clearing a facet, the other by creating a task, and showing the create CTA
   * to someone whose 181 tasks are hidden behind a chip is the failure this
   * flag exists to prevent (FR-C1.3).
   */
  public readonly filteredEmpty = computed(
    () =>
      this._loaded() && this.totalIndexed() > 0 && this.matchedCount() === 0,
  );

  /** Total number of included (board-visible) tasks. */
  public readonly totalCount = computed(() =>
    TASK_STATUSES.reduce(
      (sum, status) => sum + this._columns()[status].length,
      0,
    ),
  );

  /** Per-status task counts (all six keys always present). */
  public readonly statusCounts = computed<Record<TaskStatus, number>>(() => {
    const columns = this._columns();
    return TASK_STATUSES.reduce(
      (acc, status) => {
        acc[status] = columns[status].length;
        return acc;
      },
      {} as Record<TaskStatus, number>,
    );
  });

  /** Count of completed (done) tasks — surfaced in the header summary. */
  public readonly doneCount = computed(() => this._columns().done.length);

  /** Count of actively-worked tasks (in progress + in review). */
  public readonly activeCount = computed(
    () => this._columns().in_progress.length + this._columns().in_review.length,
  );

  /**
   * True when there is nothing to show: either no `.ptah/specs` directory yet,
   * or the directory exists but holds zero valid tasks. Only meaningful once a
   * board load has completed at least once.
   */
  public readonly isEmpty = computed(
    () =>
      this._loaded() && (!this._specsDirExists() || this.totalCount() === 0),
  );

  /**
   * The host reported excluded folders but named none of them. Surfaced so the
   * drawer can say so out loud instead of rendering an empty list that reads as
   * "nothing was excluded" — the silent-drop failure this drawer exists to end.
   */
  public readonly excludedNamesUnavailable = computed(
    () => this._excludedCount() > 0 && this._excludedFolders().length === 0,
  );

  public constructor() {
    this.setupVisibilityReconcile();
    this.setupWorkspaceSwitch();
  }

  public handleMessage(message: { type: string; payload?: unknown }): void {
    if (message.type !== TASKS_CHANGED_MESSAGE_TYPE) return;

    const payload = message.payload as TasksChangedNotification | undefined;
    const changedRoot = payload?.workspaceRoot;

    // No root in the push → refresh the active workspace only (best effort).
    if (changedRoot === undefined || changedRoot === '') {
      void this.refreshActiveFromPush();
      return;
    }

    const changedKey = normalizeRootKey(changedRoot);
    if (changedKey === this.activeKey()) {
      void this.refreshActiveFromPush();
    } else if (this.boardCache.has(changedKey)) {
      // A background (visited-but-not-visible) workspace changed on disk —
      // silently refresh just its cached slice so a later switch-back is fresh.
      void this.fetchBoard(changedKey, changedRoot);
    }
  }

  /**
   * Load (or reload) the full board for the active workspace in one
   * `tasks:board` round trip. Shows the loading flag while the request is in
   * flight (explicit reload path — the switch/push paths refresh silently).
   */
  public async loadBoard(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    await this.fetchBoard(this.activeKey(), this.activeRoot());
  }

  /**
   * Fetch and select a single task's detail (frontmatter + markdown body).
   *
   * Stamped with a monotonic {@link detailReqSeq}: after the await resolves the
   * result is applied ONLY if this call is still the newest detail request — a
   * slower response for an earlier-clicked task (double-click) or one that lands
   * after a workspace switch cleared the selection can never clobber a fresher
   * detail (Issue 2).
   */
  public async openTask(taskId: string): Promise<void> {
    const seq = ++this.detailReqSeq;
    this._selectedTaskId.set(taskId);
    this._detailLoading.set(true);
    try {
      const result = await this.rpc.call('tasks:get', {
        taskId,
        ...this.workspaceParam(),
      });
      if (seq !== this.detailReqSeq) return;
      if (result.isSuccess() && result.data) {
        this._taskDetail.set(result.data.task);
      } else {
        this._taskDetail.set(null);
        this._error.set(result.error ?? 'Failed to load task detail');
      }
    } finally {
      if (seq === this.detailReqSeq) this._detailLoading.set(false);
    }
  }

  /** Clear the selected task / detail panel. */
  public closeTask(): void {
    // Invalidate any in-flight `openTask` so a late `tasks:get` response cannot
    // repopulate the detail after the panel was closed (e.g. on a workspace
    // switch, which funnels through here).
    this.detailReqSeq++;
    this._selectedTaskId.set(null);
    this._taskDetail.set(null);
    this._detailLoading.set(false);
  }

  /**
   * Open one of the currently-selected task's artifact files in the host editor
   * (`file:open`). The absolute path is composed here from the webview's known
   * workspace root plus the task folder — the backend never leaks abs paths
   * (R4.4), and the filename is validated against the detail's artifact list to
   * rule out traversal before it reaches the host.
   */
  public async openArtifact(file: string): Promise<void> {
    const detail = this._taskDetail();
    if (!detail || !detail.artifacts.includes(file)) return;

    const root = this.appState.workspaceInfo()?.path;
    if (!root) {
      this._error.set('Cannot open file — no workspace root is available.');
      return;
    }

    const base = root.replace(/[\\/]+$/, '');
    const absPath = `${base}/.ptah/specs/${detail.folderName}/${file}`;
    const result = await this.rpc.openFile(absPath);
    if (!(result.isSuccess() && result.data?.success)) {
      this._error.set(
        result.data?.error ?? result.error ?? `Failed to open ${file}`,
      );
    }
  }

  /**
   * THE client mutation funnel. Every carrier write this webview issues goes
   * through here and through `tasks:updateMetadata` — there is no second path.
   *
   * ## Full replacement, computed by the caller
   *
   * Each field of the patch REPLACES the carrier's value. Adding or removing a
   * single label or relation is arithmetic the caller performs on the task it
   * already holds, then sends as a whole array. `[]` and `null` remove the key
   * — except `dependsOn: []`, which is still written as `[]` (pre-existing
   * behaviour, deliberately not "fixed"). The writer stays free of
   * read-modify-write semantics it has no way to make atomic.
   *
   * ## Validated against the SHARED schema, not a local copy
   *
   * The three label limits (no newline, ≤ 32 characters, ≤ 12 per task) and the
   * single-path-segment rule for every task reference live in
   * `TaskMetadataPatchSchema` and nowhere else. This method runs that exact
   * schema and surfaces its issue message VERBATIM, so the sentence the user
   * reads is the one the boundary actually enforces. Restating a limit here
   * would drift the moment either side moved.
   *
   * Pre-validating is not redundant with the RPC boundary: the handler
   * deliberately collapses every Zod failure to a generic
   * "Invalid task request parameters." so that no internal detail reaches the
   * wire. A caller told only that would have nothing to act on.
   *
   * ## `patch` is validated here; `taskId` deliberately is not
   *
   * A malformed `taskId` is refused by `TasksUpdateMetadataParamsSchema` at the
   * RPC boundary and reaches the user as that same generic sentence — no
   * specific one. That asymmetry is intentional, not an oversight. `patch`
   * carries values a person TYPED, so a precise message is the difference
   * between a fixable mistake and a dead end. `taskId` never does: every caller
   * takes it from the board graph, a rendered card, or a relation chip, all of
   * which come from folder names the scanner already accepted. There is no free
   * text path into it, so a rejection here would mean a bug in this webview
   * rather than a mistake the user could correct — and the guard that catches it
   * is the shared `TaskIdRefSchema`, on the boundary that joins it onto a path.
   * A client-side copy would be a fourth implementation of a check that exists
   * once on purpose.
   *
   * ## Serialized per task
   *
   * The RPC is issued inside {@link enqueueWrite}, so two edits to the same
   * carrier never overlap. See that method for what this does and does not
   * guarantee.
   *
   * No optimistic state (R5.7): the board moves only on the authoritative
   * re-fetch that follows a successful write.
   */
  public async applyMetadata(
    taskId: string,
    patch: TaskMetadataPatch,
    options: ApplyMetadataOptions = {},
  ): Promise<TasksUpdateMetadataResult> {
    const parsed = TaskMetadataPatchSchema.safeParse(patch);
    if (!parsed.success) {
      // Verbatim, first issue first. The schema owns the wording.
      const message =
        parsed.error.issues[0]?.message ?? 'The requested change is not valid.';
      this._error.set(message);
      return { success: false, error: { code: 'INVALID_PARAMS', message } };
    }

    this._error.set(null);
    const reload = options.reload ?? true;
    return this.enqueueWrite(taskId, () =>
      this.writeMetadata(taskId, parsed.data, reload),
    );
  }

  /**
   * Move a task to a new status.
   *
   * A thin call onto {@link applyMetadata} rather than a second write path: a
   * status change IS a metadata patch, and the backend `updateStatus` is itself
   * a delegate onto the same `applyFrontmatterPatch`. Keeping a parallel client
   * path would mean two places to serialize, two places to surface a conflict,
   * and two places for Batches 7/9/12/14 to diverge from.
   */
  public async updateStatus(taskId: string, status: TaskStatus): Promise<void> {
    await this.applyMetadata(taskId, { status });
  }

  /** Create a new task folder + `task.md`, then reload the board. */
  public async createTask(
    input: Omit<TasksCreateParams, 'workspaceRoot'>,
  ): Promise<TasksCreateResult | null> {
    this._error.set(null);
    const result = await this.rpc.call('tasks:create', {
      ...input,
      ...this.workspaceParam(),
    });
    if (result.isSuccess() && result.data) {
      if (result.data.success) {
        await this.loadBoard();
      } else {
        this._error.set(result.data.error?.message ?? 'Failed to create task');
      }
      return result.data;
    }
    this._error.set(result.error ?? 'Failed to create task');
    return null;
  }

  /** Full backend reindex of `.ptah/specs`, then reload the board. */
  public async reindex(): Promise<void> {
    this._busy.set(true);
    this._error.set(null);
    this._actionMessage.set(null);
    try {
      const result = await this.rpc.call(
        'tasks:reindex',
        this.workspaceParam(),
      );
      if (result.isSuccess() && result.data?.success) {
        this._actionMessage.set(
          `Reindexed ${result.data.indexedCount} task(s) in ${result.data.durationMs}ms`,
        );
        await this.loadBoard();
      } else {
        this._error.set(result.error ?? 'Failed to reindex tasks');
      }
    } finally {
      this._busy.set(false);
    }
  }

  /** Regenerate `.ptah/specs/registry.md` from current frontmatter. */
  public async generateRegistry(): Promise<void> {
    this._busy.set(true);
    this._error.set(null);
    this._actionMessage.set(null);
    try {
      const result = await this.rpc.call(
        'tasks:generateRegistry',
        this.workspaceParam(),
      );
      if (result.isSuccess() && result.data?.success) {
        this._actionMessage.set(
          `Registry generated — ${result.data.includedCount} listed, ${result.data.excludedCount} excluded`,
        );
      } else {
        this._error.set(result.error ?? 'Failed to generate registry');
      }
    } finally {
      this._busy.set(false);
    }
  }

  /** Dismiss the transient action banner. */
  public clearActionMessage(): void {
    this._actionMessage.set(null);
  }

  /**
   * Replace the active filter.
   *
   * A whole spec, not a patch, for the same reason `TaskFilterSpec` has no
   * optional fields: "absent" and "empty" are the difference between a facet
   * that constrains nothing and one that constrains everything, and a partial
   * update is where two callers start disagreeing about which they meant.
   *
   * This writes a signal and returns. It issues no RPC and triggers no reload —
   * every consumer downstream is a `computed()` over the payload already in
   * hand (FR-C1.4).
   */
  public setFilter(filter: TaskFilterSpec): void {
    this._filter.set(filter);
  }

  /** Drop every facet, back to the neutral spec (FR-C1.6). */
  public clearFilter(): void {
    this._filter.set(EMPTY_TASK_FILTER);
  }

  /** Change the board's sort field/direction (FR-C3). */
  public setSort(sort: TaskSortSpec): void {
    this._sort.set(sort);
  }

  /**
   * Narrow the board to one parent's sub-tasks — the card rollup's click
   * target (FR-B3.3).
   *
   * Expressed as the `childrenOf` FACET on the shared spec, so the board runs
   * the one predicate every other surface runs. There is no "show children"
   * code path beside it.
   *
   * The rest of the filter is left standing rather than reset. Two reasons: a
   * click that silently discarded the user's other facets would be a
   * destructive act with no undo affordance, and every surviving facet is
   * visible as a removable chip, so a rollup click that lands on zero cards
   * says why on screen instead of appearing to do nothing.
   */
  public showChildrenOf(parentId: string): void {
    this._filter.update((filter) => ({ ...filter, childrenOf: [parentId] }));
  }

  /** Convenience filter used by the New Task form's type picker. */
  public isKnownType(value: string): value is TaskType {
    return (
      value === 'FEATURE' ||
      value === 'BUGFIX' ||
      value === 'REFACTORING' ||
      value === 'DOCUMENTATION' ||
      value === 'RESEARCH' ||
      value === 'DEVOPS' ||
      value === 'SAAS_INIT' ||
      value === 'CREATIVE'
    );
  }

  /** Active workspace root sent as the `tasks:*` RPC param (undefined = none). */
  private activeRoot(): string | undefined {
    return this.appState.workspaceInfo()?.path ?? undefined;
  }

  /** Cache/comparison key for the active workspace (`''` when none). */
  private activeKey(): string {
    const root = this.appState.workspaceInfo()?.path;
    return root ? normalizeRootKey(root) : '';
  }

  /** `{ workspaceRoot }` spread for `tasks:*` params, omitted when no workspace. */
  private workspaceParam(): { workspaceRoot?: string } {
    const root = this.appState.workspaceInfo()?.path;
    return root ? { workspaceRoot: root } : {};
  }

  /**
   * Serialize writes to ONE carrier: `op` runs only after every write already
   * queued for `taskId` has settled.
   *
   * ## What this does NOT do
   *
   * It provides no correctness guarantee, and nothing here should be read as
   * one. Correctness comes from the writer's own pre-write re-read: it compares
   * the file byte-for-byte against what it parsed and refuses the write if
   * anything touched it in between. That check is what makes a concurrent
   * editor — another window, an agent, a text editor — safe, and it stays the
   * only thing that does.
   *
   * ## What it DOES do
   *
   * It removes this UI's ability to manufacture a `TASK_CONFLICT` **against
   * itself**. Every patch is a full replacement computed from a snapshot the
   * caller already holds, so two overlapping writes to one carrier means the
   * second was computed before the first landed — the writer sees a file that
   * moved and refuses. Without this queue a user toggling two labels quickly
   * would hit that constantly, and the refusal would be entirely self-inflicted.
   *
   * ## Two details that are not stylistic
   *
   * `prev.then(op, op)` passes `op` as BOTH handlers, so a REJECTED predecessor
   * still starts the next write instead of leaving every later write on that
   * task waiting on a promise that never fulfils.
   *
   * Stated precisely, because a reader who checks will find the second handler
   * never fires today: what is stored in the map is `tail`, not `run`, and
   * `tail` already swallows both outcomes — so `prev` is always a fulfilled
   * promise and the rejection handler is unreachable *as currently wired*. It
   * is kept because the guarantee has to survive the map holding something
   * else. Store `run` instead of `tail` and the two lines stop being
   * equivalent immediately: the queue wedges on the first failed write. That
   * pair is pinned by "does not wedge the queue when a predecessor rejects" —
   * verified to fail when `tail` is swapped for `run` while `then(op)` stands
   * alone, and to pass when either half is present.
   *
   * The identity check before `delete` is what keeps the serialization working
   * under the exact interleaving it exists to prevent. A stale cleanup that
   * deleted unconditionally would drop a NEWER chain from the map, and the next
   * write would find no tail and start immediately — overlapping the chain it
   * was supposed to follow.
   *
   * The map holds only tasks with an outstanding write, so it self-empties.
   */
  private enqueueWrite<T>(taskId: string, op: () => Promise<T>): Promise<T> {
    const prev = this.writeTails.get(taskId) ?? Promise.resolve();
    const run = prev.then(op, op);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.writeTails.set(taskId, tail);
    void tail.then(() => {
      if (this.writeTails.get(taskId) === tail) this.writeTails.delete(taskId);
    });
    return run;
  }

  /**
   * One carrier write plus its authoritative re-read. Always invoked inside
   * {@link enqueueWrite}; never called directly.
   */
  private async writeMetadata(
    taskId: string,
    patch: TaskMetadataPatch,
    reload: boolean,
  ): Promise<TasksUpdateMetadataResult> {
    // The RPC service resolves with a failed `RpcResult` on timeout and abort,
    // but a broken transport can still throw. A throw here would escape through
    // a template event handler as an unhandled rejection and leave the user
    // with a silent no-op, so it is turned into the same typed failure every
    // other refusal takes.
    let result: Awaited<
      ReturnType<typeof this.rpc.call<'tasks:updateMetadata'>>
    >;
    try {
      result = await this.rpc.call('tasks:updateMetadata', {
        taskId,
        patch,
        ...this.workspaceParam(),
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to update task metadata';
      this._error.set(message);
      return { success: false, error: { code: 'WRITE_FAILED', message } };
    }

    if (!(result.isSuccess() && result.data)) {
      const message = result.error ?? 'Failed to update task metadata';
      this._error.set(message);
      return { success: false, error: { code: 'WRITE_FAILED', message } };
    }

    const data = result.data;
    if (!data.success) {
      this._error.set(data.error?.message ?? 'Failed to update task metadata');
      return data;
    }

    if (reload) {
      // The write has ALREADY LANDED by this point. A failure from here on is a
      // refresh failure, not a write failure, and the two must not be conflated:
      // telling a user their edit failed when it is on disk is worse than
      // telling them nothing, because the obvious response is to make it again.
      //
      // Unguarded, a throw here rejects `applyMetadata`, escapes through a
      // template event handler as an unhandled rejection, and sets no error at
      // all — leaving the user looking at stale state with no signal that it is
      // stale. That is precisely the state this batch newly makes reachable, so
      // it is caught and named here rather than left to the caller.
      try {
        await this.loadBoard();
        if (this._selectedTaskId() === taskId && data.task) {
          // Refresh the open detail with the authoritative row (not a guess).
          await this.openTask(taskId);
        }
      } catch (error: unknown) {
        this._error.set(TasksStore.refreshFailedMessage(error));
      }
    }
    return data;
  }

  /**
   * The sentence shown when a write succeeded but the re-read that follows it
   * did not. Deliberately distinguishable from every write-failure message: it
   * states the change is saved FIRST, then that the view is stale, then the one
   * action that fixes it.
   */
  private static refreshFailedMessage(error: unknown): string {
    const detail = error instanceof Error ? error.message : String(error);
    return `The change was saved, but the board could not be reloaded, so what you see may be out of date. Reindex or reopen the board to refresh. (${detail})`;
  }

  /**
   * Reload the board whenever the active Electron workspace changes. Mirrors the
   * `ThothStatusService` hook: the first emission only records the key (the
   * component's constructor already issues the initial `loadBoard()`), and every
   * subsequent change repaints from cache (if present) and revalidates.
   */
  private setupWorkspaceSwitch(): void {
    // Seed the baseline synchronously with the key the component's initial
    // `loadBoard()` uses. If the workspace changes before the effect's first
    // flush, `prev !== key` there and we treat it as a real switch (fetch)
    // rather than silently recording the new key without loading it (Issue 7).
    this.lastWorkspaceKey = this.activeKey();
    effect(() => {
      const key = this.activeKey();
      const prev = this.lastWorkspaceKey;
      this.lastWorkspaceKey = key;
      if (prev === key) return;
      untracked(() => this.onWorkspaceSwitch(key));
    });
  }

  /**
   * Paint the target workspace's board immediately (from cache when we have it,
   * otherwise an empty/loading state) and revalidate in the background. Task ids
   * are per-workspace, so the open detail is cleared on switch.
   */
  private onWorkspaceSwitch(key: string): void {
    this.closeTask();
    this._error.set(null);

    const cached = this.boardCache.get(key);
    if (cached) {
      this.applySlice(cached);
      // Stale-while-revalidate: repaint instantly, refresh silently.
      void this.fetchBoard(key, this.activeRoot());
    } else {
      this.resetVisibleForLoading();
      this._loading.set(true);
      void this.fetchBoard(key, this.activeRoot());
    }
  }

  /**
   * Single board fetch. Two guards decide whether a response may write state:
   *
   *  - `isLatest()` — the per-key monotonic {@link boardReqSeq}: only the newest
   *    in-flight fetch for `key` may write that key's cache slice or the visible
   *    board, so an older same-workspace response can never overwrite a fresher
   *    one already applied (Issue 4).
   *  - `isActive()` — the workspace `key` is still the visible one, so a response
   *    for a workspace the user switched away from can never paint the visible
   *    board (it still refreshes its own cache slice for a later switch-back).
   */
  private async fetchBoard(
    key: string,
    root: string | undefined,
  ): Promise<void> {
    const seq = (this.boardReqSeq.get(key) ?? 0) + 1;
    this.boardReqSeq.set(key, seq);
    const isLatest = (): boolean => this.boardReqSeq.get(key) === seq;
    const isActive = (): boolean => key === this.activeKey();
    try {
      const result = await this.rpc.call(
        'tasks:board',
        root !== undefined ? { workspaceRoot: root } : {},
      );
      if (!isLatest()) return;
      if (result.isSuccess() && result.data) {
        const slice = this.toSlice(result.data);
        this.cacheBoard(key, slice);
        if (isActive()) {
          this.applySlice(slice);
          this._error.set(null);
        }
      } else if (isActive()) {
        this._error.set(result.error ?? 'Failed to load tasks');
      }
    } finally {
      if (isLatest() && isActive()) {
        this._loading.set(false);
        this._loaded.set(true);
      }
    }
  }

  /**
   * Write a board slice into the LRU cache. Re-inserts the key so it becomes the
   * newest (most-recently-used) entry, then evicts the oldest non-active keys
   * until the map is back within {@link BOARD_CACHE_CAP}. The active workspace's
   * slice is never evicted — it backs the visible board.
   */
  private cacheBoard(key: string, slice: BoardSlice): void {
    this.boardCache.delete(key);
    this.boardCache.set(key, slice);
    if (this.boardCache.size <= TasksStore.BOARD_CACHE_CAP) return;
    const activeKey = this.activeKey();
    for (const candidate of this.boardCache.keys()) {
      if (this.boardCache.size <= TasksStore.BOARD_CACHE_CAP) break;
      if (candidate === activeKey) continue;
      this.boardCache.delete(candidate);
    }
  }

  /**
   * Client-side staleness safety net (no optimistic state — R5.7). If a
   * `tasks:changed` push is missed while the webview is backgrounded, the board
   * could sit stale indefinitely. Re-fetch the authoritative board whenever the
   * surface regains visibility/focus. Guarded so it never stacks or fires before
   * the first load, and no-op-safe: an in-flight `loadBoard` (`_loading`) short-
   * circuits re-entry, so back-to-back `focus` + `visibilitychange` collapse to
   * one refetch. Listeners are torn down with the root injector.
   */
  private setupVisibilityReconcile(): void {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      return;
    }

    const reconcile = (): void => {
      // Only refetch when actually visible, after an initial load, and when no
      // load is already in flight — the guard doubles as the debounce.
      if (document.visibilityState === 'hidden') return;
      if (!this._loaded() || this._loading()) return;
      void this.loadBoard();
    };
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') reconcile();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', reconcile);
    this.destroyRef.onDestroy(() => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', reconcile);
    });
  }

  private async refreshActiveFromPush(): Promise<void> {
    await this.fetchBoard(this.activeKey(), this.activeRoot());
    const selected = this._selectedTaskId();
    if (selected) {
      await this.openTask(selected);
    }
  }

  /** Snapshot RPC board data into a cache slice (all six keys guaranteed). */
  private toSlice(data: TasksBoardResult): BoardSlice {
    const normalized = emptyColumns();
    for (const status of TASK_STATUSES) {
      normalized[status] = (data.columns[status] ?? []).map(withRelationArrays);
    }
    const excluded = readExcludedFolders(data);
    return {
      columns: normalized,
      excluded,
      // Prefer the host's own total, but never report fewer than the names we
      // actually received — the drawer must not claim "3 excluded" over 12 rows.
      excludedCount: Math.max(data.excludedCount, excluded.length),
      specsDirExists: data.specsDirExists,
    };
  }

  /** Paint a cached/fresh slice onto the visible board signals. */
  private applySlice(slice: BoardSlice): void {
    this._columns.set(slice.columns);
    this._excludedFolders.set(slice.excluded);
    this._excludedCount.set(slice.excludedCount);
    this._specsDirExists.set(slice.specsDirExists);
    this._loaded.set(true);
  }

  /** Reset the visible board to the first-visit empty/loading baseline. */
  private resetVisibleForLoading(): void {
    this._columns.set(emptyColumns());
    this._excludedFolders.set([]);
    this._excludedCount.set(0);
    this._specsDirExists.set(true);
    this._loaded.set(false);
  }
}
