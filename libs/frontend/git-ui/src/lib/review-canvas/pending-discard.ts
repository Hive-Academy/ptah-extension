import type { GitFileStatus } from '@ptah-extension/shared';
import type { StatusSection } from './changed-file-tree-rows';

/** What the changed-file tree's discard dialog was opened for. */
export type PendingDiscard =
  | {
      readonly kind: 'file';
      readonly workspaceRoot: string;
      readonly section: StatusSection;
      readonly path: string;
      readonly untracked: boolean;
    }
  | {
      /** Discard all, from the Changes section header. */
      readonly kind: 'all';
      readonly workspaceRoot: string;
      /** The Changes section's paths when the dialog opened: what it counted. */
      readonly paths: readonly string[];
      readonly untrackedCount: number;
      /** Conflicted (unmerged) Changes entries left out of `paths`. */
      readonly conflictedCount: number;
    };

/**
 * Discard all over the Changes section: every unstaged entry in `statusFiles`
 * — the whole section, not just the rows a filter leaves visible — except
 * conflicted (unmerged) entries, which discard all never resolves; null when
 * nothing is left. The dialog counts, and the confirm discards, exactly
 * these paths.
 */
export function pendingDiscardAll(
  workspaceRoot: string,
  statusFiles: readonly GitFileStatus[],
): PendingDiscard | null {
  const unstaged = statusFiles.filter((file) => file.staged === false);
  const files = unstaged.filter((file) => file.status !== 'U');
  if (files.length === 0) return null;
  return {
    kind: 'all',
    workspaceRoot,
    paths: files.map((file) => file.path),
    untrackedCount: files.filter((file) => file.status === '??').length,
    conflictedCount: unstaged.length - files.length,
  };
}

/** The words the confirmation dialog shows for a pending discard. */
export interface DiscardConfirmCopy {
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
}

const NO_COPY: DiscardConfirmCopy = {
  title: '',
  description: '',
  confirmLabel: '',
};

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function discardAllDescription(
  total: number,
  untrackedCount: number,
  conflictedCount: number,
): string {
  const tracked = total - untrackedCount;
  const parts = [
    tracked > 0 ? `changes to ${plural(tracked, 'tracked file')} are lost` : '',
    untrackedCount > 0
      ? `${plural(untrackedCount, 'untracked file')} ${untrackedCount === 1 ? 'is' : 'are'} deleted from disk`
      : '',
  ].filter(Boolean);
  const skipped =
    conflictedCount > 0
      ? ` ${plural(conflictedCount, 'conflicted file')} ${conflictedCount === 1 ? 'is' : 'are'} skipped.`
      : '';
  const scope = conflictedCount > 0 ? '' : 'All ';
  return (
    `${scope}${plural(total, 'file')} in Changes will be discarded: ` +
    `${parts.join(' and ')}.${skipped} Staged changes are kept. This cannot be undone.`
  );
}

/** Title, description and confirm label for the discard dialog. */
export function discardConfirmCopy(
  pending: PendingDiscard | null,
): DiscardConfirmCopy {
  if (!pending) return NO_COPY;
  if (pending.kind === 'all') {
    return {
      title: 'Discard all changes?',
      description: discardAllDescription(
        pending.paths.length,
        pending.untrackedCount,
        pending.conflictedCount,
      ),
      confirmLabel: 'Discard all',
    };
  }
  return pending.untracked
    ? {
        title: 'Delete this untracked file?',
        description: `${pending.path} is not tracked by git. Deleting it cannot be undone.`,
        confirmLabel: 'Delete file',
      }
    : {
        title: 'Discard these changes?',
        description: `Your changes to ${pending.path} will be lost. This cannot be undone.`,
        confirmLabel: 'Discard changes',
      };
}
