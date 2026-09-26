/**
 * Tasks namespace builder — exposes `.ptah/specs/` to the agent as MCP tools
 * (TASK_2026_179, step 17).
 *
 * ## Why this namespace is ALWAYS ON
 *
 * It is deliberately not registered as a toggleable namespace and never appears
 * in `disabledMcpNamespaces`. The whole failure this task set exists to fix is
 * task folders going silently missing because agents wrote task metadata by
 * hand. Giving agents a real, validated write path only helps if that path is
 * present on every runtime, in every configuration — a tool an agent cannot
 * rely on being there is a tool it will route around.
 *
 * ## There is NO `set_section` tool, and that is the point
 *
 * The contract splits ownership: `task.md` is machine-owned METADATA, and
 * `context.md` and its siblings are agent-owned PROSE. This namespace can
 * therefore create a task, move its status, and read it back — and it has no
 * ability whatsoever to write prose into the carrier. A section-writing tool
 * would collapse that boundary in one step: it would put agent narrative onto
 * the exact file the Tasks board mutates, which is how the original
 * lost-status bug happens. Agents write prose with their ordinary file tools,
 * into `context.md`, where nothing else is writing.
 *
 * ## Degradation
 *
 * Every collaborator is resolved through a lazy getter and every method
 * degrades to a typed `{ error }` result rather than throwing, so a host
 * without the task-spec services registered reports the fact instead of
 * killing the tool call. Same shape as `memory-namespace.builder.ts`.
 */

import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { z } from 'zod';
import {
  LabelSchema,
  TASK_METADATA_PATCH_SHAPE,
  TaskIdRefSchema,
} from '@ptah-extension/shared/schemas';
import {
  CONTEXT_FILE,
  MAX_LABELS_PER_TASK,
  TASK_ESTIMATES,
  TASK_STATUSES,
  TASK_TYPES,
  buildTaskGraph,
  filterTasks,
  mergeStatusTypeFacets,
  type ExcludedTaskFolder,
  type TaskChildRollup,
  type TaskEstimate,
  type TaskMetadataPatch,
  type TaskSpecDetail,
  type TaskSpecSummary,
  type TaskStatus,
  type TaskType,
} from '@ptah-extension/shared';

// ---------------------------------------------------------------------------
// Narrow structural collaborators
// ---------------------------------------------------------------------------
//
// Declared here as the minimum surface this namespace actually calls, rather
// than importing the concrete service classes. Same reasoning as
// `harness-namespace.builder.ts`: it keeps the builder unit-testable without a
// DI container, and it keeps the coupling to `task-specs` at exactly one site
// (`ptah-api-builder.service.ts`, which does the injecting).

/** The subset of `TaskWriterService` this namespace uses. */
export interface TaskSpecWriterLike {
  create(
    workspaceRoot: string,
    input: {
      title: string;
      type: TaskType;
      description?: string;
      dependsOn?: string[];
      executor?: string;
      /**
       * Optional metadata written at creation time.
       *
       * This path never dropped them at the CALL: `create` forwards the whole
       * parsed args object, so the five fields were already arriving. They
       * were discarded one layer down, by `TaskWriterService.create`, which
       * did not map them into `renderTaskMd`. Declaring them here makes the
       * collaborator type say what the schema and the writer now both agree
       * on, rather than staying silent about fields it forwards.
       */
      labels?: readonly string[];
      estimate?: TaskEstimate;
      parent?: string;
      duplicates?: readonly string[];
      relatesTo?: readonly string[];
    },
  ): Promise<
    | { success: true; task: TaskSpecSummary }
    | { success: false; error: { code: string; message: string } }
  >;
  /**
   * The single metadata write. `update` routes through this for STATUS too, so
   * an agent moving a status and an agent adding a label share one conflict
   * domain rather than two divergent write paths.
   */
  updateMetadata(
    workspaceRoot: string,
    taskId: string,
    patch: TaskMetadataPatch,
  ): Promise<
    | { success: true; task: TaskSpecSummary }
    | { success: false; error: { code: string; message: string } }
  >;
}

