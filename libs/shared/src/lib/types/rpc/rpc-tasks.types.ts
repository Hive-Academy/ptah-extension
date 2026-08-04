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

/** Workspace scoping — same convention as GitWorkspaceScopedParams. */
export interface TasksWorkspaceScopedParams {
  workspaceRoot?: string;
}

export interface TasksListParams extends TasksWorkspaceScopedParams {
  status?: TaskStatus[];
  type?: TaskType[];
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

/**
 * Push notification payload for 'tasks:changed' webview messages.
 * NOT an RPC method — mirrors GitWorktreeChangedNotification's pattern.
 */
export interface TasksChangedNotification {
  workspaceRoot: string;
  reason: 'watcher' | 'write' | 'reindex';
  folderNames?: string[];
}
