/**
 * GitWorkflowRpcHandlers (TASK_2026_576 Component 30) — the commit composer's
 * RPC surface beside `git:commit`:
 * - git:cancelOperation       - Stop a running operation (a commit) by its id
 * - git:generateCommitMessage - Write a commit message for the staged changes
 * - git:prStatus              - GitHub PR and checks for the current branch
 * - git:operationAbort        - Abort the merge/rebase/cherry-pick in progress
 * - git:operationContinue     - Continue it once no path is unmerged
 * - git:log                   - The branch's commits since its base
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
  GitLogParams,
  GitLogResult,
  GitOperationAbortParams,
  GitOperationAbortResult,
  GitOperationContinueParams,
  GitOperationContinueResult,
  GitOperationFailed,
  GitPrStatusParams,
  GitPrStatusResult,
  RpcMethodName,
} from '@ptah-extension/shared';

import { findRegisteredWorkspaceFolder } from './git-workspace-root';
import {
  parseGitCancelOperationParams,
  parseGitGenerateCommitMessageParams,
  parseGitLogParams,
  parseGitOperationAbortParams,
  parseGitOperationContinueParams,
  parseGitPrStatusParams,
} from './git-workflow-rpc.schema';

const LOG_TAG = '[GitWorkflowRpc]';

/** No repository to act on: an unregistered folder, or no active folder. */
const NO_REPOSITORY: GitOperationFailed = {
  status: 'failed',
  code: 'GIT_ERROR',
  error: 'No registered workspace folder to act on.',
};

/** The service threw (it is not expected to); the detail stays in the log. */
const ACTION_THREW: GitOperationFailed = {
  status: 'failed',
  code: 'GIT_ERROR',
  error: 'Git could not complete the action.',
};