/** The subset of `TaskIndexService` this namespace uses. */
export interface TaskSpecIndexLike {
  ensureStarted(workspaceRoot: string): Promise<void>;
  list(
    workspaceRoot: string,
    filters?: { status?: TaskStatus[]; type?: TaskType[] },
  ): Promise<{
    tasks: TaskSpecSummary[];
    excluded: ExcludedTaskFolder[];
    excludedCount: number;
    specsDirExists: boolean;
  }>;
  getDetail(
    workspaceRoot: string,
    taskId: string,
  ): Promise<TaskSpecDetail | null>;
}

export interface TasksNamespaceDependencies {
  getWriter: () => TaskSpecWriterLike | undefined;
  getIndex: () => TaskSpecIndexLike | undefined;
  getWorkspaceRoot: () => string;
}

// ---------------------------------------------------------------------------
// Zod boundary — these args arrive as untrusted JSON from an agent
// ---------------------------------------------------------------------------

const statusEnum = z.enum(TASK_STATUSES);
const typeEnum = z.enum(TASK_TYPES);
const estimateEnum = z.enum(TASK_ESTIMATES);

/**
 * `taskId` is a FOLDER NAME and gets joined onto `.ptah/specs` before a write.
 * Constraining it to a single path segment is a containment guarantee, not
 * cosmetics: a `..` or a separator would let a tool call steer that write
 * anywhere on disk.
 *
 * This is the SHARED guard, not a local restatement. The previous local check
 * tested only `'/'`, `'\\'` and an exact `'..'`, so `" .. "`, `"   "`, `"C:"`,
 * the drive-relative `"C:NAME"` and an embedded NUL all passed it — while the
 * frontmatter parser's guard over the same class of value rejected every one.
 * An agent is exactly the caller that produces those shapes.
 */
const taskIdSchema = TaskIdRefSchema;

export const TaskCreateArgsSchema = z.object({
  title: z.string().min(1),
  type: typeEnum,
  description: z.string().optional(),
  dependsOn: z.array(z.string().min(1)).optional(),
  executor: z.string().optional(),
  /**
   * Optional metadata. `labels` uses the SHARED `LabelSchema` and its
   * per-task cap so an agent creating a task cannot bypass limits that
   * `ptah_task_update` would enforce a second later; every relation value
   * reuses `taskIdSchema` for the same containment reason it exists for
   * `taskId` — these are folder names, and an agent is exactly the kind of
   * caller that will hand back a path.
   */
  labels: z.array(LabelSchema).max(MAX_LABELS_PER_TASK).optional(),
  estimate: estimateEnum.optional(),
  parent: taskIdSchema.optional(),
  duplicates: z.array(taskIdSchema).optional(),
  relatesTo: z.array(taskIdSchema).optional(),
});

/**
 * `ptah_task_update` — status OR metadata, in one call, one conflict domain.
 *
 * The patch half is `.extend`ed from the shared shape rather than restated, so
 * this tool and `tasks:updateMetadata` cannot enforce different limits. The
 * argument object stays FLAT (`{ taskId, status, labels, … }`) because that is
 * the shape agents already call it with; nesting the patch would break every
 * existing call for no gain.
 *
 * The refinement is what keeps `status` from silently becoming optional: an
 * update naming only a `taskId` used to be a type error and must stay a
 * rejection, not a write that refreshes `updated` and changes nothing.
 */
export const TaskUpdateArgsSchema = z
  .object({ taskId: taskIdSchema })
  .extend(TASK_METADATA_PATCH_SHAPE)
  .refine(
    (args) =>
      Object.entries(args).some(
        ([key, value]) => key !== 'taskId' && value !== undefined,
      ),
    { message: 'give at least one field to change (status, labels, …)' },
  );

export const TaskGetArgsSchema = z.object({ taskId: taskIdSchema });

/** Rows per `ptah_task_list` page when the agent names no `limit`. */
export const TASK_LIST_DEFAULT_LIMIT = 25;
/** The largest page an agent may ask for. */
export const TASK_LIST_MAX_LIMIT = 200;
/** Entries shown per list in `ptah_task_check`; the totals count the rest. */
export const TASK_CHECK_ENTRY_CAP = 50;

