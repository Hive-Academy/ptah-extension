import type {
  FileOutcome,
  GenerationTargetChoice,
  GenerationTargetInfo,
  WizardInstallPackAgentsResult,
} from '@ptah-extension/shared';
import { safeFailureCopy } from '../../utils/safe-failure-copy';
import {
  agentsFolder,
  targetFolder,
} from '../preview-decisions/preview-decisions.state';

/**
 * Pack install result model and pure helpers (TASK_2026_701_9e4b M1), shared
 * by the install prompt, both pack hosts and `PackInstallStore`.
 */

/** One pack install the user asked for, from any entry point. */
export interface PackInstallRequest {
  readonly source: string;
  readonly packName: string;
  /** Pack file names in scope: the whole pack or one file. */
  readonly files: readonly string[];
  readonly scope: 'pack' | 'file';
  /** Root to compare against first; null = the server default. */
  readonly target: GenerationTargetChoice | null;
}

/** Terminal per-file status a host shows after an install. */
export type PackFileStatus = 'installed' | 'kept' | 'failed';

/** Terminal result of one install, kept by `PackInstallStore`. */
export interface PackInstallFinished {
  readonly source: string;
  readonly packName: string;
  readonly files: readonly string[];
  /** Roots of the plan; `chosen` is the root the install wrote to. */
  readonly target: GenerationTargetInfo;
  /** Per-file outcome as the server reported it. */
  readonly outcomes: Readonly<Record<string, FileOutcome>>;
  readonly statuses: Readonly<Record<string, PackFileStatus>>;
  /** Safe, user-facing failure copy (never the raw error), or null. */
  readonly failure: string | null;
  /** The install failed before any per-file outcome (download, validation). */
  readonly primaryFailure: boolean;
}

export const KEPT_PACK_NOTE =
  'Your file was not changed. Origin stays Workspace file.';
export const INSTALL_FAILED_FALLBACK =
  'The install could not be completed. Try again.';

/**
 * Per-file outcome from an install result. A host without per-file outcomes
 * reports every file by the overall success; a file missing from a per-file
 * list failed.
 */
export function packFileOutcomes(
  files: readonly string[],
  result: WizardInstallPackAgentsResult,
): Record<string, FileOutcome> {
  const reported = new Map(
    (result.files ?? []).map((entry) => [entry.file, entry.outcome] as const),
  );
  const outcomes: Record<string, FileOutcome> = {};
  for (const file of files) {
    outcomes[file] =
      reported.get(file) ??
      (result.success && !result.files ? 'written' : 'failed');
  }
  return outcomes;
}

/** `written`/`unchanged` are installed; `kept`/`changed-since-preview` kept. */
export function packFileStatus(outcome: FileOutcome): PackFileStatus {
  if (outcome === 'written' || outcome === 'unchanged') return 'installed';
  if (outcome === 'kept' || outcome === 'changed-since-preview') return 'kept';
  return 'failed';
}

/** Per-file status from an install result. */
export function packFileStatuses(
  files: readonly string[],
  result: WizardInstallPackAgentsResult,
): Record<string, PackFileStatus> {
  const statuses: Record<string, PackFileStatus> = {};
  for (const [file, outcome] of Object.entries(
    packFileOutcomes(files, result),
  )) {
    statuses[file] = packFileStatus(outcome);
  }
  return statuses;
}

/** The terminal result of an install of `files` into `target`. */
export function packInstallFinished(
  request: PackInstallRequest,
  files: readonly string[],
  target: GenerationTargetInfo,
  result: WizardInstallPackAgentsResult,
): PackInstallFinished {
  const statuses = packFileStatuses(files, result);
  const anyFailed = Object.values(statuses).includes('failed');
  return {
    source: request.source,
    packName: request.packName,
    files,
    target,
    outcomes: packFileOutcomes(files, result),
    statuses,
    failure:
      result.success && !anyFailed
        ? null
        : safeFailureCopy(result.error, INSTALL_FAILED_FALLBACK),
    primaryFailure: !result.success && !result.files?.length,
  };
}

/** Installed / kept / failed counters for a results line. */
export function packResultCounts(
  statuses: Readonly<Record<string, PackFileStatus>>,
): Record<PackFileStatus, number> {
  const counts: Record<PackFileStatus, number> = {
    installed: 0,
    kept: 0,
    failed: 0,
  };
  for (const status of Object.values(statuses)) counts[status]++;
  return counts;
}

/** `<opened>/.claude/agents` relative to the project root when inside it. */
function openedAgentsRelative(info: GenerationTargetInfo): string {
  const root = info.harnessRoot.replace(/[\\/]+$/, '');
  const opened = info.openedFolder.replace(/[\\/]+$/, '');
  const folder = agentsFolder(opened);
  const inside =
    opened.length > root.length &&
    opened.toLowerCase().startsWith(root.toLowerCase()) &&
    /[\\/]/.test(opened.charAt(root.length));
  return inside ? folder.slice(root.length + 1).replace(/\\/g, '/') : folder;
}

/**
 * Opened-folder completion notice per host (design section 5), or null when
 * the install went to the project root.
 */
export function openedFolderNotice(
  info: GenerationTargetInfo,
  isElectron: boolean,
): string | null {
  if (info.chosen !== 'opened-folder' || info.openedIsHarnessRoot) return null;
  const where = `These agents are in ${openedAgentsRelative(info)}.`;
  return isElectron
    ? `${where} They will not reach other CLIs and will not appear in the Library.`
    : `${where} They will not reach other CLIs.`;
}

/** "Install to" line of a pack host: folder and scope suffix. */
export interface InstallToLabel {
  readonly path: string;
  readonly suffix: string;
}

/**
 * Where the next install goes, from the roots of the last finished one; the
 * project root's `.claude/agents` before any install.
 */
export function installToLabel(
  info: GenerationTargetInfo | null,
): InstallToLabel {
  if (!info) return { path: '.claude/agents', suffix: '(project root)' };
  const openedOnly =
    info.chosen === 'opened-folder' && !info.openedIsHarnessRoot;
  return {
    path: targetFolder(info, openedOnly ? 'opened-folder' : 'harness-root'),
    suffix: openedOnly ? '(opened folder only)' : '(project root)',
  };
}
