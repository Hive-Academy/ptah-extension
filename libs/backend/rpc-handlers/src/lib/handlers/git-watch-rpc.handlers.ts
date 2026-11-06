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
 * A root whose probe failed (neither confirmed nor refused) stays watched
 * only when the lease already held it; the roots that resolved are applied
 * either way, so one broken root cannot freeze its siblings' lease. Only when
 * every requested root failed does the call answer the retryable
 * `GIT_ROOT_PROBE_FAILED`. Calls for one lease run one at a time: a call
 * with the same roots joins the running one, a call with other roots runs
 * after it. Invalid params reject every root. A registry failure is logged and answered
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
import {
  normalizeWorkspaceRoot,
  GIT_ROOT_PROBE_FAILED_MESSAGE,
} from '@ptah-extension/shared';
import type {
  GitWatchRootsParams,
  GitWatchRootsResult,
  RpcMethodName,
} from '@ptah-extension/shared';

import { GitRootResolver, createWorktreeRootProbe } from './git-root-resolver';
import { parseGitWatchRootsParams } from './git-watch-rpc.schema';

const LOG_TAG = '[GitWatchRpc]';
const WATCH_ROOTS_DEADLINE_MS = 25_000;
/** Leases whose last accepted roots are remembered; the oldest is dropped. */
const MAX_REMEMBERED_LEASES = 16;

interface WatchFlight {
  /** {@link rootsKey} of the roots this flight resolves. */
  readonly key: string;
  readonly promise: Promise<GitWatchRootsResult>;
}

type RootResolution =
  | { readonly kind: 'accepted'; readonly root: string }
  | { readonly kind: 'rejected' }
  | { readonly kind: 'failed' };

@injectable()
export class GitWatchRpcHandlers {
  static readonly METHODS = [
    'git:watchRoots',
  ] as const satisfies readonly RpcMethodName[];

  private readonly roots: GitRootResolver;
  private readonly flights = new Map<string, WatchFlight>();
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
      epoch: () => gitInfo.probeEpoch(),
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

  /** How the resolver answered for one requested root. */
  private async resolveOne(
    requested: string,
    signal: AbortSignal,
  ): Promise<RootResolution> {
    try {
      const root = await this.roots.resolve(
        requested,
        'git:watchRoots',
        'folder-or-worktree',
        signal,
      );
      return root ? { kind: 'accepted', root } : { kind: 'rejected' };
    } catch (error: unknown) {
      if (!(error instanceof RpcUserError)) throw error;
      if (error.errorCode === 'GIT_ROOT_UNAVAILABLE')
        return { kind: 'rejected' };
      if (error.errorCode === 'GIT_ROOT_PROBE_FAILED')
        return { kind: 'failed' };
      throw error;
    }
  }

  private watchRoots(rawParams: unknown): Promise<GitWatchRootsResult> {
    const params = parseGitWatchRootsParams(rawParams);
    if (!params) {
      const rejected = requestedStrings(rawParams);
      this.logger.warn(`${LOG_TAG} git:watchRoots called with invalid params`, {
        rootCount: rejected.length,
      });
      return Promise.resolve({ watched: [], rejected, evicted: [] });
    }
    return this.joinOrQueue(params);
  }

  /**
   * Join the lease's running call when it resolves the same roots; otherwise
   * run after it, so the newest set is the one the lease ends with (review
   * #8).
   */
  private joinOrQueue(
    params: GitWatchRootsParams,
  ): Promise<GitWatchRootsResult> {
    const key = rootsKey(params.roots);
    const running = this.flights.get(params.leaseId);
    if (!running) return this.start(params, key);
    if (running.key === key) return running.promise;
    // The running call's outcome, success or failure, belongs to its own
    // caller; this one only waits for it to finish.
    const next = (): Promise<GitWatchRootsResult> => this.joinOrQueue(params);
    return running.promise.then(next, next);
  }