/**
 * `ptah_task_list` arguments. An unbounded list returned 223,297 characters
 * for 235 tasks live, so the page is bounded by default and the per-row
 * `description` is opt-in (`fields: 'full'`).
 *
 * `cursor` is opaque to the agent. Its shape (length, alphabet, payload) is
 * checked by {@link decodeListCursor}, not here, so every bad cursor gets the
 * one INVALID_CURSOR refusal rather than a generic argument error.
 */
export const TaskListArgsSchema = z.object({
  status: z.array(statusEnum).optional(),
  type: z.array(typeEnum).optional(),
  limit: z
    .number()
    .int()
    .min(1)
    .max(TASK_LIST_MAX_LIMIT)
    .default(TASK_LIST_DEFAULT_LIMIT),
  cursor: z.string().optional(),
  fields: z.enum(['summary', 'full']).default('summary'),
});

/**
 * Longest cursor string accepted. Every field of a minted cursor is fixed
 * width (the anchor id is carried as a hash, never verbatim), so a minted
 * cursor stays near 140 chars whatever the folder name — well inside this.
 */
const TASK_LIST_CURSOR_MAX_LENGTH = 512;

const hex16 = z.string().regex(/^[0-9a-f]{16}$/);

/**
 * The decoded cursor, every field fixed-width:
 * - `c`: the anchor row's `created` instant in epoch ms, or null when undated;
 * - `a`: a hash of the anchor row's id (the last row the previous page gave);
 * - `h`: a fingerprint of the ids sharing `c` that sort at or before the
 *   anchor, over the UNFILTERED task list;
 * - `s`: an HMAC over the other fields with a per-process key, so only a
 *   cursor this process issued is accepted.
 * `v` versions the encoding so a cursor of another format is refused.
 */
const TaskListCursorSchema = z
  .object({
    v: z.literal(3),
    c: z
      .number()
      .int()
      .min(-8_640_000_000_000_000)
      .max(8_640_000_000_000_000)
      .nullable(),
    a: hex16,
    h: hex16,
    s: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  })
  .strict();

/**
 * Signs cursors. Per process: a cursor survives any number of calls to the
 * same host but not a restart (it is then refused with INVALID_CURSOR and the
 * agent restarts the walk) — the price of an opaque, stateless token with no
 * issued-cursor table to grow or expire.
 */
const CURSOR_SIGNING_KEY = randomBytes(32);

type TaskListCursor = z.infer<typeof TaskListCursorSchema>;

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export type TaskMutationResult =
  | { ok: true; task: TaskSpecSummary; note?: string }
  | { ok: false; error: string; code?: string };

/**
 * The relations a task did not author, plus its child rollup.
 *
 * Handed to the agent alongside the task so it never has to do graph maths
 * over `ptah_task_list` output to answer "what blocks this?" or "how many of
 * its children are done?". Everything here is DERIVED and recomputed on every
 * read — none of it is a frontmatter key, and writing one back would create a
 * second authored side that can disagree with the first.
 */
export interface TaskDerivedRelations {
  /** Tasks whose honoured `parent` is this task, id-sorted. */
  children: string[];
  /** Counts over {@link children}. Absent when the task has none. */
  childRollup?: TaskChildRollup;
  /** The parent claim that was actually honoured, if any. */
  effectiveParent?: string;
  /** Tasks that declare a `depends_on` on this one. */
  blocks: string[];
  /** Tasks that declare this one a duplicate. */
  duplicatedBy: string[];
  /** Symmetric closure of `relates_to`: authored first, then derived. */
  related: string[];
  /** This task's `depends_on` entries that are neither done nor cancelled. */
  unmetDependencies: string[];
}

export type TaskGetResult =
  | { ok: true; task: TaskSpecDetail; derived: TaskDerivedRelations }
  | { ok: false; error: string; code?: string };

/**
 * One `fields: 'summary'` row: enough to pick a task, reuse a label or find
 * the newest id. Dropped relative to {@link TaskSpecSummary}: `description`
 * (most of the bytes), `folderName` (always equal to `id`), and
 * `validationIssues` (`frontmatterValid: false` still flags a task that has
 * any; `ptah_task_get` and `ptah_task_check` carry them). Optional metadata
 * appears only when set, relation arrays only when non-empty, and
 * `frontmatterValid` only when false — 25 rows must fit the 8k-char default
 * budget (User Decision 2), and a `true` on every row spends ~600 of it.
 */
