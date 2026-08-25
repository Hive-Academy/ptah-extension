/**
 * The Zod half of the shared task-metadata write contract (TASK_2026_181,
 * family B).
 *
 * Split out of `task-view.types.ts` so the contract's pure types, its path-
 * segment guard and its numeric limits can be imported without pulling `zod`
 * in. Dependency direction is one-way: schemas → types.
 */
import { z } from 'zod';
import { TASK_ESTIMATES, TASK_STATUSES } from './task-spec.types';
import {
  EMPTY_PATCH_MESSAGE,
  MAX_LABEL_LENGTH,
  MAX_LABELS_PER_TASK,
  TASK_ID_REF_MESSAGE,
  isSingleTaskPathSegment,
} from './task-view.types';
import type { TaskMetadataPatch } from './task-view.types';

/**
 * A reference to another task: a folder name, never a path.
 *
 * Used for `taskId`, `parent`, and every entry of `duplicates`, `relatesTo`
 * and `dependsOn`.
 */
export const TaskIdRefSchema = z
  .string()
  .min(1)
  .refine(isSingleTaskPathSegment, { message: TASK_ID_REF_MESSAGE });

/**
 * One label.
 *
 * The three FR-B1.7 limits (no newline, ≤ 32 characters, ≤ 12 per task) are
 * enforced HERE and nowhere else on the write path, so the RPC, MCP and CLI
 * callers cannot disagree about what a valid label is. The READ path
 * deliberately does not re-apply them: a carrier hand-authored with a 40-char
 * label still reaches the board, carrying a warning. Rejecting on read would
 * hide the task instead of reporting the problem.
 */
export const LabelSchema = z
  .string()
  .min(1)
  .max(MAX_LABEL_LENGTH, {
    message: `a label may be at most ${MAX_LABEL_LENGTH} characters`,
  })
  .refine((value) => !/[\r\n]/.test(value), {
    message: 'a label may not contain a newline',
  })
  .refine((value) => value.trim().length > 0, {
    message: 'a label may not be blank',
  });

/**
 * The raw patch shape, exported so other boundaries can `.extend()` it onto
 * their own object rather than restate it.
 *
 * `ptah_task_update` takes a FLAT `{ taskId, ...patch }` argument object, so it
 * needs the shape rather than the assembled schema. Handing it the shape is
 * what makes drift between the RPC and MCP surfaces a compile error instead of
 * a review responsibility.
 */
export const TASK_METADATA_PATCH_SHAPE = {
  status: z.enum(TASK_STATUSES).optional(),
  labels: z
    .array(LabelSchema)
    .max(MAX_LABELS_PER_TASK, {
      message: `a task may carry at most ${MAX_LABELS_PER_TASK} labels`,
    })
    .optional(),
  estimate: z.enum(TASK_ESTIMATES).nullable().optional(),
  parent: TaskIdRefSchema.nullable().optional(),
  duplicates: z.array(TaskIdRefSchema).optional(),
  relatesTo: z.array(TaskIdRefSchema).optional(),
  dependsOn: z.array(TaskIdRefSchema).optional(),
} as const;

/**
 * True when a parsed patch actually asks for a change.
 *
 * Deliberately tests for a DEFINED value rather than merely a present key. Zod
 * keeps an explicitly-`undefined` optional key in its output, so
 * `{ labels: undefined }` has a key count of one while requesting nothing —
 * and a patch requesting nothing still reaches `updateFrontmatter`, which
 * refreshes `updated` and rewrites the carrier. That is a write to a file with
 * no undo, made on behalf of a caller who asked for no change.
 */
function patchChangesSomething(patch: Record<string, unknown>): boolean {
  return Object.values(patch).some((value) => value !== undefined);
}

/**
 * A metadata patch.
 *
 * **Every field is a FULL REPLACEMENT, never a merge.** Adding or removing one
 * label is arithmetic the caller performs on the task it already holds, then
 * sends as a whole array. That keeps the writer free of read-modify-write
 * semantics it has no way to make atomic.
 *
 * `null` (`estimate`, `parent`) and `[]` (`labels`, `duplicates`, `relatesTo`)
 * both mean REMOVE THE KEY. `dependsOn: []` is the one exception — it is still
 * written as `[]`, which is the behaviour that shipped long before this task
 * and is not "fixed" here.
 */
export const TaskMetadataPatchSchema = z
  .object(TASK_METADATA_PATCH_SHAPE)
  .refine(patchChangesSomething, { message: EMPTY_PATCH_MESSAGE });

/**
 * Compile-time proof that the schema's output still satisfies the declared
 * wire type. A field added to one and not the other fails typecheck here.
 */
export type TaskMetadataPatchParsed = z.infer<typeof TaskMetadataPatchSchema>;
const _patchShapeMatchesWireType: TaskMetadataPatch =
  {} as TaskMetadataPatchParsed;
void _patchShapeMatchesWireType;
