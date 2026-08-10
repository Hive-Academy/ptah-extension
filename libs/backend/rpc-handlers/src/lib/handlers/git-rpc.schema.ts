/**
 * Zod schemas for {@link GitRpcHandlers}.
 *
 * Scope note: this file covers `git:diffFile` and `git:applyHunks` only. The
 * other sixteen `git:*` methods predate them and are deliberately left on
 * their hand-rolled guards — retrofitting them is a separate change with its
 * own regression surface.
 *
 * Both sets of params reach the backend from the renderer and name a path that
 * is fed to a git object spec, so the shape is validated before any subprocess
 * is spawned. Path *traversal* is a separate concern handled by
 * `GitInfoService.validatePathSegment`, which both paths are put through.
 */
import { z } from 'zod';
import type {
  GitApplyHunksParams,
  GitDiffFileParams,
} from '@ptah-extension/shared';

export const GitDiffComparisonSchema = z.enum(['staged', 'worktree'] as const);

export const GitDiffFileParamsSchema = z.object({
  workspaceRoot: z.string().min(1).optional(),
  path: z.string().min(1),
  comparison: GitDiffComparisonSchema,
  originalPath: z.string().min(1).optional(),
});

/**
 * Parse `git:diffFile` params.
 *
 * Returns `null` for anything malformed so the handler can answer with a
 * structured read error rather than throwing an unmapped transport fault.
 */
export function parseGitDiffFileParams(raw: unknown): GitDiffFileParams | null {
  const result = GitDiffFileParamsSchema.safeParse(raw);
  return result.success ? result.data : null;
}

export const GitApplyHunksOperationSchema = z.enum([
  'stage',
  'unstage',
  'revert',
] as const);

/**
 * `git:applyHunks` params — the only `git:*` payload that mutates the index or
 * the working tree, so it is validated in full before git is touched (NFR-3).
 *
 * The schema proves shape only. It deliberately does NOT encode which
 * operations are legal for which comparison: that matrix is enforced in
 * `GitInfoService.applyHunks`, where it is reachable by every host and cannot
 * be bypassed by a caller that reaches the service directly.
 *
 * `snapshotToken` is `min(1)` because the empty string is what a failed
 * `git:diffFile` returns; accepting it would let a caller ask to write against
 * a snapshot that was never taken.
 */
export const GitApplyHunksParamsSchema = z.object({
  workspaceRoot: z.string().min(1).optional(),
  path: z.string().min(1),
  originalPath: z.string().min(1).optional(),
  comparison: GitDiffComparisonSchema,
  operation: GitApplyHunksOperationSchema,
  hunkIndices: z.array(z.number().int().nonnegative()).min(1),
  snapshotToken: z.string().min(1),
});

/**
 * Parse `git:applyHunks` params.
 *
 * Returns `null` for anything malformed so the handler can answer with a
 * structured refusal rather than throwing an unmapped transport fault.
 */
export function parseGitApplyHunksParams(
  raw: unknown,
): GitApplyHunksParams | null {
  const result = GitApplyHunksParamsSchema.safeParse(raw);
  return result.success ? result.data : null;
}
