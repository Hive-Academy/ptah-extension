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
  labelColorIndex,
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

/**
 * daisyui class list for the estimate badge.
 *
 * Two weights, not five colours. The badge has to be distinguishable from the
 * type badge and the status badge (FR-B2.2) without inventing a fifth colour
 * axis on a card that already carries four, so the size is expressed as
 * *weight*: the two large sizes read as a filled badge, the rest as an outline.
 * The letters are always rendered, so the weight is reinforcement and never the
 * carrier of the meaning (NFR-12).
 *
 * Both class lists resolve through daisyui's `neutral` / `base-content` pair,
 * which is dark-on-light in the light theme and light-on-dark in the dark one —
 * so neither needs a per-theme audit the way {@link LABEL_CHIP_CLASSES} does.
 */
export function taskEstimateBadge(estimate: TaskEstimate): string {
  return estimate === 'L' || estimate === 'XL'
    ? 'badge-neutral font-mono'
    : 'badge-outline font-mono';
}

// ---------------------------------------------------------------------------
// Label chips
// ---------------------------------------------------------------------------

/**
 * The label chip palette: a FIXED, hand-audited list of Tailwind class triples.
 *
 * ## Why these are absolute palette colours and not daisyui theme tokens
 *
 * The gate on this list is ≥ 4.5:1 text contrast in BOTH the light and the dark
 * theme (NFR-12, R15). A daisyui token (`badge-info`, `bg-primary`, …) resolves
 * to a different colour per theme, and this app ships 30-plus themes — auditing
 * a token-based palette means auditing every theme, and it silently re-breaks
 * the next time a theme is added. Tailwind palette steps are absolute sRGB, so
 * a chip renders identically in every theme and ONE audit holds for all of them.
 *
 * ## Gate 1 — text contrast, `text-*-800` on `bg-*-100`
 *
 * Identical in every theme, because the values are absolute. Gate is 4.5:1.
 *
 * ## Gate 2 — chip boundary, the better of fill-or-border against the page
 *
 * On a dark page the near-white fill carries the edge (13–17:1); on a light
 * page the fill is a 1.03–1.16:1 non-edge and the `-700` border carries it.
 * Gate is WCAG 1.4.11's 3:1. `-700` rather than `-600` buys real margin: the
 * worst entry moves from 3.09:1 (green, 3% over the line) to 4.70:1.
 *
 * | slot | hue | text : fill | worst boundary over 4 themes |
 * |---|---|---|---|
 * | 0 | zinc    | **13.55:1** | 9.79:1 |
 * | 1 | red     | **6.80:1**  | 6.07:1 |
 * | 2 | orange  | **6.38:1**  | 4.85:1 |
 * | 3 | green   | **6.49:1**  | 4.70:1 |
 * | 4 | cyan    | **6.49:1**  | 5.02:1 |
 * | 5 | sky     | **6.59:1**  | 5.56:1 |
 * | 6 | indigo  | **8.06:1**  | 7.41:1 |
 * | 7 | fuchsia | **7.08:1**  | 5.93:1 |
 *
 * Themes audited: `anubis`, `anubis-light`, daisyui `dark`, daisyui `light`.
 *
 * ## Gate 3 — the slots must be telling apart at chip size
 *
 * Measured as Euclidean distance in OKLab between fills. `emerald`/`teal` at
 * **0.0157** is the pair this list rejected as too close, so that number is the
 * standing threshold. Every pair here clears it: the closest is `cyan`/`sky` at
 * **0.0276**, which is 1.76x the rejected pair.
 *
 * `rose` was in this list and was CUT at review: `red`/`rose` measured
 * **0.0064**, two and a half times CLOSER than the pair already rejected — the
 * threshold was not being applied to the list that defined it. `amber`, `yellow`
 * and `lime` fail gate 2 (2.75–2.99:1) and are not candidates.
 *
 * Nothing about the assignment is persisted — {@link labelChipClass} hashes the
 * label text, so the same label is the same colour in every host with no
 * registry, no column and no settings entry.
 */
