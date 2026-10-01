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
 * NUL-delimited (`-z`) output is preferred because Git emits paths verbatim in
 * that mode. The line-delimited form remains supported for existing callers.
 *
 * Format (blocks separated by blank lines):
 *   worktree <path>
 *   HEAD <sha>
 *   branch refs/heads/<name>
 *   [bare]
 *   [detached]
 *   [locked[ <reason>]]
 *   [prunable[ <reason>]]
 *
 * `locked` and `prunable` set their flag; a reason, when git gives one, is
 * kept verbatim. In the line-delimited form git C-quotes a reason containing
 * a newline — only the NUL form preserves it exactly.
 *
 * @param output - Raw stdout from `git worktree list --porcelain`
 * @returns Parsed worktree entries. The first entry is marked as the main worktree.
 */
export function parseWorktreeList(output: string): GitWorktreeInfo[] {
  const worktrees: GitWorktreeInfo[] = [];
  const nulDelimited = output.includes('\0');
  const normalizedOutput = nulDelimited
    ? output
    : output.replace(/\r\n/g, '\n');
  const blocks = normalizedOutput.split(nulDelimited ? '\0\0' : '\n\n');

  for (const block of blocks) {
    if (!block) continue;

    const lines = block.split(nulDelimited ? '\0' : '\n');
    let wtPath = '';
    let head = '';
    let branch = '';
    let isBare = false;
    let lockReason: string | undefined;
    let locked = false;
    let prunableReason: string | undefined;
    let prunable = false;

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        wtPath = line.substring('worktree '.length);
      } else if (line.startsWith('HEAD ')) {
        head = line.substring('HEAD '.length).substring(0, 8);
      } else if (line.startsWith('branch ')) {
        const ref = line.substring('branch '.length);
        branch = ref.startsWith('refs/heads/')
          ? ref.substring('refs/heads/'.length)
          : ref;
      } else if (line === 'bare') {
        isBare = true;
      } else if (line === 'detached') {
        branch = 'HEAD (detached)';
      } else if (line === 'locked' || line.startsWith('locked ')) {
        locked = true;
        lockReason = line.substring('locked '.length) || undefined;
      } else if (line === 'prunable' || line.startsWith('prunable ')) {
        prunable = true;
        prunableReason = line.substring('prunable '.length) || undefined;
      }
    }

    if (wtPath) {
      const entry: GitWorktreeInfo = {
        path: wtPath,
        head,
        branch: branch || 'HEAD',
        isMain: worktrees.length === 0,
        isBare,
      };
      if (locked) {
        entry.locked = true;
        if (lockReason !== undefined) entry.lockReason = lockReason;
      }
      if (prunable) {
        entry.prunable = true;
        if (prunableReason !== undefined) entry.prunableReason = prunableReason;
      }
      worktrees.push(entry);
    }
  }

  return worktrees;
}
