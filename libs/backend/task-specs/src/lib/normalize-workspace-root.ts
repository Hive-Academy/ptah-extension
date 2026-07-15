import * as path from 'path';

/**
 * Canonical workspace-root key used by the index store, the watcher event
 * filter, and RPC params alike — so the same workspace never yields two
 * different keys (NFR-8).
 *
 * Steps:
 *  1. `path.resolve` — absolutize + normalize separators for the host OS.
 *  2. strip a trailing separator (defensive; `resolve` already does for
 *     non-root paths, but callers may pass pre-joined strings).
 *  3. lower-case a Windows drive letter (`D:\` and `d:\` are the same root).
 */
export function normalizeWorkspaceRoot(root: string): string {
  let resolved = path.resolve(root);
  resolved = resolved.replace(/[\\/]+$/, '');
  resolved = resolved.replace(/^([a-zA-Z]):/, (_m, drive: string) => {
    return `${drive.toLowerCase()}:`;
  });
  return resolved;
}
