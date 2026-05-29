/**
 * Zod validation schemas for `mem:` progressive disclosure RPC handlers.
 *
 * `MemSearchIndexParamsSchema` is permissive on `query` (empty allowed) because
 * an empty query is the documented pure-filter listing path. The handler treats
 * `''` and `undefined` identically.
 */
import { z } from 'zod';

const MemoryTypeWireSchema = z.enum([
  'bugfix',
  'feature',
  'decision',
  'discovery',
  'refactor',
  'change',
]);

export const MemSearchIndexParamsSchema = z.object({
  query: z.string().max(2000).optional(),
  topK: z.number().int().positive().max(100).optional(),
  workspaceRoot: z.string().min(1).optional(),
  project: z.string().min(1).optional(),
  type: z.array(MemoryTypeWireSchema).max(10).optional(),
  concepts: z.array(z.string().min(1).max(200)).max(20).optional(),
  files: z.array(z.string().min(1).max(2048)).max(20).optional(),
  dateRange: z
    .object({
      fromMs: z.number().int().nonnegative().optional(),
      toMs: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export const MemTimelineParamsSchema = z.object({
  anchorId: z.string().min(1),
  before: z.number().int().nonnegative().max(50).optional(),
  after: z.number().int().nonnegative().max(50).optional(),
  workspaceRoot: z.string().min(1).optional(),
});

export const MemGetObservationsParamsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  includeQueueRows: z.boolean().optional(),
});
