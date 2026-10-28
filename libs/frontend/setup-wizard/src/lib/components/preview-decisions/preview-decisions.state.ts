/**
 * Keep/replace decision state shared by the wizard preview modal, the sidebar
 * preview dialog and the community-pack install prompt (TASK_2026_701_9e4b F1).
 *
 * Pure functions over immutable rows. A surface keeps one
 * {@link DecisionSnapshot} in a signal and replaces it through these helpers:
 *
 * - every row starts on Keep;
 * - a Replace survives a re-preview only when the row's opaque `revision` is
 *   unchanged (the server rejects a replace against a different baseline);
 * - a target change resets every row to Keep and sets the status line;
 * - an unreadable or unknown file is forced Keep and never changes, not even
 *   through "Replace all".
 *
 * Copy follows design-spec section 5 verbatim.
 */
import type {
  FileDecision,
  FileDecisionEntry,
  GenerationPreviewFile,
  GenerationTargetChoice,
  GenerationTargetInfo,
  WizardPlanPackInstallResult,
  WizardPreviewGenerationResponse,
} from '@ptah-extension/shared';

/** Which surface family a row belongs to; it selects the Replace wording. */
export type DecisionKind = 'wizard' | 'pack';

/** Surface whose confirm button the label is for. */
export type DecisionConfirmContext = 'wizard-modal' | 'sidebar-dialog' | 'pack';

/**
 * Row state. Wizard rows use `new`/`exists`/`unreadable`; pack rows use
 * `new`/`identical`/`differs`/`unreadable`.
 */
export type DecisionRowState =
  | 'new'
  | 'exists'
  | 'identical'
  | 'differs'
  | 'unreadable';

/** One file a surface may ask the user about. */
export interface DecisionRow {
  /** Decision key sent back: agent id (wizard) or pack file name (pack). */
  readonly id: string;
  /** Path shown to the user and used in accessible names. */
  readonly path: string;
  readonly kind: DecisionKind;
  readonly state: DecisionRowState;
  /** Opaque baseline revision echoed with a replace. */
  readonly revision?: string;
  readonly decision: FileDecision;
  /** True when the file could not be read (or its state is unknown). */
  readonly forcedKeep: boolean;
  /** The local file still matches what the setup wizard last wrote (D10). */
  readonly unchangedSinceWizardWrite: boolean;
  /** The agent's Library copy carries edits (Electron only). */
  readonly libraryCopyEdited: boolean;
  /** Current local text, for the pack diff. */
  readonly localText?: string;
  /** Incoming pack text, for the pack diff. */
  readonly incomingText?: string;
}

/** The decision state one surface holds. */
export interface DecisionSnapshot {
  readonly rows: readonly DecisionRow[];
  /** Target the rows were compared against; null when the host sent none. */
  readonly target: GenerationTargetChoice | null;
  /** `role=status` line to show, or null. */
  readonly status: string | null;
}

export const KEEP_LABEL = 'Keep my file';
export const WHAT_CHANGES_LABEL = 'What changes';
export const WIZARD_DIFF_UNAVAILABLE =
  'The generated content is not known until generation runs.';
export const PACK_DIFF_UNAVAILABLE = 'The differences could not be shown.';
export const UNREADABLE_NOTE =
  'Ptah could not compare this file, so it is treated as different and will be kept. Replace is not available for it.';
export const UNCHANGED_SINCE_WIZARD_NOTE =
  'Unchanged since the setup wizard wrote it';
export const LIBRARY_COPY_EDITED_NOTE =
  'Library copy has edits. If you replace, you will need to choose rebase or keep for it in the Library.';
export const TARGET_CHANGED_STATUS =
  'Target changed. The comparison was run again and every choice is reset to Keep.';
export const BULK_GROUP_LABEL = 'Apply to all differing files';

const REPLACE_LABEL: Record<DecisionKind, string> = {
  wizard: 'Replace with generated',
  pack: 'Replace with pack version',
};

const REPLACE_SOURCE: Record<DecisionKind, string> = {
  wizard: 'generated',
  pack: 'pack',
};

const CONFIRM_BASE: Record<DecisionConfirmContext, string> = {
  'wizard-modal': 'Confirm Generate',
  'sidebar-dialog': 'Confirm and generate',
  pack: 'Install pack',
};

