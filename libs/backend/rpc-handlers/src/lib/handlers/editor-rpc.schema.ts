import { z } from 'zod';

export const EditorTargetIdSchema = z.enum([
  'vscode',
  'cursor',
  'antigravity',
  'zed',
  'kiro',
]);

export const EditorDetectTargetsParamsSchema = z.object({}).strict();

export const EditorOpenFileParamsSchema = z
  .object({
    target: EditorTargetIdSchema,
    path: z.string().min(1),
    line: z.number().int().positive().optional(),
    workspaceRoot: z.string().min(1).max(4096).optional(),
  })
  .strict();

export const EditorOpenWorkspaceParamsSchema = z
  .object({
    target: EditorTargetIdSchema,
    root: z.string().min(1),
  })
  .strict();
