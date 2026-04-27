/**
 * Git Utility Functions
 *
 * Pure utility functions for parsing git CLI output.
 * Shared across vscode-lm-tools (MCP namespace builder) and ptah-electron (GitInfoService).
 */

import type { GitWorktreeInfo } from '../types/rpc/rpc-git.types';

/**
 * Parse `git worktree list --porcelain` output into GitWorktreeInfo[].
 *
 * Format (blocks separated by blank lines):
 *   worktree <path>
 *   HEAD <sha>
 *   branch refs/heads/<name>
 *   [bare]
 *   [detached]
 *
 * @param output - Raw stdout from `git worktree list --porcelain`
 * @returns Parsed worktree entries. The first entry is marked as the main worktree.
 */
export function parseWorktreeList(output: string): GitWorktreeInfo[] {
  const worktrees: GitWorktreeInfo[] = [];
  const blocks = output.replace(/\r\n/g, '\n').trim().split('\n\n');

  for (const block of blocks) {
    if (!block.trim()) continue;

    const lines = block.trim().split('\n');
    let wtPath = '';
    let head = '';
    let branch = '';
    let isBare = false;

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        wtPath = line.substring('worktree '.length);
      } else if (line.startsWith('HEAD ')) {
        head = line.substring('HEAD '.length).substring(0, 8);
      } else if (line.startsWith('branch ')) {
        const ref = line.substring('branch '.length);
        // Strip refs/heads/ prefix
        branch = ref.startsWith('refs/heads/')
          ? ref.substring('refs/heads/'.length)
          : ref;
      } else if (line.trim() === 'bare') {
        isBare = true;
      } else if (line.trim() === 'detached') {
        branch = 'HEAD (detached)';
      }
    }

    if (wtPath) {
      worktrees.push({
        path: wtPath,
        head,
        branch: branch || 'HEAD',
        isMain: worktrees.length === 0,
        isBare,
      });
    }
  }

  return worktrees;
}
