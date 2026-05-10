import * as path from 'path';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';

/**
 * Checks whether `workspacePath` is an authorized workspace root or a path
 * inside one of the open workspace folders.
 *
 * Normalization mirrors `session-rpc.handlers.ts:isAuthorizedWorkspace`:
 * resolve → forward-slashes → lowercase → strip trailing slash.
 * The separator boundary check (`folder + '/'`) prevents `/foo/bar` from
 * accidentally matching `/foo/barbaz`.
 */
export function isAuthorizedWorkspace(
  workspacePath: string,
  workspaceProvider: IWorkspaceProvider,
): boolean {
  if (!workspacePath) return false;
  const folders = workspaceProvider.getWorkspaceFolders();
  if (!folders || folders.length === 0) return false;

  // Convert backslashes to forward slashes BEFORE path.resolve so input paths
  // serialized with Windows separators are interpreted as path separators on
  // POSIX runtimes too (otherwise resolve() treats `\` as part of the filename).
  const normalize = (p: string) =>
    path
      .resolve(p.replace(/\\/g, '/'))
      .replace(/\\/g, '/')
      .toLowerCase()
      .replace(/\/+$/, '');

  const target = normalize(workspacePath);

  return folders.some((f) => {
    const folder = normalize(f);
    if (folder === target) return true;
    if (target.startsWith(folder + '/')) return true;
    return false;
  });
}