  private start(
    params: GitWatchRootsParams,
    key: string,
  ): Promise<GitWatchRootsResult> {
    const { leaseId } = params;
    this.registry.beginRenewal?.(leaseId);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<GitWatchRootsResult>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        this.logger.warn(`${LOG_TAG} git:watchRoots resolve deadline`, {
          leaseId,
        });
        this.keepPrevious(leaseId);
        reject(
          new RpcUserError(
            GIT_ROOT_PROBE_FAILED_MESSAGE,
            'GIT_ROOT_PROBE_FAILED',
          ),
        );
      }, WATCH_ROOTS_DEADLINE_MS);
      timer.unref?.();
    });
    const promise: Promise<GitWatchRootsResult> = Promise.race([
      this.resolveRoots(leaseId, params.roots, controller.signal),
      deadline,
    ]).finally(() => {
      if (timer) clearTimeout(timer);
      this.registry.endRenewal?.(leaseId);
      if (this.flights.get(leaseId)?.promise === promise) {
        this.flights.delete(leaseId);
      }
    });
    this.flights.set(leaseId, { key, promise });
    return promise;
  }

  /** Renew the lease with the roots it last accepted. */
  private keepPrevious(leaseId: string): GitWatchRootsResult {
    const outcome = this.registry.setLease(
      leaseId,
      this.previousRoots.get(leaseId) ?? [],
    );
    return {
      watched: [...outcome.watched],
      rejected: [],
      evicted: [...outcome.evicted],
    };
  }

  private async resolveRoots(
    leaseId: string,
    requestedRoots: readonly string[],
    signal: AbortSignal,
  ): Promise<GitWatchRootsResult> {
    const results = await Promise.all(
      requestedRoots.map((requested) => this.resolveOne(requested, signal)),
    );
    if (signal.aborted) return this.keepPrevious(leaseId);

    const held = new Map(
      (this.previousRoots.get(leaseId) ?? []).map((root) => [
        normalizeWorkspaceRoot(root),
        root,
      ]),
    );
    const accepted: string[] = [];
    const rejected: string[] = [];
    const seen = new Set<string>();
    let failed = 0;
    const accept = (root: string): void => {
      const rootKey = normalizeWorkspaceRoot(root);
      if (seen.has(rootKey)) return;
      seen.add(rootKey);
      accepted.push(root);
    };
    results.forEach((result, index) => {
      const requested = requestedRoots[index];
      if (result.kind === 'accepted') accept(result.root);
      else if (result.kind === 'rejected') rejected.push(requested);
      else {
        failed += 1;
        // Review #5: an unconfirmed root keeps a watcher it already had,
        // and gets none it did not have.
        const kept = held.get(normalizeWorkspaceRoot(requested));
        if (kept) accept(kept);
      }
    });

    if (failed > 0) {
      this.logger.warn(
        `${LOG_TAG} git:watchRoots probe failed; keeping those roots from the previous lease`,
        { leaseId, failed, requested: requestedRoots.length },
      );
    }
    const result = this.commitLease(leaseId, accepted, rejected);
    if (failed > 0 && failed === requestedRoots.length) {
      throw new RpcUserError(
        GIT_ROOT_PROBE_FAILED_MESSAGE,
        'GIT_ROOT_PROBE_FAILED',
      );
    }
    return result;
  }

  private commitLease(
    leaseId: string,
    accepted: readonly string[],
    rejected: string[],
  ): GitWatchRootsResult {
    try {
      const outcome = this.registry.setLease(leaseId, accepted);
      this.previousRoots.delete(leaseId);
      if (accepted.length > 0) {
        this.previousRoots.set(leaseId, accepted);
        if (this.previousRoots.size > MAX_REMEMBERED_LEASES) {
          const oldest = this.previousRoots.keys().next().value;
          if (oldest !== undefined) this.previousRoots.delete(oldest);
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

/** Order-preserving identity of a root set: spellings of one root are equal. */
function rootsKey(roots: readonly string[]): string {
  return roots.map((root) => normalizeWorkspaceRoot(root)).join('\n');
}

/** The string roots of a malformed request, reported back as rejected. */
function requestedStrings(rawParams: unknown): string[] {
  if (typeof rawParams !== 'object' || rawParams === null) return [];
  const roots: unknown = Reflect.get(rawParams, 'roots');
  if (!Array.isArray(roots)) return [];
  return roots.filter((root): root is string => typeof root === 'string');
}
