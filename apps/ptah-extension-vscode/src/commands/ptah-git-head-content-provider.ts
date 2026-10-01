/**
 * Read-only `ptah-git-head:` documents: the HEAD side of a file for the
 * native diff and changes editors opened by the `ptah.review.*` commands
 * (TASK_2026_576, Requirement 5.7).
 *
 * The provider is Ptah's own, so a diff opens without the built-in `vscode.git`
 * extension. A HEAD side that cannot be shown as text (too large, binary, an
 * LFS pointer, absent) is replaced by one explanatory line; the bytes are
 * never served.
 */

import * as vscode from 'vscode';
import type { GitInfoService, Logger } from '@ptah-extension/vscode-core';
import type { GitBlobRead } from '@ptah-extension/shared';

/** URI scheme of the HEAD side: `ptah-git-head:/<rel>?root=<folderIndex>`. */
export const PTAH_GIT_HEAD_SCHEME = 'ptah-git-head';

const ROOT_QUERY_KEY = 'root';

/**
 * The HEAD-side URI of `relativePath` (forward slashes) inside the workspace
 * folder at `folderIndex`.
 */
export function toGitHeadUri(
  relativePath: string,
  folderIndex: number,
): vscode.Uri {
  return vscode.Uri.from({
    scheme: PTAH_GIT_HEAD_SCHEME,
    path: `/${relativePath}`,
    query: `${ROOT_QUERY_KEY}=${folderIndex}`,
  });
}

/** Serves `GitInfoService.readHeadText` as read-only text documents. */
export class PtahGitHeadContentProvider
  implements vscode.TextDocumentContentProvider
{
  constructor(
    private readonly gitInfo: Pick<GitInfoService, 'readHeadText'>,
    private readonly logger: Logger,
  ) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const target = resolveTarget(uri);
    if (!target) {
      return 'This HEAD version is not available: the workspace folder is no longer open.';
    }

    let read: GitBlobRead;
    try {
      read = await this.gitInfo.readHeadText(target.root, target.relativePath);
    } catch (error: unknown) {
      return this.readFailed(
        error instanceof Error ? error.message : String(error),
      );
    }
    if (read.outcome === 'error') {
      return this.readFailed(`${read.code}: ${read.message}`);
    }
    return describeRead(read);
  }

  /**
   * Empty left side plus a status-bar warning: the user still sees the
   * working-tree side. The git detail stays in the log.
   */
  private readFailed(detail: string): string {
    this.logger.warn('[PtahGitHeadContentProvider] HEAD read failed', {
      error: detail,
    });
    vscode.window.setStatusBarMessage(
      '$(warning) Ptah could not read the HEAD version of this file.',
      5000,
    );
    return '';
  }
}

function resolveTarget(
  uri: vscode.Uri,
): { root: string; relativePath: string } | null {
  const rawIndex = new URLSearchParams(uri.query).get(ROOT_QUERY_KEY);
  if (rawIndex === null || !/^\d+$/.test(rawIndex)) return null;
  const folder = vscode.workspace.workspaceFolders?.[Number(rawIndex)];
  const relativePath = uri.path.replace(/^\/+/, '');
  if (!folder || !relativePath) return null;
  return { root: folder.uri.fsPath, relativePath };
}

function describeRead(read: Exclude<GitBlobRead, { outcome: 'error' }>): string {
  switch (read.outcome) {
    case 'content':
      return read.content;
    case 'absent':
      return 'This file does not exist at HEAD.';
    case 'binary':
      return `Binary file at HEAD (${read.byteLength} bytes) — not shown.`;
    case 'too-large':
      return `File at HEAD is too large to show (${read.byteLength} bytes).`;
    case 'lfs-pointer':
      return `Git LFS object at HEAD (${read.size} bytes) — not shown.`;
  }
}
