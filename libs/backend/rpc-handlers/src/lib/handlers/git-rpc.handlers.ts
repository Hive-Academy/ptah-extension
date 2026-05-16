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
 * - git:branches         - List local/remote branches with ahead/behind counts
 * - git:checkout         - Checkout a branch (with dirty-tree guard)
 * - git:stashList        - List all stash entries
 * - git:tags             - List tags sorted by creation date
 * - git:remotes          - List configured remotes
 * - git:lastCommit       - Get the last commit details for a ref
 *
 * Lifted from `apps/ptah-electron/...` into the
 * shared `rpc-handlers` library so all hosts (Electron, CLI, and the VS Code
 * extension if it registers `TOKENS.GIT_INFO_SERVICE`) can serve `git:*`
 * uniformly. The handler reads `GitInfoService` from the shared
 * `vscode-core` library and resolves it via `TOKENS.GIT_INFO_SERVICE`.
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
  GitBranchesParams,
  GitBranchesResult,
  GitCheckoutParams,
  GitCheckoutResult,
  GitStashListParams,
  GitStashListResult,
  GitTagsParams,
  GitTagsResult,
  GitRemotesParams,
  GitRemotesResult,
  GitLastCommitParams,
  GitLastCommitResult,
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
    'git:branches',
    'git:checkout',
    'git:stashList',
    'git:tags',
    'git:remotes',
    'git:lastCommit',
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
    // Source control methods
    this.registerGitStage();
    this.registerGitUnstage();
    this.registerGitDiscard();
    this.registerGitCommit();
    this.registerGitShowFile();
    // Branch/tag/remote/stash methods
    this.registerGitBranches();
    this.registerGitCheckout();
    this.registerGitStashList();
    this.registerGitTags();
    this.registerGitRemotes();
    this.registerGitLastCommit();
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
  // Source Control Handlers
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

  // ==========================================================================
  // Branch, Checkout, Stash, Tag, Remote, Last-Commit Handlers
  // ==========================================================================

  /**
   * git:branches - List local (and optionally remote) branches with ahead/behind counts.
   * Returns an empty result when no workspace is open (CLI adapter path).
   */
  private registerGitBranches(): void {
    this.rpcHandler.registerMethod<GitBranchesParams, GitBranchesResult>(
      'git:branches',
      async (params) => {
        const wsRoot = this.workspace.getWorkspaceRoot();
        if (!wsRoot) {
          this.logger.debug(
            '[GitRpc] git:branches called with no workspace open',
          );
          return { current: '', local: [], remote: [] };
        }

        return this.gitInfo.getBranches(wsRoot, params?.includeRemote);
      },
    );
  }

  /**
   * git:checkout - Checkout a branch, optionally creating it.
   * Returns { success: false, dirty: true } when working tree is dirty and force=false.
   * Validates that branch param is non-empty before delegating.
   */
  private registerGitCheckout(): void {
    this.rpcHandler.registerMethod<GitCheckoutParams, GitCheckoutResult>(
      'git:checkout',
      async (params) => {
        const wsRoot = this.workspace.getWorkspaceRoot();
        if (!wsRoot) {
          return { success: false, error: 'No workspace folder open' };
        }

        if (!params?.branch?.trim()) {
          return { success: false, error: 'branch is required' };
        }

        this.logger.debug('[GitRpc] git:checkout', {
          branch: params.branch,
          createNew: params.createNew,
          force: params.force,
        } as unknown as Error);

        return this.gitInfo.checkout(
          wsRoot,
          params.branch,
          params.createNew,
          params.force,
        );
      },
    );
  }

  /**
   * git:stashList - List all stash entries for the active workspace.
   */
  private registerGitStashList(): void {
    this.rpcHandler.registerMethod<GitStashListParams, GitStashListResult>(
      'git:stashList',
      async () => {
        const wsRoot = this.workspace.getWorkspaceRoot();
        if (!wsRoot) {
          return { count: 0, entries: [] };
        }

        return this.gitInfo.stashList(wsRoot);
      },
    );
  }

  /**
   * git:tags - List tags sorted by creation date (newest first).
   */
  private registerGitTags(): void {
    this.rpcHandler.registerMethod<GitTagsParams, GitTagsResult>(
      'git:tags',
      async (params) => {
        const wsRoot = this.workspace.getWorkspaceRoot();
        if (!wsRoot) {
          return { tags: [] };
        }

        return this.gitInfo.getTags(wsRoot, params?.limit);
      },
    );
  }

  /**
   * git:remotes - List all configured remotes with fetch and push URLs.
   */
  private registerGitRemotes(): void {
    this.rpcHandler.registerMethod<GitRemotesParams, GitRemotesResult>(
      'git:remotes',
      async () => {
        const wsRoot = this.workspace.getWorkspaceRoot();
        if (!wsRoot) {
          return { remotes: [] };
        }

        return this.gitInfo.getRemotes(wsRoot);
      },
    );
  }

  /**
   * git:lastCommit - Get the last commit details for a ref (default: HEAD).
   */
  private registerGitLastCommit(): void {
    this.rpcHandler.registerMethod<GitLastCommitParams, GitLastCommitResult>(
      'git:lastCommit',
      async (params) => {
        const wsRoot = this.workspace.getWorkspaceRoot();
        if (!wsRoot) {
          return {
            hash: '',
            shortHash: '',
            subject: '',
            body: '',
            author: '',
            authorEmail: '',
            time: 0,
          };
        }

        return this.gitInfo.getLastCommit(wsRoot, params?.ref);
      },
    );
  }
}
