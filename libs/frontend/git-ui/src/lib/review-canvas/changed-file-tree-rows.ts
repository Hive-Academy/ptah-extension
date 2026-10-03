import type {
  GitConflictKind,
  GitFileStatus,
  GitReviewFile,
} from '@ptah-extension/shared';
import type { FileStatusCode } from '@ptah-extension/ui';
import { buildChangedFileTree } from '../source-control/changed-file-tree';
import type { ChangedFileTreeNode } from '../source-control/changed-file-tree';

/**
 * The flat, ARIA-ready row model of `ChangedFileTreeComponent`: one row per
 * section, folder and file in display order, each with its level, set
 * position and the collapsible rows above it.
 */

export type StatusSection = 'staged' | 'unstaged';

/** One file of either source, normalized for the rows. */
export interface TreeFile {
  readonly path: string;
  readonly originalPath?: string;
  readonly status: FileStatusCode;
  readonly conflictKind?: GitConflictKind;
  readonly additions: number | null;
  readonly deletions: number | null;
  readonly binary: boolean;
  /** `null` for branch and historical comparisons. */
  readonly staged: boolean | null;
  readonly isDirectory?: boolean;
}

interface TreeRowBase {
  readonly id: string;
  readonly level: number;
  readonly setSize: number;
  readonly posInSet: number;
  readonly parentId: string | null;
  /** Every collapsible row above this one, outermost first. */
  readonly ancestorIds: readonly string[];
}

export type TreeRow =
  | (TreeRowBase & {
      readonly kind: 'section';
      readonly section: StatusSection;
      readonly label: string;
      readonly count: number;
    })
  | (TreeRowBase & {
      readonly kind: 'folder';
      readonly name: string;
      readonly path: string;
    })
  | (TreeRowBase & {
      readonly kind: 'file';
      readonly name: string;
      readonly file: TreeFile;
    });

export type TreeFileRow = Extract<TreeRow, { kind: 'file' }>;

const SECTION_LABEL: Readonly<Record<StatusSection, string>> = {
  staged: 'Staged',
  unstaged: 'Changes',
};

/** A section header's bulk action: unstage all (Staged), stage all (Changes). */
export const SECTION_BULK_ACTION: Readonly<
  Record<StatusSection, { title: string; label: string; testId: string }>
> = {
  staged: {
    title: 'Unstage all',
    label: 'Unstage all files',
    testId: 'tree-unstage-all',
  },
  unstaged: {
    title: 'Stage all',
    label: 'Stage all files',
    testId: 'tree-stage-all',
  },
};

function fromStatus(file: GitFileStatus): TreeFile {
  return {
    path: file.path,
    ...(file.origPath ? { originalPath: file.origPath } : {}),
    status: file.status,
    ...(file.conflict ? { conflictKind: file.conflict.kind } : {}),
    additions: file.additions ?? null,
    deletions: file.deletions ?? null,
    binary: file.binary ?? false,
    staged: file.staged,
    ...(file.isDirectory ? { isDirectory: true } : {}),
  };
}

function fromReview(file: GitReviewFile): TreeFile {
  return {
    path: file.path,
    ...(file.originalPath ? { originalPath: file.originalPath } : {}),
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    binary: file.binary,
    staged: null,
  };
}

/** Append `nodes` (and their descendants) to `out` in display order. */
function flattenNodes(
  nodes: readonly ChangedFileTreeNode<TreeFile>[],
  scope: string,
  level: number,
  parentId: string | null,
  ancestorIds: readonly string[],
  out: TreeRow[],
): void {
  nodes.forEach((node, index) => {
    const id = `${scope}\u0000${node.kind}\u0000${node.path}`;
    const base = {
      id,
      level,
      setSize: nodes.length,
      posInSet: index + 1,
      parentId,
      ancestorIds,
    };
    if (node.kind === 'folder') {
      out.push({ ...base, kind: 'folder', name: node.name, path: node.path });
      flattenNodes(
        node.children,
        scope,
        level + 1,
        id,
        [...ancestorIds, id],
        out,
      );
    } else {
      out.push({ ...base, kind: 'file', name: node.name, file: node.file });
    }
  });
}

/**
 * Every row, ignoring collapse. Status comparisons list the git status in a
 * Staged and a Changes section; branch and historical list the review files.
 */
export function buildTreeRows(
  statusMode: boolean,
  statusFiles: readonly GitFileStatus[],
  reviewFiles: readonly GitReviewFile[],
  query: string,
): readonly TreeRow[] {
  const out: TreeRow[] = [];
  if (!statusMode) {
    const files = reviewFiles.map(fromReview);
    flattenNodes(buildChangedFileTree(files, query), 'files', 1, null, [], out);
    return out;
  }
  const all = statusFiles.map(fromStatus);
  const sections: readonly StatusSection[] = ['staged', 'unstaged'];
  sections.forEach((section, index) => {
    const files = all.filter((file) => file.staged === (section === 'staged'));
    const id = `section\u0000${section}`;
    out.push({
      id,
      kind: 'section',
      section,
      label: SECTION_LABEL[section],
      count: files.length,
      level: 1,
      setSize: sections.length,
      posInSet: index + 1,
      parentId: null,
      ancestorIds: [],
    });
    flattenNodes(buildChangedFileTree(files, query), section, 2, id, [id], out);
  });
  return out;
}
