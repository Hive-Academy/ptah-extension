/**
 * `tasks:` RPC namespace contracts (TASK_2026_157).
 *
 * Compile-time HALF of the dual registration. The runtime half is the
 * `'tasks:'` prefix in `ALLOWED_METHOD_PREFIXES`
 * (`libs/backend/vscode-core/src/messaging/rpc-handler.ts`) — neither alone
 * is sufficient; missing the runtime prefix crashes silently.
 *
 * `TasksChangedNotification` is a push payload (raw webview message), NOT an
 * RPC method — it mirrors `GitWorktreeChangedNotification`.
 */

import type {
  ExcludedTaskFolder,
  TaskEstimate,
  TaskSpecSummary,
  TaskSpecDetail,
  TaskStatus,
  TaskType,
} from '../task-spec.types';
import type { TaskFilterSpec } from '../task-filter';
import type { TaskMetadataPatch } from '../task-view.types';
import type { SavedTaskView } from '../task-saved-view.types';

/** Workspace scoping — same convention as GitWorkspaceScopedParams. */
export interface TasksWorkspaceScopedParams {
  workspaceRoot?: string;
}

export interface TasksListParams extends TasksWorkspaceScopedParams {
  /**
   * Legacy status facet. Kept because `ptah_task_list` and `ptah spec list`
   * shipped with it; folded into `filter.statuses` before the predicate runs,
   * so there is one path through `filterTasks` rather than two.
   */
  status?: TaskStatus[];
  /** Legacy type facet — see `status`. */
  type?: TaskType[];
  /**
   * The multi-axis filter (FR-C1.5).
   *
   * Applied server-side by the SAME `filterTasks` the board runs client-side,
   * over the same summaries. A partial spec is completed with the neutral
   * defaults at the Zod boundary.
   */
  filter?: TaskFilterSpec;
}
export interface TasksListResult {
  tasks: TaskSpecSummary[];
  excludedCount: number;
  specsDirExists: boolean;
}

export interface TasksGetParams extends TasksWorkspaceScopedParams {
  taskId: string;
}
export interface TasksGetResult {
  task: TaskSpecDetail | null;
}

export interface TasksCreateParams extends TasksWorkspaceScopedParams {
  title: string;
  type: TaskType;
  description?: string;
  dependsOn?: string[];
  executor?: string;
  /**
   * Optional metadata, applied at creation time.
   *
   * Omitted or empty means the carrier is written without the corresponding
   * frontmatter key at all — a task created with no labels does not get a
   * `labels: []` line. The RESULT needs no such additions: every task-carrying
   * result on this namespace is a `TaskSpecSummary`, so the five fields ride
   * onto `tasks:list`, `tasks:board`, `tasks:get` and this method's own
   * response without a single extra type.
   */
  labels?: string[];
  estimate?: TaskEstimate;
  parent?: string;
  duplicates?: string[];
  relatesTo?: string[];
}
export interface TasksCreateResult {
  success: boolean;
  task?: TaskSpecSummary;
  error?: {
    /**
     * `ID_ALLOCATION_EXHAUSTED` (TASK_2026_179, step 13): every candidate id
     * lost the exclusive-create race against a concurrent writer, so nothing
     * was written. Retryable — unlike `WRITE_FAILED`.
     */
    code:
      | 'TASK_FOLDER_EXISTS'
      | 'WRITE_FAILED'
      | 'INVALID_PARAMS'
      | 'ID_ALLOCATION_EXHAUSTED';
    message: string;
  };
}

export interface TasksUpdateStatusParams extends TasksWorkspaceScopedParams {
  taskId: string;
  status: TaskStatus;
}
export interface TasksUpdateStatusResult {
  success: boolean;
  task?: TaskSpecSummary;
  error?: {
    /**
     * `TASK_CONFLICT` (TASK_2026_179, step 4): the carrier changed on disk
     * between the writer's read and its write, so the write was REFUSED rather
     * than allowed to clobber the other writer. The board should re-read and
     * retry; the on-disk file is whatever the other writer left.
     */
    code: 'TASK_NOT_FOUND' | 'TASK_EXCLUDED' | 'WRITE_FAILED' | 'TASK_CONFLICT';
    message: string;
  };
}

