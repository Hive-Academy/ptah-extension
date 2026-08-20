/**
 * Task-spec plain types (TASK_2026_157).
 *
 * Framework-agnostic shapes shared by the backend `task-specs` lib and the
 * frontend `tasks-ui` lib. NO Zod, NO file I/O here — the Zod schema lives at
 * the file boundary in `@ptah-extension/task-specs` (`task-frontmatter.ts`).
 *
 * The `.ptah/specs/TASK_YYYY_NNN/task.md` frontmatter is the source of truth;
 * folders without a valid `task.md` are EXCLUDED (no inference, no legacy
 * emoji parsing) per the phase-1 no-legacy decision.
 */

export const TASK_STATUSES = [
  'backlog',
  'in_progress',
  'in_review',
  'blocked',
  'done',
  'cancelled',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_TYPES = [
  'FEATURE',
  'BUGFIX',
  'REFACTORING',
  'DOCUMENTATION',
  'RESEARCH',
  'DEVOPS',
  'SAAS_INIT',
  'CREATIVE',
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

/**
 * T-shirt sizes, smallest first.
 *
 * **The tuple order IS the sort order.** There is deliberately no numeric
 * mapping anywhere in the codebase: the moment `M` becomes `3`, somebody sums a
 * column and reports a sprint total, and a size that was only ever a rough
 * relative signal starts being read as a commitment. Sorting by index gives the
 * ordering the board needs and nothing else.
 */
export const TASK_ESTIMATES = ['XS', 'S', 'M', 'L', 'XL'] as const;
export type TaskEstimate = (typeof TASK_ESTIMATES)[number];

/**
 * A non-fatal problem with an otherwise-included task's frontmatter.
 * Warnings never exclude the task — the folder still enters the board/index.
 */
export interface TaskValidationIssue {
  field: string;
  code:
    | 'id_mismatch'
    | 'invalid_type'
    | 'invalid_date'
    | 'invalid_depends_on'
    /**
     * A `depends_on` entry naming a task folder that does not exist.
     *
     * Distinct from `invalid_depends_on`, which means the field is the wrong
     * SHAPE. This one is well-formed but points at nothing — usually a typo, a
     * folder that was renamed, or a dependency declared before its task was
     * created. It is a warning: the task stays included, because a broken
     * pointer is no reason to hide the task holding it.
     */
    | 'dangling_depends_on'
    /** `estimate` is present but is not one of {@link TASK_ESTIMATES}. */
    | 'invalid_estimate'
    /**
     * `labels` is the wrong SHAPE (not an array of strings), or an entry
     * violates a per-label limit. The field degrades to `[]` on a shape
     * failure; entries that merely exceed a limit are kept verbatim, because
     * the READ boundary warns while only the WRITE boundary rejects.
     */
    | 'invalid_labels'
    /** `parent` is not a string, or is not a single path segment. */
    | 'invalid_parent'
    /** `parent` names a folder that does not exist under the spec root. */
    | 'dangling_parent'
    /**
     * The task's parent chain closes on itself. Emitted for the self-parent
     * case by the single-file parser, and for multi-node cycles by the
     * scanner's cross-file pass — both mean the same thing to a reader.
     */
    | 'parent_cycle'
    /**
     * This task declares a parent that itself declares a parent. Parentage is
     * ONE level deep by design; the warning lands on the task making the
     * invalid claim, and both tasks stay on the board.
     */
    | 'parent_depth_exceeded'
    /** `duplicates` / `relates_to` is the wrong shape; `field` names which. */
    | 'invalid_relation'
    /**
     * A well-formed relation entry pointing at nothing — a self-reference, or
     * a folder that does not exist. Same reasoning as `dangling_depends_on`:
     * a broken pointer is no reason to hide the task holding it.
     */
    | 'dangling_relation'
    | 'schema_issue';
  message: string;
  /**
   * The offending ENTRY this issue is about, for the codes that name one:
   * `dangling_depends_on`, `dangling_relation`, `dangling_parent`,
   * `parent_cycle`, `parent_depth_exceeded`. Absent for every other code.
   *
   * ## Why this exists rather than parsing it back out of `message`
   *
   * `duplicates` and `relates_to` are ARRAYS, so one field can carry several
   * bad entries and produce several issues that agree on `field` and `code` and
   * differ only in which entry they are about. Two passes report on those
   * arrays — the per-file parser, which knows which FOLDERS exist, and the
   * cross-file graph, which knows which folders became readable TASKS — and the
   * scanner has to fold the second into the first without restating what the
   * first already said. Identifying a finding by `(code, field)` alone is not
   * enough to do that: it cannot tell "the parser already reported this exact
   * entry" from "the parser reported a DIFFERENT entry under the same field",
   * and collapsing the two silently discards a real warning that has no other
   * route to the board.
   *
   * The message is not usable as that identity. It is prose, it is worded
   * differently by each pass on purpose, and keying on it would make the
   * de-duplication fail the moment either sentence is edited.
   *
   * This is DERIVED data. It is never written to frontmatter — nothing in the
   * emitter reads `validationIssues` — and it needs no index column, because
   * the whole array is persisted as one JSON blob.
   */
  ref?: string;
}

/** Summary row — what list/board return and what the index stores. */
export interface TaskSpecSummary {
  /** Canonical id — ALWAYS the folder name (C1: folder name wins on mismatch). */
  id: string;
  folderName: string;
  status: TaskStatus;
  /** null when frontmatter `type` failed validation (warning, not exclusion). */
  type: TaskType | null;
  title: string;
  description?: string;
  /** reserved, phase 2. */
  assignee?: string;
  dependsOn: string[];
  executor?: string;
  /**
   * Free-text labels, in authored order. ALWAYS an array — absent, malformed
   * and empty all collapse to `[]` so no consumer has to null-check it.
   *
   * Matching is case- and whitespace-insensitive (see `labelKey`), but the
   * authored text is what gets stored and rendered: normalizing on read would
   * silently rewrite what the author typed.
   */
  labels: string[];
  /** T-shirt size. Absent or unrecognised ⇒ `undefined` (warning, not error). */
  estimate?: TaskEstimate;
  /**
   * Folder name of the parent task, AS DECLARED. Single-valued, ONE level deep.
   *
   * A self-parent or a parent naming a folder that does not exist is kept here
   * verbatim and reported in `validationIssues` — the declared value is the
   * only evidence of what the author meant, and the derived graph is what
   * decides whether the claim is honoured. The single exception is a value that
   * is not a path segment at all (`..`, anything with a separator): that is
   * cleared, because it is a folder name headed for a path join.
   */
  parent?: string;
  /** Task folders this one duplicates. Always an array; see `labels`. */
  duplicates: string[];
  /**
   * Loosely-related task folders. The relation is symmetric in the DERIVED
   * graph but authored on one side only — there is no inverse key to keep in
   * sync, and therefore no way for the two sides to disagree on disk.
   */
  relatesTo: string[];
  /** ISO 8601; null when unparseable (warning). */
  created: string | null;
  updated: string | null;
  /** true = zero validation issues. */
  frontmatterValid: boolean;
  validationIssues: TaskValidationIssue[];
}

/** Detail shape — summary plus the markdown body and folder artifact list. */
export interface TaskSpecDetail extends TaskSpecSummary {
  /** markdown body of task.md (below the frontmatter block). */
  body: string;
  /** filenames present in the folder (context.md, tasks.md, ...). */
  artifacts: string[];
}

/** Typed exclusion — folders that never enter index/registry/board (R1.2). */
export interface ExcludedTaskFolder {
  folderName: string;
  reason:
    | 'no_carrier'
    | 'no_frontmatter'
    | 'yaml_unparseable'
    | 'invalid_status'
    | 'missing_title'
    | 'unreadable';
}
