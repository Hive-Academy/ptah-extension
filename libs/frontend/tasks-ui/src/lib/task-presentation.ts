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
  type TaskStatus,
  type TaskType,
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