export const LABEL_CHIP_CLASSES = [
  'bg-zinc-100 text-zinc-800 border-zinc-700',
  'bg-red-100 text-red-800 border-red-700',
  'bg-orange-100 text-orange-800 border-orange-700',
  'bg-green-100 text-green-800 border-green-700',
  'bg-cyan-100 text-cyan-800 border-cyan-700',
  'bg-sky-100 text-sky-800 border-sky-700',
  'bg-indigo-100 text-indigo-800 border-indigo-700',
  'bg-fuchsia-100 text-fuchsia-800 border-fuchsia-700',
] as const;

/**
 * Stable chip classes for a label.
 *
 * Delegates the slot choice to the shared {@link labelColorIndex}, which hashes
 * the case- and whitespace-folded key — so `Licensing`, `licensing` and
 * `licensing ` are one label with ONE colour (R9), and the extension host and
 * the webview agree bit-for-bit.
 *
 * Colour is never the sole carrier of meaning: every chip renders its text.
 */
export function labelChipClass(label: string): string {
  return LABEL_CHIP_CLASSES[labelColorIndex(label, LABEL_CHIP_CLASSES.length)];
}

// ---------------------------------------------------------------------------
// Relation groups
// ---------------------------------------------------------------------------

/**
 * The five relation headings the detail panel groups under (FR-B4.9), in the
 * order they are rendered: what holds this task up, what this task holds up,
 * then the two duplicate directions, then the loose relation.
 */
export const TASK_RELATION_GROUPS = [
  'blocked_by',
  'blocks',
  'duplicates',
  'duplicated_by',
  'related',
] as const;
export type TaskRelationGroup = (typeof TASK_RELATION_GROUPS)[number];

/** Heading text per relation group. */
export const TASK_RELATION_GROUP_LABELS: Record<TaskRelationGroup, string> = {
  blocked_by: 'Blocked by',
  blocks: 'Blocks',
  duplicates: 'Duplicates',
  duplicated_by: 'Duplicated by',
  related: 'Related',
};

/** Which side of an edge authored it. `related` is the one mixed group. */
export type TaskRelationOrigin = 'authored' | 'derived';

/**
 * Where each group's edges are authored.
 *
 * `related` is `mixed` because `relates_to` may be declared on either side and
 * the derived graph shows both — so that group is rendered as two homogeneous
 * halves rather than one list the reader has to decode.
 */
export const TASK_RELATION_GROUP_ORIGIN: Record<
  TaskRelationGroup,
  TaskRelationOrigin | 'mixed'
> = {
  blocked_by: 'authored',
  blocks: 'derived',
  duplicates: 'authored',
  duplicated_by: 'derived',
  related: 'mixed',
};

/**
 * The sentence that says which carrier owns an edge, per origin.
 *
 * This is the TEXT half of the authored-vs-derived distinction (FR-B4.9), and
 * it is the load-bearing half. A solid-versus-dashed chip is not a distinction
 * for a reader who cannot resolve that difference, and "removable only from the
 * other task" is not something a border style can say. The styling reinforces
 * these sentences; it never replaces them.
 */
export const TASK_RELATION_ORIGIN_NOTES: Record<TaskRelationOrigin, string> = {
  authored: `Declared in this task's own frontmatter.`,
  derived: `Declared by the other task — this task's carrier does not name it. Open that task to change the edge.`,
};

/**
 * The heading a group renders under, once its origin is known.
 *
 * Four of the five groups already name their own direction, so the heading is
 * just the label. `related` is the exception: it splits into two lists that
 * would otherwise both be headed "Related", leaving the distinction to carry on
 * the note sentence alone. Two identical headings are a worse failure than a
 * long one — a reader scanning headings sees the same word twice and has no
 * reason to look further.
 */
export function taskRelationHeading(
  group: TaskRelationGroup,
  origin: TaskRelationOrigin,
): string {
  if (group !== 'related') return TASK_RELATION_GROUP_LABELS[group];
  return origin === 'authored'
    ? 'Related — declared here'
    : 'Related — declared elsewhere';
}

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
