/**
 * Zod schemas for {@link GitRpcHandlers}.
 *
 * Scope note: this file covers `git:diffFile` only. The other sixteen `git:*`
 * methods predate it and are deliberately left on their hand-rolled guards —
 * retrofitting them is a separate change with its own regression surface.
 *
 * `git:diffFile` params reach the backend from the renderer and name a path
 * that is fed to a git object spec, so the shape is validated before any
 * subprocess is spawned. Path *traversal* is a separate concern handled by
 * `GitInfoService.validatePathSegment`, which the handler calls on both paths.
 */
import { z } from 'zod';
import type { GitDiffFileParams } from '@ptah-extension/shared';

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