export interface TaskListSummaryRow {
  id: string;
  status: TaskStatus;
  type: TaskType | null;
  title: string;
  labels: string[];
  estimate?: TaskEstimate;
  parent?: string;
  executor?: string;
  dependsOn?: string[];
  duplicates?: string[];
  relatesTo?: string[];
  created: string | null;
  updated: string | null;
  frontmatterValid?: false;
}

/**
 * Stands in for a row that does not fit the result budget even alone (a
 * very long description under `fields: 'full'`), so paging still advances.
 */
export interface TaskListOversizedRow {
  id: string;
  oversized: true;
}

interface TaskListPageCommon {
  ok: true;
  /** Rows on this page — may be under `limit` when the budget is reached. */
  count: number;
  /** Tasks matching the filters, across all pages. */
  total: number;
  /** Present when more rows follow; pass it back as `cursor`. */
  nextCursor?: string;
  /** Present only when the page holds a {@link TaskListOversizedRow}. */
  note?: string;
  excludedCount: number;
  specsDirExists: boolean;
}

export type TaskListResult =
  | (TaskListPageCommon &
      (
        | {
            fields: 'summary';
            tasks: Array<TaskListSummaryRow | TaskListOversizedRow>;
          }
        | {
            fields: 'full';
            tasks: Array<TaskSpecSummary | TaskListOversizedRow>;
          }
      ))
  | { ok: false; error: string; code?: string };

/**
 * A health report for the whole spec tree.
 *
 * `excluded` carries skipped folders BY NAME with their typed reason. A bare
 * count is what made these folders invisible in the first place — the agent
 * running `check` needs to know WHICH folder and WHY to do anything about it.
 *
 * Both lists are capped at {@link TASK_CHECK_ENTRY_CAP} entries so a badly
 * broken tree cannot flood the caller; `invalidTotal` / `excludedTotal` give
 * the full counts, and `healthy` is decided on the full set, never the page.
 */
export type TaskCheckResult =
  | {
      ok: true;
      healthy: boolean;
      taskCount: number;
      excluded: ExcludedTaskFolder[];
      excludedTotal: number;
      invalid: Array<{
        taskId: string;
        issues: Array<{ field: string; code: string; message: string }>;
      }>;
      invalidTotal: number;
      specsDirExists: boolean;
    }
  | { ok: false; error: string };

/**
 * How the caller will deliver a page. The MCP dispatcher passes its
 * result-budget test, so a page holds only as many WHOLE rows as survive the
 * budget step unchanged; without it (`execute_code`), `limit` alone bounds
 * the page.
 */
export interface TaskListOptions {
  fits?: (text: string) => boolean;
}

export interface TasksNamespace {
  create(args: unknown): Promise<TaskMutationResult>;
  update(args: unknown): Promise<TaskMutationResult>;
  get(args: unknown): Promise<TaskGetResult>;
  list(args?: unknown, options?: TaskListOptions): Promise<TaskListResult>;
  check(): Promise<TaskCheckResult>;
}

/**
 * Project one task's derived relations out of the shared graph.
 *
 * Arrays are copied out of the graph's readonly maps because the result
 * crosses a tool boundary and is JSON-serialized by the caller; handing out
 * the graph's own arrays would let a consumer mutate a structure the next read
 * rebuilds from scratch anyway.
 */
function deriveFor(
  tasks: readonly TaskSpecSummary[],
  taskId: string,
): TaskDerivedRelations {
  const graph = buildTaskGraph(tasks);
  const rollup = graph.rollup.get(taskId);
  return {
    children: [...(graph.children.get(taskId) ?? [])],
    ...(rollup === undefined ? {} : { childRollup: rollup }),
    ...(graph.effectiveParent.has(taskId)
      ? { effectiveParent: graph.effectiveParent.get(taskId) }
      : {}),
    blocks: [...(graph.blocks.get(taskId) ?? [])],
    duplicatedBy: [...(graph.duplicatedBy.get(taskId) ?? [])],
    related: [...(graph.related.get(taskId) ?? [])],
    unmetDependencies: [...(graph.unmetDependencies.get(taskId) ?? [])],
  };
}

