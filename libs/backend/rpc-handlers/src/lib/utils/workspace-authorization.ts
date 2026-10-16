import { isPathWithinRoots } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import * as path from 'path';

/** Compare workspace roots, never their children, using the host's path rules. */
export function sameWorkspaceRoot(
  left: string,
  right: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (!left || !right) return false;
  const paths = platform === 'win32' ? path.win32 : path;
  const normalized = (value: string): string => {
    const resolved = paths.normalize(paths.resolve(value));
    const root = paths.parse(resolved).root;
    const withoutTrailing =
      resolved === root ? resolved : resolved.replace(/[\\/]+$/, '');
    return platform === 'win32'
      ? withoutTrailing.toLowerCase()
      : withoutTrailing;
  };
  return normalized(left) === normalized(right);
}

/** Return the open folder's original spelling for all file and context operations. */
export function findOpenWorkspaceRoot(
  requestedRoot: string,
  workspaceProvider: IWorkspaceProvider,
): string | undefined {
  return workspaceProvider
    .getWorkspaceFolders()
    .find((folder) => sameWorkspaceRoot(folder, requestedRoot));
}

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
