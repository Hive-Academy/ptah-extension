import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { GitWorktreeInfo } from '@ptah-extension/shared';
import type { CommonDirRead, WorktreeListRead } from '@ptah-extension/vscode-core';

/**
 * The registered workspace folder that `requested` names, as it is
 * registered; undefined when it names none.
 *
 * Separators and a trailing slash are ignored everywhere; case only on
 * Windows and macOS, whose default file systems ignore it too. The returned
 * string is the registered folder, never the caller's spelling, so git runs
 * on the folder that was checked.
 *
 * The `git:*` handlers accept a caller-named folder only through this, and
 * never fall back to the active folder when it finds none: a stale or hostile
 * request must not read from, or mutate, a different repository.
 */
export function findRegisteredWorkspaceFolder(
  workspace: IWorkspaceProvider,
  requested: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const ignoreCase = platform === 'win32' || platform === 'darwin';
  const target = normalizeFolder(requested, ignoreCase);
  return workspace
    .getWorkspaceFolders()
    .find((folder) => normalizeFolder(folder, ignoreCase) === target);
}

/** What {@link findRegisteredWorktree} asks of git and the file system. */
export interface WorktreeRootProbe {
  /** `git worktree list` for an open folder, with git's `prunable` label. */
  listWorktrees(
    folder: string,
  ): Promise<readonly Pick<GitWorktreeInfo, 'path' | 'prunable'>[]>;
  /** Absolute `git rev-parse --git-common-dir` run in `dir`; null when unknown. */
  commonDir(dir: string): Promise<string | null>;
  /** Whether `dir` exists as a directory. */
  directoryExists(dir: string): Promise<boolean>;
  directoryRead?(dir: string): Promise<{ kind: 'exists' } | { kind: 'absent' } | { kind: 'failed'; cause: Error }>;
  listWorktreesRead?(folder: string, signal?: AbortSignal): Promise<WorktreeListRead>;
  commonDirRead?(dir: string, signal?: AbortSignal): Promise<CommonDirRead>;
  invalidate?(): void;
}

export type RegisteredWorktreeOutcome =
  | { kind: 'confirmed-worktree'; path: string }
  | { kind: 'confirmed-not-worktree' }
  | { kind: 'probe-failed'; cause: Error };

/**
 * The worktree that `requested` names, as git lists it, when it is a live
 * worktree of an open workspace folder's repository; undefined otherwise.
 *
 * For read-only `git:*` methods only: it lets the review dock read a turn's
 * worktree without opening it as a workspace folder. The list itself is repo
 * metadata anyone with write access to `.git/worktrees` can edit, so a listed
 * path is accepted only when it is not a UNC path, git does not mark it
 * `prunable`, its directory exists, and git run inside it reports the same
 * common directory as the open folder — the candidate really is that
 * repository's worktree, not an arbitrary directory named in its metadata.
 * A folder whose list or common directory cannot be read contributes nothing.
 */
export async function findRegisteredWorktree(
  workspace: IWorkspaceProvider,
  probe: WorktreeRootProbe,
  requested: string,
  platform: NodeJS.Platform = process.platform,
): Promise<string | undefined> {
  const result = await probeRegisteredWorktree(workspace, probe, requested, platform);
  return result.kind === 'confirmed-worktree' ? result.path : undefined;
}

export async function probeRegisteredWorktree(
  workspace: IWorkspaceProvider,
  probe: WorktreeRootProbe,
  requested: string,
  platform: NodeJS.Platform = process.platform,
  signal?: AbortSignal,
): Promise<RegisteredWorktreeOutcome> {
  const requestedDir = probe.directoryRead
    ? await probe.directoryRead(requested)
    : (await probe.directoryExists(requested) ? { kind: 'exists' as const } : { kind: 'absent' as const });
  if (requestedDir.kind === 'failed') return { kind: 'probe-failed', cause: requestedDir.cause };
  if (requestedDir.kind === 'absent') return { kind: 'confirmed-not-worktree' };
  const ignoreCase = platform === 'win32' || platform === 'darwin';
  const target = normalizeFolder(requested, ignoreCase);
  const results = await Promise.all(workspace.getWorkspaceFolders().map(async (folder): Promise<RegisteredWorktreeOutcome> => {
    try {
      return await liveWorktreeOf(folder, probe, target, ignoreCase, signal);
    } catch (error: unknown) {
      return { kind: 'probe-failed', cause: error instanceof Error ? error : new Error(String(error)) };
    }
  }));
  return results.find((result) => result.kind === 'confirmed-worktree')
    ?? results.find((result) => result.kind === 'probe-failed')
    ?? { kind: 'confirmed-not-worktree' };
}

/** `folder`'s listed worktree at `target`, when every check holds. */
async function liveWorktreeOf(
  folder: string,
  probe: WorktreeRootProbe,
  target: string,
  ignoreCase: boolean,
  signal?: AbortSignal,
): Promise<RegisteredWorktreeOutcome> {
  const listing = probe.listWorktreesRead
    ? await probe.listWorktreesRead(folder, signal)
    : { kind: 'listed' as const, worktrees: await probe.listWorktrees(folder) };
  if (listing.kind === 'failed') return { kind: 'probe-failed', cause: listing.cause };
  if (listing.kind === 'not-a-repo') return { kind: 'confirmed-not-worktree' };
  const match = listing.worktrees.find(
    (worktree) =>
      !!worktree.path &&
      !worktree.prunable &&
      !/^[\\/]{2}/.test(worktree.path) &&
      normalizeFolder(worktree.path, ignoreCase) === target,
  )?.path;
  if (!match) return { kind: 'confirmed-not-worktree' };
  const candidate = probe.directoryRead
    ? await probe.directoryRead(match)
    : (await probe.directoryExists(match) ? { kind: 'exists' as const } : { kind: 'absent' as const });
  if (candidate.kind === 'failed') return { kind: 'probe-failed', cause: candidate.cause };
  if (candidate.kind === 'absent') return { kind: 'confirmed-not-worktree' };
  const [folderCommonDir, candidateCommonDir] = await Promise.all([
    probe.commonDirRead ? probe.commonDirRead(folder, signal) : probe.commonDir(folder).then((path) => path ? { kind: 'dir' as const, path } : { kind: 'not-a-repo' as const }),
    probe.commonDirRead ? probe.commonDirRead(match, signal) : probe.commonDir(match).then((path) => path ? { kind: 'dir' as const, path } : { kind: 'not-a-repo' as const }),
  ]);
  if (folderCommonDir.kind === 'failed') return { kind: 'probe-failed', cause: folderCommonDir.cause };
  if (candidateCommonDir.kind === 'failed') return { kind: 'probe-failed', cause: candidateCommonDir.cause };
  const same =
    folderCommonDir.kind === 'dir' &&
    candidateCommonDir.kind === 'dir' &&
    normalizeFolder(candidateCommonDir.path, ignoreCase) ===
      normalizeFolder(folderCommonDir.path, ignoreCase);
  return same ? { kind: 'confirmed-worktree', path: match } : { kind: 'confirmed-not-worktree' };
}

function normalizeFolder(path: string, ignoreCase: boolean): string {
  const slashed = path.replaceAll('\\', '/');
  let end = slashed.length;
  while (end > 0 && slashed[end - 1] === '/') end--;
  const trimmed = slashed.slice(0, end);
  return ignoreCase ? trimmed.toLowerCase() : trimmed;
}
