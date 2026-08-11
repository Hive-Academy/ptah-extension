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
  BULK_CHUNK_SIZE,
  DEFAULT_TASK_SORT,
  EMPTY_TASK_FILTER,
  TASK_ESTIMATES,
  TASK_STATUSES,
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
  type DocFile,
  type TaskSpecDetail,
  type TaskSpecSummary,
  type TaskStatus,
  type TaskType,
  type TasksBoardResult,
  type TasksBulkLabelMode,
  type TasksBulkResultItem,
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

/**
 * How many tasks must be selected before a bulk status move asks first
 * (FR-C4.12).
 *
 * Ten, and the threshold is EXCLUSIVE: ten tasks run straight away, eleven ask.
 * The number is not a risk assessment — every write in the run is equally
 * irreversible — it is the point past which a user can no longer see the whole
 * selection at once, and therefore can no longer check it by looking. Below it
 * the confirmation would be a dialog whose answer is already on screen.
 *
 * Distinct from {@link BULK_CHUNK_SIZE}, which is a wire limit shared with the
 * RPC boundary. This one is a UI decision and lives only on this side.
 */
export const BULK_CONFIRM_THRESHOLD = 10;

/** The failure codes a bulk item can carry — the write funnel's own (D5). */
type BulkErrorCode = NonNullable<TasksBulkResultItem['error']>['code'];

/**
 * WHAT a bulk run is doing — the one description every stage of the run reads.
 *
 * ## A discriminated union, not two parallel fields
 *
 * The obvious alternative is a `status?: TaskStatus` beside a `label?: string`
 * on {@link BulkProgress} and {@link BulkSummary}. That shape can express two
 * states this feature has no meaning for — both set, and neither set — and the
 * moment it can, every reader has to decide what to do about them, separately.
 * The same refusal {@link TaskBulkOutcome} makes for the board's two still-
 * selected groups: one signal that cannot disagree with itself, rather than two
 * that can.
 *
 * It is also what keeps ONE run method, ONE chunk call and ONE settle: the only
 * place `kind` is inspected is the line that picks which RPC to issue and the
 * sentences that describe it.
 */
export type BulkOperation =
  | { readonly kind: 'status'; readonly status: TaskStatus }
  | {
      readonly kind: 'label';
      readonly label: string;
      readonly mode: TasksBulkLabelMode;
    };

/**
 * A bulk run currently in flight.
 *
 * `done` counts tasks the client has ISSUED a write for and received an answer
 * about — not tasks that succeeded. A run of 120 that ends with 118 failures
 * still reports `120 / 120`, because this number answers "how far through the
 * list are we", and the summary answers "what happened".
 */
export interface BulkProgress {
  /** What every task in this run is having done to it. */
  readonly operation: BulkOperation;
  readonly done: number;
  readonly total: number;
  /**
   * Cancellation has been REQUESTED. It takes effect between chunks — see
   * {@link TasksStore.cancelBulk} — so this being true does not mean the run
   * has stopped, and never means a write was undone.
   */
  readonly cancelled: boolean;
}

/** One task the bulk run could not move, and everything known about why. */
export interface BulkFailure {
  readonly taskId: string;
  /**
   * The task's title as the board last read it, or `null` when the id is no
   * longer on the board (it was deleted, or excluded, between selection and
   * write). Rendered as `{{ interpolation }}` only — it is author text off
   * disk (BR-10).
   */
  readonly title: string | null;
  readonly code: BulkErrorCode;
  /** The backend's own sentence, verbatim. This side invents no wording. */
  readonly message: string;
  /**
   * ON `TASK_CONFLICT` ONLY: what the carrier holds right now (FR-C4.7).
   *
   * The whole reason this field is carried this far. "It changed, try again"
   * is a dead end; "it changed, and it now says In Review" is a decision the
   * user can actually make.
   */
  readonly currentStatus?: TaskStatus;
}

/**
 * One task the run never reached, because it was cancelled first.
 *
 * A THIRD group, kept apart from {@link BulkFailure} at every layer — the data
 * model, the summary panel, and the card. Nothing was attempted, nothing is on
 * disk, and nothing refused: reporting it beside the failures would tell a user
 * that eighty tasks broke when they pressed Cancel.
 *
 * It carries no `code` and no `message` for the same reason. There is nothing
 * to say about it except that it did not happen yet, and inventing a failure
 * sentence would be the exact false statement this split exists to prevent.
 */
export interface BulkUntouched {
  readonly taskId: string;
  readonly title: string | null;
}

/**
 * How the last run left one task, for the cards that are still selected
 * because of it.
 *
 * After a cancelled run the board holds two kinds of still-checked card that a
 * user must be able to tell apart before deciding what to do: one refused a
 * write, the other was never asked. They are one signal here so the board takes
 * one input rather than two parallel id sets that could disagree.
 */
export type TaskBulkOutcome = 'failed' | 'untouched';

/**
 * What one finished bulk run did. Persistent state, NOT a transient banner
 * (FR-C4.5): it is cleared by the user dismissing it or by the next run, never
 * by a timer, because a list of per-task failures that disappears on its own is
 * a list nobody can act on.
 */
