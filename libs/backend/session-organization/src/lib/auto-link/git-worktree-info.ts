/**
 * Read a linked git worktree's identity from two small files, through the
 * host `IFileSystemProvider` port (no git process, decisions.md D4):
 *
 *  - `<cwd>/.git` is a FILE (a linked worktree; the main checkout has a
 *    directory there) holding `gitdir: <path>`;
 *  - `<gitdir>/HEAD` holds `ref: refs/heads/<branch>`, or a bare commit id
 *    when HEAD is detached (no branch).
 *
 * Every failure — no `.git`, a `.git` directory, an oversized or malformed
 * file, an unreadable HEAD — yields null (or a null branch). Never throws.
 */
import * as path from 'node:path';
import type { IFileSystemProvider } from '@ptah-extension/platform-core';

/** Both files are a single short line; anything larger is not one of them. */
const MAX_POINTER_FILE_BYTES = 4 * 1024;

const GITDIR_LINE = /^gitdir:\s*(.+?)\s*$/m;
const HEAD_REF_LINE = /^ref:\s*refs\/heads\/(.+?)\s*$/m;

export type WorktreeFileReader = Pick<IFileSystemProvider, 'readFile'>;

export interface GitWorktreeInfo {
  /** The directory the session runs in (as given). */
  worktreePath: string;
  /** The checked-out branch; null when HEAD is detached or unreadable. */
  branch: string | null;
}

async function readSmallFile(
  fs: WorktreeFileReader,
  file: string,
): Promise<string | null> {
  try {
    const content = await fs.readFile(file);
    return content.length > MAX_POINTER_FILE_BYTES ? null : content;
  } catch {
    // degradation-audit: optional-capability - an absent or unreadable
    // pointer file means "not a linked worktree"; the caller records nothing.
    return null;
  }
}

/** The linked worktree at `cwd`, or null when `cwd` is not one. */
export async function readGitWorktreeInfo(
  fs: WorktreeFileReader,
  cwd: string,
): Promise<GitWorktreeInfo | null> {
  const pointer = await readSmallFile(fs, path.join(cwd, '.git'));
  const gitdir = pointer === null ? undefined : GITDIR_LINE.exec(pointer)?.[1];
  if (gitdir === undefined || gitdir.length === 0) return null;

  const head = await readSmallFile(
    fs,
    path.join(path.resolve(cwd, gitdir), 'HEAD'),
  );
  const branch = head === null ? undefined : HEAD_REF_LINE.exec(head)?.[1];
  return { worktreePath: cwd, branch: branch ?? null };
}
