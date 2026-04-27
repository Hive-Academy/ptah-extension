/**
 * Git RPC Handlers
 *
 * Handles Git-related RPC methods for all hosts that have a real workspace:
 * - git:info             - Get branch info + file status for active workspace
 * - git:worktrees        - List all worktrees for active workspace
 * - git:addWorktree      - Create a new worktree
 * - git:removeWorktree   - Remove an existing worktree
 * - git:stage            - Stage files in the git index
 * - git:unstage          - Unstage files from the git index
 * - git:discard          - Discard working tree changes (destructive)
 * - git:commit           - Create a commit with the provided message
 * - git:showFile         - Show file content from HEAD revision
 *
 * TASK_2025_227 Batch 2: Git info bar + worktree management.
 * TASK_2026_104 Sub-batch B5b: Lifted from `apps/ptah-electron/...` into the
 * shared `rpc-handlers` library so all hosts (Electron, CLI, and the VS Code
 * extension if it registers `TOKENS.GIT_INFO_SERVICE`) can serve `git:*`
 * uniformly. The handler now reads `GitInfoService` from the shared
 * `vscode-core` library and resolves it via `TOKENS.GIT_INFO_SERVICE`
 * (no more `ELECTRON_TOKENS` dependency).
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type {
  GitInfoService,
  Logger,
  RpcHandler,
} from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type {
  GitInfoResult,
  GitWorktreesResult,
  GitAddWorktreeParams,
  GitAddWorktreeResult,
  GitRemoveWorktreeParams,
  GitRemoveWorktreeResult,
  GitStageParams,
  GitStageResult,
  GitUnstageParams,
  GitUnstageResult,
  GitDiscardParams,
  GitDiscardResult,
  GitCommitParams,
  GitCommitResult,
  GitShowFileParams,
  GitShowFileResult,
  RpcMethodName,
} from '@ptah-extension/shared';

@injectable()
export class GitRpcHandlers {
  /**
   * RPC methods owned by this handler. Used by the SHARED_HANDLERS coverage
   * invariant in `register-all.ts`.
   */
  static readonly METHODS = [
    'git:info',
    'git:worktrees',
    'git:addWorktree',
    'git:removeWorktree',
    'git:stage',
    'git:unstage',
    'git:discard',
    'git:commit',
    'git:showFile',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(TOKENS.GIT_INFO_SERVICE)
    private readonly gitInfo: GitInfoService,
  ) {}

  register(): void {
    this.registerGitInfo();
    this.registerGitWorktrees();
    this.registerAddWorktree();
    this.registerRemoveWorktree();
    // Source control methods (TASK_2025_273)
    this.registerGitStage();
    this.registerGitUnstage();
    this.registerGitDiscard();
    this.registerGitCommit();
    this.registerGitShowFile();
  }

  /**
   * git:info - Returns branch info and changed file list for the active workspace.
   * If no workspace is open or it's not a git repo, returns a non-git default.
   */
  private registerGitInfo(): void {
    this.rpcHandler.registerMethod<Record<string, never>, GitInfoResult>(
      'git:info',
      async () => {
        const wsRoot = this.workspace.getWorkspaceRoot();
        if (!wsRoot) {
          this.logger.debug('[GitRpc] git:info called with no workspace open');
          return {
            isGitRepo: false,
            branch: { branch: '', upstream: null, ahead: 0, behind: 0 },
            files: [],
          };
        }

        return this.gitInfo.getGitInfo(wsRoot);
      },
    );
  }

  /**
   * git:worktrees - Returns all worktrees for the active workspace.
   * If no workspace is open, returns an empty list.
   */
  private registerGitWorktrees(): void {
    this.rpcHandler.registerMethod<Record<string, never>, GitWorktreesResult>(
      'git:worktrees',
      async () => {
        const wsRoot = this.workspace.getWorkspaceRoot();
        if (!wsRoot) {
          return { worktrees: [] };
        }

        const worktrees = await this.gitInfo.getWorktrees(wsRoot);
        return { worktrees };
      },
    );
  }

  /**
   * git:addWorktree - Creates a new git worktree at the specified path/branch.
   * Delegates to GitInfoService.addWorktree() for the actual git CLI call.
   */
  private registerAddWorktree(): void {
    this.rpcHandler.registerMethod<GitAddWorktreeParams, GitAddWorktreeResult>(
      'git:addWorktree',
      async (params) => {
        const wsRoot = this.workspace.getWorkspaceRoot();
        if (!wsRoot) {
          return {
            success: false,
            error: 'No workspace folder open',
          };
        }

        if (!params?.branch) {
          return {
            success: false,
            error: 'branch is required',
          };
        }

        this.logger.info('[GitRpc] Adding worktree', {
          branch: params.branch,
          path: params.path,
          createBranch: params.createBranch,
        } as unknown as Error);

        return this.gitInfo.addWorktree(wsRoot, {
          branch: params.branch,
          path: params.path,
          createBranch: params.createBranch,
        });
      },
    );
  }

  /**
   * git:removeWorktree - Removes an existing git worktree.
   * Delegates to GitInfoService.removeWorktree() for the actual git CLI call.
   */
  private registerRemoveWorktree(): void {
    this.rpcHandler.registerMethod<
      GitRemoveWorktreeParams,
      GitRemoveWorktreeResult
    >('git:removeWorktree', async (params) => {
      const wsRoot = this.workspace.getWorkspaceRoot();
      if (!wsRoot) {
        return {
          success: false,
          error: 'No workspace folder open',
        };
      }

      if (!params?.path) {
        return {
          success: false,
          error: 'path is required',
        };
      }

      this.logger.info('[GitRpc] Removing worktree', {
        worktreePath: params.path,
        force: params.force,
      } as unknown as Error);

      return this.gitInfo.removeWorktree(wsRoot, params.path, params.force);
    });
  }

  // ==========================================================================
  // Source Control Handlers (TASK_2025_273)
  // ==========================================================================

  /**
   * git:stage - Stage files in the git index.
   */
  private registerGitStage(): void {
    this.rpcHandler.registerMethod<GitStageParams, GitStageResult>(
      'git:stage',
      async (params) => {
        const wsRoot = this.workspace.getWorkspaceRoot();
        if (!wsRoot) {
          return { success: false, error: 'No workspace folder open' };
        }

        if (!params?.paths || params.paths.length === 0) {
          return { success: false, error: 'paths must be a non-empty array' };
        }

        return this.gitInfo.stageFiles(wsRoot, params.paths);
      },
    );
  }

  /**
   * git:unstage - Unstage files from the git index.
   */
  private registerGitUnstage(): void {
    this.rpcHandler.registerMethod<GitUnstageParams, GitUnstageResult>(
      'git:unstage',
      async (params) => {
        const wsRoot = this.workspace.getWorkspaceRoot();
        if (!wsRoot) {
          return { success: false, error: 'No workspace folder open' };
        }

        if (!params?.paths || params.paths.length === 0) {
          return { success: false, error: 'paths must be a non-empty array' };
        }

        return this.gitInfo.unstageFiles(wsRoot, params.paths);
      },
    );
  }

  /**
   * git:discard - Discard working tree changes (destructive).
   */
  private registerGitDiscard(): void {
    this.rpcHandler.registerMethod<GitDiscardParams, GitDiscardResult>(
      'git:discard',
      async (params) => {
        const wsRoot = this.workspace.getWorkspaceRoot();
        if (!wsRoot) {
          return { success: false, error: 'No workspace folder open' };
        }

        if (!params?.paths || params.paths.length === 0) {
          return { success: false, error: 'paths must be a non-empty array' };
        }

        this.logger.warn(
          '[GitRpc] git:discard called — this is a destructive operation',
          { paths: params.paths } as unknown as Error,
        );

        return this.gitInfo.discardChanges(wsRoot, params.paths);
      },
    );
  }

  /**
   * git:commit - Create a commit with the provided message.
   */
  private registerGitCommit(): void {
    this.rpcHandler.registerMethod<GitCommitParams, GitCommitResult>(
      'git:commit',
      async (params) => {
        const wsRoot = this.workspace.getWorkspaceRoot();
        if (!wsRoot) {
          return { success: false, error: 'No workspace folder open' };
        }

        if (!params?.message || !params.message.trim()) {
          return { success: false, error: 'Commit message cannot be empty' };
        }

        return this.gitInfo.commit(wsRoot, params.message);
      },
    );
  }

  /**
   * git:showFile - Show file content from HEAD revision.
   */
  private registerGitShowFile(): void {
    this.rpcHandler.registerMethod<GitShowFileParams, GitShowFileResult>(
      'git:showFile',
      async (params) => {
        const wsRoot = this.workspace.getWorkspaceRoot();
        if (!wsRoot) {
          return { content: '' };
        }

        if (!params?.path || !params.path.trim()) {
          return { content: '' };
        }

        return this.gitInfo.showFile(wsRoot, params.path);
      },
    );
  }
}
