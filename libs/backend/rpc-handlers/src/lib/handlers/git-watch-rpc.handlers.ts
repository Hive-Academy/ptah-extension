/**
 * GitWatchRpcHandlers — `git:watchRoots` (TASK_2026_855 component 4).
 *
 * A renderer declares the extra roots it wants live `git:status-update`
 * pushes for (its dock scope plus the open sessions' worktrees). Every root is
 * validated with {@link GitRootResolver} under the `'folder-or-worktree'`
 * policy, de-duplicated, and handed to the host's
 * {@link IGitRootWatchRegistry}, which owns the watcher lifetime.
 *
 * Host gating is data: the manifest entry declares
 * `requires: ['gitRootWatch']`, and only hosts whose profile turns that
 * capability on (Electron) register `PLATFORM_TOKENS.GIT_ROOT_WATCH_REGISTRY`.
 *
 * The method never throws to the renderer: invalid params reject every root,
 * and a registry failure is logged and answered with an empty result, which
 * the renderer reads as "no live pushes" (it still fetches on switch).
 */

import { injectable, inject } from 'tsyringe';
import { RpcUserError, TOKENS } from '@ptah-extension/vscode-core';
import type {
  GitInfoService,
  Logger,
  RpcHandler,
} from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type {
  IFileSystemProvider,
  IGitRootWatchRegistry,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { normalizeWorkspaceRoot } from '@ptah-extension/shared';
import type {
  GitWatchRootsParams,
  GitWatchRootsResult,
  RpcMethodName,
} from '@ptah-extension/shared';

import { GitRootResolver, createWorktreeRootProbe } from './git-root-resolver';
import { parseGitWatchRootsParams } from './git-watch-rpc.schema';

const LOG_TAG = '[GitWatchRpc]';

@injectable()
export class GitWatchRpcHandlers {
  static readonly METHODS = [
    'git:watchRoots',
  ] as const satisfies readonly RpcMethodName[];

  private readonly roots: GitRootResolver;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    workspace: IWorkspaceProvider,
    @inject(TOKENS.GIT_INFO_SERVICE)
    gitInfo: GitInfoService,
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    fileSystem: IFileSystemProvider,
    @inject(PLATFORM_TOKENS.GIT_ROOT_WATCH_REGISTRY)
    private readonly registry: IGitRootWatchRegistry,
  ) {
    this.roots = new GitRootResolver({
      workspace,
      probe: createWorktreeRootProbe(gitInfo, fileSystem),
      warn: (message, context) =>
        this.logger.warn(`${LOG_TAG} ${message}`, context),
    });
  }

  register(): void {
    this.rpcHandler.registerMethod<GitWatchRootsParams, GitWatchRootsResult>(
      'git:watchRoots',
      (rawParams) => this.watchRoots(rawParams),
    );
  }

  /** The validated root, or undefined when the resolver refuses it. */
  private async resolveOrReject(
    requested: string,
  ): Promise<string | undefined> {
    try {
      return await this.roots.resolve(
        requested,
        'git:watchRoots',
        'folder-or-worktree',
      );
    } catch (error: unknown) {
      if (
        error instanceof RpcUserError &&
        error.errorCode === 'GIT_ROOT_UNAVAILABLE'
      ) {
        return undefined;
      }
      throw error;
    }
  }

  private async watchRoots(rawParams: unknown): Promise<GitWatchRootsResult> {
    const params = parseGitWatchRootsParams(rawParams);
    if (!params) {
      const rejected = requestedStrings(rawParams);
      this.logger.warn(`${LOG_TAG} git:watchRoots called with invalid params`, {
        rootCount: rejected.length,
      });
      return { watched: [], rejected, evicted: [] };
    }

    const accepted: string[] = [];
    const rejected: string[] = [];
    const seen = new Set<string>();
    for (const requested of params.roots) {
      const root = await this.resolveOrReject(requested);
      if (!root) {
        rejected.push(requested);
        continue;
      }
      const key = normalizeWorkspaceRoot(root);
      if (seen.has(key)) continue;
      seen.add(key);
      accepted.push(root);
    }

    try {
      const outcome = this.registry.setLease(params.leaseId, accepted);
      return {
        watched: [...outcome.watched],
        rejected,
        evicted: [...outcome.evicted],
      };
    } catch (error: unknown) {
      this.logger.error(
        `${LOG_TAG} git:watchRoots lease update failed`,
        error instanceof Error ? error : new Error(String(error)),
      );
      return { watched: [], rejected: [], evicted: [] };
    }
  }
}

/** The string roots of a malformed request, reported back as rejected. */
function requestedStrings(rawParams: unknown): string[] {
  if (typeof rawParams !== 'object' || rawParams === null) return [];
  const roots: unknown = Reflect.get(rawParams, 'roots');
  if (!Array.isArray(roots)) return [];
  return roots.filter((root): root is string => typeof root === 'string');
}
