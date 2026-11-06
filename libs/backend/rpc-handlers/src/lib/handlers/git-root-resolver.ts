/**
 * GitRootResolver — the one rule for "which root may a `git:*` call run in"
 * (TASK_2026_855 D5, D17, D18).
 *
 * - With no root named, the active workspace folder is used.
 * - A named root is accepted when it is a registered workspace folder, or —
 *   under the `'folder-or-worktree'` policy — a live worktree of an open
 *   folder's repository (see {@link probeRegisteredWorktree} for the checks).
 * - A confirmed missing named root throws `RpcUserError('GIT_ROOT_UNAVAILABLE')`
 *   and never falls back to the active folder: a stale or hostile request
 *   must not read from, or mutate, a different repository. The webview shows
 *   the error's message ("This worktree is no longer available."), not the
 *   handlers' "No workspace folder open", which stays for the no-folder case.
 * - A probe that could not answer throws the retryable
 *   `GIT_ROOT_PROBE_FAILED`, up to {@link MAX_CONSECUTIVE_PROBE_FAILURES} in a
 *   row for one root; after that the root reads as unavailable until a probe
 *   answers again, so a root that fails for good does not retry forever.
 *
 * Writes are never cached: every mutating call drops the probe caches and
 * re-validates, so a worktree removed or replaced between two writes is
 * refused on the second one. Read-only methods ({@link READ_ONLY_GIT_METHODS})
 * reuse a settled answer: a confirmed worktree for {@link READ_PROBE_TTL_MS}
 * (its directory is re-checked on every reuse), a confirmed refusal for only
 * {@link READ_PROBE_NEGATIVE_TTL_MS}. Failures are never cached here, and
 * in-flight sharing happens below, in the git probe, where each caller keeps
 * its own abort signal: one caller's deadline cannot fail another caller's
 * probe. A method not in the list is treated as a write (review M1).
 */

import { FileType } from '@ptah-extension/platform-core';
import type {
  IFileSystemProvider,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  GIT_ROOT_UNAVAILABLE_MESSAGE,
  GIT_ROOT_PROBE_FAILED_MESSAGE,
} from '@ptah-extension/shared';
import { RpcUserError } from '@ptah-extension/vscode-core';
import type { GitInfoService } from '@ptah-extension/vscode-core';
import {
  findRegisteredWorkspaceFolder,
  probeRegisteredWorktree,
  type DirectoryRead,
  type RegisteredWorktreeOutcome,
  type WorktreeRootProbe,
} from './git-workspace-root';

/**
 * `'folder'`: only a registered workspace folder (worktree create/remove).
 * `'folder-or-worktree'`: also a live worktree of an open folder's repository.
 */
export type GitRootPolicy = 'folder' | 'folder-or-worktree';

export interface GitRootResolverDeps {
  readonly workspace: IWorkspaceProvider;
  readonly probe: WorktreeRootProbe;
  /** Called once per refused named root, with the method and the root. */
  readonly warn: (message: string, context: Record<string, unknown>) => void;
  /** Bumped by every probe-cache invalidation; a cached answer from an older value is dropped. */
  readonly epoch: () => number;
  readonly platform?: NodeJS.Platform;
  /** Clock for the read cache; defaults to `Date.now`. */
  readonly now?: () => number;
}

/** How long a confirmed worktree is reused by read-only methods. */
export const READ_PROBE_TTL_MS = 60_000;
/** How long a confirmed refusal is reused by read-only methods (review M1). */
export const READ_PROBE_NEGATIVE_TTL_MS = 2_000;
/** Probe failures in a row after which a root reads as unavailable (review #6). */
export const MAX_CONSECUTIVE_PROBE_FAILURES = 3;
/** Roots whose failure streak is tracked at once; the oldest is dropped. */
const MAX_TRACKED_FAILURE_ROOTS = 64;

/**
 * `git:*` methods that never change a repository. Only these may reuse a
 * recent worktree confirmation; every other method re-validates per call.
 */
export const READ_ONLY_GIT_METHODS: ReadonlySet<string> = new Set([
  'git:info',
  'git:reviewChanges',
  'git:reviewFile',
  'git:diffFile',
  'git:log',
  'git:lastCommit',
  'git:branches',
  'git:remotes',
  'git:worktrees',
  'git:stashList',
  'git:stashShow',
  'git:prStatus',
  'git:showFile',
  'git:tags',
  'git:watchRoots',
]);

type SettledOutcome = Exclude<
  RegisteredWorktreeOutcome,
  { kind: 'probe-failed' }
>;

interface ReadProbeEntry {
  readonly expiresAt: number;
  readonly epoch: number;
  readonly outcome: SettledOutcome;
}

/** The message of the {@link GitRootResolver} refusal (shared with the webview). */
export { GIT_ROOT_UNAVAILABLE_MESSAGE };

export class GitRootResolver {
  /** Settled read-only answers by requested root (see header). */
  private readonly readProbes = new Map<string, ReadProbeEntry>();
  /** Consecutive probe failures by requested root (see header). */
  private readonly failureStreaks = new Map<string, number>();

  constructor(private readonly deps: GitRootResolverDeps) {}

