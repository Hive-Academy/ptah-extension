import { isPathWithinRoots } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';

/**
 * Checks whether `workspacePath` is an authorized workspace root or a path
 * inside one of the open workspace folders.
 *
 * The lexical containment MECHANISM (resolve → normalize → separator-boundary
 * compare, win32-only case fold) lives in `platform-core`'s
 * {@link isPathWithinRoots}, so any other consumer of the same rule shares one
 * implementation and cannot drift from this one.
 */
export function isAuthorizedWorkspace(
  workspacePath: string,
  workspaceProvider: IWorkspaceProvider,
): boolean {
  if (!workspacePath) return false;
  const folders = workspaceProvider.getWorkspaceFolders();
  if (!folders || folders.length === 0) return false;

  return isPathWithinRoots(workspacePath, folders);
}
