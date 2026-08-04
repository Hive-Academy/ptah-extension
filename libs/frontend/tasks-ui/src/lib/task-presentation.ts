/**
 * Presentation maps for the Tasks board.
 *
 * NOTHING in this file hand-writes a per-task `*.md` filename. Every document
 * name flows from the shared `DOC_FILES` contract (`@ptah-extension/shared` →
 * `task-spec.contract.ts`), the single closed set of documents Ptah recognises
 * inside a task folder. A CI ratchet fails the build on any per-task `*.md`
 * literal that reappears here — a second divergent doc-file list is exactly
 * what this file used to be.
 */
import {
  BATCHES_FILE,
  CARRIER_FILE,
  DOC_FILES,
  LEGACY_BATCHES_FILE,
  isLegacyDocFile,
  type DocFile,
  type ExcludedTaskFolder,
  type TaskEstimate,
  type TaskStatus,
  type TaskType,
  type TaskValidationIssue,
} from '@ptah-extension/shared';

/** Human-readable column / badge label per status. */
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  in_progress: 'In Progress',
  in_review: 'In Review',
  blocked: 'Blocked',
  done: 'Done',
  cancelled: 'Cancelled',
};

/** daisyui badge modifier per status — drives the small status pill colour. */
export const TASK_STATUS_BADGE: Record<TaskStatus, string> = {
  backlog: 'badge-ghost',
  in_progress: 'badge-info',
  in_review: 'badge-warning',
  blocked: 'badge-error',
  done: 'badge-success',
  cancelled: 'badge-neutral',
};

/** daisyui badge modifier per task type. `null` → unvalidated (warning). */
export function taskTypeBadge(type: TaskType | null): string {
  return type ? 'badge-outline' : 'badge-warning badge-outline';
}

// ---------------------------------------------------------------------------
// Estimates
// ---------------------------------------------------------------------------

/**
 * Long-form name per t-shirt size, for tooltips and pickers where two letters
 * are not enough to guess at.
 *
 * Keyed by the shared `TaskEstimate` union, so a size added backend-side fails
 * to compile here until it is named. Deliberately NOT a numeric map: there is
 * no point-value anywhere in the codebase, because the moment `M` becomes `3`
 * somebody sums a column and reports a sprint total from a signal that was only
 * ever meant to be a rough relative size.
 */
export const TASK_ESTIMATE_LABELS: Record<TaskEstimate, string> = {
  XS: 'Extra small',
  S: 'Small',
  M: 'Medium',
  L: 'Large',
  XL: 'Extra large',
};

// ---------------------------------------------------------------------------
// Validation warnings
// ---------------------------------------------------------------------------

/** The warning-code union carried by a shared {@link TaskValidationIssue}. */
export type TaskValidationCode = TaskValidationIssue['code'];

/**
 * One sentence per validation code, saying what is wrong AND what the board did
 * about it.
 *
 * Keyed by the shared code union — exactly the guarantee
 * {@link TASK_EXCLUSION_REASON_LABELS} already provides one section below. A
 * code added backend-side FAILS THIS LIB'S TYPECHECK until it is explained
 * here, which is the whole mechanism: a warning badge that renders a raw
 * `parent_depth_exceeded` at a user tells them a machine noticed something and
 * nothing else.
 *
 * Every sentence states the fallback, because a warning without one reads as
 * "your task may be broken" when the true meaning is always "your task is on
 * the board, and this one field was ignored".
 */
export const TASK_VALIDATION_CODE_LABELS: Record<TaskValidationCode, string> = {
  id_mismatch: `The frontmatter id disagrees with the folder name. The folder name wins, and nothing was renamed.`,
  invalid_type:
    'The task type is not one of the recognised types, so no type is shown.',
  invalid_date:
    'A created or updated stamp is not a parseable date, so it is shown as unknown.',
  invalid_depends_on:
    'The depends_on field is not a list of task ids, so no dependencies are shown.',
  dangling_depends_on:
    'A dependency names a task folder that does not exist. The entry is kept — usually it is a typo or a task not created yet.',
  invalid_estimate:
    'The estimate is not one of the recognised sizes, so no size is shown.',
  invalid_labels:
    'The labels field is not a list of strings, so no labels are shown.',
  invalid_parent:
    'The parent is not a single task folder name, so it was ignored entirely.',
  dangling_parent:
    'The parent names a task folder that does not exist. The value is kept, but no parent link is drawn.',
  parent_cycle:
    'The parent chain loops back to this task, so the parent link was dropped. Both tasks stay on the board.',
  parent_depth_exceeded:
    'The parent of this task already has a parent, and parentage is one level deep. The link was dropped; both tasks stay on the board.',
  invalid_relation:
    'A relation field is not a list of task ids, so that relation is not shown.',
  dangling_relation:
    'A relation names this task itself, or a folder that does not exist. The entry is kept and simply links nowhere.',
  schema_issue:
    'The frontmatter has a problem the board could not describe more precisely.',
};

