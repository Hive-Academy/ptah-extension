/**
 * Zod request schemas for the `tasks:` RPC namespace (NFR-9).
 *
 * Every handler parses its params through the matching schema at the trust
 * boundary before touching the index/writer. `workspaceRoot` is always
 * optional (resolved to the active workspace when omitted); status/type
 * enums are validated against the shared canonical lists so a malformed
 * filter is rejected structurally rather than silently ignored.
 */
import { z } from 'zod';
import {
  BULK_CHUNK_SIZE,
  DOC_FILES,
  TASK_ESTIMATES,
  TASK_STATUSES,
  TASK_TYPES,
  MAX_LABELS_PER_TASK,
  MAX_SAVED_VIEW_ID_LENGTH,
} from '@ptah-extension/shared';
import {
  LabelSchema,
  SavedTaskViewSchema,
  TaskFilterSpecSchema,
  TaskIdRefSchema,
  TaskMetadataPatchSchema,
} from '@ptah-extension/shared/schemas';

const workspaceRoot = z.string().min(1).optional();
const statusEnum = z.enum(TASK_STATUSES);
const typeEnum = z.enum(TASK_TYPES);
const estimateEnum = z.enum(TASK_ESTIMATES);

/**
 * A task-id reference: one path segment, never a path.
 *
 * `taskId`, `parent`, `duplicates` and `relates_to` values are folder names
 * that end up joined onto the spec root, so a `..` or a separator reaching a
 * write path would steer that write outside the spec tree.
 *
 * This is the SHARED guard ({@link TaskIdRefSchema}), not a local re-statement
 * of it. The earlier local version tested only `'/'`, `'\\'` and an exact
 * `'..'`, which let `" .. "`, `"   "`, `"C:"`, the drive-relative `"C:NAME"`
 * and an embedded NUL straight through — none of which the frontmatter
 * parser's guard accepted. Two guards over the same value disagreeing about
 * what a folder name is has exactly one useful fix, and it is not a third
 * copy.
 */
const taskIdRef = TaskIdRefSchema;

/**
 * `tasks:list` — no new method, one new optional facet bag (FR-C1.5).
 *
 * `status` / `type` stay exactly as they were: `ptah_task_list` and
 * `ptah spec list` both use them, and this is not the batch that breaks them.
 * They are folded into the SAME two facets of the spec before the predicate
 * runs (`mergeStatusTypeFacets`), so adding `filter` did not add a second
 * comparison path — it removed the possibility of one.
 *
 * `TaskFilterSpecSchema` is IMPORTED, never restated: the board, this boundary
 * and the CLI must agree on what a filter is, and three copies of a facet list
 * is how they stop agreeing.
 */
export const TasksListParamsSchema = z.object({
  workspaceRoot,
  status: z.array(statusEnum).optional(),
  type: z.array(typeEnum).optional(),
  filter: TaskFilterSpecSchema.optional(),
});

export const TasksGetParamsSchema = z.object({
  workspaceRoot,
  taskId: taskIdRef,
});

/**
 * `file` is a CLOSED ENUM over the contract's document set, never a string.
 *
 * This is the whole security boundary for `tasks:getArtifact`: the value is
 * joined onto a folder path on the other side, so a free string — even one
 * screened for `..` — would make the method a general file reader pointed at
 * the user's disk. An enum cannot express a path at all, which is a stronger
 * guarantee than any sanitiser, and it comes from `DOC_FILES` so the boundary
 * cannot drift from the contract it is enforcing.
 */
export const TasksGetArtifactParamsSchema = z.object({
  workspaceRoot,
  taskId: taskIdRef,
  file: z.enum(DOC_FILES),
});

