import type { IWorkspaceProvider } from '@ptah-extension/platform-core';

/**
 * Whether `requested` is exactly one of the registered workspace folders
 * (separators, a trailing slash and case ignored).
 *
 * The `git:*` handlers accept a caller-named folder only when this holds, and
 * never fall back to the active folder when it does not: a stale or hostile
 * request must not read from, or mutate, a different repository.
 */
export function isRegisteredWorkspaceFolder(
  workspace: IWorkspaceProvider,
  requested: string,
): boolean {
  const target = normalizeFolder(requested);
  return workspace
    .getWorkspaceFolders()
    .some((folder) => normalizeFolder(folder) === target);
}

function normalizeFolder(path: string): string {
  const slashed = path.replaceAll('\\', '/');
  let end = slashed.length;
  while (end > 0 && slashed[end - 1] === '/') end--;
  return slashed.slice(0, end).toLowerCase();
}
