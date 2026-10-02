import { z } from 'zod';

export const EditorTargetIdSchema = z.enum([
  'vscode',
  'cursor',
  'antigravity',
  'zed',
  'kiro',
  'terminal',
]);

export const EditorDetectTargetsParamsSchema = z.object({}).strict();

export const EditorOpenFileParamsSchema = z
  .object({
    target: EditorTargetIdSchema,
    path: z.string().min(1),
    line: z.number().int().positive().optional(),
    workspaceRoot: z.string().min(1).max(4096).optional(),
    scope: z.enum(['workspace', 'external-link']).optional(),
  })
  .strict();

/**
 * `path` is repository-relative; `GitInfoService.materializeConflictStages`
 * is the authority on whether it names a path inside the working tree.
 */
export const EditorOpenMergeParamsSchema = z
  .object({
    target: EditorTargetIdSchema,
    path: z.string().min(1).max(4096),
    workspaceRoot: z.string().min(1).max(4096).optional(),
  })
  .strict();

export const EditorOpenWorkspaceParamsSchema = z
  .object({
    target: EditorTargetIdSchema,
    root: z.string().min(1),
  })
  .strict();
