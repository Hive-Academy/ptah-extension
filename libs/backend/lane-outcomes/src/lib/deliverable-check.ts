/**
 * Containment for one deliverable path.
 *
 * Lexical check first: `..`, a Windows drive or UNC entry that is not absolute
 * on this platform, and any resolved path outside the root are rejected before
 * a filesystem call. `checkDeliverable` then realpaths the root and the entry
 * and repeats that relative-path test. A real path outside the real root is
 * `outside-root` and is never stat'ed. A missing path, including a dangling
 * symlink, cannot leak data and is reported as not found. Error results carry
 * a code only, never a path or a provider message.
 */

import { isAbsolute, relative, resolve, sep, win32 } from 'node:path';
import type { IFileSystemProvider } from '@ptah-extension/platform-core';

export interface DeliverableCheck {
  readonly exists: boolean;
  readonly bytes: number;
  readonly mtimeMs: number | null;
}

export type DeliverableCheckResult =
  | { readonly check: DeliverableCheck }
  | { readonly errorCode: string };

const OUTSIDE_ROOT = 'outside-root';

/**
 * Node reports a missing path as ENOENT (ENOTDIR when a parent is a file).
 * `vscode.workspace.fs` uses FileNotFound and FileNotADirectory.
 */
const NOT_FOUND_CODES: ReadonlySet<string> = new Set([
  'ENOENT',
  'ENOTDIR',
  'FileNotFound',
  'FileNotADirectory',
]);

function missingFile(): DeliverableCheckResult {
  return { check: { exists: false, bytes: 0, mtimeMs: null } };
}

export function containedDeliverablePath(
  root: string,
  entry: string,
): string | null {
  if (isForeignPlatformPath(entry)) return null;
  const base = resolve(root);
  const resolved = resolve(base, entry);
  return isInside(base, resolved) ? resolved : null;
}

export async function checkDeliverable(
  fs: Pick<IFileSystemProvider, 'stat' | 'realpath'>,
  root: string,
  entry: string,
): Promise<DeliverableCheckResult> {
  const lexical = containedDeliverablePath(root, entry);
  if (lexical === null) return { errorCode: OUTSIDE_ROOT };
  const realRoot = await resolveReal(fs, resolve(root));
  if (!('path' in realRoot)) return realRoot;
  const realPath = await resolveReal(fs, lexical);
  if (!('path' in realPath)) return realPath;
  if (!isInside(realRoot.path, realPath.path))
    return { errorCode: OUTSIDE_ROOT };
  try {
    const stat = await fs.stat(realPath.path);
    return { check: { exists: true, bytes: stat.size, mtimeMs: stat.mtime } };
  } catch (error: unknown) {
    return fromFsError(error);
  }
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * `C:/…` and `\\server\…` are not absolute on POSIX, so `resolve` would join
 * them onto the root. A drive-relative `C:foo` is the same class.
 */
function isForeignPlatformPath(entry: string): boolean {
  if (win32.isAbsolute(entry) && !isAbsolute(entry)) return true;
  return process.platform !== 'win32' && /^[A-Za-z]:/.test(entry);
}

function codeOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'string' && code.length > 0) return code;
  }
  return 'UNKNOWN';
}

function fromFsError(error: unknown): DeliverableCheckResult {
  if (NOT_FOUND_CODES.has(codeOf(error))) return missingFile();
  return { errorCode: codeOf(error) };
}

async function resolveReal(
  fs: Pick<IFileSystemProvider, 'realpath'>,
  target: string,
): Promise<{ readonly path: string } | DeliverableCheckResult> {
  try {
    return { path: await fs.realpath(target) };
  } catch (error: unknown) {
    return fromFsError(error);
  }
}
