/**
 * SpecSkipCache — remembers `TASK_*` folders that definitely have no `task.md`
 * carrier, so the harvester does not re-walk them on every read.
 *
 * Only a definite miss is remembered: the carrier `stat` answered ENOENT /
 * ENOTDIR while the folder itself was readable. A carrier that exists but could
 * not be read or parsed (EMFILE, EBUSY, an antivirus lock, an oversized file,
 * invalid frontmatter) is never cached, so a transient failure cannot hide a
 * folder from harvesting and the Tasks board. A remembered miss is dropped when
 * the folder's own mtime/size changes (a carrier appearing adds a directory
 * entry) and, at the latest, after {@link SKIP_CACHE_TTL_MS} — which also
 * bounds the case a folder signature cannot see (a dangling carrier symlink
 * whose target is created later).
 */
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { CARRIER_FILE } from '@ptah-extension/shared';

/** Longest a definite miss is trusted without looking at the carrier again. */
export const SKIP_CACHE_TTL_MS = 60_000;

const MAX_ENTRIES = 512;

export type SpecFolderVerdict = 'skip' | 'read';

interface SkipEntry {
  readonly signature: string;
  readonly expiresAt: number;
}

type CarrierPresence = 'present' | 'absent' | 'unknown';

/**
 * Structural, not `instanceof Error`: `fs` errors can come from another realm
 * (Jest's sandbox, a worker), where an `instanceof` check is false and a
 * definite miss would be misread as a transient failure.
 */
function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  );
}

async function folderSignature(directory: string): Promise<string | null> {
  try {
    const info = await stat(directory);
    return `${info.mtimeMs}:${info.size}`;
  } catch {
    // degradation-audit: optional-capability — an unreadable folder has no
    // signature, so it is never cached and the carrier check below decides.
    return null;
  }
}

async function carrierPresence(path: string): Promise<CarrierPresence> {
  try {
    await stat(path);
    return 'present';
  } catch (error: unknown) {
    // Only a missing path is a definite miss; every other failure is
    // `unknown`, which the caller treats as "read it" (never cached).
    return isMissingPathError(error) ? 'absent' : 'unknown';
  }
}

export class SpecSkipCache {
  private readonly entries = new Map<string, SkipEntry>();

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * `skip` for a folder with no carrier (remembered or just confirmed);
   * `read` when the carrier exists or its presence could not be established —
   * the caller then runs the full extraction, whose null result is not cached.
   */
  async classify(directory: string): Promise<SpecFolderVerdict> {
    const signature = await folderSignature(directory);
    const entry = this.entries.get(directory);
    if (
      entry !== undefined &&
      signature !== null &&
      entry.signature === signature &&
      entry.expiresAt > this.now()
    ) {
      return 'skip';
    }
    this.entries.delete(directory);
    const presence = await carrierPresence(join(directory, CARRIER_FILE));
    if (presence !== 'absent') return 'read';
    if (signature !== null) this.remember(directory, signature);
    return 'skip';
  }

  private remember(directory: string, signature: string): void {
    if (this.entries.size >= MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(directory, {
      signature,
      expiresAt: this.now() + SKIP_CACHE_TTL_MS,
    });
  }
}
