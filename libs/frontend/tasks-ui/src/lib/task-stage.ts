/**
 * Pure helpers for presenting one task outside the board: the status ink, the
 * derived Stage and the order its documents are listed in.
 *
 * Like `task-presentation.ts`, NOTHING here hand-writes a per-task `*.md`
 * filename. Every name comes from a named constant of the shared contract
 * (`task-spec.contract.ts`), which the contract guard enforces.
 */
import {
  BATCHES_FILE,
  CARRIER_FILE,
  CODE_LOGIC_REVIEW_FILE,
  CODE_STYLE_REVIEW_FILE,
  DESIGN_HANDOFF_FILE,
  DESIGN_SPEC_FILE,
  DOC_FILES,
  IMPLEMENTATION_PLAN_FILE,
  LEGACY_BATCHES_FILE,
  TASK_DESCRIPTION_FILE,
  TEST_REPORT_FILE,
  VISUAL_DESIGN_SPECIFICATION_FILE,
  VISUAL_REVIEW_FILE,
  type DocFile,
  type TaskStatus,
} from '@ptah-extension/shared';

/**
 * Text colour per status, from the per-theme status-ink utilities. Measured
 * ink, not the daisyUI `badge-*` fills, so the pill text meets contrast on
 * every theme (design-spec D29).
 */
export const TASK_STATUS_INK: Record<TaskStatus, string> = {
  backlog: 'text-base-content-muted',
  in_progress: 'text-state-run',
  in_review: 'text-state-need',
  blocked: 'text-state-err',
  done: 'text-state-done',
  cancelled: 'text-base-content-muted',
};

/** One step of the Stage ladder and the documents that prove it was reached. */
interface TaskStageStep {
  readonly stage: string;
  readonly files: readonly DocFile[];
}

/**
 * The Stage ladder, earliest step first. A task has no phase field, so the
 * Stage is DERIVED: the furthest step with at least one of its documents
 * present. It is a hint, not a state machine.
 *
 * The batch breakdown accepts its legacy name too — that fallback is permanent
 * (see `LEGACY_BATCHES_FILE`).
 */
const TASK_STAGE_LADDER = [
  { stage: 'Requirements', files: [TASK_DESCRIPTION_FILE] },
  {
    stage: 'Design',
    files: [
      DESIGN_SPEC_FILE,
      VISUAL_DESIGN_SPECIFICATION_FILE,
      DESIGN_HANDOFF_FILE,
    ],
  },
  { stage: 'Plan', files: [IMPLEMENTATION_PLAN_FILE] },
  { stage: 'Build', files: [BATCHES_FILE, LEGACY_BATCHES_FILE] },
  {
    stage: 'Review',
    files: [CODE_STYLE_REVIEW_FILE, CODE_LOGIC_REVIEW_FILE, VISUAL_REVIEW_FILE],
  },
  { stage: 'Test', files: [TEST_REPORT_FILE] },
] as const satisfies readonly TaskStageStep[];

/** The label of one ladder step, e.g. `Design`. */
export type TaskStage = (typeof TASK_STAGE_LADDER)[number]['stage'];

/**
 * The furthest ladder step any of `artifacts` reaches, or `null` when none of
 * the ladder documents exist (a folder with only the carrier has no Stage).
 */
export function deriveTaskStage(
  artifacts: readonly string[],
): TaskStage | null {
  const present = new Set(artifacts);
  for (let i = TASK_STAGE_LADDER.length - 1; i >= 0; i--) {
    const step = TASK_STAGE_LADDER[i];
    if (step.files.some((file) => present.has(file))) return step.stage;
  }
  return null;
}

/** `handoff-N.md`, capturing N. Not a contract document: N is open-ended. */
const HANDOFF_FILE_PATTERN = /^handoff-(\d+)\.md$/;

/**
 * The order a task's documents are listed in:
 *
 *  1. the carrier, only when it is in `artifacts` (never added when absent);
 *  2. the recognised documents, in `DOC_FILES` order;
 *  3. `handoff-N.md`, ascending by N;
 *  4. everything else, alphabetically.
 *
 * Only entries of `artifacts` are returned, each once.
 */
export function orderTaskDocuments(artifacts: readonly string[]): string[] {
  const remaining = new Set(artifacts);
  const ordered: string[] = [];

  const take = (file: string): void => {
    if (remaining.delete(file)) ordered.push(file);
  };

  take(CARRIER_FILE);
  for (const file of DOC_FILES) take(file);

  const handoffs: { file: string; n: number }[] = [];
  for (const file of remaining) {
    const match = HANDOFF_FILE_PATTERN.exec(file);
    if (match) handoffs.push({ file, n: Number(match[1]) });
  }
  handoffs.sort((a, b) => a.n - b.n || compareText(a.file, b.file));
  for (const { file } of handoffs) take(file);

  ordered.push(...[...remaining].sort(compareText));
  return ordered;
}

/** Locale-independent comparison, so the order is the same on every host. */
function compareText(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}