/** Render a Zod failure as one readable line for the agent. */
function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

// ---------------------------------------------------------------------------
// ptah_task_list paging
// ---------------------------------------------------------------------------
//
// Order: newest `created` INSTANT first (parsed, so `+02:00` and `Z` spellings
// compare as the times they are), undated rows last, ties broken by `id` — a
// TOTAL order because `id` is the folder name and therefore unique. The
// namespace sorts itself rather than trusting the index's order, so paging
// does not depend on which store backs the index.
//
// The cursor is keyset, not an offset: it names the last row returned, and the
// next page is every matching row that sorts strictly after it. An offset
// would skip a row whenever an earlier one was deleted; a keyset does not.
//
// Identity is checked on the UNFILTERED list, read once per call; the status
// and type filters are applied afterwards with the shared `filterTasks`. So a
// returned task that stops matching the filter (a backlog task completed
// mid-walk) changes nothing the cursor depends on, and the walk continues.
//
// The one mutable part of the key is `id`: renaming a folder changes it. A
// rename keeps `created`, so it can only move a row WITHIN its own
// same-instant group — and only the cursor's own group straddles the page
// boundary. The cursor therefore carries `h`, a fingerprint of that group's
// ids at or before the anchor. If one of them was renamed, added or removed,
// or the anchor itself is gone, the call is refused with INVALID_CURSOR
// instead of silently skipping or repeating a row. Guarantees, pinned by spec:
//  - no row is returned twice across one walk, and no row that existed for
//    the whole walk is skipped: a rename across the boundary is refused;
//  - changes in any other group need no check — a renamed row stays in its
//    group, entirely before or entirely after the cursor;
//  - a status/type change never invalidates the cursor;
//  - a task added mid-walk appears only if it sorts after the cursor (a new
//    task, being newest, normally sorts before it and is not shown);
//  - a cursor past the last matching row yields an empty page, no nextCursor;
//  - an altered or fabricated cursor fails the HMAC and is refused.
// Residual: `created` is not writable through `ptah_task_update`; hand-editing
// it mid-walk can move that one row across the cursor.

type ListSortKey = { at: number | null; id: string };

/** Epoch ms of a `created` value, or null when absent or unparseable. */
function instantOf(created: string | null): number | null {
  if (created === null) return null;
  const at = Date.parse(created);
  return Number.isNaN(at) ? null : at;
}