export interface BulkSummary {
  /** What the run was doing to each task. */
  readonly operation: BulkOperation;
  /** How many tasks the user had selected when the run started. */
  readonly requested: number;
  /**
   * How many of them the client actually issued a write for. Equal to
   * `requested` unless the run was cancelled — cancellation is chunk-granular,
   * so this lands on a chunk boundary.
   */
  readonly attempted: number;
  readonly succeeded: number;
  /**
   * How many of {@link succeeded} needed no write at all — the task already
   * carried the label being added, or already lacked the one being removed.
   *
   * ## A SUB-COUNT of `succeeded`, not a fourth group
   *
   * A no-op is a success: the task ends in the state the user asked for, its
   * `updated` stamp is untouched because nothing was written, and it leaves the
   * selection like any other success. Counting it anywhere else would break the
   * three-group invariant below — and putting it in `untouched` would be the
   * worse of the two mistakes, because that group means "the run never reached
   * this task", which is the opposite of what happened.
   *
   * It is carried separately only so the summary can avoid the false sentence
   * "10 tasks got the label" for a run where 8 of them already had it. Always
   * `0` for a status run: `tasks:bulkUpdateStatus` never sets `noop`, on
   * purpose (see `TasksBulkResultItem.noop`).
   */
  readonly noop: number;
  readonly failures: readonly BulkFailure[];
  /**
   * The tasks the run never reached. Empty unless {@link cancelled}.
   *
   * `succeeded + failures.length + untouched.length === requested` is the
   * invariant that makes this summary complete: every task the user selected is
   * accounted for in exactly one of the three, so no id can go missing from the
   * report of what happened to it. {@link noop} sits INSIDE `succeeded` and is
   * deliberately absent from that sum.
   */
  readonly untouched: readonly BulkUntouched[];
  readonly cancelled: boolean;
}

/**
 * The shared empty outcome map.
 *
 * One frozen instance rather than a fresh `new Map()` per evaluation: the
 * board, every column and every card read this through an `input`, and a new
 * identity on each read would invalidate their OnPush checks on every change
 * detection pass for the entire time no summary exists — which is nearly all
 * of the time.
 */
