import type { IWorkspaceProvider } from '@ptah-extension/platform-core';

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

function normalizeFolder(path: string, ignoreCase: boolean): string {
  const slashed = path.replaceAll('\\', '/');
  let end = slashed.length;
  while (end > 0 && slashed[end - 1] === '/') end--;
  const trimmed = slashed.slice(0, end);
  return ignoreCase ? trimmed.toLowerCase() : trimmed;
}