/**
 * `tasks:updateMetadata` — change any subset of a task's metadata in ONE write.
 *
 * Deliberately one method rather than one per field. Each carrier write is its
 * own conflict domain, so five methods would mean five chances for a concurrent
 * edit to be refused, and a UI editing two fields at once would conflict with
 * itself. `patch` is the SHARED {@link TaskMetadataPatch} — the same type the
 * MCP tool and the CLI compose from, so the three paths cannot enforce
 * different limits.
 */
export interface TasksUpdateMetadataParams extends TasksWorkspaceScopedParams {
  taskId: string;
  patch: TaskMetadataPatch;
}

export interface TasksUpdateMetadataResult {
  success: boolean;
  task?: TaskSpecSummary;
  error?: {
    /**
     * `TASK_CONFLICT` means the carrier changed on disk between the writer's
     * read and its write, so NOTHING was written — re-read and retry.
     * `INVALID_PARAMS` reaches the wire here (unlike on `tasks:updateStatus`)
     * because a patch can legitimately be well-typed and still ask for no
     * change at all, and a caller deserves to be told that rather than shown a
     * generic write failure.
     */
    code:
      | 'TASK_NOT_FOUND'
      | 'TASK_EXCLUDED'
      | 'WRITE_FAILED'
      | 'TASK_CONFLICT'
      | 'INVALID_PARAMS';
    message: string;
  };
}

export type TasksGenerateRegistryParams = TasksWorkspaceScopedParams;
export interface TasksGenerateRegistryResult {
  success: boolean;
  includedCount: number;
  excludedCount: number;
  /** workspace-relative: '.ptah/specs/registry.md' (no abs-path leakage, R4.4). */
  registryPath: string;
}

export type TasksBoardParams = TasksWorkspaceScopedParams;
export interface TasksBoardResult {
  /** all six status keys always present. */
  columns: Record<TaskStatus, TaskSpecSummary[]>;
  /**
   * Every skipped folder BY NAME with its typed reason (TASK_2026_179, step 10).
   *
   * A count alone tells a user that folders vanished without telling them which
   * or why — that silent drop is the exact failure the exclusions drawer exists
   * to end. `excludedCount` stays as the host's own total so an older host that
   * cannot name its exclusions still reports the magnitude honestly.
   *
   * Reuses the shared {@link ExcludedTaskFolder} union deliberately: the board
   * UI keys a `Record` off `reason`, so a second, divergent copy of the union
   * would silently break that compile-time exhaustiveness guarantee.
   */
  excluded: ExcludedTaskFolder[];
  excludedCount: number;
  specsDirExists: boolean;
}