/**
 * `round` is a BOUNDED INTEGER, and there is no filename in this shape at all.
 *
 * `round-N-judge.md` cannot be a `DocFile` — `N` is a parameter, so the set is
 * open — which removes the enum boundary `tasks:getArtifact` relies on. It is
 * replaced by a stronger one rather than a weaker one: the caller sends a
 * number, the server derives the name via `roundJudgeFile()`, and a number
 * cannot express a separator or a `..`. Traversal is structurally impossible
 * here, not screened out.
 *
 * The ceiling is 4, deliberately NOT the panel's cap of 2. The Conductor may
 * run a third round when the user explicitly authorises one
 * (`crucible.md:153`), and a fourth is a skill violation that must surface in
 * the UI as a visible anomaly rather than as an RPC error the user never sees.
 * `int()` refuses `1.5`; `min(1)` refuses `0` and negatives — both would
 * otherwise compose into a filename for a round that cannot exist.
 */
export const TasksGetRoundJudgeParamsSchema = z.object({
  workspaceRoot,
  taskId: taskIdRef,
  round: z.number().int().min(1).max(4),
});

/**
 * Sweep bounds, enforced here rather than trusted from the caller.
 *
 * `min(1)` refuses zero outright: "delete everything finished, including what
 * I closed a minute ago" is never what a retention policy means, and `0` is one
 * keystroke from `7`. `max(3650)` is a sanity ceiling, not a policy.
 *
 * `apply` has NO default. A destructive flag that defaults to anything is a
 * flag a caller can omit into a deletion; this one must be stated.
 */
export const TasksSweepParamsSchema = z.object({
  workspaceRoot,
  olderThanDays: z.number().int().min(1).max(3650),
  apply: z.boolean(),
});

export const TasksCreateParamsSchema = z.object({
  workspaceRoot,
  title: z.string().min(1),
  type: typeEnum,
  // Omitted means `backlog`, defaulted by the emitter rather than here — one
  // place decides what an unstated status means, and it is the same place for
  // every writer.
  status: statusEnum.optional(),
  description: z.string().optional(),
  dependsOn: z.array(z.string().min(1)).optional(),
  executor: z.string().optional(),
  // Optional metadata carried at creation time. `estimate` is the enum, so an
  // unrecognised size is refused at the boundary rather than written to a file
  // and reported as a validation warning on the next scan. `labels` uses the
  // SHARED label schema and cap — a create that could plant 40 labels which
  // `tasks:updateMetadata` would then refuse to edit is not a boundary, it is
  // a hole beside one.
  labels: z.array(LabelSchema).max(MAX_LABELS_PER_TASK).optional(),
  estimate: estimateEnum.optional(),
  parent: taskIdRef.optional(),
  duplicates: z.array(taskIdRef).optional(),
  relatesTo: z.array(taskIdRef).optional(),
});

export const TasksUpdateStatusParamsSchema = z.object({
  workspaceRoot,
  taskId: taskIdRef,
  status: statusEnum,
});

/**
 * `tasks:updateMetadata` — the one metadata write method.
 *
 * `patch` is composed from the SHARED `TaskMetadataPatchSchema` rather than
 * restated, so the RPC surface and the `ptah_task_update` MCP tool enforce
 * byte-identical limits. Relaxing a limit in one place is impossible; there is
 * only the one place.
 */
export const TasksUpdateMetadataParamsSchema = z.object({
  workspaceRoot,
  taskId: taskIdRef,
  patch: TaskMetadataPatchSchema,
  /**
   * The optimistic-concurrency precondition for a full-replacement `labels`
   * write. See `TasksUpdateMetadataParams.expectLabels` for what it closes.
   *
   * A bare `z.array(z.string())`, deliberately NOT `LabelSchema`: this is a
   * description of what the caller last SAW on disk, not a proposal of what to
   * write. The read boundary accepts a hand-authored 40-character label as a
   * warning, so a task can legitimately carry one — and refusing to state it
   * here would make the one carrier that most needs the precondition the one
   * carrier that cannot use it.
   */
  expectLabels: z.array(z.string()).optional(),
});

