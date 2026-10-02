/**
 * GitWorkflowRpcHandlers (TASK_2026_576 Component 30) — the commit composer's
 * RPC surface beside `git:commit`:
 * - git:cancelOperation       - Stop a running operation (a commit) by its id
 * - git:generateCommitMessage - Write a commit message for the staged changes
 *
 * `git:commit` itself, with its `operationId` and the throttled
 * `git:operationOutput` stream, stays in {@link GitRpcHandlers}.
 *
 * Generation never commits and never runs on its own: it answers one click,
 * and every failure is a named `unavailable` reason the composer turns into
 * "type your own".
 */

import { inject, injectable } from 'tsyringe';
import {
  RpcUserError,
  TOKENS,
  type GitInfoService,
  type Logger,
  type RpcHandler,
} from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  SDK_TOKENS,
  type CommitMessageGenerator,
} from '@ptah-extension/agent-sdk';
import type {
  GitCancelOperationParams,
  GitCancelOperationResult,
  GitGenerateCommitMessageParams,
  GitGenerateCommitMessageResult,
  RpcMethodName,
} from '@ptah-extension/shared';

import { isRegisteredWorkspaceFolder } from './git-workspace-root';
import {
  parseGitCancelOperationParams,
  parseGitGenerateCommitMessageParams,
} from './git-workflow-rpc.schema';

const LOG_TAG = '[GitWorkflowRpc]';

@injectable()
export class GitWorkflowRpcHandlers {
  /** RPC methods owned by this handler (manifest coverage invariant). */
  static readonly METHODS = [
    'git:cancelOperation',
    'git:generateCommitMessage',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(TOKENS.GIT_INFO_SERVICE)
    private readonly gitInfo: GitInfoService,
    @inject(SDK_TOKENS.SDK_COMMIT_MESSAGE_GENERATOR)
    private readonly commitMessages: CommitMessageGenerator,
  ) {}

  register(): void {
    this.registerCancelOperation();
    this.registerGenerateCommitMessage();
  }

  /**
   * git:cancelOperation - `{ cancelled: true }` when an operation with that id
   * was running and was told to stop; its own result then reports
   * `CANCELLED` (with the commit lock recovery). False when none was running.
   */
  private registerCancelOperation(): void {
    this.rpcHandler.registerMethod<
      GitCancelOperationParams,
      GitCancelOperationResult
    >('git:cancelOperation', async (rawParams) => {
      const params = parseGitCancelOperationParams(rawParams);
      if (!params) {
        throw new RpcUserError(
          'Invalid git:cancelOperation params (operationId)',
          'INVALID_PARAMS',
        );
      }
      return { cancelled: this.gitInfo.cancelOperation(params.operationId) };
    });
  }

  /**
   * git:generateCommitMessage - a message for the staged changes of the named
   * (registered) workspace folder, or the active one. The generator's
   * discriminated result is returned as is.
   */
  private registerGenerateCommitMessage(): void {
    this.rpcHandler.registerMethod<
      GitGenerateCommitMessageParams,
      GitGenerateCommitMessageResult
    >('git:generateCommitMessage', async (rawParams) => {
      const params = parseGitGenerateCommitMessageParams(rawParams);
      if (!params) {
        throw new RpcUserError(
          'Invalid git:generateCommitMessage params (workspaceRoot)',
          'INVALID_PARAMS',
        );
      }
      const root = this.resolveRoot(params.workspaceRoot);
      // No repository to read a staged diff from: `unreachable` is the
      // reason the shared type documents for an unreadable staged diff.
      if (!root) return { status: 'unavailable', reason: 'unreachable' };

      try {
        return await this.commitMessages.generate(root);
      } catch (error: unknown) {
        // The generator reports every failure as a reason and is not
        // expected to throw; if it does, the detail stays in the log.
        this.logger.error(
          `${LOG_TAG} commit message generation threw`,
          error instanceof Error ? error : new Error(String(error)),
        );
        return { status: 'unavailable', reason: 'unreachable' };
      }
    });
  }

  /**
   * Same rule as `GitRpcHandlers`: a named folder must be registered, and an
   * unregistered one never falls back to the active folder.
   */
  private resolveRoot(requested: string | undefined): string | undefined {
    if (!requested) return this.workspace.getWorkspaceRoot();
    if (isRegisteredWorkspaceFolder(this.workspace, requested)) {
      return requested;
    }
    this.logger.warn(
      `${LOG_TAG} git:generateCommitMessage called with unregistered workspaceRoot`,
      { workspaceRoot: requested },
    );
    return undefined;
  }
}
