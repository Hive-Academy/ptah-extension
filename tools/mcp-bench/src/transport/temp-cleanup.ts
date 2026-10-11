/**
 * Removing a bench temp folder after its process was killed. On win32 a dead
 * process's file handles close a moment after its exit (`taskkill /T /F` is
 * the Electron stop), so `rmdir` fails with EBUSY/EPERM/ENOTEMPTY for a while.
 * {@link removeTempDir} retries for a bounded time and then REPORTS the folder
 * it could not remove instead of throwing: a leftover temp folder is a fact
 * about the run, never a reason to lose it. Callers record the returned text.
 */

import { rm } from 'node:fs/promises';

export interface TempCleanupOptions {
  /** The removal, injectable for specs. Default `fs.rm(path, { recursive, force })`. */
  readonly remove?: (path: string) => Promise<void>;
  /** Attempts before giving up. Default 20. */
  readonly attempts?: number;
  /** Wait between attempts. Default 500 ms (about 10 s in all). */
  readonly delayMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * Removes `path` (recursively), retrying on any error. Resolves `null` once
 * the folder is gone, else `temp folder left: <path>: <last error>`. Never rejects.
 */
export async function removeTempDir(
  path: string,
  options: TempCleanupOptions = {},
): Promise<string | null> {
  const remove =
    options.remove ??
    ((target) => rm(target, { recursive: true, force: true }));
  const attempts = Math.max(1, options.attempts ?? 20);
  const delayMs = options.delayMs ?? 500;
  const sleep =
    options.sleep ??
    ((ms) => new Promise<void>((done) => setTimeout(done, ms)));
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await remove(path);
      return null;
    } catch (error: unknown) {
      last = error;
      if (attempt < attempts) await sleep(delayMs);
    }
  }
  return `temp folder left: ${path}: ${last instanceof Error ? last.message : String(last)}`;
}