/** Visible Replace segment label. */
export function replaceLabel(kind: DecisionKind): string {
  return REPLACE_LABEL[kind];
}

/** Accessible name of the Keep segment. */
export function keepAriaLabel(path: string): string {
  return `${KEEP_LABEL} ${path}`;
}

/** Accessible name of the Replace segment, with the forced-keep suffix. */
export function replaceAriaLabel(
  path: string,
  kind: DecisionKind,
  forcedKeep: boolean,
): string {
  const base = `Replace ${path} with ${REPLACE_SOURCE[kind]} version`;
  return forcedKeep
    ? `${base} (not available: file could not be read)`
    : base;
}

/** Accessible name of the radiogroup. */
export function groupAriaLabel(path: string): string {
  return `Keep or replace ${path}`;
}

/** State badge text for a row. */
export function stateBadge(row: DecisionRow): string {
  switch (row.state) {
    case 'new':
      return 'New';
    case 'exists':
      return 'Exists — may be replaced';
    case 'identical':
      return 'Already current';
    case 'differs':
      return 'Differs from local file';
    case 'unreadable':
      return 'Could not read file';
  }
}

/** The row carries a keep/replace control (enabled or forced Keep). */
export function hasControl(row: DecisionRow): boolean {
  return (
    row.state === 'exists' ||
    row.state === 'differs' ||
    row.state === 'unreadable'
  );
}

/** The user can choose Replace for the row. */
export function isControllable(row: DecisionRow): boolean {
  return hasControl(row) && !row.forcedKeep;
}

function wizardSourceFile(
  files: readonly GenerationPreviewFile[],
): GenerationPreviewFile | undefined {
  return files.find(
    (file) => file.target === 'claude' && file.certainty === 'definite',
  );
}

function wizardState(file: GenerationPreviewFile): DecisionRowState {
  // An older host sends no `localState`: nothing there is New, anything
  // there is an unknown state and therefore forced Keep.
  if (file.localState) return file.localState;
  return file.willOverwrite ? 'unreadable' : 'new';
}

/** Rows for the wizard previews: one per agent, for its Claude source file. */
export function buildWizardRows(
  preview: WizardPreviewGenerationResponse,
): DecisionRow[] {
  const rows: DecisionRow[] = [];
  for (const agent of preview.agents) {
    const file = wizardSourceFile(agent.files);
    if (!file) continue;
    const state = wizardState(file);
    rows.push({
      id: agent.agentId,
      path: file.relPath,
      kind: 'wizard',
      state,
      revision: file.revision,
      decision: 'keep',
      forcedKeep: state === 'unreadable',
      unchangedSinceWizardWrite: agent.unchangedSinceWizardWrite === true,
      libraryCopyEdited: agent.libraryCopyEdited === true,
    });
  }
  return rows;
}

/** Rows for a community-pack install plan: one per pack file. */
export function buildPackRows(plan: WizardPlanPackInstallResult): DecisionRow[] {
  return plan.files.map((file) => ({
    id: file.file,
    path: file.file,
    kind: 'pack',
    state: file.state,
    revision: file.revision,
    decision: 'keep',
    forcedKeep: file.state === 'unreadable',
    unchangedSinceWizardWrite: false,
    libraryCopyEdited: false,
    localText: file.localText,
    incomingText: file.incomingText,
  }));
}

/**
 * The next snapshot after a (re-)preview.
 *
 * - First preview, or same target: a previous Replace is carried only when the
 *   row is still controllable and its revision is defined and equal.
 * - Target changed: every row is Keep and the status line is set.
 */
export function nextSnapshot(
  previous: DecisionSnapshot | null,
  freshRows: readonly DecisionRow[],
  target: GenerationTargetChoice | null,
): DecisionSnapshot {
  const keepRows = freshRows.map((row) =>
    row.decision === 'keep' ? row : { ...row, decision: 'keep' as const },
  );
  if (!previous) return { rows: keepRows, target, status: null };
  if (previous.target !== target) {
    return { rows: keepRows, target, status: TARGET_CHANGED_STATUS };
  }
  const replaced = new Map(
    previous.rows
      .filter((row) => row.decision === 'replace')
      .map((row) => [row.id, row.revision] as const),
  );
  const rows = keepRows.map((row) => {
    const revision = replaced.get(row.id);
    const carry =
      isControllable(row) &&
      revision !== undefined &&
      row.revision !== undefined &&
      revision === row.revision;
    return carry ? { ...row, decision: 'replace' as const } : row;
  });
  return { rows, target, status: null };
}

