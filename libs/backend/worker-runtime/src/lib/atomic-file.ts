import { randomBytes } from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';

/**
 * Replaces `path` atomically with owner-only content. The data goes to an
 * exclusively created (`wx`), uniquely named 0600 temp file beside it, which
 * is then renamed into place, so a reader sees the old or the new file and a
 * crash never leaves a half-written one. A failed write removes its temp file.
 */
export async function writeFileAtomic(
  path: string,
  data: string,
): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(temporary, data, { mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/** {@link writeFileAtomic} for a JSON value. */
export function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  return writeFileAtomic(path, JSON.stringify(value));
}
