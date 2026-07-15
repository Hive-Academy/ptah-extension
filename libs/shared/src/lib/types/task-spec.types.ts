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
    | 'schema_issue';
  message: string;
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