/**
 * `tasks:bulkUpdateStatus` — move a set of tasks to one status (FR-C4).
 *
 * ## `taskIds` uses the SAME `taskIdRef` as every single-task method
 *
 * Each entry is joined onto the spec root by the write funnel exactly as a
 * single-task `taskId` is, so a bulk call is not a place where the containment
 * guard gets to be weaker. Restating it per-element rather than validating the
 * array as `z.array(z.string())` is the whole point: one bad entry among twenty
 * is refused at the boundary instead of reaching a path join nineteen writes in.
 *
 * ## The cap is a Zod `.max()` here, unlike `tasks:saveViews`
 *
 * Exceeding `BULK_CHUNK_SIZE` is a CLIENT bug, not a user action — the client
 * owns the chunking, so a request over the cap means its loop is wrong, and a
 * generic `INVALID_PARAMS` is the correct and complete answer. That is the
 * opposite of the saved-views cap, which a user reaches by saving views and so
 * needs a typed message naming the limit.
 *
 * `.min(1)` because a bulk call over nothing has no meaningful result list, and
 * accepting it would let a client's empty-selection bug reach the write path
 * and trigger an index rebuild for no writes at all.
 */
export const TasksBulkUpdateStatusParamsSchema = z.object({
  workspaceRoot,
  taskIds: z.array(taskIdRef).min(1).max(BULK_CHUNK_SIZE),
  status: statusEnum,
});

/**
 * `tasks:bulkUpdateLabel` — add or remove ONE label across a set of tasks
 * (FR-C5).
 *
 * Shares `taskIds` verbatim with {@link TasksBulkUpdateStatusParamsSchema}: the
 * same per-element `taskIdRef` guard, the same `.min(1)`, and the same
 * `BULK_CHUNK_SIZE` cap IMPORTED from the shared types rather than restated.
 * Two enforcers of one number is broken in one direction (a client chunking
 * above the cap fails every call) and silently unbounded in the other.
 *
 * ## `label` is a bare `z.string()` here, and that is not a relaxed boundary
 *
 * The three label rules — ≤ {@link LabelSchema}'s 32 characters, no newline,
 * not blank — still hold, and it is still `LabelSchema` that holds them. They
 * are applied one line into the HANDLER instead of here, for the same reason
 * `MAX_LABELS_PER_TASK` is: this method answers with a LIST, one entry per
 * task, and `parse` cannot produce one. Every Zod failure at this boundary
 * collapses to a single generic `INVALID_PARAMS` throw, which the board turns
 * into a `WRITE_FAILED` entry for every task in the chunk — so a user who
 * typed a 40-character label was told twelve carriers had failed to write and
 * never told that the label was too long. Checking one line later makes the
 * refusal say what it is, per task, in `LabelSchema`'s own words.
 *
 * Nothing here is trusted onto a path or into a file: the label is joined into
 * the merged array and that array is validated by `TaskMetadataPatchSchema` —
 * which contains `LabelSchema` — before any write.
 *
 * Note what is also NOT here: the per-task limit. `MAX_LABELS_PER_TASK`
 * constrains the MERGED array, which does not exist until the handler has read
 * the task's current labels, so it is enforced there — by running the merged
 * array through `TaskMetadataPatchSchema`, the one definition of that limit.
 */
export const TasksBulkUpdateLabelParamsSchema = z.object({
  workspaceRoot,
  taskIds: z.array(taskIdRef).min(1).max(BULK_CHUNK_SIZE),
  label: z.string(),
  mode: z.enum(['add', 'remove']),
});

export const TasksGenerateRegistryParamsSchema = z.object({
  workspaceRoot,
});

export const TasksBoardParamsSchema = z.object({
  workspaceRoot,
});

export const TasksReindexParamsSchema = z.object({
  workspaceRoot,
});

