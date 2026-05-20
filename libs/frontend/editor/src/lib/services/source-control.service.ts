import { Injectable, inject } from '@angular/core';
import {
  VSCodeService,
  rpcCall,
  type RpcCallResult,
} from '@ptah-extension/core';
import type {
  GitStageResult,
  GitUnstageResult,
  GitDiscardResult,
  GitCommitResult,
  GitShowFileResult,
} from '@ptah-extension/shared';

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

  /**
   * Stage a single file.
   * @param path - Relative path from workspace root
   */
  async stageFile(path: string): Promise<RpcCallResult<GitStageResult>> {
    return rpcCall<GitStageResult>(this.vscodeService, 'git:stage', {
      paths: [path],
    });
  }

  /**
   * Unstage a single file.
   * @param path - Relative path from workspace root
   */
  async unstageFile(path: string): Promise<RpcCallResult<GitUnstageResult>> {
    return rpcCall<GitUnstageResult>(this.vscodeService, 'git:unstage', {
      paths: [path],
    });
  }

  /**
   * Stage all changed files in the workspace.
   */
  async stageAll(): Promise<RpcCallResult<GitStageResult>> {
    return rpcCall<GitStageResult>(this.vscodeService, 'git:stage', {
      paths: ['.'],
    });
  }

  /**
   * Unstage all staged files in the workspace.
   */
  async unstageAll(): Promise<RpcCallResult<GitUnstageResult>> {
    return rpcCall<GitUnstageResult>(this.vscodeService, 'git:unstage', {
      paths: ['.'],
    });
  }

  /**
   * Discard working tree changes for a file.
   * WARNING: This is a destructive operation that cannot be undone.
   * @param path - Relative path from workspace root
   */
  async discardChanges(path: string): Promise<RpcCallResult<GitDiscardResult>> {
    return rpcCall<GitDiscardResult>(this.vscodeService, 'git:discard', {
      paths: [path],
    });
  }

  /**
   * Create a commit with the given message.
   * @param message - Commit message
   */
  async commit(message: string): Promise<RpcCallResult<GitCommitResult>> {
    return rpcCall<GitCommitResult>(this.vscodeService, 'git:commit', {
      message,
    });
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
    });
  }
}
