import * as path from 'node:path';
import {
  FileType,
  isPathWithinRoots,
  type IFileSystemProvider,
} from '@ptah-extension/platform-core';

function normalize(value: string): string {
  const normalized = path
    .resolve(value)
    .replace(/\\/g, '/')
    .replace(/\/+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function registeredRoot(
  requested: string,
  roots: readonly string[],
): string | undefined {
  const target = normalize(requested);
  return roots.find((root) => normalize(root) === target);
}

/** Resolve and verify a launch path against the registered workspace set. */
export async function resolveWorkspaceFilePath(
  request: { path: string; workspaceRoot?: string },
  roots: readonly string[],
  fileSystem: IFileSystemProvider,
): Promise<
  { success: true; path: string } | { success: false; error: string }
> {
  const explicitRoot = request.workspaceRoot
    ? registeredRoot(request.workspaceRoot, roots)
    : undefined;
  if (request.workspaceRoot && !explicitRoot) {
    return { success: false, error: 'Workspace root is not registered' };
  }
  if (!path.isAbsolute(request.path) && !explicitRoot) {
    return {
      success: false,
      error: 'A workspace root is required for a relative path',
    };
  }
  const resolved = path.resolve(explicitRoot ?? '', request.path);
  const authorizedRoots = explicitRoot ? [explicitRoot] : roots;
  if (!isPathWithinRoots(resolved, authorizedRoots)) {
    return { success: false, error: 'Path is outside the workspace' };
  }
  try {
    const stat = await fileSystem.stat(resolved);
    if ((stat.type & FileType.Directory) !== 0) {
      return { success: false, error: 'Path is a directory' };
    }
  } catch {
    return { success: false, error: 'File does not exist or is unreadable' };
  }
  return { success: true, path: resolved };
}