/** Sets one row's decision; forced-keep and control-less rows never change. */
export function setDecision(
  snapshot: DecisionSnapshot,
  id: string,
  decision: FileDecision,
): DecisionSnapshot {
  let changed = false;
  const rows = snapshot.rows.map((row) => {
    if (row.id !== id || row.decision === decision) return row;
    if (decision === 'replace' && !isControllable(row)) return row;
    changed = true;
    return { ...row, decision };
  });
  return changed ? { ...snapshot, rows } : snapshot;
}

/** "Keep all" / "Replace all": every controllable row; forced keep is skipped. */
export function setAllDecisions(
  snapshot: DecisionSnapshot,
  decision: FileDecision,
): DecisionSnapshot {
  let changed = false;
  const rows = snapshot.rows.map((row) => {
    if (!isControllable(row) || row.decision === decision) return row;
    changed = true;
    return { ...row, decision };
  });
  return changed ? { ...snapshot, rows } : snapshot;
}

/** Number of rows the bulk bar acts on. */
export function controllableCount(rows: readonly DecisionRow[]): number {
  return rows.filter(isControllable).length;
}

/** Bulk bar label: wizard "N existing files", pack "N files can be replaced". */
export function bulkCountLabel(kind: DecisionKind, count: number): string {
  if (kind === 'wizard') {
    return `${count} existing ${count === 1 ? 'file' : 'files'}`;
  }
  return `${count} ${count === 1 ? 'file can' : 'files can'} be replaced`;
}

/** Counts over the rows that carry a control. */
export function decisionCounts(rows: readonly DecisionRow[]): {
  kept: number;
  toReplace: number;
} {
  let kept = 0;
  let toReplace = 0;
  for (const row of rows) {
    if (!hasControl(row)) continue;
    if (row.decision === 'replace') toReplace++;
    else kept++;
  }
  return { kept, toReplace };
}

/** Footer summary "<k> kept, <r> to replace"; null when no row has a control. */
export function summaryText(rows: readonly DecisionRow[]): string | null {
  if (!rows.some(hasControl)) return null;
  const { kept, toReplace } = decisionCounts(rows);
  return `${kept} kept, ${toReplace} to replace`;
}

/** Confirm label per surface and number of replacements. */
export function confirmLabel(
  context: DecisionConfirmContext,
  replaceCount: number,
): string {
  const base = CONFIRM_BASE[context];
  if (replaceCount <= 0) return base;
  return `${base}, replace ${replaceCount} ${replaceCount === 1 ? 'file' : 'files'}`;
}

/** Decisions to send: `{decision, revision}` for each Replace; absent = keep. */
export function decisionEntries(
  rows: readonly DecisionRow[],
): Record<string, FileDecisionEntry> {
  const entries: Record<string, FileDecisionEntry> = {};
  for (const row of rows) {
    if (row.decision !== 'replace' || !isControllable(row)) continue;
    entries[row.id] =
      row.revision === undefined
        ? { decision: 'replace' }
        : { decision: 'replace', revision: row.revision };
  }
  return entries;
}

/**
 * Order-independent signature of a preview's definite targets. Two previews
 * with different signatures mean the targets changed since the user looked.
 */
export function targetsSignature(
  preview: WizardPreviewGenerationResponse,
): string {
  const keys = new Set(
    preview.agents.flatMap((agent) =>
      agent.files
        .filter((file) => file.certainty === 'definite')
        .map(
          (file) => `${file.target}:${file.relPath}:${file.willOverwrite}`,
        ),
    ),
  );
  return [...keys].sort().join('|');
}

/** Agents folder under a root, in the root's own separator style. */
export function agentsFolder(root: string): string {
  const separator = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  const trimmed = root.replace(/[\\/]+$/, '');
  return [trimmed, '.claude', 'agents'].join(separator);
}

/** Folder the chosen target writes to. */
export function targetFolder(
  info: GenerationTargetInfo,
  choice: GenerationTargetChoice,
): string {
  return agentsFolder(
    choice === 'opened-folder' ? info.openedFolder : info.harnessRoot,
  );
}
