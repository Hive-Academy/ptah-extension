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

  const normalize = (p: string) =>
    path.resolve(p).replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');

  const target = normalize(workspacePath);

  return folders.some((f) => {
    const folder = normalize(f);
    if (folder === target) return true;
    if (target.startsWith(folder + '/')) return true;
    return false;
  });
}
