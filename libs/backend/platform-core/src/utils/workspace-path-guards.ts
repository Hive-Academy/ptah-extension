import * as path from 'path';
import type { IPlatformInfo } from '../types/platform.types';

export interface WorkspacePathSafety {
  readonly ok: boolean;
  readonly reason?: string;
}

function normalize(candidate: string): string {
  const resolved = path.resolve(candidate);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isFilesystemRoot(resolved: string): boolean {
  return path.parse(resolved).root === resolved;
}

/**
 * Reject candidate paths that must never be used as a session cwd: the
 * filesystem root, the Ptah install/extension directory, or the platform's
 * global storage directory. The check is best-effort — `platformInfo` paths
 * are normalized but not canonicalized (no symlink resolution), so callers
 * should treat a falsy result as advisory enforcement.
 */
export function isUnsafeWorkspacePath(
  candidate: string | undefined | null,
  platformInfo: Pick<IPlatformInfo, 'extensionPath' | 'globalStoragePath'>,
): WorkspacePathSafety {
  if (!candidate || candidate.trim().length === 0) {
    return { ok: false, reason: 'empty workspace path' };
  }

  const resolved = path.resolve(candidate);
  if (isFilesystemRoot(resolved)) {
    return { ok: false, reason: `filesystem root (${resolved})` };
  }

  const normalized = normalize(candidate);
  const appPath = normalize(platformInfo.extensionPath);
  if (normalized === appPath) {
    return { ok: false, reason: `app installation directory (${appPath})` };
  }
  if (appPath.startsWith(normalized + path.sep)) {
    return {
      ok: false,
      reason: `ancestor of app installation directory (${normalized} contains ${appPath})`,
    };
  }

  const storagePath = normalize(platformInfo.globalStoragePath);
  if (normalized === storagePath) {
    return {
      ok: false,
      reason: `app global storage directory (${storagePath})`,
    };
  }

  return { ok: true };
}