@injectable()
export class GitWorkflowRpcHandlers {
  /** RPC methods owned by this handler (manifest coverage invariant). */
  static readonly METHODS = [
    'git:cancelOperation',
    'git:generateCommitMessage',
    'git:prStatus',
    'git:operationAbort',
    'git:operationContinue',
    'git:log',
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
    this.registerPrStatus();
    this.registerOperationAbort();
    this.registerOperationContinue();
    this.registerLog();
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
    >('git:cancelOperation', (rawParams) => {
      const params = parseGitCancelOperationParams(rawParams);
      if (!params) {
        return Promise.reject(
          new RpcUserError(
            'Invalid git:cancelOperation params (operationId)',
            'INVALID_PARAMS',
          ),
        );
      }
      return Promise.resolve({
        cancelled: this.gitInfo.cancelOperation(params.operationId),
      });
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
      const root = this.resolveRoot(
        'git:generateCommitMessage',
        params.workspaceRoot,
      );
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
   * git:prStatus - the GitHub PR of the current branch of the named
   * (registered) workspace folder, or the active one. The branch is read
   * here, never taken from the client. Every miss is a quiet `unavailable`
   * reason; the panel stays usable without `gh`.
   */
  private registerPrStatus(): void {
    this.rpcHandler.registerMethod<GitPrStatusParams, GitPrStatusResult>(
      'git:prStatus',
      async (rawParams) => {
        const params = parseGitPrStatusParams(rawParams);
        if (!params) {
          throw new RpcUserError(
            'Invalid git:prStatus params (workspaceRoot)',
            'INVALID_PARAMS',
          );
        }
        const root = this.resolveRoot('git:prStatus', params.workspaceRoot);
        if (!root) return { status: 'unavailable', reason: 'failed' };

        try {
          const { current } = await this.gitInfo.getBranches(root, false);
          // Empty on a detached HEAD (and when the branch list could not be
          // read): there is no branch a pull request could belong to.
          if (!current) {
            return { status: 'unavailable', reason: 'no-pr' };
          }
          return await this.gitInfo.readPrStatus(root, current);
        } catch (error: unknown) {
          // The reader reports every failure as a reason and is not expected
          // to throw; if it does, the detail stays in the log.
          this.logger.error(
            `${LOG_TAG} PR status read threw`,
            error instanceof Error ? error : new Error(String(error)),
          );
          return { status: 'unavailable', reason: 'failed' };
        }
      },
    );
  }

  /**
   * git:operationAbort - abort the merge, rebase or cherry-pick in progress.
   * The service re-detects the operation; the client never names it. Its
   * typed result (with an already sanitized `error`) is returned as is.
   */
  private registerOperationAbort(): void {
    this.rpcHandler.registerMethod<
      GitOperationAbortParams,
      GitOperationAbortResult
    >('git:operationAbort', async (rawParams) => {
      const params = parseGitOperationAbortParams(rawParams);
      if (!params) {
        throw new RpcUserError(
          'Invalid git:operationAbort params (workspaceRoot)',
          'INVALID_PARAMS',
        );
      }
      const root = this.resolveRoot('git:operationAbort', params.workspaceRoot);
      if (!root) return NO_REPOSITORY;

      try {
        return await this.gitInfo.abortOperation(root);
      } catch (error: unknown) {
        this.logThrow('operation abort threw', error);
        return ACTION_THREW;
      }
    });
  }

  /**
   * git:operationContinue - continue the operation in progress; refused as
   * `conflicts-remain` while a path is unmerged. Same rules as abort.
   */
  private registerOperationContinue(): void {
    this.rpcHandler.registerMethod<
      GitOperationContinueParams,
      GitOperationContinueResult
    >('git:operationContinue', async (rawParams) => {
      const params = parseGitOperationContinueParams(rawParams);
      if (!params) {
        throw new RpcUserError(
          'Invalid git:operationContinue params (workspaceRoot)',
          'INVALID_PARAMS',
        );
      }
      const root = this.resolveRoot(
        'git:operationContinue',
        params.workspaceRoot,
      );
      if (!root) return NO_REPOSITORY;

      try {
        return await this.gitInfo.continueOperation(root);
      } catch (error: unknown) {
        this.logThrow('operation continue threw', error);
        return ACTION_THREW;
      }
    });
  }

  /**
   * git:log - the branch's commits since its base (or the recent commits).
   * The base and range are resolved by the reader, never by the client.
   */
  private registerLog(): void {
    this.rpcHandler.registerMethod<GitLogParams, GitLogResult>(
      'git:log',
      async (rawParams) => {
        const params = parseGitLogParams(rawParams);
        if (!params) {
          throw new RpcUserError(
            'Invalid git:log params (workspaceRoot)',
            'INVALID_PARAMS',
          );
        }
        const root = this.resolveRoot('git:log', params.workspaceRoot);
        if (!root) return { status: 'unavailable', reason: 'not-a-repository' };

        try {
          return await this.gitInfo.getLog(root);
        } catch (error: unknown) {
          this.logThrow('history read threw', error);
          return { status: 'unavailable', reason: 'git-failed' };
        }
      },
    );
  }

  /** The ONE place a raw error goes: the host log. */
  private logThrow(what: string, error: unknown): void {
    this.logger.error(
      `${LOG_TAG} ${what}`,
      error instanceof Error ? error : new Error(String(error)),
    );
  }

  /**
   * Same rule as `GitRpcHandlers`: a named folder must be registered, and an
   * unregistered one never falls back to the active folder.
   */
  private resolveRoot(
    method: RpcMethodName,
    requested: string | undefined,
  ): string | undefined {
    if (!requested) return this.workspace.getWorkspaceRoot();
    const registered = findRegisteredWorkspaceFolder(this.workspace, requested);
    if (registered) return registered;
    this.logger.warn(
      `${LOG_TAG} ${method} called with unregistered workspaceRoot`,
      { workspaceRoot: requested },
    );
    return undefined;
  }
}
