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

import type { GitNamespace } from '../types';
import {
  execGit,
  resolveWorktreePath,
  WORKTREE_GIT_TIMEOUT_MS,
} from '@ptah-extension/vscode-core';
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
  /**
   * SDK session id of the agent whose MCP call created the worktree. Set only
   * on `created` when the caller resolves to an SDK session id.
   */
  sessionId?: string;
}) => void;

/** A worktree an agent's MCP call created, attributed to the calling session. */
export interface CallerWorktreeRecord {
  /** SDK session id of the caller, never a webview tab id. */
  sessionId: string;
  worktreePath: string;
  branch: string;
}

/**
 * Dependencies required to build the git namespace.
 * getWorkspaceRoot is a lazy getter called at invocation time to get the current workspace.
 */
export interface GitNamespaceDependencies {
  /** Lazy getter for workspace root path. Called at each git operation to get the current workspace. */
  getWorkspaceRoot: () => string;
  /** Optional callback fired after worktree add/remove to notify frontend */
  onWorktreeChanged?: WorktreeChangeCallback;
  /**
   * Resolves the SDK session id of the session that issued the current MCP
   * call, or `undefined` when there is no caller or it has no SDK id yet.
   * Must never return a webview tab id.
   */
  resolveCallerSessionId?: () => string | undefined;
  /**
   * Records a successfully added worktree on the calling session. This is the
   * only MCP worktree capture path: the shared `onWorktreeChanged` handler
   * records nothing, because agent session start reuses it for child
   * worktrees that must not land on the parent.
   */
  recordWorktreeForCaller?: (record: CallerWorktreeRecord) => void;
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
  const {
    getWorkspaceRoot,
    onWorktreeChanged,
    resolveCallerSessionId,
    recordWorktreeForCaller,
  } = deps;

  /**
   * Attribute a created worktree to the calling session. Returns the caller's
   * SDK session id when one resolves, so the change event can carry it.
   * Capture is best-effort: a resolver or recorder failure never turns a
   * worktree that git already created into a failed add.
   */
  function captureForCaller(
    worktreePath: string,
    branch: string,
  ): string | undefined {
    let sessionId: string | undefined;
    try {
      sessionId = resolveCallerSessionId?.() || undefined;
      if (sessionId && recordWorktreeForCaller) {
        recordWorktreeForCaller({ sessionId, worktreePath, branch });
      }
    } catch {
      // Recorder contract is never-throw; this guards a faulty implementation
      // so the successful add is still reported as one.
      void 0;
    }
    return sessionId;
  }

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
          '-z',
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
        const workspaceRoot = getWorkspaceRoot();
        if (!workspaceRoot) {
          throw new Error(
            'Cannot add worktree: workspace root is not resolved. Open a workspace folder first.',
          );
        }
        const worktreePath = resolveWorktreePath(
          workspaceRoot,
          params.branch,
          params.path,
        );

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
        const sessionId = captureForCaller(worktreePath, params.branch);
        if (onWorktreeChanged) {
          onWorktreeChanged({
            action: 'created',
            worktreePath,
            branch: params.branch,
            ...(sessionId ? { sessionId } : {}),
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
