/**
 * Zod validation schemas for Memory RPC handlers (TASK_2026_119).
 *
 * `MemoryPurgeBySubjectPatternParamsSchema` validates params for the
 * `memory:purgeBySubjectPattern` RPC method before the handler acts on them.
 * The `min(1)` guard is belt-and-braces on top of the store-level empty-string guard.
 */
import { z } from 'zod';

export const MemoryPurgeBySubjectPatternParamsSchema = z.object({
  pattern: z.string().min(1, 'pattern must not be empty'),
  mode: z.enum(['substring', 'like']),
  workspaceRoot: z.string().min(1),
});

export type MemoryPurgeBySubjectPatternParams = z.infer<
  typeof MemoryPurgeBySubjectPatternParamsSchema
>;
