import { homedir } from 'node:os';
import { isPathWithinRoots } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';

/**
 * Checks whether `workspacePath` is an authorized workspace root or a path
 * inside one of the open workspace folders.
 *
 * The lexical containment MECHANISM (resolve → normalize → separator-boundary
 * compare, win32-only case fold) lives in `platform-core`'s
 * {@link isPathWithinRoots} so this boundary check and the pty spawn-sink
 * re-check share one implementation and cannot drift.
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

/**
 * Checks whether `candidate` is the user's home directory or a path inside it.
 * Uses the same containment predicate as {@link isAuthorizedWorkspace} so the
 * two arms of the terminal-cwd check behave identically.
 */
export function isWithinHomeDir(candidate: string): boolean {
  if (!candidate) return false;
  return isPathWithinRoots(candidate, [homedir()]);
}

/**
 * The authorized-root SET for a terminal `cwd`: every open workspace folder
 * plus the user's home directory.
 *
 * This is the POLICY. The RPC handler both (a) checks a caller-supplied `cwd`
 * against it via {@link isPathWithinRoots} at the boundary and (b) passes the
 * very same array DOWN the `IPtyHost.create` port so the spawn sink can
 * re-validate `cwd` without doing its own workspace discovery (TASK_2026_191
 * F4). Handing down the array — not the `IWorkspaceProvider` — is what keeps the
 * sink decoupled from workspace state.
 */
export function authorizedTerminalRoots(
  workspaceProvider: IWorkspaceProvider,
): string[] {
  const folders = workspaceProvider.getWorkspaceFolders() ?? [];
  return [...folders, homedir()];
}

/**
 * Containment gate for a terminal `cwd`: authorized when it is inside an open
 * workspace folder OR inside the user's home directory. Equivalent to testing
 * containment within {@link authorizedTerminalRoots}.
 */
export function isAuthorizedTerminalCwd(
  cwd: string,
  workspaceProvider: IWorkspaceProvider,
): boolean {
  return isPathWithinRoots(cwd, authorizedTerminalRoots(workspaceProvider));
}