function compareListKeys(a: ListSortKey, b: ListSortKey): number {
  if (a.at !== b.at) {
    if (a.at === null) return 1;
    if (b.at === null) return -1;
    return a.at < b.at ? 1 : -1;
  }
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

interface KeyedTask {
  key: ListSortKey;
  task: TaskSpecSummary;
}

function hash16(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/**
 * Fingerprint of the rows in the UNFILTERED `all` that share `key`'s instant
 * and sort at or before it: the part of the cursor's group already passed.
 */
function groupFingerprint(all: readonly KeyedTask[], key: ListSortKey): string {
  return hash16(
    all
      .filter((row) => row.key.at === key.at && row.key.id <= key.id)
      .map((row) => row.key.id)
      .join('\n'),
  );
}

function signCursor(c: number | null, a: string, h: string): string {
  return createHmac('sha256', CURSOR_SIGNING_KEY)
    .update(`3|${c === null ? '-' : String(c)}|${a}|${h}`)
    .digest('base64url')
    .slice(0, 22);
}

function encodeListCursor(all: readonly KeyedTask[], key: ListSortKey): string {
  const a = hash16(key.id);
  const h = groupFingerprint(all, key);
  const cursor: TaskListCursor = {
    v: 3,
    c: key.at,
    a,
    h,
    s: signCursor(key.at, a, h),
  };
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/**
 * The anchor row of a verified cursor in the current UNFILTERED list, or
 * null when the anchor is gone or its group changed around it.
 */
function resolveAnchor(
  all: readonly KeyedTask[],
  cursor: TaskListCursor,
): ListSortKey | null {
  const anchor = all.find(
    (row) => row.key.at === cursor.c && hash16(row.key.id) === cursor.a,
  );
  if (anchor === undefined) return null;
  return groupFingerprint(all, anchor.key) === cursor.h ? anchor.key : null;
}

/**
 * Decode a cursor this process issued, or `null` for anything else:
 * malformed, altered, fabricated, or signed by an earlier process.
 */
function decodeListCursor(raw: string): TaskListCursor | null {
  if (
    raw.length === 0 ||
    raw.length > TASK_LIST_CURSOR_MAX_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(raw)
  ) {
    return null;
  }
  const bytes = Buffer.from(raw, 'base64url');
  // Canonical only: Node's decoder skips characters it cannot read, so a
  // corrupted cursor could otherwise decode to a neighbouring valid one.
  if (bytes.toString('base64url') !== raw) return null;
  let json: unknown;
  try {
    json = JSON.parse(bytes.toString('utf8'));
  } catch {
    // degradation-audit: reported — not base64url JSON at all; `list` turns
    // this null into an INVALID_CURSOR tool error. The parser's message adds
    // nothing an agent can act on.
    return null;
  }
  const parsed = TaskListCursorSchema.safeParse(json);
  if (!parsed.success) return null;
  const { c, a, h, s: signature } = parsed.data;
  const expected = Buffer.from(signCursor(c, a, h), 'utf8');
  const given = Buffer.from(signature, 'utf8');
  // `timingSafeEqual` throws on unequal lengths; a length mismatch is simply
  // a wrong signature.
  return expected.length === given.length && timingSafeEqual(expected, given)
    ? parsed.data
    : null;
}

/** Largest `n` in `[0, max]` with `fits(n)` (`fits` monotone; `fits(0)` untested). */
function largestFitting(max: number, fits: (n: number) => boolean): number {
  let low = 0;
  let high = max;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(middle)) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
}

const INVALID_CURSOR_MESSAGE =
  'cursor is not usable: it was not returned by this tool, was altered, or ' +
  'the tasks around its position were renamed, added or removed since. ' +
  'omit cursor to restart at the first page.';

const OVERSIZED_ROW_NOTE =
  'A row too large for one response is shown as { id, oversized: true }; ' +
  'read it with ptah_task_get.';

function toSummaryRow(task: TaskSpecSummary): TaskListSummaryRow {
  return {
    id: task.id,
    status: task.status,
    type: task.type,
    title: task.title,
    labels: task.labels,
    ...(task.estimate === undefined ? {} : { estimate: task.estimate }),
    ...(task.parent === undefined ? {} : { parent: task.parent }),
    ...(task.executor === undefined ? {} : { executor: task.executor }),
    ...(task.dependsOn.length > 0 ? { dependsOn: task.dependsOn } : {}),
    ...(task.duplicates.length > 0 ? { duplicates: task.duplicates } : {}),
    ...(task.relatesTo.length > 0 ? { relatesTo: task.relatesTo } : {}),
    created: task.created,
    updated: task.updated,
    ...(task.frontmatterValid ? {} : { frontmatterValid: false as const }),
  };
}

export function buildTasksNamespace(
  deps: TasksNamespaceDependencies,
): TasksNamespace {
  /**
   * Resolve the collaborators plus a workspace root, or explain what is
   * missing. Warming the index here (rather than per-method) keeps the derived
   * board in step with a write the agent is about to make.
   */
  const ready = async (): Promise<
    | {
        ok: true;
        root: string;
        writer?: TaskSpecWriterLike;
        index?: TaskSpecIndexLike;
      }
    | { ok: false; error: string }
  > => {
    const root = deps.getWorkspaceRoot();
    if (!root) {
      return { ok: false, error: 'No workspace is open.' };
    }
    const index = deps.getIndex();
    if (index) {
      try {
        await index.ensureStarted(root);
      } catch {
        // A cold index is not a reason to refuse a write — the file is the
        // source of truth and the writer notifies the index itself.
      }
    }
    return { ok: true, root, writer: deps.getWriter(), index };
  };

  const failure = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

  return {
    async create(args: unknown): Promise<TaskMutationResult> {
      const parsed = TaskCreateArgsSchema.safeParse(args ?? {});
      if (!parsed.success) {
        return {
          ok: false,
          error: formatZodError(parsed.error),
          code: 'INVALID_ARGS',
        };
      }
      const context = await ready();
      if (!context.ok) return { ok: false, error: context.error };
      if (!context.writer) {
        return {
          ok: false,
          error: 'Task specs are not available on this runtime.',
        };
      }
      try {
        const result = await context.writer.create(context.root, parsed.data);
        if (!result.success) {
          return {
            ok: false,
            error: result.error.message,
            code: result.error.code,
          };
        }
        return {
          ok: true,
          task: result.task,
          note:
            `Folder created with a metadata-only carrier. Write the background, ` +
            `plan and discussion to ${CONTEXT_FILE} in the same folder — never ` +
            `into the carrier.`,
        };
      } catch (error: unknown) {
        return { ok: false, error: failure(error) };
      }
    },

    async update(args: unknown): Promise<TaskMutationResult> {
      const parsed = TaskUpdateArgsSchema.safeParse(args ?? {});
      if (!parsed.success) {
        return {
          ok: false,
          error: formatZodError(parsed.error),
          code: 'INVALID_ARGS',
        };
      }
      const context = await ready();
      if (!context.ok) return { ok: false, error: context.error };
      if (!context.writer) {
        return {
          ok: false,
          error: 'Task specs are not available on this runtime.',
        };
      }
      const { taskId, ...patch } = parsed.data;
      try {
        const result = await context.writer.updateMetadata(
          context.root,
          taskId,
          patch,
        );
        if (!result.success) {
          // TASK_CONFLICT arrives here when somebody else changed the carrier
          // between our read and our write. It is RETRYABLE and the message
          // says so — the agent should re-read rather than force the write.
          return {
            ok: false,
            error: result.error.message,
            code: result.error.code,
          };
        }
        return { ok: true, task: result.task };
      } catch (error: unknown) {
        return { ok: false, error: failure(error) };
      }
    },

    async get(args: unknown): Promise<TaskGetResult> {
      const parsed = TaskGetArgsSchema.safeParse(args ?? {});
      if (!parsed.success) {
        return {
          ok: false,
          error: formatZodError(parsed.error),
          code: 'INVALID_ARGS',
        };
      }
      const context = await ready();
      if (!context.ok) return { ok: false, error: context.error };
      if (!context.index) {
        return {
          ok: false,
          error: 'Task specs are not available on this runtime.',
        };
      }
      try {
        const task = await context.index.getDetail(
          context.root,
          parsed.data.taskId,
        );
        if (!task) {
          return {
            ok: false,
            code: 'TASK_NOT_FOUND',
            error: `No task '${parsed.data.taskId}'. It may have no carrier — run the spec doctor to see skipped folders.`,
          };
        }
        // The derived block is computed from the SAME `buildTaskGraph` the
        // board runs, so an agent and a human reading the same workspace never
        // see two different answers about who blocks whom.
        const { tasks } = await context.index.list(context.root);
        return {
          ok: true,
          task,
          derived: deriveFor(tasks, parsed.data.taskId),
        };
      } catch (error: unknown) {
        return { ok: false, error: failure(error) };
      }
    },

    async list(
      args?: unknown,
      options?: TaskListOptions,
    ): Promise<TaskListResult> {
      const parsed = TaskListArgsSchema.safeParse(args ?? {});
      if (!parsed.success) {
        return {
          ok: false,
          error: formatZodError(parsed.error),
          code: 'INVALID_ARGS',
        };
      }
      const { status, type, limit, cursor, fields } = parsed.data;
      // Decoded before any index work: a malformed cursor is refused outright,
      // never silently treated as "start at the first page".
      const after = cursor === undefined ? undefined : decodeListCursor(cursor);
      if (after === null) {
        return {
          ok: false,
          code: 'INVALID_CURSOR',
          error: INVALID_CURSOR_MESSAGE,
        };
      }
      const context = await ready();
      if (!context.ok) return { ok: false, error: context.error };
      if (!context.index) {
        return {
          ok: false,
          error: 'Task specs are not available on this runtime.',
        };
      }
      try {
        // ONE unfiltered read: cursor identity is checked against every task,
        // so a status/type change never invalidates a cursor, and the page is
        // filtered from the same snapshot with the shared predicate the store
        // itself runs (`mergeStatusTypeFacets` + `filterTasks`).
        const result = await context.index.list(context.root);
        const all: KeyedTask[] = result.tasks
          .map((task) => ({
            key: { at: instantOf(task.created), id: task.id },
            task,
          }))
          .sort((a, b) => compareListKeys(a.key, b.key));
        const spec = mergeStatusTypeFacets(undefined, status, type);
        const matching = new Set(
          spec === null ? [] : filterTasks(result.tasks, spec).map((t) => t.id),
        );
        const ordered = all.filter((row) => matching.has(row.key.id));
        let remaining = ordered;
        if (after !== undefined) {
          const cursorKey = resolveAnchor(all, after);
          if (cursorKey === null) {
            return {
              ok: false,
              code: 'INVALID_CURSOR',
              error: INVALID_CURSOR_MESSAGE,
            };
          }
          remaining = ordered.filter(
            (row) => compareListKeys(row.key, cursorKey) > 0,
          );
        }

        const render = (
          count: number,
          oversized = false,
        ): Extract<TaskListResult, { ok: true }> => {
          const rows = remaining.slice(0, count);
          const last = rows[rows.length - 1];
          const common: TaskListPageCommon = {
            ok: true,
            count: rows.length,
            total: ordered.length,
            ...(remaining.length > count && last !== undefined
              ? { nextCursor: encodeListCursor(all, last.key) }
              : {}),
            ...(oversized ? { note: OVERSIZED_ROW_NOTE } : {}),
            excludedCount: result.excludedCount,
            specsDirExists: result.specsDirExists,
          };
          if (oversized && last !== undefined) {
            // The row alone is over the budget: a fixed-size stub, so paging
            // still advances past it.
            const stub: TaskListOversizedRow = {
              id: last.key.id,
              oversized: true,
            };
            return { ...common, fields, tasks: [stub] };
          }
          const tasks = rows.map((row) => row.task);
          return fields === 'full'
            ? { ...common, fields, tasks }
            : { ...common, fields, tasks: tasks.map(toSummaryRow) };
        };

        const upTo = Math.min(limit, remaining.length);
        const fits = options?.fits;
        if (fits === undefined || fits(JSON.stringify(render(upTo)))) {
          return render(upTo);
        }
        // Only as many WHOLE rows as the budget step will pass unchanged, so
        // it never cuts inside a row while `nextCursor` points past it.
        const kept = largestFitting(upTo - 1, (count) =>
          fits(JSON.stringify(render(count))),
        );
        return kept > 0 ? render(kept) : render(1, true);
      } catch (error: unknown) {
        return { ok: false, error: failure(error) };
      }
    },

    async check(): Promise<TaskCheckResult> {
      const context = await ready();
      if (!context.ok) return { ok: false, error: context.error };
      if (!context.index) {
        return {
          ok: false,
          error: 'Task specs are not available on this runtime.',
        };
      }
      try {
        const result = await context.index.list(context.root);
        const invalid = result.tasks
          .filter((task) => task.validationIssues.length > 0)
          .map((task) => ({
            taskId: task.id,
            issues: task.validationIssues.map((issue) => ({
              field: issue.field,
              code: issue.code,
              message: issue.message,
            })),
          }));
        return {
          ok: true,
          // Decided on the FULL lists, before either is capped.
          healthy: invalid.length === 0 && result.excluded.length === 0,
          taskCount: result.tasks.length,
          excluded: result.excluded.slice(0, TASK_CHECK_ENTRY_CAP),
          excludedTotal: result.excluded.length,
          invalid: invalid.slice(0, TASK_CHECK_ENTRY_CAP),
          invalidTotal: invalid.length,
          specsDirExists: result.specsDirExists,
        };
      } catch (error: unknown) {
        return { ok: false, error: failure(error) };
      }
    },
  };
}
