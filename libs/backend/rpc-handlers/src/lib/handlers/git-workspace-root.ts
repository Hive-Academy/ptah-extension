import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { GitWorktreeInfo } from '@ptah-extension/shared';

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
}

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
  const ignoreCase = platform === 'win32' || platform === 'darwin';
  const target = normalizeFolder(requested, ignoreCase);
  for (const folder of workspace.getWorkspaceFolders()) {
    try {
      const match = await liveWorktreeOf(folder, probe, target, ignoreCase);
      if (match) return match;
    } catch {
      // degradation-audit: optional-capability - an unreadable worktree list
      // or common directory only means this folder authorizes no extra root;
      // it never widens.
    }
  }
  return undefined;
}

/** `folder`'s listed worktree at `target`, when every check holds. */
async function liveWorktreeOf(
  folder: string,
  probe: WorktreeRootProbe,
  target: string,
  ignoreCase: boolean,
): Promise<string | undefined> {
  const match = (await probe.listWorktrees(folder)).find(
    (worktree) =>
      !!worktree.path &&
      !worktree.prunable &&
      !/^[\\/]{2}/.test(worktree.path) &&
      normalizeFolder(worktree.path, ignoreCase) === target,
  )?.path;
  if (!match || !(await probe.directoryExists(match))) return undefined;
  const [folderCommonDir, candidateCommonDir] = await Promise.all([
    probe.commonDir(folder),
    probe.commonDir(match),
  ]);
  const same =
    !!folderCommonDir &&
    !!candidateCommonDir &&
    normalizeFolder(candidateCommonDir, ignoreCase) ===
      normalizeFolder(folderCommonDir, ignoreCase);
  return same ? match : undefined;
}

function normalizeFolder(path: string, ignoreCase: boolean): string {
  const slashed = path.replaceAll('\\', '/');
  let end = slashed.length;
  while (end > 0 && slashed[end - 1] === '/') end--;
  const trimmed = slashed.slice(0, end);
  return ignoreCase ? trimmed.toLowerCase() : trimmed;
}
