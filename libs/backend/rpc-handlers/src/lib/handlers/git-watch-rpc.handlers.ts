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
 * A failed probe returns a retryable error while renewing the previous lease.
 * Invalid params reject every root. A registry failure is logged and answered
 * with an empty result, which the renderer reads as "no live pushes".
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
import { normalizeWorkspaceRoot, GIT_ROOT_PROBE_FAILED_MESSAGE } from '@ptah-extension/shared';
import type {
  GitWatchRootsParams,
  GitWatchRootsResult,
  RpcMethodName,
} from '@ptah-extension/shared';

import { GitRootResolver, createWorktreeRootProbe } from './git-root-resolver';
import { parseGitWatchRootsParams } from './git-watch-rpc.schema';

const LOG_TAG = '[GitWatchRpc]';
const WATCH_ROOTS_DEADLINE_MS = 25_000;

@injectable()
export class GitWatchRpcHandlers {
  static readonly METHODS = [
    'git:watchRoots',
  ] as const satisfies readonly RpcMethodName[];

  private readonly roots: GitRootResolver;
  private readonly flights = new Map<string, Promise<GitWatchRootsResult>>();
  private readonly previousRoots = new Map<string, readonly string[]>();

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
      epoch: () => gitInfo.probeEpoch?.() ?? 0,
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
    signal: AbortSignal,
  ): Promise<{ root?: string; failed: boolean }> {
    try {
      const root = await this.roots.resolve(
        requested,
        'git:watchRoots',
        'folder-or-worktree',
        signal,
      );
      return { root, failed: false };
    } catch (error: unknown) {
      if (
        error instanceof RpcUserError &&
        error.errorCode === 'GIT_ROOT_UNAVAILABLE'
      ) {
        return { failed: false };
      }
      if (error instanceof RpcUserError && error.errorCode === 'GIT_ROOT_PROBE_FAILED') {
        return { failed: true };
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

    const running = this.flights.get(params.leaseId);
    if (running) return running;
    this.registry.beginRenewal?.(params.leaseId);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<GitWatchRootsResult>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        this.logger.warn(`${LOG_TAG} git:watchRoots resolve deadline`, { leaseId: params.leaseId });
        this.keepPrevious(params.leaseId, []);
        reject(new RpcUserError(GIT_ROOT_PROBE_FAILED_MESSAGE, 'GIT_ROOT_PROBE_FAILED'));
      }, WATCH_ROOTS_DEADLINE_MS);
      timer.unref?.();
    });
    const flight = Promise.race([this.resolveRoots(params.leaseId, params.roots, controller.signal), deadline])
      .finally(() => {
        if (timer) clearTimeout(timer);
        this.registry.endRenewal?.(params.leaseId);
        this.flights.delete(params.leaseId);
      });
    this.flights.set(params.leaseId, flight);
    return flight;
  }

  private keepPrevious(leaseId: string, rejected: string[]): GitWatchRootsResult {
    const previous = this.previousRoots.get(leaseId) ?? [];
    const outcome = this.registry.setLease(leaseId, previous);
    return { watched: [...outcome.watched], rejected, evicted: [...outcome.evicted] };
  }

  private async resolveRoots(leaseId: string, requestedRoots: readonly string[], signal: AbortSignal): Promise<GitWatchRootsResult> {
    const accepted: string[] = [];
    const rejected: string[] = [];
    const seen = new Set<string>();
    const results = await Promise.all(requestedRoots.map((requested) => this.resolveOrReject(requested, signal)));
    if (signal.aborted) return this.keepPrevious(leaseId, rejected);
    if (results.some((result) => result.failed)) {
      this.logger.warn(`${LOG_TAG} git:watchRoots probe failed; retaining lease`, { leaseId });
      this.keepPrevious(leaseId, rejected);
      throw new RpcUserError(GIT_ROOT_PROBE_FAILED_MESSAGE, 'GIT_ROOT_PROBE_FAILED');
    }
    for (let index = 0; index < requestedRoots.length; index++) {
      const requested = requestedRoots[index];
      const root = results[index].root;
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
      const outcome = this.registry.setLease(leaseId, accepted);
      if (accepted.length === 0) this.previousRoots.delete(leaseId);
      else {
        this.previousRoots.delete(leaseId);
        this.previousRoots.set(leaseId, accepted);
        if (this.previousRoots.size > 16) {
          const oldest = this.previousRoots.keys().next().value;
          if (oldest) this.previousRoots.delete(oldest);
        }
      }
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
