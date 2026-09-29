import { Injectable, inject } from '@angular/core';
import {
  VSCodeService,
  rpcCall,
  type RpcCallResult,
} from '@ptah-extension/core';
import { GIT_HOOK_TIMEOUT_MS, gitRpcTimeoutFor } from '@ptah-extension/shared';
import type {
  GitStageResult,
  GitUnstageResult,
  GitDiscardResult,
  GitCommitResult,
  GitShowFileResult,
} from '@ptah-extension/shared';
import { GitStatusService } from './git-status.service';

/**
 * Renderer timeout for every index / working-tree mutation. Commit runs its
 * hooks under the backend hook timeout, and stage, unstage and discard take
 * the same repository write lock, so they can queue behind that commit
 * (TASK_2026_576 RC8, V1). The margin lets the backend's typed result arrive
 * before the renderer gives up.
 */
const MUTATION_RPC_TIMEOUT_MS = gitRpcTimeoutFor(GIT_HOOK_TIMEOUT_MS);

/**
 * SourceControlService - Frontend RPC wrapper for git source control operations.
 *
 * Complexity Level: 1 (Simple RPC delegation, no internal state)
 * Patterns: Injectable service, RPC delegation
 *
 * Responsibilities:
 * - Stage/unstage individual files and all files
 * - Discard working tree changes
 * - Create commits
 * - Retrieve original file content from HEAD for diff views
 *
 * Communication: Uses rpcCall utility for MESSAGE_TYPES.RPC_CALL / RPC_RESPONSE with correlationId.
 */
@Injectable({ providedIn: 'root' })
export class SourceControlService {
  private readonly vscodeService = inject(VSCodeService);
  private readonly gitStatus = inject(GitStatusService);

  /**
   * Stage a single file.
   * @param path - Relative path from workspace root
   */
  async stageFile(path: string): Promise<RpcCallResult<GitStageResult>> {
    return rpcCall<GitStageResult>(
      this.vscodeService,
      'git:stage',
      {
        paths: [path],
        ...this.scopeParams(),
      },
      MUTATION_RPC_TIMEOUT_MS,
    );
  }

  /**
   * Unstage a single file.
   * @param path - Relative path from workspace root
   */
  async unstageFile(path: string): Promise<RpcCallResult<GitUnstageResult>> {
    return rpcCall<GitUnstageResult>(
      this.vscodeService,
      'git:unstage',
      {
        paths: [path],
        ...this.scopeParams(),
      },
      MUTATION_RPC_TIMEOUT_MS,
    );
  }

  /**
   * Stage all changed files in the workspace.
   */
  async stageAll(): Promise<RpcCallResult<GitStageResult>> {
    return rpcCall<GitStageResult>(
      this.vscodeService,
      'git:stage',
      {
        paths: ['.'],
        ...this.scopeParams(),
      },
      MUTATION_RPC_TIMEOUT_MS,
    );
  }

  /**
   * Unstage all staged files in the workspace.
   */
  async unstageAll(): Promise<RpcCallResult<GitUnstageResult>> {
    return rpcCall<GitUnstageResult>(
      this.vscodeService,
      'git:unstage',
      {
        paths: ['.'],
        ...this.scopeParams(),
      },
      MUTATION_RPC_TIMEOUT_MS,
    );
  }

  /**
   * Discard working tree changes for a file.
   * WARNING: This is a destructive operation that cannot be undone.
   * @param path - Relative path from workspace root
   */
  async discardChanges(path: string): Promise<RpcCallResult<GitDiscardResult>> {
    return rpcCall<GitDiscardResult>(
      this.vscodeService,
      'git:discard',
      {
        paths: [path],
        ...this.scopeParams(),
      },
      MUTATION_RPC_TIMEOUT_MS,
    );
  }

  /**
   * Create a commit with the given message.
   * @param message - Commit message
   */
  async commit(message: string): Promise<RpcCallResult<GitCommitResult>> {
    return rpcCall<GitCommitResult>(
      this.vscodeService,
      'git:commit',
      {
        message,
        ...this.scopeParams(),
      },
      MUTATION_RPC_TIMEOUT_MS,
    );
  }

  /**
   * Get the original content of a file from HEAD revision.
   * Returns empty content for new/untracked files.
   * @param relativePath - Relative path from workspace root
   */
  async getOriginalContent(
    relativePath: string,
  ): Promise<RpcCallResult<GitShowFileResult>> {
    return rpcCall<GitShowFileResult>(this.vscodeService, 'git:showFile', {
      path: relativePath,
      ...this.scopeParams(),
    });
  }

  /**
   * Workspace-scoping params pinned to the workspace whose files are
   * displayed (GitStatusService's active workspace), so mutating git ops
   * can never land in a different repository if the backend's active
   * folder changes underneath an in-flight UI action.
   */
  private scopeParams(): { workspaceRoot?: string } {
    const root = this.gitStatus.activeWorkspacePath();
    return root ? { workspaceRoot: root } : {};
  }
}
