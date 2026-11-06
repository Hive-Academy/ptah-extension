import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type {
  CommonDirRead,
  WorktreeListRead,
} from '@ptah-extension/vscode-core';

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

/** Whether a directory exists; `failed` is a stat error other than "absent". */
export type DirectoryRead =
  | { readonly kind: 'exists' }
  | { readonly kind: 'absent' }
  | { readonly kind: 'failed'; readonly cause: Error };

/**
 * What {@link probeRegisteredWorktree} asks of git and the file system. Every
 * read answers with an outcome, never a bare value, so a timeout or an
 * unreadable path can never pass for "not a worktree".
 */
export interface WorktreeRootProbe {
  /** `git worktree list` for an open folder, with git's `prunable` label. */
  listWorktrees(
    folder: string,
    signal?: AbortSignal,
  ): Promise<WorktreeListRead>;
  /** Absolute `git rev-parse --git-common-dir` run in `dir`. */
  commonDir(dir: string, signal?: AbortSignal): Promise<CommonDirRead>;
  /** Whether `dir` exists as a directory. */
  directory(dir: string): Promise<DirectoryRead>;
  /** Drop every cached answer, so the next probe asks git again. */
  invalidate(): void;
}

export type RegisteredWorktreeOutcome =
  | { kind: 'confirmed-worktree'; path: string }
  | { kind: 'confirmed-not-worktree' }
  | { kind: 'probe-failed'; cause: Error };

/**
 * Whether `requested` names a live worktree of an open workspace folder's
 * repository, as git lists it.
 *
 * For the `'folder-or-worktree'` root policy: it lets the review dock read a
 * turn's worktree without opening it as a workspace folder. The list itself
 * is repo metadata anyone with write access to `.git/worktrees` can edit, so
 * a listed path is accepted only when its directory exists, it is not a UNC
 * path, git does not mark it `prunable`, and git run inside it reports the
 * same common directory as the open folder — the candidate really is that
 * repository's worktree, not an arbitrary directory named in its metadata.
 * git never runs in `requested` before the list names it.
 *
 * A folder whose probe fails makes the answer `probe-failed` (retryable)
 * only when that folder could own `requested` — see {@link couldOwn} —
 * so one permanently broken folder elsewhere cannot turn every gone worktree
 * into a retry loop.
 */
export async function probeRegisteredWorktree(
  workspace: IWorkspaceProvider,
  probe: WorktreeRootProbe,
  requested: string,
  platform: NodeJS.Platform = process.platform,
  signal?: AbortSignal,
): Promise<RegisteredWorktreeOutcome> {
  // A UNC path is never accepted, so it is refused before a stat can reach
  // the network share.
  if (isUncPath(requested)) return { kind: 'confirmed-not-worktree' };
  const requestedDir = await probe.directory(requested);
  if (requestedDir.kind === 'failed') {
    return { kind: 'probe-failed', cause: requestedDir.cause };
  }
  if (requestedDir.kind === 'absent') return { kind: 'confirmed-not-worktree' };

  const ignoreCase = platform === 'win32' || platform === 'darwin';
  const target = normalizeFolder(requested, ignoreCase);
  const results = await Promise.all(
    workspace.getWorkspaceFolders().map(async (folder) => {
      try {
        return {
          folder,
          outcome: await liveWorktreeOf(
            folder,
            probe,
            target,
            ignoreCase,
            signal,
          ),
        };
      } catch (error: unknown) {
        const cause = error instanceof Error ? error : new Error(String(error));
        const outcome: RegisteredWorktreeOutcome = {
          kind: 'probe-failed',
          cause,
        };
        return { folder, outcome };
      }
    }),
  );
  const confirmed = results.find(
    ({ outcome }) => outcome.kind === 'confirmed-worktree',
  );
  if (confirmed) return confirmed.outcome;
  const failure = results.find(
    ({ folder, outcome }) =>
      outcome.kind === 'probe-failed' && couldOwn(folder, target, ignoreCase),
  );
  return failure?.outcome ?? { kind: 'confirmed-not-worktree' };
}

/** `folder`'s listed worktree at `target`, when every check holds. */
async function liveWorktreeOf(
  folder: string,
  probe: WorktreeRootProbe,
  target: string,
  ignoreCase: boolean,
  signal?: AbortSignal,
): Promise<RegisteredWorktreeOutcome> {
  const listing = await probe.listWorktrees(folder, signal);
  if (listing.kind === 'failed') {
    return { kind: 'probe-failed', cause: listing.cause };
  }
  if (listing.kind === 'not-a-repo') return { kind: 'confirmed-not-worktree' };
  const match = listing.worktrees.find(
    (worktree) =>
      !!worktree.path &&
      !worktree.prunable &&
      !isUncPath(worktree.path) &&
      normalizeFolder(worktree.path, ignoreCase) === target,
  )?.path;
  // `match` is the requested directory, whose existence was checked first.
  if (!match) return { kind: 'confirmed-not-worktree' };
  const [folderCommonDir, candidateCommonDir] = await Promise.all([
    probe.commonDir(folder, signal),
    probe.commonDir(match, signal),
  ]);
  if (folderCommonDir.kind === 'failed') {
    return { kind: 'probe-failed', cause: folderCommonDir.cause };
  }
  if (candidateCommonDir.kind === 'failed') {
    return { kind: 'probe-failed', cause: candidateCommonDir.cause };
  }
  const same =
    folderCommonDir.kind === 'dir' &&
    candidateCommonDir.kind === 'dir' &&
    normalizeFolder(candidateCommonDir.path, ignoreCase) ===
      normalizeFolder(folderCommonDir.path, ignoreCase);
  return same
    ? { kind: 'confirmed-worktree', path: match }
    : { kind: 'confirmed-not-worktree' };
}

/**
 * Whether `folder`'s repository could own the normalized `target`: it lies
 * inside the folder (`.claude-worktrees/` and other nested worktrees) or
 * beside it under the folder's parent (`git worktree add ../name`). A
 * worktree elsewhere is still accepted when the folder answers; only the
 * failure of a folder that cannot plausibly own the path stops counting.
 */
function couldOwn(
  folder: string,
  target: string,
  ignoreCase: boolean,
): boolean {
  const root = normalizeFolder(folder, ignoreCase);
  const parent = root.slice(0, root.lastIndexOf('/'));
  return isWithin(target, root) || (parent !== '' && isWithin(target, parent));
}

function isUncPath(path: string): boolean {
  return /^[\\/]{2}/.test(path);
}

function isWithin(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}/`);
}

function normalizeFolder(path: string, ignoreCase: boolean): string {
  const slashed = path.replaceAll('\\', '/');
  let end = slashed.length;
  while (end > 0 && slashed[end - 1] === '/') end--;
  const trimmed = slashed.slice(0, end);
  return ignoreCase ? trimmed.toLowerCase() : trimmed;
}
