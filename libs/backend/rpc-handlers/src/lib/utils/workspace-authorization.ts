import * as path from 'path';
import { homedir } from 'node:os';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';

/**
 * Canonicalize a path for containment comparison:
 * resolve → forward-slashes → lowercase → strip trailing slash.
 * Shared by every containment check in this file so they compare byte-identical
 * shapes.
 */
function normalize(p: string): string {
  return path
    .resolve(p.replace(/\\/g, '/'))
    .replace(/\\/g, '/')
    .toLowerCase()
    .replace(/\/+$/, '');
}

/**
 * Checks whether `candidate` is contained within `base` (equal to it, or a
 * descendant). The separator boundary check (`base + '/'`) prevents `/foo/bar`
 * from accidentally matching `/foo/barbaz`.
 */
function isContainedIn(candidate: string, base: string): boolean {
  const target = normalize(candidate);
  const root = normalize(base);
  return target === root || target.startsWith(root + '/');
}

/**
 * Checks whether `workspacePath` is an authorized workspace root or a path
 * inside one of the open workspace folders.
 *
 * Normalization mirrors `session-rpc.handlers.ts:isAuthorizedWorkspace`:
 * resolve → forward-slashes → lowercase → strip trailing slash.
 */
export function isAuthorizedWorkspace(
  workspacePath: string,
  workspaceProvider: IWorkspaceProvider,
): boolean {
  if (!workspacePath) return false;
  const folders = workspaceProvider.getWorkspaceFolders();
  if (!folders || folders.length === 0) return false;

  return folders.some((f) => isContainedIn(workspacePath, f));
}

/**
 * Checks whether `candidate` is the user's home directory or a path inside it.
 * Uses the same normalization as {@link isAuthorizedWorkspace} so the two arms
 * of the terminal-cwd check behave identically.
 */
export function isWithinHomeDir(candidate: string): boolean {
  if (!candidate) return false;
  return isContainedIn(candidate, homedir());
}

/**
 * Containment gate for a terminal `cwd`: authorized when it is inside an open
 * workspace folder OR inside the user's home directory.
 *
 * This composes {@link isAuthorizedWorkspace} (unchanged, still "an open
 * workspace folder" for its session-handler callers) with the extra home arm
 * that terminal spawning requires, without widening the shared predicate.
 */
export function isAuthorizedTerminalCwd(
  cwd: string,
  workspaceProvider: IWorkspaceProvider,
): boolean {
  return isAuthorizedWorkspace(cwd, workspaceProvider) || isWithinHomeDir(cwd);
}
