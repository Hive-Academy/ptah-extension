import { normalizeWorkspaceRoot } from '@ptah-extension/shared';
import type { GitFileStatus, GitReviewFile } from '@ptah-extension/shared';
import type { ReviewDiffComparison } from '../services/review-diff.service';
import type { ReviewScope } from '../services/review-navigation.service';
import type {
  ReviewCanvasFile,
  ReviewFileLabel,
} from './file-diff-section.component';

/**
 * Pure builders for the review canvas's file list: the section ids and the
 * `ReviewCanvasFile` records the canvas renders, from `git status` entries or
 * from review (branch / historical) entries.
 */

/** A section's id: its comparison kind plus both paths. */
export function reviewFileId(
  kind: string,
  path: string,
  originalPath?: string,
): string {
  return `${kind}\u0000${originalPath ?? path}\u0000${path}`;
}

/** The scope part of a reading-position key. */
export function reviewScopeId(
  scope: ReviewScope,
  branchRange: string | null,
): string {
  if (scope.kind === 'historical') {
    return `historical:${scope.base.sha}..${scope.head.sha}`;
  }
  if (scope.kind === 'worktree' && scope.root) {
    return `worktree:${normalizeWorkspaceRoot(scope.root)}`;
  }
  return scope.kind === 'branch' ? `branch:${branchRange ?? ''}` : scope.kind;
}

function statusLabel(file: GitFileStatus): ReviewFileLabel | null {
  if (file.status === 'U') return 'conflicted';
  if (file.submodule) return 'submodule';
  return file.binary ? 'binary' : null;
}

/**
 * A `git status` entry as a staged or working-tree section. `root` is the
 * read-only worktree the entry was read from; omitted for the active
 * workspace.
 */
export function statusCanvasFile(
  file: GitFileStatus,
  root?: string,
): ReviewCanvasFile {
  const kind = file.staged ? 'staged' : 'worktree';
  return {
    id: reviewFileId(kind, file.path, file.origPath),
    path: file.path,
    ...(file.origPath ? { originalPath: file.origPath } : {}),
    status: file.status,
    ...(file.conflict ? { conflictKind: file.conflict.kind } : {}),
    additions: file.additions ?? null,
    deletions: file.deletions ?? null,
    comparison: kind,
    request: {
      comparison: root ? { kind, root } : { kind },
      path: file.path,
      ...(file.origPath ? { origPath: file.origPath } : {}),
    },
    label: statusLabel(file),
  };
}

/** A branch-review or historical entry, read-only, over `comparison`. */
export function reviewCanvasFile(
  file: GitReviewFile,
  kind: ReviewScope['kind'],
  comparison: ReviewDiffComparison,
): ReviewCanvasFile {
  return {
    id: reviewFileId(kind, file.path, file.originalPath),
    path: file.path,
    ...(file.originalPath ? { originalPath: file.originalPath } : {}),
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    comparison: kind,
    request: {
      comparison,
      path: file.path,
      ...(file.originalPath ? { origPath: file.originalPath } : {}),
    },
    label: file.binary ? 'binary' : null,
  };
}