  /**
   * The root `method` may run in: the registered spelling of the named root,
   * or the active workspace folder when none is named (undefined when no
   * folder is open).
   *
   * @throws RpcUserError `GIT_ROOT_UNAVAILABLE` when the named root is refused,
   *   `GIT_ROOT_PROBE_FAILED` when the probe could not answer (retryable).
   */
  async resolve(
    requested: string | undefined,
    method: string,
    policy: GitRootPolicy,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    const { workspace, probe, platform } = this.deps;
    if (!requested) return workspace.getWorkspaceRoot();

    const folder = findRegisteredWorkspaceFolder(
      workspace,
      requested,
      platform,
    );
    if (folder) return folder;

    if (policy === 'folder-or-worktree') {
      const readOnly = READ_ONLY_GIT_METHODS.has(method);
      if (!readOnly) probe.invalidate();
      const outcome = readOnly
        ? await this.probeForRead(requested, signal)
        : await probeRegisteredWorktree(
            workspace,
            probe,
            requested,
            platform,
            signal,
          );
      if (outcome.kind === 'confirmed-worktree') {
        this.failureStreaks.delete(requested);
        return outcome.path;
      }
      if (outcome.kind === 'probe-failed') {
        this.deps.warn(`[GitRoot] ${method} probe failed`, {
          method,
          workspaceRoot: requested,
          cause: outcome.cause,
        });
        if (this.mayRetry(requested, signal)) {
          throw new RpcUserError(
            GIT_ROOT_PROBE_FAILED_MESSAGE,
            'GIT_ROOT_PROBE_FAILED',
          );
        }
      } else {
        this.failureStreaks.delete(requested);
      }
    }

    this.deps.warn(`[GitRoot] ${method} refused workspaceRoot`, {
      method,
      workspaceRoot: requested,
      policy,
    });
    throw new RpcUserError(
      GIT_ROOT_UNAVAILABLE_MESSAGE,
      'GIT_ROOT_UNAVAILABLE',
    );
  }

  /**
   * Record one more failure for `requested`; true while its streak is under
   * {@link MAX_CONSECUTIVE_PROBE_FAILURES}. A failure caused by the caller's
   * own abort says nothing about the root and is not counted.
   */
  private mayRetry(requested: string, signal?: AbortSignal): boolean {
    if (signal?.aborted) return true;
    const streak = (this.failureStreaks.get(requested) ?? 0) + 1;
    this.failureStreaks.delete(requested);
    this.failureStreaks.set(requested, streak);
    if (this.failureStreaks.size > MAX_TRACKED_FAILURE_ROOTS) {
      const oldest = this.failureStreaks.keys().next().value;
      if (oldest !== undefined) this.failureStreaks.delete(oldest);
    }
    return streak < MAX_CONSECUTIVE_PROBE_FAILURES;
  }

  /** The worktree probe for a read, reusing a recent settled answer. */
  private async probeForRead(
    requested: string,
    signal?: AbortSignal,
  ): Promise<RegisteredWorktreeOutcome> {
    const { workspace, probe, platform } = this.deps;
    const now = this.now();
    const epoch = this.deps.epoch();
    const cached = this.readProbes.get(requested);
    if (cached && cached.expiresAt > now && cached.epoch === epoch) {
      if (cached.outcome.kind === 'confirmed-not-worktree') {
        return cached.outcome;
      }
      // A confirmed worktree removed outside Ptah must not keep git running
      // in a missing directory for the rest of the TTL.
      const dir = await probe.directory(requested);
      if (dir.kind === 'exists') return cached.outcome;
    }
    this.readProbes.delete(requested);
    this.pruneExpired(now);

    const outcome = await probeRegisteredWorktree(
      workspace,
      probe,
      requested,
      platform,
      signal,
    );
    // A failure is never stored, and neither is an answer that raced an
    // invalidation or came back after the caller gave up.
    if (
      outcome.kind !== 'probe-failed' &&
      !signal?.aborted &&
      this.deps.epoch() === epoch
    ) {
      const ttl =
        outcome.kind === 'confirmed-worktree'
          ? READ_PROBE_TTL_MS
          : READ_PROBE_NEGATIVE_TTL_MS;
      this.readProbes.set(requested, {
        expiresAt: this.now() + ttl,
        epoch,
        outcome,
      });
    }
    return outcome;
  }

  private pruneExpired(now: number): void {
    for (const [key, entry] of this.readProbes) {
      if (entry.expiresAt <= now) this.readProbes.delete(key);
    }
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }
}

/**
 * The production {@link WorktreeRootProbe}: git's worktree list and common
 * dir from `GitInfoService`'s shared folder probe, directory existence from
 * the file system port. A stat that fails with `ENOENT`/`ENOTDIR` reads as
 * absent; any other stat error is a failed probe, not an absence.
 */
export function createWorktreeRootProbe(
  gitInfo: Pick<
    GitInfoService,
    'probeWorktreeList' | 'probeCommonDir' | 'invalidateProbeReadCache'
  >,
  fileSystem: Pick<IFileSystemProvider, 'stat'>,
): WorktreeRootProbe {
  return {
    listWorktrees: (folder, signal) =>
      gitInfo.probeWorktreeList(folder, signal),
    commonDir: (dir, signal) => gitInfo.probeCommonDir(dir, signal),
    directory: (dir) => fileSystem.stat(dir).then(toDirectoryRead, statFailure),
    invalidate: () => gitInfo.invalidateProbeReadCache(),
  };
}

function toDirectoryRead(stat: { type: FileType }): DirectoryRead {
  return (stat.type & FileType.Directory) !== 0
    ? { kind: 'exists' }
    : { kind: 'absent' };
}

function statFailure(error: unknown): DirectoryRead {
  const cause = error instanceof Error ? error : new Error(String(error));
  const code: unknown = Reflect.get(cause, 'code');
  return code === 'ENOENT' || code === 'ENOTDIR'
    ? { kind: 'absent' }
    : { kind: 'failed', cause };
}
