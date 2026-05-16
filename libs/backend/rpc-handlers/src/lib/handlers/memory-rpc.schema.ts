/**
 * Zod validation schemas for Memory RPC handlers.
 *
 * `MemoryPurgeBySubjectPatternParamsSchema` validates params for the
 * `memory:purgeBySubjectPattern` RPC method before the handler acts on them.
 * The `min(1)` guard is belt-and-braces on top of the store-level empty-string guard.
 *
 * `MemorySearchParamsSchema` validates params for `memory:search`, including
 * the optional `workspaceRoot` filter.
 */
import { z } from 'zod';

export const MemoryPurgeBySubjectPatternParamsSchema = z.object({
  pattern: z.string().min(1, 'pattern must not be empty'),
  mode: z.enum(['substring', 'like']),
  workspaceRoot: z.string().min(1),
});

export const MemorySearchParamsSchema = z.object({
  query: z.string(),
  topK: z.number().int().positive().max(50).optional(),
  workspaceRoot: z.string().min(1).optional(),
});

export type MemoryPurgeBySubjectPatternParams = z.infer<
  typeof MemoryPurgeBySubjectPatternParamsSchema
>;
