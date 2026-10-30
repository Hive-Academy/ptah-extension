/**
 * GitRootResolver — the one rule for "which root may a `git:*` call run in"
 * (TASK_2026_855 D5, D17, D18).
 *
 * - With no root named, the active workspace folder is used.
 * - A named root is accepted when it is a registered workspace folder, or —
 *   under the `'folder-or-worktree'` policy — a live worktree of an open
 *   folder's repository (see {@link findRegisteredWorktree} for the checks).
 * - A refused named root throws `RpcUserError('GIT_ROOT_UNAVAILABLE')` and
 *   never falls back to the active folder: a stale or hostile request must
 *   not read from, or mutate, a different repository. The webview shows the
 *   error's message ("This worktree is no longer available."), not the
 *   handlers' "No workspace folder open", which stays for the no-folder case.
 *
 * Writes are never cached: every mutating call re-validates, so a worktree
 * removed or replaced between two writes is refused on the second one.
 * Read-only methods ({@link READ_ONLY_GIT_METHODS}) share the worktree probe
 * (`git worktree list` + two `rev-parse` + a stat) for a short window
 * ({@link READ_PROBE_TTL_MS}) and while one is in flight, so a burst of
 * status/diff reads after a watcher push spawns git once. Only a confirmed
 * worktree is kept; a refusal is never cached. A method not in the list is
 * treated as a write (review M1).
 */

import { FileType } from '@ptah-extension/platform-core';
import type {
  IFileSystemProvider,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { GIT_ROOT_UNAVAILABLE_MESSAGE } from '@ptah-extension/shared';
import { RpcUserError } from '@ptah-extension/vscode-core';
import type { GitInfoService } from '@ptah-extension/vscode-core';
import {
  findRegisteredWorkspaceFolder,
  findRegisteredWorktree,
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
  readonly platform?: NodeJS.Platform;
  /** Clock for the read cache; defaults to `Date.now`. */
  readonly now?: () => number;
}

/** How long a confirmed worktree is reused by read-only methods. */
export const READ_PROBE_TTL_MS = 1500;

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
]);

interface ReadProbeEntry {
  readonly expiresAt: number;
  readonly result: Promise<string | undefined>;
}

/** The message of the {@link GitRootResolver} refusal (shared with the webview). */
export { GIT_ROOT_UNAVAILABLE_MESSAGE };

export class GitRootResolver {
  /** Read-only worktree confirmations by requested root (see header). */
  private readonly readProbes = new Map<string, ReadProbeEntry>();

  constructor(private readonly deps: GitRootResolverDeps) {}

  /**
   * The root `method` may run in: the registered spelling of the named root,
   * or the active workspace folder when none is named (undefined when no
   * folder is open).
   *
   * @throws RpcUserError `GIT_ROOT_UNAVAILABLE` when the named root is refused.
   */
  async resolve(
    requested: string | undefined,
    method: string,
    policy: GitRootPolicy,
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
      const worktree = READ_ONLY_GIT_METHODS.has(method)
        ? await this.probeForRead(requested)
        : await findRegisteredWorktree(workspace, probe, requested, platform);
      if (worktree) return worktree;
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

  /** The worktree probe for a read: shared in flight and for a short TTL. */
  private probeForRead(requested: string): Promise<string | undefined> {
    const now = (this.deps.now ?? Date.now)();
    const cached = this.readProbes.get(requested);
    if (cached && cached.expiresAt > now) return cached.result;
    this.pruneExpired(now);

    const { workspace, probe, platform } = this.deps;
    const result = findRegisteredWorktree(
      workspace,
      probe,
      requested,
      platform,
    );
    const entry: ReadProbeEntry = {
      expiresAt: now + READ_PROBE_TTL_MS,
      result,
    };
    this.readProbes.set(requested, entry);
    const forget = (): void => {
      if (this.readProbes.get(requested) === entry) {
        this.readProbes.delete(requested);
      }
    };
    // Keep confirmations only; a refusal is re-probed on the next read.
    void result.then((worktree) => {
      if (!worktree) forget();
    }, forget);
    return result;
  }

  private pruneExpired(now: number): void {
    for (const [key, entry] of this.readProbes) {
      if (entry.expiresAt <= now) this.readProbes.delete(key);
    }
  }
}

/**
 * The production {@link WorktreeRootProbe}: git's worktree list and common
 * dir from `GitInfoService`, directory existence from the file system port.
 * A stat failure reads as "not a directory".
 */
export function createWorktreeRootProbe(
  gitInfo: Pick<GitInfoService, 'getWorktrees' | 'getCommonDir'>,
  fileSystem: Pick<IFileSystemProvider, 'stat'>,
): WorktreeRootProbe {
  return {
    listWorktrees: (folder) => gitInfo.getWorktrees(folder),
    commonDir: (dir) => gitInfo.getCommonDir(dir),
    directoryExists: (dir) =>
      fileSystem.stat(dir).then(
        (stat) => (stat.type & FileType.Directory) !== 0,
        // An unreadable path reads as absent, which only refuses the root.
        () => false,
      ),
  };
}
