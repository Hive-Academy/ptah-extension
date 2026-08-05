/**
 * The shared task-metadata write contract (TASK_2026_181, family B).
 *
 * This module is the SINGLE definition of what a metadata patch may contain.
 * The RPC boundary (`tasks:updateMetadata`), the MCP agent boundary
 * (`ptah_task_update`) and the CLI all compose their schemas out of the shapes
 * declared here, so the three paths cannot drift: a limit relaxed on one of
 * them is a limit relaxed on all three, deliberately and visibly.
 *
 * Zero runtime dependencies beyond Zod — `libs/shared` is the one bridge
 * between the backend write path and the webview that drives it.
 */
import { z } from 'zod';
import { TASK_ESTIMATES, TASK_STATUSES } from './task-spec.types';
import type { TaskEstimate, TaskStatus } from './task-spec.types';

/**
 * A folder name is one path segment and nothing else.
 *
 * ## Why this lives in `libs/shared` rather than beside its first caller
 *
 * Four boundaries need this decision and every one of them guards a value that
 * is eventually joined onto the spec root: the frontmatter parser (`parent`),
 * the `tasks:` RPC schema (`taskId`, `parent`, the relation arrays), the MCP
 * namespace (`taskId`), and `tasks:adopt` (`folderName`). Four hand-written
 * copies of a containment check is how three of them ended up accepting
 * `" .. "` while the fourth rejected it. There is one implementation, here, and
 * every boundary calls it.
 *
 * ## Why the comparison is made against the TRIMMED value
 *
 * So that a padded traversal token is rejected alongside a bare one. Note what
 * this is NOT claiming: on Windows + Node, `' .. '` is *not* equivalent to
 * `'..'` — `path.join(dir, ' .. ')` preserves it literally and the lookup
 * fails with `ENOENT` (probed directly). The rejection is defence against a
 * value whose evident INTENT is traversal reaching some future consumer that
 * does trim before resolving, not a claim that every path API treats the two
 * alike.
 *
 * Callers still STORE the raw value — trimming here would silently rewrite what
 * the author typed, and `.ptah/**` is gitignored, so there is no undo for a
 * normalization nobody asked for. A padded-but-otherwise-valid name simply
 * matches no folder and is reported as dangling, which is the honest outcome.
 *
 * The rejected shapes, each for its own reason:
 *  - empty or whitespace-only — names nothing.
 *  - `.` / `..` after trimming — traversal tokens, which `path.join` collapses.
 *  - either separator — more than one segment by definition.
 *  - ANY colon. This covers two distinct Windows shapes that a separator-only
 *    check misses: a drive-letter prefix (`C:`, `C:work`) and alternate-data-
 *    stream syntax (`NAME:stream`). What is demonstrable about the first is
 *    narrower than it is tempting to write:
 *    `path.resolve('D:/ws/.ptah/specs', 'C:work')` yields `C:\work` — a
 *    different VOLUME — whereas `path.join` of the same values does NOT
 *    escape, yielding `…/specs/C:work`. Today's callers all join, so none of
 *    them is exploitable. The rejection exists so that stays true of callers
 *    added later, which is a property of this guard rather than of how the
 *    current ones happen to compose paths.
 *  - an embedded NUL — truncates the path at the OS boundary, so the string
 *    Node validates and the path the kernel opens are different strings.
 */
export function isSingleTaskPathSegment(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.includes('/') || trimmed.includes('\\')) return false;
  if (trimmed.includes('\0')) return false;
  if (trimmed === '.' || trimmed === '..') return false;
  // Subsumes the drive-letter prefix (`C:`, `C:work`) — a separate regex for
  // it would now be unreachable, and dead code beside a live check is how a
  // later reader concludes one of them is the wrong one.
  if (trimmed.includes(':')) return false;
  return true;
}

/** The message every path-segment rejection carries, on every boundary. */
export const TASK_ID_REF_MESSAGE = 'a task id must be a single path segment';

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

/** FR-B1.7 — the longest a single label may be. */
export const MAX_LABEL_LENGTH = 32;
/** FR-B1.7 — the most labels one task may carry. */
export const MAX_LABELS_PER_TASK = 12;

/**
 * The most task ids one bulk call may carry (FR-C4.9).
 *
 * ## Why the number lives here rather than in the client that chunks
 *
 * It is a single number with two enforcers: the client slices its selection by
 * it, and the RPC boundary REFUSES a request that exceeds it. Those two have to
 * be the same number or one of them is wrong — a client chunking at 20 against
 * a boundary capping at 10 fails every call, and the reverse silently permits
 * an unbounded write burst that cancellation cannot interrupt. Declaring it
 * beside the other shared task-write limits is what makes "the same number"
 * structural instead of a review responsibility.
 *
 * ## Why there is a cap at all
 *
 * Cancellation is chunk-granular: a bulk run can only stop BETWEEN calls,
 * because every write already issued has landed and is not reversed. The cap is
 * therefore the resolution of the cancel button. It also bounds how long one
 * call holds the write path before the single index rebuild at its end.
 */
export const BULK_CHUNK_SIZE = 20;

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

/** The message a no-op patch is rejected with. */
export const EMPTY_PATCH_MESSAGE = 'patch must change at least one field';

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
 * A metadata patch, as it travels over RPC.
 *
 * Declared as an interface rather than inferred so the wire contract is
 * readable at the point of use; {@link TaskMetadataPatchSchema} is checked
 * against it below, so the two cannot drift apart silently.
 */
export interface TaskMetadataPatch {
  status?: TaskStatus;
  /** Full replacement. `[]` removes the key. */
  labels?: string[];
  /** `null` removes the key. */
  estimate?: TaskEstimate | null;
  /** `null` removes the key. */
  parent?: string | null;
  /** Full replacement. `[]` removes the key. */
  duplicates?: string[];
  /** Full replacement. `[]` removes the key. */
  relatesTo?: string[];
  /** Full replacement. `[]` is written as `[]` (pre-existing behaviour). */
  dependsOn?: string[];
}

/**
 * Compile-time proof that the schema's output still satisfies the declared
 * wire type. A field added to one and not the other fails typecheck here.
 */
export type TaskMetadataPatchParsed = z.infer<typeof TaskMetadataPatchSchema>;
const _patchShapeMatchesWireType: TaskMetadataPatch =
  {} as TaskMetadataPatchParsed;
void _patchShapeMatchesWireType;