export type TasksReindexParams = TasksWorkspaceScopedParams;
export interface TasksReindexResult {
  success: boolean;
  indexedCount: number;
  excludedCount: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// tasks:adopt — give an EXISTING carrier-less folder a carrier
// ---------------------------------------------------------------------------

/**
 * Adopt a folder that already exists on disk but has no `task.md`.
 *
 * Deliberately a SEPARATE method from `tasks:create` rather than a flag on it.
 * `create` allocates an id; adoption must never do that — the folder name it is
 * given IS the canonical id. A shared method would put an allocator call one
 * mistaken branch away from minting a second folder for a task that already
 * exists, which is the exact failure this task set exists to remove.
 */
export interface TasksAdoptParams extends TasksWorkspaceScopedParams {
  /** Existing folder under `.ptah/specs`. This name IS the id. */
  folderName: string;
  title: string;
  type: TaskType;
  /** Caller-supplied status. The doctor deduces it from folder artifacts. */
  status: TaskStatus;
  description?: string;
  dependsOn?: string[];
  executor?: string;
  /**
   * Emit `status_inferred: true` into the carrier. Set whenever `status` was
   * deduced rather than declared, so a reader can tell a guess from a fact.
   */
  statusInferred?: boolean;
}

export interface TasksAdoptResult {
  success: boolean;
  task?: TaskSpecSummary;
  error?: {
    /**
     * `CARRIER_EXISTS` is the load-bearing one: adoption ABORTS when the folder
     * already has a carrier and returns this typed error. It never falls
     * through to allocating a fresh id, and it never overwrites the carrier —
     * `.ptah/**` is gitignored, so an overwrite has no undo.
     */
    code:
      | 'FOLDER_NOT_FOUND'
      | 'CARRIER_EXISTS'
      | 'WRITE_FAILED'
      | 'INVALID_PARAMS';
    message: string;
  };
}

// ---------------------------------------------------------------------------
// tasks:doctorPlan — READ-ONLY diagnosis
// ---------------------------------------------------------------------------

/** Adopt a carrier-less folder. Status is DEDUCED, never asserted. */
export interface TasksDoctorAdoptAction {
  kind: 'adopt';
  folderName: string;
  title: string;
  type: TaskType;
  status: TaskStatus;
  /** Artifact filenames the status was deduced from. Empty ⇒ `backlog`. */
  inferredFrom: string[];
}

/**
 * Move a batch breakdown from its pre-rename name onto the current one.
 *
 * `from`/`to` are bare FILENAMES, not paths: the service works in absolute
 * paths, but an absolute path in an RPC result leaks the user's directory
 * layout to the webview (R4.4). The folder is already named by `folderName`.
 */
export interface TasksDoctorRenameBatchesAction {
  kind: 'renameLegacyBatches';
  folderName: string;
  from: string;
  to: string;
}

export type TasksDoctorAction =
  | TasksDoctorAdoptAction
  | TasksDoctorRenameBatchesAction;

/**
 * Something worth SAYING that the doctor will not change on its own.
 *
 * Widened in lockstep with `DoctorWarning['code']` in `task-doctor.service.ts`
 * — the handler passes the service's warnings straight onto the wire, so the
 * two unions drifting apart is a compile error rather than a wire-shape bug.
 *
 * There is deliberately NO matching `TasksDoctorAction` for the four
 * cross-file codes. These are reported and never repaired, for the same reason
 * `id_mismatch` is: a repair here would rewrite a carrier the user did not ask
 * about.
 */
export interface TasksDoctorWarning {
  folderName: string;
  code:
    | 'id_mismatch'
    | 'unparseable_carrier'
    /** `parent` names a folder that is not a readable task. */
    | 'dangling_parent'
    /** The task's parent chain closes on itself. */
    | 'parent_cycle'
    /** The declared parent itself declares a parent; parentage is one level. */
    | 'parent_depth_exceeded'
    /** A `duplicates` / `relates_to` entry pointing at nothing, or at itself. */
    | 'dangling_relation';
  message: string;
}

export type TasksDoctorPlanParams = TasksWorkspaceScopedParams;

/**
 * Result of a doctor diagnosis.
 *
 * `tasks:doctorPlan` is READ-ONLY and must stay that way: it does not warm the
 * index (which would write `.ptah/specs/README.md`), it does not stamp the
 * contract file, and it does not touch a single task folder. The whole point of
 * a plan is that a human reads it and decides — a "plan" that already mutated
 * is not a plan, it is a fait accompli. Applying it is a separate, explicit act
 * that this namespace deliberately does not expose.
 */
export interface TasksDoctorPlanResult {
  ok: boolean;
  plan?: {
    /** Contract version this build writes. */
    contractVersion: number;
    /** Version recorded on disk, or null when the tree was never stamped. */
    stampVersion: number | null;
    actions: TasksDoctorAction[];
    warnings: TasksDoctorWarning[];
  };
  error?: {
    code:
      | 'STAMP_UNREADABLE'
      | 'SCAN_FAILED'
      | 'JOURNAL_WRITE_FAILED'
      | 'JOURNAL_NOT_FOUND'
      | 'JOURNAL_UNREADABLE'
      | 'APPLY_FAILED';
    message: string;
  };
}

// ---------------------------------------------------------------------------
// tasks:getViews / tasks:saveViews — saved board views (FR-C2)
// ---------------------------------------------------------------------------

export type TasksGetViewsParams = TasksWorkspaceScopedParams;

/**
 * The stored views, as far as they could be read.
 *
 * Reading views NEVER fails: a malformed entry, a settings file full of
 * nonsense and a settings file that cannot be read at all all produce a
 * successful result with whatever survived, because the board renders off this
 * call and refusing to answer would take the board down over a settings file
 * (NFR-11).
 */
export interface TasksGetViewsResult {
  /** Sorted ascending by `order`. */
  views: SavedTaskView[];
  /**
   * The view the board should open on, or `null`.
   *
   * `null` also covers a stored id that no surviving view carries — an active
   * view that is not in the list is a state the board has no way to render.
   */
  activeViewId: string | null;
  /**
   * Stored entries dropped because they failed validation (FR-C2.3).
   *
   * Reported rather than hidden: the alternative to saying "2 of your views
   * could not be read" is a menu that is quietly shorter than the user left it.
   */
  skipped: number;
}

/**
 * Replace the WHOLE stored list.
 *
 * Per-view create / rename / update / delete / reorder (FR-C2.5) are all
 * arithmetic the client performs on the list it already holds, followed by one
 * call to this method — mirroring `PTAH_CLI_AGENTS_DEF`. A per-view CRUD
 * surface would need read-modify-write semantics that a settings file cannot
 * make atomic, and five methods where one does.
 */
export interface TasksSaveViewsParams extends TasksWorkspaceScopedParams {
  /** At most `MAX_SAVED_TASK_VIEWS`; ids must be unique within the list. */
  views: SavedTaskView[];
  /**
   * `undefined` leaves the stored value alone; `null` clears it.
   *
   * Either way the result is reconciled against `views` before it is written,
   * so a stored active id can never outlive the view it names.
   */
  activeViewId?: string | null;
}

export interface TasksSaveViewsResult {
  /** True when the view LIST persisted. See `warning` for the partial case. */
  success: boolean;
  /**
   * The views were saved; something secondary was not.
   *
   * ## Why a partial outcome is reported as success rather than failure
   *
   * `views` and `activeViewId` are two settings keys and therefore two separate
   * whole-file writes. There is no way to make them one atomic act, so the
   * second can fail after the first has genuinely landed. Reporting that as
   * `WRITE_FAILED` would be a lie with a cost: the only sensible response a
   * user has to "failed" is to do it again, and re-saving is pointless here
   * because their views are already on disk.
   *
   * The stale pointer is self-correcting rather than wrong data —
   * `tasks:getViews` reconciles `activeViewId` against the views it actually
   * read and returns `null` when it names none of them — so the ONLY defect in
   * this case is what the caller is told. Hence: success, plus a warning that
   * names what actually happened.
   */
  warning?: {
    code: 'ACTIVE_VIEW_ID_NOT_SAVED';
    message: string;
  };
  /**
   * Set only when NOTHING was saved.
   *
   * There is deliberately no `INVALID_PARAMS` member: a schema failure throws
   * an `RpcUserError` at the boundary and never reaches this shape, so
   * declaring the code here would invite a client to write a branch that can
   * never run.
   */
  error?: {
    code: 'CAP_EXCEEDED' | 'WRITE_FAILED';
    message: string;
  };
}

/**
 * Push notification payload for 'tasks:changed' webview messages.
 * NOT an RPC method — mirrors GitWorktreeChangedNotification's pattern.
 */
export interface TasksChangedNotification {
  workspaceRoot: string;
  reason: 'watcher' | 'write' | 'reindex';
  folderNames?: string[];
}
