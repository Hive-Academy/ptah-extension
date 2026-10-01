import {
  GIT_DIFF_MAX_SIDE_BYTES,
  type GitBlobRead,
} from '@ptah-extension/shared';

/**
 * Classification of one diff side's bytes into the {@link GitBlobRead}
 * outcomes that carry data: `content`, `binary`, `too-large` and
 * `lfs-pointer` (TASK_2026_576 RC12). The read itself — git, the worktree,
 * a review ref — stays with the caller.
 */

/** Leading bytes inspected for a NUL to decide `binary`, as git does. */
const BINARY_SNIFF_BYTES = 8000;

/** A Git LFS pointer file is never larger than this. */
const LFS_POINTER_MAX_BYTES = 1024;

/** First line of every Git LFS pointer file (spec v1). */
const LFS_POINTER_VERSION = 'version https://git-lfs.github.com/spec/v1';

const LFS_OID_KEY = 'oid ';
const LFS_SIZE_KEY = 'size ';

/**
 * Classify a side read in full. Order: over the per-side limit, then a Git
 * LFS pointer, then binary (a NUL in the first 8000 bytes), then text.
 */
export function classifyBlobBytes(bytes: Buffer): GitBlobRead {
  if (bytes.byteLength > GIT_DIFF_MAX_SIDE_BYTES) {
    return { outcome: 'too-large', byteLength: bytes.byteLength };
  }
  const pointer = readLfsPointer(bytes);
  if (pointer) return pointer;
  if (bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
    return { outcome: 'binary', byteLength: bytes.byteLength };
  }
  return { outcome: 'content', content: bytes.toString('utf8') };
}

/**
 * The pointer's `oid` (as written, e.g. `sha256:<hex>`) and `size`, or null
 * when `bytes` is not a well-formed Git LFS pointer. A file that starts with
 * the version line but lacks a valid `oid` or `size` is ordinary content.
 */
function readLfsPointer(
  bytes: Buffer,
): Extract<GitBlobRead, { outcome: 'lfs-pointer' }> | null {
  if (bytes.byteLength > LFS_POINTER_MAX_BYTES) return null;
  const text = bytes.toString('utf8');
  if (!text.startsWith(LFS_POINTER_VERSION)) return null;

  let oid: string | null = null;
  let size: number | null = null;
  for (const line of text.split('\n')) {
    if (line.startsWith(LFS_OID_KEY)) {
      oid = line.substring(LFS_OID_KEY.length).trim();
    } else if (line.startsWith(LFS_SIZE_KEY)) {
      const value = line.substring(LFS_SIZE_KEY.length).trim();
      size = /^\d+$/.test(value) ? Number(value) : null;
    }
  }
  if (!oid || size === null) return null;
  return { outcome: 'lfs-pointer', oid, size };
}
