import { z } from 'zod';

/** Most-recently-used workspaces the host remembers (newest first). */
export const RECENT_WORKSPACES_MAX = 8;

export const RecentWorkspaceSchema = z
  .object({
    path: z.string().min(1).max(4096),
    name: z.string().min(1).max(255),
    lastOpenedAt: z.number().int().nonnegative().safe(),
  })
  .strict();
export type RecentWorkspace = z.infer<typeof RecentWorkspaceSchema>;

export const WorkspaceListRecentParamsSchema = z.object({}).strict();
export type WorkspaceListRecentParams = z.infer<
  typeof WorkspaceListRecentParamsSchema
>;

export const WorkspaceListRecentResultSchema = z
  .object({
    workspaces: z.array(RecentWorkspaceSchema).max(RECENT_WORKSPACES_MAX),
  })
  .strict();
export type WorkspaceListRecentResult = z.infer<
  typeof WorkspaceListRecentResultSchema
>;
