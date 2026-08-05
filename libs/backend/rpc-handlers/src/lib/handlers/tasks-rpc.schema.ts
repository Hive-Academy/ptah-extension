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
  TASK_ESTIMATES,
  TASK_STATUSES,
  TASK_TYPES,
  LabelSchema,
  MAX_LABELS_PER_TASK,
  TaskFilterSpecSchema,
  TaskIdRefSchema,
  TaskMetadataPatchSchema,
} from '@ptah-extension/shared';

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

export const TasksCreateParamsSchema = z.object({
  workspaceRoot,
  title: z.string().min(1),
  type: typeEnum,
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

export type TasksListParamsParsed = z.infer<typeof TasksListParamsSchema>;
export type TasksGetParamsParsed = z.infer<typeof TasksGetParamsSchema>;
export type TasksCreateParamsParsed = z.infer<typeof TasksCreateParamsSchema>;
export type TasksUpdateStatusParamsParsed = z.infer<
  typeof TasksUpdateStatusParamsSchema
>;
export type TasksUpdateMetadataParamsParsed = z.infer<
  typeof TasksUpdateMetadataParamsSchema
>;
