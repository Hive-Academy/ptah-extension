/**
 * Readers for the persisted Electron layout (`electron-layout` webview state).
 *
 * Split out of `electron-layout.service.ts`, which is at its size limit. The
 * persisted state is untrusted input (an older build, or a hand-edited state
 * file, may have written it), so every reader narrows from `unknown`.
 */

import { lastPathSegment } from '@ptah-extension/shared';

export interface WorkspaceFolder {
  path: string;
  name: string;
}

/** The folder part of the persisted layout. */
export interface PersistedWorkspaceState {
  workspaceFolders?: unknown[];
  activeWorkspaceIndex?: number;
}

/** A persisted folder entry with the two string fields the rail needs. */
export function isWorkspaceFolder(value: unknown): value is WorkspaceFolder {
  return (
    typeof value === 'object' &&
    value !== null &&
    'path' in value &&
    typeof value.path === 'string' &&
    'name' in value &&
    typeof value.name === 'string'
  );
}

/** The valid folder entries of a persisted layout, or `null` if it has none. */
export function persistedWorkspaceFolders(
  state: PersistedWorkspaceState,
): WorkspaceFolder[] | null {
  return Array.isArray(state.workspaceFolders)
    ? state.workspaceFolders.filter(isWorkspaceFolder)
    : null;
}

/**
 * The one clamp for a persisted active index: an integer in
 * `[0, folderCount - 1]` (`0` for an empty list). A missing, `NaN`, infinite
 * or fractional index is malformed and falls back to `0`.
 */
export function clampActiveWorkspaceIndex(
  requested: unknown,
  folderCount: number,
): number {
  const index =
    typeof requested === 'number' && Number.isInteger(requested)
      ? requested
      : 0;
  return Math.min(Math.max(0, index), Math.max(0, folderCount - 1));
}

/**
 * Basename of `workspaceFolders[activeWorkspaceIndex]` in a persisted layout,
 * or `null` when the entry is missing or malformed.
 */
export function persistedActiveFolderName(
  state: PersistedWorkspaceState,
): string | null {
  const folders = persistedWorkspaceFolders(state);
  if (!folders) return null;
  const folder =
    folders[clampActiveWorkspaceIndex(state.activeWorkspaceIndex, folders.length)];
  if (!folder) return null;
  return lastPathSegment(folder.path) || folder.name || null;
}