// ---------------------------------------------------------------------------
// Workflow-stage artifacts — derived from DOC_FILES, never hand-listed
// ---------------------------------------------------------------------------

/**
 * Turn a recognised document name into a display label: strip the extension,
 * title-case the hyphen-separated words (`a-b` becomes `A B`).
 *
 * Derived rather than mapped so a name added to the shared `DOC_FILES` set
 * cannot arrive here unlabelled, and so no filename has to be repeated. The
 * extension is cut at the last `.` (never matched as a literal); the remaining
 * `-` segments are title-cased.
 */
function docFileLabel(file: DocFile): string {
  const dot = file.lastIndexOf('.');
  const stem = dot > 0 ? file.slice(0, dot) : file;
  return stem
    .split('-')
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** One canonical workflow stage and the filename(s) that satisfy it. */
export interface WorkflowArtifact {
  readonly label: string;
  /** Canonical filename first; any later entry is an accepted alias. */
  readonly files: readonly DocFile[];
}

/**
 * Canonical workflow-stage artifacts, in `DOC_FILES` order. Presence of one of
 * a stage's `files` in a task folder signals that orchestration stage produced
 * its output; absence is a meaningful gap (e.g. a Done task with no review
 * document was never reviewed).
 *
 * Legacy names fold into the stage they were renamed from rather than forming a
 * stage of their own: the batch breakdown accepts BOTH `BATCHES_FILE` and its
 * pre-rename name `LEGACY_BATCHES_FILE`. That fallback is PERMANENT and is
 * never deprecation-warned — task folders live under a gitignored path, so no
 * migration can be trusted to have run.
 */
export const WORKFLOW_ARTIFACTS: readonly WorkflowArtifact[] = DOC_FILES.filter(
  (file) => !isLegacyDocFile(file),
).map((file) => ({
  label: docFileLabel(file),
  files: file === BATCHES_FILE ? [file, LEGACY_BATCHES_FILE] : [file],
}));

// ---------------------------------------------------------------------------
// Typed board exclusions
// ---------------------------------------------------------------------------

/** The reason union carried by a shared {@link ExcludedTaskFolder}. */
export type TaskExclusionReason = ExcludedTaskFolder['reason'];

/**
 * One sentence per exclusion reason, explaining why the folder never reached
 * the board and what to fix. Keyed by the shared reason union, so a reason
 * added backend-side fails to compile until it is explained here — the whole
 * point of the exclusions drawer is that no folder disappears unexplained.
 *
 * The carrier filename is interpolated from `CARRIER_FILE`, never typed out.
 */
export const TASK_EXCLUSION_REASON_LABELS: Record<TaskExclusionReason, string> =
  {
    no_carrier: `The folder has no ${CARRIER_FILE}, so the board skips it entirely.`,
    no_frontmatter: `${CARRIER_FILE} exists but carries no YAML frontmatter block.`,
    yaml_unparseable: `The frontmatter in ${CARRIER_FILE} is not valid YAML.`,
    invalid_status:
      'The frontmatter status is missing, or is not one of the six allowed values.',
    missing_title: 'The frontmatter title is missing or empty.',
    unreadable: `${CARRIER_FILE} could not be read from disk.`,
  };

/** Narrow an untrusted value to a known exclusion reason. */
export function isTaskExclusionReason(
  value: unknown,
): value is TaskExclusionReason {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(TASK_EXCLUSION_REASON_LABELS, value)
  );
}

/** Explanation sentence for a typed exclusion reason. Never empty. */
export function taskExclusionReasonLabel(reason: TaskExclusionReason): string {
  return TASK_EXCLUSION_REASON_LABELS[reason];
}
