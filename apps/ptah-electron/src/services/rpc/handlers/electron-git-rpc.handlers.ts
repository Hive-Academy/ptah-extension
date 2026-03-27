/**
 * Electron Git RPC Handlers
 *
 * Handles Git-related RPC methods for the Electron desktop app:
 * - git:info       - Get branch info + file status for active workspace
 * - git:worktrees  - List all worktrees for active workspace
 * - git:addWorktree    - Create a new worktree
 * - git:removeWorktree - Remove an existing worktree
 *
 * TASK_2025_227 Batch 2: Git info bar + worktree management
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type {
  GitInfoResult,
  GitWorktreesResult,
  GitAddWorktreeParams,
  GitAddWorktreeResult,
  GitRemoveWorktreeParams,
  GitRemoveWorktreeResult,
} from '@ptah-extension/shared';
import type { GitInfoService } from '../../git-info.service';
import { ELECTRON_TOKENS } from '../../../di/electron-tokens';

@injectable()
export class ElectronGitRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(ELECTRON_TOKENS.GIT_INFO_SERVICE)
    private readonly gitInfo: GitInfoService,
  ) {}

  register(): void {
    this.registerGitInfo();
    this.registerGitWorktrees();
    this.registerAddWorktree();
    this.registerRemoveWorktree();
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
          this.logger.debug(
            '[ElectronGitRpc] git:info called with no workspace open',
          );
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

        this.logger.info('[ElectronGitRpc] Adding worktree', {
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

      this.logger.info('[ElectronGitRpc] Removing worktree', {
        worktreePath: params.path,
        force: params.force,
      } as unknown as Error);

      return this.gitInfo.removeWorktree(wsRoot, params.path, params.force);
    });
  }
}