/**
 * `tasks:adopt` — note `status` is REQUIRED here while `tasks:create` has no
 * status field at all. That asymmetry is the point: creation always starts at
 * `backlog`, whereas adoption is retrofitting a carrier onto work that already
 * happened, so the caller must say what state that work is in.
 *
 * `folderName` is constrained to a single path segment by the SHARED guard. It
 * is joined onto `.ptah/specs` and then written to, so a `..` or a separator
 * would let a caller steer the write outside the spec tree entirely — and so
 * would `" .. "` or a drive-relative `"C:NAME"`, which the earlier local
 * check here did not catch.
 */
export const TasksAdoptParamsSchema = z.object({
  workspaceRoot,
  folderName: taskIdRef,
  title: z.string().min(1),
  type: typeEnum,
  status: statusEnum,
  description: z.string().optional(),
  dependsOn: z.array(z.string().min(1)).optional(),
  executor: z.string().optional(),
  statusInferred: z.boolean().optional(),
});

export const TasksDoctorPlanParamsSchema = z.object({
  workspaceRoot,
});

export const TasksGetViewsParamsSchema = z.object({
  workspaceRoot,
});

/**
 * `tasks:saveViews` — whole-list replace (FR-C2.5).
 *
 * ## The 50-view cap is deliberately NOT a Zod `.max()`
 *
 * Every schema failure in this file funnels through `TasksRpcHandlers.parse`,
 * which throws a single generic `INVALID_PARAMS` and discards the Zod message.
 * That is right for a malformed request and wrong for a full list: "invalid
 * parameters" tells a user who just hit the limit nothing they can act on. The
 * cap is therefore checked in the handler, which can return the typed
 * `CAP_EXCEEDED` result naming the limit — a clear message rather than a silent
 * truncation. `MAX_SAVED_TASK_VIEWS` stays the one number, in one place; adding
 * a `.max()` here as well would be a second limit for a later reader to tighten
 * independently.
 *
 * ## Ids must be unique
 *
 * `activeViewId` selects a view BY ID, so two views sharing one id is a state
 * with no single answer to "which view is active" and no way for a rename to
 * hit only one of them. It is a client bug rather than a user action, so it is
 * refused at the boundary instead of being reconciled.
 */
export const TasksSaveViewsParamsSchema = z.object({
  workspaceRoot,
  views: z
    .array(SavedTaskViewSchema)
    .refine(
      (views) => new Set(views.map((view) => view.id)).size === views.length,
      { message: 'saved view ids must be unique' },
    ),
  // `null` clears the active view; omitting the key leaves the stored value
  // alone. Both are reconciled against `views` before anything is written.
  activeViewId: z.string().max(MAX_SAVED_VIEW_ID_LENGTH).nullable().optional(),
});

export type TasksListParamsParsed = z.infer<typeof TasksListParamsSchema>;
export type TasksGetParamsParsed = z.infer<typeof TasksGetParamsSchema>;
export type TasksGetArtifactParamsParsed = z.infer<
  typeof TasksGetArtifactParamsSchema
>;
export type TasksGetRoundJudgeParamsParsed = z.infer<
  typeof TasksGetRoundJudgeParamsSchema
>;
export type TasksCreateParamsParsed = z.infer<typeof TasksCreateParamsSchema>;
export type TasksSweepParamsParsed = z.infer<typeof TasksSweepParamsSchema>;
export type TasksUpdateStatusParamsParsed = z.infer<
  typeof TasksUpdateStatusParamsSchema
>;
export type TasksUpdateMetadataParamsParsed = z.infer<
  typeof TasksUpdateMetadataParamsSchema
>;
export type TasksBulkUpdateStatusParamsParsed = z.infer<
  typeof TasksBulkUpdateStatusParamsSchema
>;
export type TasksBulkUpdateLabelParamsParsed = z.infer<
  typeof TasksBulkUpdateLabelParamsSchema
>;
export type TasksSaveViewsParamsParsed = z.infer<
  typeof TasksSaveViewsParamsSchema
>;
