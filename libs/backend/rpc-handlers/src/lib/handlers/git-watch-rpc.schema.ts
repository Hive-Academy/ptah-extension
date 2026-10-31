/**
 * Zod schema for {@link GitWatchRpcHandlers} (`git:watchRoots`,
 * TASK_2026_855). The renderer names the roots; each is re-validated by
 * `GitRootResolver` after this shape check.
 */
import { z } from 'zod';
import type { GitWatchRootsParams } from '@ptah-extension/shared';

import { WorkspaceRootSchema } from './git-rpc.schema';

/** Roots one lease may name; the renderer sends at most 4. */
export const MAX_WATCH_ROOTS_PER_LEASE = 8;

export const GitWatchRootsParamsSchema = z
  .object({
    leaseId: z.string().min(1).max(128),
    roots: z.array(WorkspaceRootSchema).max(MAX_WATCH_ROOTS_PER_LEASE),
  })
  .strict();

export function parseGitWatchRootsParams(
  raw: unknown,
): GitWatchRootsParams | null {
  const result = GitWatchRootsParamsSchema.safeParse(raw);
  return result.success ? result.data : null;
}
