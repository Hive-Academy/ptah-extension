/**
 * Git Namespace Builder
 *
 * Git worktree MCP tools for AI agent access.
 * Provides worktreeList, worktreeAdd, worktreeRemove methods for managing
 * git worktrees via the CLI. Uses cross-spawn for cross-platform compatibility
 * (handles Windows .cmd wrappers automatically without shell: true).
 *
 * Pattern: namespace-builders/agent-namespace.builder.ts
 */

import * as path from 'path';
import type { GitNamespace } from '../types';
import { execGit, WORKTREE_GIT_TIMEOUT_MS } from '@ptah-extension/vscode-core';
import {
  parseWorktreeList,
  type GitWorktreeInfo,
} from '@ptah-extension/shared';

/**
 * Callback for worktree change notifications.
 * Fired after a worktree is successfully added or removed via the MCP tool,
 * so the frontend can refresh its worktree list and file explorer.
 */
export type WorktreeChangeCallback = (event: {
  action: 'created' | 'removed';
  worktreePath?: string;
  branch?: string;
}) => void;

/**
 * Dependencies required to build the git namespace.
 * getWorkspaceRoot is a lazy getter called at invocation time to get the current workspace.
 */
export interface GitNamespaceDependencies {
  /** Lazy getter for workspace root path. Called at each git operation to get the current workspace. */
  getWorkspaceRoot: () => string;
  /** Optional callback fired after worktree add/remove to notify frontend */
  onWorktreeChanged?: WorktreeChangeCallback;
}

/**
 * Build the git namespace with worktree operations.
 *
 * Delegates subprocess execution to the shared `execGit` helper in vscode-core,
 * with a worktree-sized timeout (`WORKTREE_GIT_TIMEOUT_MS`) and cross-platform
 * process-tree kill on timeout.
 */
export function buildGitNamespace(
  deps: GitNamespaceDependencies,
): GitNamespace {
  const { getWorkspaceRoot, onWorktreeChanged } = deps;

  function runGit(
    args: string[],
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const cwd = getWorkspaceRoot();
    if (!cwd) {
      return Promise.reject(
        new Error(
          'Cannot run git: workspace root is not resolved. Open a workspace folder first.',
        ),
      );
    }
    return execGit(args, cwd, { timeoutMs: WORKTREE_GIT_TIMEOUT_MS });
  }

  return {
    async worktreeList(): Promise<{
      worktrees: GitWorktreeInfo[];
      error?: string;
    }> {
      try {
        const { stdout, stderr, exitCode } = await runGit([
          'worktree',
          'list',
          '--porcelain',
        ]);

        if (exitCode !== 0) {
          const errorMsg =
            stderr.trim() || 'git worktree list failed (non-zero exit code)';
          return { worktrees: [], error: errorMsg };
        }

        return { worktrees: parseWorktreeList(stdout) };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { worktrees: [], error: message };
      }
    },

    async worktreeAdd(params: {
      branch: string;
      path?: string;
      createBranch?: boolean;
    }): Promise<{ success: boolean; worktreePath?: string; error?: string }> {
      try {
        const worktreePath =
          params.path ||
          path.join(path.dirname(getWorkspaceRoot()), params.branch);

        const args = ['worktree', 'add'];
        if (params.createBranch) {
          args.push('-b', params.branch, worktreePath);
        } else {
          args.push(worktreePath, params.branch);
        }

        const { exitCode, stderr } = await runGit(args);

        if (exitCode !== 0) {
          return {
            success: false,
            error: stderr.trim() || 'Failed to add worktree',
          };
        }
        if (onWorktreeChanged) {
          onWorktreeChanged({
            action: 'created',
            worktreePath,
            branch: params.branch,
          });
        }

        return { success: true, worktreePath };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
      }
    },

    async worktreeRemove(params: {
      path: string;
      force?: boolean;
    }): Promise<{ success: boolean; error?: string }> {
      try {
        const args = ['worktree', 'remove'];
        if (params.force) {
          args.push('--force');
        }
        args.push(params.path);

        const { exitCode, stderr } = await runGit(args);

        if (exitCode !== 0) {
          return {
            success: false,
            error: stderr.trim() || 'Failed to remove worktree',
          };
        }
        if (onWorktreeChanged) {
          try {
            onWorktreeChanged({
              action: 'removed',
              worktreePath: params.path,
            });
          } catch {
            void 0;
          }
        }

        return { success: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
      }
    },
  };
}
