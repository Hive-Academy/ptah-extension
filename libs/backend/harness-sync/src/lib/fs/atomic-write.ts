/**
 * The one way this lib persists a file it owns: temp + rename, retried.
 *
 * Five call sites used to spell this out for themselves — the managed manifest,
 * the two MCP facets, the MCP intent store and the `.gitignore` writer — and
 * four of the five had the temp+rename half without the RETRY half. That is
 * precisely backwards for the failure they were protecting against: `renameSync`
 * over a file an antivirus scanner has open is EPERM/EBUSY on Windows, and the
 * unretried version turned a 40ms hiccup into a manifest that never landed. A
 * manifest that never landed is the worst outcome this lib has, because the next
 * pass reads no ownership record and reclassifies every file Ptah wrote as
 * foreign — the harness freezes and only a manual repair unfreezes it.
 *
 * Two properties, both load-bearing:
 *
 * - **Atomic.** A reader never sees a half-written file. The temp file lives in
 *   the SAME directory as the target so the rename stays within one filesystem.
 * - **Retried.** Every step — the parent `mkdir`, the write and the rename — goes
 *   through {@link withWindowsRetrySync}.
 *
 * It THROWS on final failure rather than logging. Every caller has a different
 * right answer (the manifest store warns and reports, the MCP facets propagate
 * to the facet planner, the gitignore writer degrades to `failed`), and a helper
 * that swallowed would take that choice away from all of them.
 */

import { mkdirSync, renameSync, rmSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { withWindowsRetrySync } from './windows-retry';

/**
 * Disambiguates two writes to the same path from one process. The workspace lock
 * and the in-process queue already serialize reconciles, but the MCP intent
 * store and the facets are also reachable from RPC handlers that hold neither.
 */
let sequence = 0;

/** `<path>.<pid>.<n>.tmp`, next to the target so the rename cannot cross a device. */
export function tempPathFor(path: string): string {
  sequence += 1;
  return `${path}.${process.pid}.${sequence}.tmp`;
}

/**
 * Write `content` to `path` atomically, retrying Windows sharing violations.
 *
 * @throws the last filesystem error when all attempts fail. The temp file is
 *   removed on the way out; a stranded one would be harmless but confusing.
 */
export function atomicWriteWithRetry(
  path: string,
  content: string | Buffer,
): void {
  withWindowsRetrySync(() => mkdirSync(dirname(path), { recursive: true }));

  const temp = tempPathFor(path);
  try {
    withWindowsRetrySync(() =>
      typeof content === 'string'
        ? writeFileSync(temp, content, 'utf-8')
        : writeFileSync(temp, content),
    );
    withWindowsRetrySync(() => renameSync(temp, path));
  } catch (error: unknown) {
    try {
      rmSync(temp, { force: true });
    } catch {
      /* best effort — a stranded temp file is harmless */
    }
    throw error;
  }
}
