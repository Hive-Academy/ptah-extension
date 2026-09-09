import { createHash } from 'crypto';
import * as path from 'path';

const WORKTREE_DIRECTORY = '.claude-worktrees';
const MAX_WORKTREE_NAME_LENGTH = 64;
const HASH_LENGTH = 12;
const MAX_STEM_LENGTH = MAX_WORKTREE_NAME_LENGTH - HASH_LENGTH - 1;

/**
 * Derive a bounded directory name from a full branch ref.
 *
 * Git remains the authority on whether the ref itself is valid. The directory
 * name cannot contain path separators or traversal segments, while a hash of
 * the unmodified ref prevents distinct refs with similar readable stems from
 * selecting the same directory.
 */
export function worktreeDirectoryName(branch: string): string {
  const hash = createHash('sha256')
    .update(branch, 'utf8')
    .digest('hex')
    .slice(0, HASH_LENGTH);
  const stem = branch
    .normalize('NFKC')
    .replace(/[\\/]+/g, '-')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/[-_.]{2,}/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '')
    .slice(0, MAX_STEM_LENGTH)
    .replace(/[-_.]+$/g, '');

  return `${stem || 'worktree'}-${hash}`;
}

/**
 * Resolve a worktree target consistently for UI RPC and MCP callers.
 *
 * Omitted paths use the nested SDK convention. Absolute paths remain an
 * explicit escape hatch. Relative paths must remain lexically contained by the
 * workspace root; physical containment is not applicable because the target
 * normally does not exist yet.
 */
export function resolveWorktreePath(
  workspaceRoot: string,
  branch: string,
  requestedPath?: string,
): string {
  if (!requestedPath) {
    return path.join(
      workspaceRoot,
      WORKTREE_DIRECTORY,
      worktreeDirectoryName(branch),
    );
  }

  if (path.win32.isAbsolute(requestedPath)) {
    return requestedPath;
  }
  if (path.isAbsolute(requestedPath)) {
    return path.normalize(requestedPath);
  }

  const resolved = path.resolve(workspaceRoot, requestedPath);
  const relative = path.relative(workspaceRoot, resolved);
  if (
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(
      'Relative worktree path must stay within the workspace root. Use an absolute path for another location.',
    );
  }
  return resolved;
}
