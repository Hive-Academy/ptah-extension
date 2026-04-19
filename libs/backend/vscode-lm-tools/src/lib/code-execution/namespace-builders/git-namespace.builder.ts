/**
 * Git Namespace Builder
 * TASK_2025_236: Git worktree MCP tools for AI agent access
 *
 * Provides worktreeList, worktreeAdd, worktreeRemove methods for managing
 * git worktrees via the CLI. Uses cross-spawn for cross-platform compatibility
 * (handles Windows .cmd wrappers automatically without shell: true).
 *
 * Pattern: namespace-builders/agent-namespace.builder.ts
 */

import crossSpawn from 'cross-spawn';
import * as path from 'path';
import type { GitNamespace } from '../types';
import {
  parseWorktreeList,
  type GitWorktreeInfo,
} from '@ptah-extension/shared';

const GIT_TIMEOUT_MS = 10_000;

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
 * All git commands are executed via cross-spawn with a 10-second timeout.
 * cross-spawn handles Windows .cmd wrappers automatically, preventing
 * EINVAL/ENOENT errors without needing shell: true.
 *
 * @param deps - Dependencies containing the workspace root path
 * @returns GitNamespace with worktreeList, worktreeAdd, worktreeRemove methods
 */
export function buildGitNamespace(
  deps: GitNamespaceDependencies,
): GitNamespace {
  const { getWorkspaceRoot, onWorktreeChanged } = deps;

  /**
   * Execute a git command and return stdout/stderr/exitCode.
   * Uses cross-spawn which handles Windows .cmd wrappers automatically,
   * preventing EINVAL errors while keeping command injection safety
   * (no shell: true needed).
   *
   * @see apps/ptah-electron/src/services/git-info.service.ts for the same pattern
   */
  function execGit(
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
    return new Promise((resolve, reject) => {
      const child = crossSpawn('git', args, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          child.kill('SIGTERM');
          reject(
            new Error(`git ${args[0]} timed out after ${GIT_TIMEOUT_MS}ms`),
          );
        }
      }, GIT_TIMEOUT_MS);

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('close', (code: number | null) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          resolve({ stdout, stderr, exitCode: code ?? 1 });
        }
      });

      child.on('error', (error: Error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(error);
        }
      });
    });
  }

  return {
    async worktreeList(): Promise<{
      worktrees: GitWorktreeInfo[];
      error?: string;
    }> {
      try {
        const { stdout, stderr, exitCode } = await execGit([
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

        const { exitCode, stderr } = await execGit(args);

        if (exitCode !== 0) {
          return {
            success: false,
            error: stderr.trim() || 'Failed to add worktree',
          };
        }

        // Notify frontend about the new worktree so it can refresh UI
        if (onWorktreeChanged) {
          try {
            onWorktreeChanged({
              action: 'created',
              worktreePath,
              branch: params.branch,
            });
          } catch {
            // Notification failure should never break worktree creation
          }
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

        const { exitCode, stderr } = await execGit(args);

        if (exitCode !== 0) {
          return {
            success: false,
            error: stderr.trim() || 'Failed to remove worktree',
          };
        }

        // Notify frontend about the removal so it can refresh UI
        if (onWorktreeChanged) {
          try {
            onWorktreeChanged({
              action: 'removed',
              worktreePath: params.path,
            });
          } catch {
            // Notification failure should never break worktree removal
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