const EMPTY_OUTCOMES: ReadonlyMap<string, TaskBulkOutcome> = new Map();

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

  /** The workflow document expanded in the detail panel — see {@link readDocument}. */
  private readonly _openDocument = signal<DocFile | null>(null);
  private readonly _documentContent = signal<string | null>(null);
  private readonly _documentLoading = signal(false);

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
   * The multi-select set (FR-C4.1). SESSION STATE — never persisted, never
   * sent, and never written to a carrier.
   *
   * ## It is COMPLETELY INDEPENDENT of `_selectedTaskId`
   *
   * `_selectedTaskId` is the detail panel: which ONE task is open for reading.
   * This is which tasks a bulk action would write. They are two different
   * questions and they are deliberately not wired together — entering
   * multi-select opens no detail, and clearing the selection closes no detail
   * (plan §6.3). A user checking twelve cards has not asked to read any of
   * them, and a user closing a detail panel has not asked to discard a
   * selection they spent twelve clicks building.
   *
   * The two are also allowed to overlap freely: the open task may or may not be
   * in the set, and neither state constrains the other.
   */
  private readonly _selection = signal<ReadonlySet<string>>(new Set());

  /**
   * Where a Shift-range starts counting from — the last task toggled
   * individually.
   *
   * `null` means "no origin yet", in which case a Shift-click behaves as a
   * plain toggle and becomes the origin itself. That is the only sane reading:
   * a range needs two ends, and inventing the first one (the top of the board,
   * say) would select tasks the user never pointed at.
   */
  private readonly _selectionAnchor = signal<string | null>(null);

  /**
   * Tasks whose bulk write is in flight RIGHT NOW — one chunk's worth
   * (FR-C4.11).
   *
   * Chunks are issued strictly one at a time, so this holds at most
   * {@link BULK_CHUNK_SIZE} ids and is replaced wholesale per chunk rather
   * than accumulated and picked apart. It exists so a card can say "this one is
   * being written" instead of the board going uniformly busy for a run that may
   * take several seconds.
   */
  private readonly _pending = signal<ReadonlySet<string>>(new Set());

  /** The in-flight bulk run, or `null`. See {@link BulkProgress}. */
  private readonly _bulk = signal<BulkProgress | null>(null);

  /** The last finished run's outcome. See {@link BulkSummary}. */
  private readonly _bulkSummary = signal<BulkSummary | null>(null);

  /**
   * A bulk move that is waiting for the user to confirm it (FR-C4.12).
   *
   * ## Why the confirmation decision lives in the store
   *
   * FR-C6.7 requires a bulk action launched from the COMMAND PALETTE to pass
   * through the same confirmation as one launched from the bulk bar. Two
   * surfaces each deciding "is this selection big enough to ask about" is two
   * copies of one rule, and the copy that drifts is the one that writes 120
   * carriers without asking. Every surface calls {@link TasksStore.requestBulk}
   * (through {@link TasksStore.requestBulkStatus} or
   * {@link TasksStore.requestBulkLabel}); this signal is where that one
   * decision is recorded, and the bar renders whatever it holds.
   *
   * It holds the whole {@link BulkOperation}, so a label run passes the same
   * gate as a status run rather than acquiring a second route into the loop.
   */
  private readonly _bulkRequest = signal<BulkOperation | null>(null);

  /**
   * A `tasks:changed` push arrived while a bulk run was suppressing them.
   *
   * NOT a signal: nothing renders it. It records that the store was TOLD about
   * a change it chose not to act on, which is a different thing from merely
   * being older than disk — see {@link handleMessage} for the suppression and
   * {@link reconcileAfterBulk} for what is owed once the run ends.
   */
  private missedPush = false;

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

  /** Same guard as {@link detailReqSeq}, for the workflow-document read. */
  private documentReqSeq = 0;

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
  public readonly openDocument = this._openDocument.asReadonly();
  public readonly documentContent = this._documentContent.asReadonly();
  public readonly documentLoading = this._documentLoading.asReadonly();

  /** The active filter spec — read-only; mutate through {@link setFilter}. */
  public readonly filter = this._filter.asReadonly();
  /** The active sort spec — read-only; mutate through {@link setSort}. */
  public readonly sort = this._sort.asReadonly();

  /** The multi-select set (FR-C4.1) — see {@link _selection}. */
  public readonly selection = this._selection.asReadonly();
  /** Ids whose bulk write is in flight (FR-C4.11) — see {@link _pending}. */
  public readonly pending = this._pending.asReadonly();
  /** The in-flight bulk run, or `null`. */
  public readonly bulk = this._bulk.asReadonly();
  /** The last finished run's outcome, until dismissed or replaced. */
  public readonly bulkSummary = this._bulkSummary.asReadonly();
  /** A bulk move awaiting confirmation, or `null` (FR-C4.12 / FR-C6.7). */
  public readonly bulkRequest = this._bulkRequest.asReadonly();

  /** How many tasks are selected — the number the bulk bar states. */
  public readonly selectionCount = computed(() => this._selection().size);

  /**
   * How the last run left each still-selected task, keyed by id.
   *
   * ## Why the board needs this at all
   *
   * After a cancelled run, "failed" and "never attempted" both leave a card
   * CHECKED — so without this the two are indistinguishable on the board, and
   * the user is looking at eighty cards in one visual state that mean two
   * different things. The store already refuses to conflate them in
   * {@link BulkSummary}; this is the same refusal carried as far as the pixels,
   * because a distinction the interface does not draw is one the user cannot
   * act on.
   *
   * Derived from the summary rather than stored separately, so it cannot drift
   * from it, and it empties the moment the summary is dismissed or replaced.
   */
  public readonly lastRunOutcomes = computed<
    ReadonlyMap<string, TaskBulkOutcome>
  >(() => {
    const summary = this._bulkSummary();
    if (summary === null) return EMPTY_OUTCOMES;
    const outcomes = new Map<string, TaskBulkOutcome>();
    for (const failure of summary.failures) {
      outcomes.set(failure.taskId, 'failed');
    }
    for (const skipped of summary.untouched) {
      outcomes.set(skipped.taskId, 'untouched');
    }
    return outcomes;
  });

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

  /**
   * Every VISIBLE task id in the order the user reads them: column by column in
   * `TASK_STATUSES` order, each column filtered and sorted exactly as rendered.
   *
   * This is what a Shift-range resolves against (plan §6.3), and reading it off
   * {@link board} rather than off `_columns` is the whole point. A range
   * computed over the raw payload would select tasks the filter is hiding and
   * tasks the sort has moved elsewhere — so "everything between these two
   * cards" would mean something the user cannot see and did not ask for. Here,
   * a range means what the screen shows.
   */
  public readonly visibleOrder = computed<readonly string[]>(() =>
    this.board().flatMap((column) => column.tasks.map((task) => task.id)),
  );

  /**
   * How many SELECTED tasks the active filter is currently hiding.
   *
   * The selection deliberately survives a filter change (it is the user's, not
   * the filter's), which means the two can disagree — twelve selected while
   * three are on screen. Silently pruning the selection to the filter would
   * discard work with no undo; saying nothing would let a bulk write nine
   * carriers the user cannot see. So the bar states the number instead.
   */
  public readonly hiddenSelectionCount = computed(() => {
    const visible = this.filteredIds();
    let hidden = 0;
    for (const id of this._selection()) {
      if (!visible.has(id)) hidden += 1;
    }
    return hidden;
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

  /**
   * `tasks:changed` — refresh whatever the push says moved.
   *
   * ## The second of the two fronts holding the bulk path to ≤ 1 reload (R5)
   *
   * A bulk run issues several `tasks:bulkUpdateStatus` (or
   * `tasks:bulkUpdateLabel`) calls, and EACH ONE ends
   * with the backend rebuilding the index and broadcasting `tasks:changed`
   * (`TasksRpcHandlers.rebuildAfterBulk`). Those pushes land here while the run
   * is still going. Left alone, every one of them re-enters `loadBoard` — so a
   * 120-task run would issue six board fetches on top of the one the run itself
   * owes, and the first front (the loop never calling `loadBoard`) would be
   * bypassed entirely without a single line of the loop being wrong.
   *
   * So the whole handler short-circuits while a run is in flight. What is
   * dropped is recovered rather than forgotten:
   *
   *  - the ACTIVE board is covered by the one `loadBoard()` the run's `finally`
   *    issues, which is strictly newer than any push it suppressed;
   *  - the OPEN DETAIL is not — `loadBoard` does not touch it — so
   *    {@link reconcileAfterBulk} refreshes it when {@link missedPush} says a
   *    push was dropped;
   *  - a BACKGROUND workspace's cached slice goes stale, which costs nothing:
   *    `onWorkspaceSwitch` revalidates on every switch regardless.
   */
  public handleMessage(message: { type: string; payload?: unknown }): void {
    if (message.type !== TASKS_CHANGED_MESSAGE_TYPE) return;

    if (this._bulk() !== null) {
      this.missedPush = true;
      return;
    }

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
    // Opening a different task must not leave the previous one's plan expanded
    // underneath the new task's heading. Cleared unconditionally: re-opening
    // the SAME task is a re-read, and it is cheaper to reopen a document than
    // to reason about when the old content is still the right content.
    this.closeDocument();
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
    this.closeDocument();
  }

  /**
   * Read ONE workflow document of the open task, for in-place rendering.
   *
   * Sequenced exactly like {@link openTask}, and for the same reason: the user
   * can click three documents faster than the first read returns, and the last
   * one clicked is the one that must win. The response's own `file` is checked
   * against the request as a second guard, so a reply cannot be rendered under
   * a heading naming a different document.
   *
   * `content: null` on success means the folder does not hold that file. It is
   * NOT an error and does not set one — most tasks carry a handful of the
   * fifteen recognised documents.
   */
  public async readDocument(file: DocFile | null): Promise<void> {
    const taskId = this._selectedTaskId();
    if (file === null || taskId === null) {
      this.closeDocument();
      return;
    }

    const seq = ++this.documentReqSeq;
    this._openDocument.set(file);
    this._documentContent.set(null);
    this._documentLoading.set(true);
    try {
      const result = await this.rpc.call('tasks:getArtifact', {
        taskId,
        file,
        ...this.workspaceParam(),
      });
      if (seq !== this.documentReqSeq) return;
      if (result.isSuccess() && result.data && result.data.file === file) {
        this._documentContent.set(result.data.content);
      } else {
        this._documentContent.set(null);
        this._error.set(result.error ?? `Failed to read ${file}`);
      }
    } finally {
      if (seq === this.documentReqSeq) this._documentLoading.set(false);
    }
  }

  /** Close the expanded document and invalidate any read still in flight. */
  public closeDocument(): void {
    this.documentReqSeq++;
    this._openDocument.set(null);
    this._documentContent.set(null);
    this._documentLoading.set(false);
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
   *
   * ## Why the schema is imported dynamically
   *
   * `TasksStore` is registered in `MESSAGE_HANDLERS` at webview bootstrap, so
   * it is eager. A static import of the schema would therefore pull the whole
   * Zod runtime (304 kB) into the initial bundle for a check that only ever
   * runs when a user edits task metadata on the (lazily loaded) board.
   * Deferring the import moves those bytes into the board's own chunk
   * (TASK_2026_187 Unit 10). The deferral goes through the local
   * `./metadata-patch-schema.lazy` module — see that file for why it is not a
   * direct `import('@ptah-extension/shared/schemas')`.
   *
   * This is safe precisely because it is **not** a streaming path: the method
   * is already `async`, every caller already awaits it, writes are serialized
   * per task by {@link enqueueWrite}, and by the time a user can reach this
   * code the board chunk — which imports the same module statically — has
   * already been fetched. Nothing is queued, reordered or dropped. The chat
   * streaming handlers, where those properties would NOT hold, use
   * hand-written parsers instead.
   */
  public async applyMetadata(
    taskId: string,
    patch: TaskMetadataPatch,
    options: ApplyMetadataOptions = {},
  ): Promise<TasksUpdateMetadataResult> {
    const { TaskMetadataPatchSchema } =
      await import('./metadata-patch-schema.lazy');
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
    // Derived HERE rather than passed by each caller — see
    // {@link believedLabels} for why this is the honest place to take it from,
    // and `TasksUpdateMetadataParams.expectLabels` for the lost update it
    // closes.
    const expectLabels =
      parsed.data.labels === undefined
        ? undefined
        : this.believedLabels(taskId);
    return this.enqueueWrite(taskId, () =>
      this.writeMetadata(taskId, parsed.data, reload, expectLabels),
    );
  }

  /**
   * What THIS webview last knew task `taskId` to be labelled.
   *
   * ## Why the store derives it instead of each caller passing it
   *
   * `patch.labels` is a full replacement, so every label writer computes
   * `[...whatItSaw, added]` or `whatItSaw.filter(...)`. There are three such
   * writers — the detail panel's add and remove, and the palette's label
   * toggle — and all three compute `whatItSaw` from state that came from this
   * store: the panel from `taskDetail()`, the palette from the board rows.
   * `expectLabels` therefore is not a new fact any of them holds; it is the
   * value they already read, and taking it from its source makes the
   * precondition impossible to forget at a fourth call site. Threading it
   * through the emit chain would make it another thing to remember, and the
   * whole defect being closed here is a precondition somebody remembered on
   * one path and not the other.
   *
   * ## Why it is taken ONLY for a patch that replaces labels
   *
   * A status move, an estimate, a parent or a `depends_on` edit does not touch
   * `labels`, so a label precondition on those would refuse a write the user
   * asked for because somebody else labelled the task — turning a safety net
   * into a denial of service on the busiest carriers.
   *
   * ## Why the detail is preferred over the board row
   *
   * They can disagree: `openTask` re-reads one carrier, so the open task's
   * detail can be newer than the board payload it was opened from. The detail
   * is what the panel renders and therefore what the user acted on. `null` when
   * this store has never seen the task — an empty array would ASSERT the task
   * carries no labels, which is a different and much stronger claim.
   */
  private believedLabels(taskId: string): readonly string[] | undefined {
    const detail = this._taskDetail();
    if (detail?.id === taskId) return detail.labels;
    return this.allTasks().find((task) => task.id === taskId)?.labels;
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

  // -------------------------------------------------------------------------
  // Selection (FR-C4.1–4.2)
  //
  // Nothing below touches `_selectedTaskId`, and nothing in the detail-panel
  // methods above touches `_selection`. That separation is the contract, not an
  // accident of layout — see `_selection`.
  // -------------------------------------------------------------------------

  /**
   * Add or remove one task, and make it the origin for the next Shift-range.
   *
   * The anchor moves on a DESELECT too. A user who unchecks a card has still
   * told us where they are looking, and a range that counted from the last
   * *checked* card would start somewhere they had just moved away from.
   */
  public toggleSelection(taskId: string): void {
    this._selection.update((current) => {
      const next = new Set(current);
      if (!next.delete(taskId)) next.add(taskId);
      return next;
    });
    this._selectionAnchor.set(taskId);
  }

  /**
   * Select every visible task between the anchor and `taskId` (Shift-click).
   *
   * ## Additive, and it never deselects
   *
   * The range is unioned into the existing selection. The alternative —
   * replacing the selection with the range, as a file manager does — means a
   * mis-aimed Shift-click silently discards everything selected before it, and
   * there is no undo on this surface. Extending is recoverable by clicking the
   * cards back off; replacing is not.
   *
   * ## No anchor, or an anchor the filter has hidden → a plain toggle
   *
   * Both ends must be on screen for "everything between them" to mean
   * anything. When either is missing this degrades to {@link toggleSelection},
   * which also re-anchors — so the next Shift-click has the origin this one
   * lacked.
   */
  public selectRangeTo(taskId: string): void {
    const order = this.visibleOrder();
    const anchor = this._selectionAnchor();
    const from = anchor === null ? -1 : order.indexOf(anchor);
    const to = order.indexOf(taskId);
    if (from < 0 || to < 0) {
      this.toggleSelection(taskId);
      return;
    }

    const start = Math.min(from, to);
    const end = Math.max(from, to);
    this._selection.update((current) => {
      const next = new Set(current);
      for (let index = start; index <= end; index += 1) {
        next.add(order[index]);
      }
      return next;
    });
    // The anchor deliberately stays where it was: successive Shift-clicks are
    // meant to grow and shrink one range from a fixed origin, not to walk it.
  }

  /**
   * Select everything the active filter matches (FR-C4.2).
   *
   * `filteredIds()`, not every indexed task: the control that offers this is
   * rendered beside the `23 of 181` counter, so "all matching" has to mean the
   * 23. Selecting 181 tasks from a button that sits next to the number 23 would
   * be the single most destructive misreading available on this surface.
   */
  public selectAllMatching(): void {
    this._selection.set(new Set(this.filteredIds()));
    this._selectionAnchor.set(null);
  }

  /** Drop the whole selection. Does NOT close the detail panel (plan §6.3). */
  public clearSelection(): void {
    this._selection.set(new Set());
    this._selectionAnchor.set(null);
  }

  // -------------------------------------------------------------------------
  // Bulk status and labels (FR-C4 / FR-C5)
  // -------------------------------------------------------------------------

  /**
   * Ask to apply one {@link BulkOperation} to every selected task — the ONE
   * entry point into a run.
   *
   * The bulk bar's status picker, its label controls, the summary's Retry and
   * the command palette's bulk entries all arrive here, which is what makes
   * FR-C6.7 ("palette bulk actions route through the same confirmation")
   * structural rather than a promise — and what makes labels inherit the gate
   * instead of acquiring a second, similar one. Above
   * {@link BULK_CONFIRM_THRESHOLD} it records a pending request and writes
   * nothing; at or below it, it runs.
   */
  public requestBulk(operation: BulkOperation): void {
    if (this._selection().size === 0) return;
    if (this._bulk() !== null) return;
    if (this._selection().size > BULK_CONFIRM_THRESHOLD) {
      this._bulkRequest.set(operation);
      return;
    }
    void this.runBulk(operation);
  }

  /** Ask to move every selected task to `status` (FR-C4). */
  public requestBulkStatus(status: TaskStatus): void {
    this.requestBulk({ kind: 'status', status });
  }

  /**
   * Ask to add `label` to, or remove it from, every selected task (FR-C5).
   *
   * The label is passed through UNCHECKED. Its limits — no newline, not blank,
   * ≤ 32 characters, ≤ 12 per task — live in `LabelSchema` and
   * `TaskMetadataPatchSchema` and nowhere else, so an over-long label comes
   * back as one `INVALID_PARAMS` entry per task carrying the boundary's own
   * sentence, which is the sentence the user should read. A copy of the rule
   * here would be a second enforcer to drift.
   *
   * That per-task shape is a property of the HANDLER, not of the wire: three of
   * the four limits used to sit on `tasks:bulkUpdateLabel`'s request schema,
   * where every Zod failure collapses to one generic throw — and
   * {@link callBulkChunk} expands a throw into a `WRITE_FAILED` entry per task.
   * A 40-character label therefore reported twelve write failures and never the
   * length. The handler now runs `LabelSchema` itself, one line past `parse`,
   * so all four answer the same way.
   */
  public requestBulkLabel(label: string, mode: TasksBulkLabelMode): void {
    this.requestBulk({ kind: 'label', label, mode });
  }

  /** Run the pending request (the user said yes). */
  public confirmBulkRequest(): void {
    const operation = this._bulkRequest();
    if (operation === null) return;
    void this.runBulk(operation);
  }

  /** Discard the pending request. The selection is left exactly as it was. */
  public cancelBulkRequest(): void {
    this._bulkRequest.set(null);
  }

  /**
   * Ask the in-flight run to stop (FR-C4.9).
   *
   * ## Chunk-granular, and this method cannot make it finer
   *
   * It sets a flag the loop reads BETWEEN chunks. Every write already issued is
   * on disk and is not reversed — there is no undo on a carrier file, and
   * inventing one by writing the old status back would be a second write with
   * the same failure modes as the first. The UI says so in those words rather
   * than implying the run stopped where the click landed.
   */
  public cancelBulk(): void {
    this._bulk.update((progress) =>
      progress === null ? null : { ...progress, cancelled: true },
    );
  }

  /** Dismiss the persistent failure summary (FR-C4.5). */
  public clearBulkSummary(): void {
    this._bulkSummary.set(null);
  }

  /**
   * Apply one {@link BulkOperation} to every selected task, in chunks,
   * cancellably, with EXACTLY ONE board reload for the whole run (FR-C4 / R5).
   *
   * ## Partial failure is the outcome, not the error path
   *
   * The RPC answers with a LIST — one entry per task, each describing what
   * happened to that carrier (D5). This method never collapses that list into a
   * verdict. It splits it: successes leave the selection, failures stay in it
   * (FR-C4.6), and every failure is carried into {@link BulkSummary} with the
   * backend's own message and, on a conflict, the status the carrier actually
   * holds now (FR-C4.7).
   *
   * ## No auto-retry, ever (FR-C4.8)
   *
   * Nothing in here re-issues a failed write. Failures stay SELECTED precisely
   * so that Retry is a button the user presses, aimed at exactly what failed. A
   * conflict means somebody else wrote that file; retrying it automatically is
   * how a bulk operation overwrites the change it just detected.
   *
   * ## Exactly one reload, held by two independent fronts
   *
   * (a) This loop never calls `loadBoard` — only the `finally` does, once.
   * (b) `handleMessage` drops `tasks:changed` while `_bulk()` is non-null, so
   *     the backend's per-chunk broadcasts cannot re-enter it either.
   * Either front alone leaves the other's failure mode wide open: without (a)
   * the loop reloads N times on its own; without (b) the pushes do it instead.
   *
   * ## Not routed through `enqueueWrite`, deliberately
   *
   * That queue serializes writes PER TASK ID, and one bulk call covers up to
   * {@link BULK_CHUNK_SIZE} carriers at once — it has no single id to queue on,
   * and queuing it behind every member's tail would serialize the whole run
   * behind unrelated single-card edits. The overlap the queue exists to prevent
   * (this UI conflicting with itself) is therefore possible here, and it is
   * REPORTED rather than prevented: the writer's pre-write re-read refuses, and
   * the entry comes back `TASK_CONFLICT` with `currentStatus`, which is the
   * actionable answer.
   *
   * ## ONE run method for both operations
   *
   * Status and labels differ in exactly one line of this method — which RPC
   * {@link callBulkChunk} issues. Everything the run is actually about (the
   * chunking, the cancel check between chunks, the pending set, the one
   * reload, the push suppression, the three-group settle) is identical, and a
   * second copy of it would be a second place for any of those to be wrong.
   */
  public async runBulk(operation: BulkOperation): Promise<void> {
    if (this._bulk() !== null) return;
    const ids = [...this._selection()];
    if (ids.length === 0) return;

    this._bulkRequest.set(null);
    this._bulkSummary.set(null);
    this._error.set(null);
    this.missedPush = false;
    this._bulk.set({ operation, done: 0, total: ids.length, cancelled: false });

    /**
     * Outcomes keyed by the SAME case-folded key the RPC boundary dedupes on
     * (`dedupeTaskIds` in `tasks-rpc.handlers.ts`). Two selected ids differing
     * only in case are one task to the write path — it writes once and answers
     * once, under the first spelling it saw — so keying on the raw string would
     * leave the second spelling looking unanswered. Both get the one true
     * outcome instead.
     */
    const outcomes = new Map<string, TasksBulkResultItem>();
    let attempted = 0;

    try {
      for (let index = 0; index < ids.length; index += BULK_CHUNK_SIZE) {
        if (this._bulk()?.cancelled === true) break;
        const chunk = ids.slice(index, index + BULK_CHUNK_SIZE);
        // Replaced, not accumulated: chunks are issued strictly one at a time,
        // so the previous chunk is always finished by the time this runs.
        this._pending.set(new Set(chunk));
        attempted += chunk.length;

        for (const item of await this.callBulkChunk(chunk, operation)) {
          outcomes.set(item.taskId.toLowerCase(), item);
        }

        this._bulk.update(
          (progress) =>
            progress && { ...progress, done: progress.done + chunk.length },
        );
        this._pending.set(new Set());
      }
    } finally {
      this._pending.set(new Set());
      const cancelled = this._bulk()?.cancelled === true;
      this._bulk.set(null);
      this._bulkSummary.set(
        this.settleBulk(ids, operation, outcomes, attempted, cancelled),
      );
      await this.reconcileAfterBulk(ids);
    }
  }

  /**
   * One chunk's RPC, answered as a result list whatever happens.
   *
   * A transport-level failure — a throw, a timeout, a refusal by the boundary
   * before the loop started — is not an answer about any individual task, but
   * the caller still needs one per task or those ids silently vanish from the
   * run. So it is expanded into one `WRITE_FAILED` entry per requested id,
   * carrying the transport's own sentence. Those entries are failures, so the
   * tasks stay selected and stay retryable, which is exactly right: nothing is
   * known to have been written.
   *
   * The transport sentence names what the run was doing, because it is read
   * beside a list of task ids and "Failed to update task statuses." under a
   * label run is a false description of the write that did not happen.
   *
   * This is the ONLY place `operation.kind` decides anything on the write path.
   */
  private async callBulkChunk(
    chunk: readonly string[],
    operation: BulkOperation,
  ): Promise<readonly TasksBulkResultItem[]> {
    const fallback =
      operation.kind === 'status'
        ? 'Failed to update task statuses.'
        : 'Failed to update task labels.';
    const failAll = (message: string): TasksBulkResultItem[] =>
      chunk.map((taskId) => ({
        taskId,
        ok: false,
        error: { code: 'WRITE_FAILED' as const, message },
      }));

    try {
      const result =
        operation.kind === 'status'
          ? await this.rpc.call('tasks:bulkUpdateStatus', {
              taskIds: [...chunk],
              status: operation.status,
              ...this.workspaceParam(),
            })
          : await this.rpc.call('tasks:bulkUpdateLabel', {
              taskIds: [...chunk],
              label: operation.label,
              mode: operation.mode,
              ...this.workspaceParam(),
            });
      if (!(result.isSuccess() && result.data)) {
        return failAll(result.error ?? fallback);
      }
      // The payload crossed the host bridge with no schema on it — the same
      // unvalidated boundary `withRelationArrays` guards on the board path. A
      // malformed frame must not take the run's bookkeeping down with it.
      const results = result.data.results;
      if (!Array.isArray(results)) {
        return failAll('The host returned no outcome for these tasks.');
      }
      return results;
    } catch (error: unknown) {
      return failAll(error instanceof Error ? error.message : fallback);
    }
  }

  /**
   * Split the run's outcomes into the next selection and the summary.
   *
   * ## Three groups, not two
   *
   * Failures stay selected (FR-C4.6) and are listed. Successes leave the
   * selection. And a CANCELLED run leaves a third group — ids no write was ever
   * issued for — which stay selected too, and are counted in neither
   * `succeeded` nor `failures`. They are not failures: nothing was attempted,
   * nothing is on disk, and reporting them as failures would tell the user that
   * 80 tasks broke when they pressed Cancel.
   *
   * That third group is why `attempted` is carried separately from `requested`;
   * it is also what makes Retry after a cancel resume the run rather than
   * re-issue the part that already landed.
   *
   * ## And a no-op is NOT a fourth group
   *
   * `noop: true` comes back with `ok: true` — the task is already in the state
   * the user asked for and nothing was written. It is counted in `succeeded`,
   * it leaves the selection like every other success, and {@link
   * BulkSummary.noop} records how many of the successes it accounted for so the
   * summary can say so without inventing writes. Routing it to `untouched`
   * instead would state the opposite of what happened: that group means the run
   * never reached the task.
   */
  private settleBulk(
    ids: readonly string[],
    operation: BulkOperation,
    outcomes: ReadonlyMap<string, TasksBulkResultItem>,
    attempted: number,
    cancelled: boolean,
  ): BulkSummary {
    const titles = new Map(
      this.allTasks().map((task) => [task.id, task.title] as const),
    );
    const nextSelection = new Set<string>();
    const failures: BulkFailure[] = [];
    const untouched: BulkUntouched[] = [];
    let succeeded = 0;
    let noop = 0;

    for (const taskId of ids) {
      const item = outcomes.get(taskId.toLowerCase());
      if (item === undefined) {
        // Never attempted — the run stopped before reaching this chunk. It is
        // recorded as its own group, not merged into the failures.
        nextSelection.add(taskId);
        untouched.push({ taskId, title: titles.get(taskId) ?? null });
        continue;
      }
      if (item.ok) {
        succeeded += 1;
        // A sub-count of the line above, deliberately not an `else`: the task
        // succeeded AND wrote nothing, and both facts are reported.
        if (item.noop === true) noop += 1;
        continue;
      }
      nextSelection.add(taskId);
      failures.push({
        taskId,
        title: titles.get(taskId) ?? null,
        code: item.error?.code ?? 'WRITE_FAILED',
        message: item.error?.message ?? 'The write was refused.',
        ...(item.currentStatus === undefined
          ? {}
          : { currentStatus: item.currentStatus }),
      });
    }

    this._selection.set(nextSelection);
    return {
      operation,
      requested: ids.length,
      attempted,
      succeeded,
      noop,
      failures,
      untouched,
      cancelled,
    };
  }

  /**
   * The single board reload a bulk run owes, plus the one thing it does not
   * cover.
   *
   * `loadBoard()` here is the ONLY board fetch the whole run issues (FR-C4.10 /
   * R5) — the loop issues none, and the pushes that would have were dropped by
   * {@link handleMessage}.
   *
   * It refreshes the board and nothing else, so the open detail panel is
   * refreshed explicitly, for either of two independent reasons: the run may
   * have rewritten the open task's own carrier, or a suppressed push may have
   * carried a change to it from somewhere else entirely. Both leave the panel
   * showing a status that is no longer true, and the second is precisely what
   * {@link missedPush} is for — without it, a push dropped during a run would
   * have no path back at all.
   *
   * A failed reload is reported as a refresh failure, never as a write failure:
   * the writes have already landed, and telling a user their bulk move failed
   * when 40 carriers are on disk invites them to run it again.
   */
  private async reconcileAfterBulk(ids: readonly string[]): Promise<void> {
    const missed = this.missedPush;
    this.missedPush = false;

    try {
      await this.loadBoard();
    } catch (error: unknown) {
      this._error.set(TasksStore.refreshFailedMessage(error));
      return;
    }

    const selected = this._selectedTaskId();
    if (selected === null) return;
    if (!missed && !ids.includes(selected)) return;
    try {
      await this.openTask(selected);
    } catch (error: unknown) {
      this._error.set(TasksStore.refreshFailedMessage(error));
    }
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
    expectLabels: readonly string[] | undefined,
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
        // Omitted, not sent as `undefined`: absent means "no precondition" on
        // the wire, and a `labels` patch for a task this store has never seen
        // has no belief to state.
        ...(expectLabels === undefined ? {} : { expectLabels }),
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
    // Task ids are per-workspace folder names, so a selection carried across a
    // switch would name tasks in the workspace the user just left — and the
    // bulk bar would offer to write them. This is the one place the selection
    // is discarded without the user asking, and it is discarded because it has
    // stopped referring to anything on screen. The summary of the last run goes
    // with it for the same reason.
    this.clearSelection();
    this._bulkSummary.set(null);
    this._bulkRequest.set(null);

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
      // A bulk run owes exactly one board reload and issues it itself (R5). A
      // window regaining focus mid-run must not add a second — the run's own
      // reload lands after every write and is strictly fresher than anything
      // this could fetch now. Same reasoning as the push suppression in
      // `handleMessage`, on the other input that can re-enter `loadBoard`.
      if (this._bulk() !== null) return;
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
    this.pruneSelection(slice.columns);
  }

  /**
   * Drop selected ids the newly-painted board no longer holds.
   *
   * A task can leave the index between selection and the next load — deleted,
   * renamed, or newly excluded by the scanner. It is NOT the same case as a
   * task the filter is hiding, which stays selected on purpose and is counted
   * by {@link hiddenSelectionCount}: a hidden task still exists and a bulk
   * write would still land on it, whereas this one has nothing left to write
   * to. Keeping it would leave the bar stating a count that can never be acted
   * on and can never be corrected except by clearing everything.
   *
   * Allocation-free on the normal path: the board reloads on every write and
   * the overwhelming majority of reloads change nothing about membership, so a
   * new `Set` is only built when something actually left.
   */
  private pruneSelection(columns: Record<TaskStatus, TaskSpecSummary[]>): void {
    const selection = this._selection();
    if (selection.size === 0) return;

    const present = new Set<string>();
    for (const status of TASK_STATUSES) {
      for (const task of columns[status]) present.add(task.id);
    }

    let dropped = false;
    for (const id of selection) {
      if (!present.has(id)) {
        dropped = true;
        break;
      }
    }
    if (!dropped) return;

    const next = new Set<string>();
    for (const id of selection) {
      if (present.has(id)) next.add(id);
    }
    this._selection.set(next);

    const anchor = this._selectionAnchor();
    if (anchor !== null && !present.has(anchor)) {
      this._selectionAnchor.set(null);
    }
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
