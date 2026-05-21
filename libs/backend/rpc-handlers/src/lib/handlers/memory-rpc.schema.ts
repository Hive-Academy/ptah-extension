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

export const MemoryDiagnosticsParamsSchema = z.object({
  workspaceRoot: z.string().min(1).nullable().optional(),
  eventLimit: z.number().int().positive().max(200).optional(),
});

export const MemoryRunNowParamsSchema = z.object({
  sessionId: z.string().min(1),
  workspaceRoot: z.string().min(1),
});

export const MemoryTriggersSchema = z.object({
  preCompact: z.boolean(),
  idleMs: z.number().int().nonnegative(),
  turnThreshold: z.number().int().nonnegative(),
  bootScan: z.boolean(),
});

export const MemorySetTriggersParamsSchema = z.object({
  triggers: MemoryTriggersSchema.partial(),
});

export const MemoryGetTriggersParamsSchema = z.object({}).strict().optional();
