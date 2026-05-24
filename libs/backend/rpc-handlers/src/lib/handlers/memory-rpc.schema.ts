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
  sessionId: z
    .string()
    .min(1)
    .refine((v) => v !== 'manual', {
      message: 'reserved sessionId',
    }),
  workspaceRoot: z.string().min(1),
});

export const MemoryTriggersSchema = z.object({
  preCompact: z.boolean(),
  idleMs: z
    .number()
    .int()
    .nonnegative()
    .refine((v) => v === 0 || v >= 5000, {
      message: 'idleMs must be 0 or >= 5000',
    }),
  turnThreshold: z
    .number()
    .int()
    .nonnegative()
    .refine((v) => v === 0 || v >= 2, {
      message: 'turnThreshold must be 0 or >= 2',
    }),
  bootScan: z.boolean(),
  userPromptSubmit: z
    .object({
      enabled: z.boolean(),
      cueList: z.array(z.string().min(1).max(200)).max(50),
      minPromptLength: z.number().int().min(0).max(10000),
    })
    .optional(),
  postToolUse: z
    .object({
      enabled: z.boolean(),
    })
    .optional(),
  maxCuratesPerHour: z.number().int().min(0).max(1000).optional(),
});

export const MemorySetTriggersParamsSchema = z.object({
  triggers: MemoryTriggersSchema.partial(),
});

export const MemoryGetTriggersParamsSchema = z.object({}).strict().optional();

export const MemorySearchSymbolsParamsSchema = z.object({
  workspaceRoot: z.string().min(1).nullable().optional(),
  query: z.string().max(500).optional(),
  kinds: z.array(z.string().min(1).max(100)).max(50).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
});
