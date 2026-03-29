/**
 * Git Namespace Builder
 * TASK_2025_236: Git worktree MCP tools for AI agent access
 *
 * Provides worktreeList, worktreeAdd, worktreeRemove methods for managing
 * git worktrees via the CLI. Uses child_process.execFile WITHOUT shell: true
 * to prevent command injection. On Windows, uses 'git.cmd' as the executable
 * since git is distributed as a .cmd wrapper.
 *
 * Pattern: namespace-builders/agent-namespace.builder.ts
 */

import { execFile } from 'child_process';
import * as path from 'path';
import type { GitNamespace } from '../types';
import type { GitWorktreeInfo } from '@ptah-extension/shared';

const GIT_TIMEOUT_MS = 10_000;

/**
 * Dependencies required to build the git namespace.
 * workspaceRoot is the absolute path to the current workspace directory.
 */
export interface GitNamespaceDependencies {
  workspaceRoot: string;
}

/**
 * Build the git namespace with worktree operations.
 *
 * All git commands are executed via child_process.execFile with a 10-second timeout.
 * On Windows, 'git.cmd' is used as the executable (shell: false to prevent injection).
 *
 * @param deps - Dependencies containing the workspace root path
 * @returns GitNamespace with worktreeList, worktreeAdd, worktreeRemove methods
 */
export function buildGitNamespace(
  deps: GitNamespaceDependencies,
): GitNamespace {
  const { workspaceRoot } = deps;

  /**
   * Platform-specific git executable.
   * On Windows, git is distributed as a .cmd wrapper, so we must use 'git.cmd'
   * when NOT using shell: true. This avoids ENOENT errors on Windows while
   * keeping shell: false to prevent command injection.
   *
   * @see apps/ptah-electron/src/services/git-info.service.ts for the cross-spawn pattern
   */
  const gitExecutable = process.platform === 'win32' ? 'git.cmd' : 'git';

  /**
   * Execute a git command and return stdout/stderr/exitCode.
   * Uses execFile WITHOUT shell: true to prevent command injection from
   * AI-provided branch names and paths. On Windows, 'git.cmd' is used
   * as the executable to handle the .cmd wrapper.
   */
  function execGit(
    args: string[],
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      execFile(
        gitExecutable,
        args,
        {
          cwd: workspaceRoot,
          timeout: GIT_TIMEOUT_MS,
          maxBuffer: 1024 * 1024, // 1MB buffer for large worktree lists
        },
        (error, stdout, stderr) => {
          if (error && 'killed' in error && error.killed) {
            reject(
              new Error(`git ${args[0]} timed out after ${GIT_TIMEOUT_MS}ms`),
            );
            return;
          }

          // execFile treats non-zero exit codes as errors,
          // but we want to handle them gracefully.
          // Node.js ExecFileException uses string codes (e.g. 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'),
          // so we simply use exit code 1 as fallback when error is truthy.
          const exitCode = error ? 1 : 0;
          resolve({
            stdout: typeof stdout === 'string' ? stdout : '',
            stderr: typeof stderr === 'string' ? stderr : '',
            exitCode,
          });
        },
      );
    });
  }

  /**
   * Parse git worktree list --porcelain output into GitWorktreeInfo[].
   *
   * Format (blocks separated by blank lines):
   *   worktree <path>
   *   HEAD <sha>
   *   branch refs/heads/<name>
   *   [bare]
   *   [detached]
   *
   * Logic ported from GitInfoService.parseWorktreeList() in
   * apps/ptah-electron/src/services/git-info.service.ts
   */
  function parseWorktreeList(output: string): GitWorktreeInfo[] {
    const worktrees: GitWorktreeInfo[] = [];
    const blocks = output.trim().split('\n\n');

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
          params.path || path.join(path.dirname(workspaceRoot), params.branch);

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

        return { success: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
      }
    },
  };
}
