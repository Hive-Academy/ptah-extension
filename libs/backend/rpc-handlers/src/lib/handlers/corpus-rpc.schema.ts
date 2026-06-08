/**
 * Zod validation schemas for `corpus:` knowledge-corpus RPC handlers.
 *
 * Filter shape on `corpus:build` mirrors `MemSearchIndexParamsSchema` so the
 * persisted `queryJson` blob can be replayed by `corpus:rebuild` without
 * schema drift.
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

const CorpusNameSchema = z.string().min(1).max(200);

export const CorpusListParamsSchema = z.object({
  workspaceRoot: z.string().min(1).optional(),
});

export const CorpusGetParamsSchema = z.object({
  name: CorpusNameSchema,
});

export const CorpusBuildParamsSchema = z.object({
  name: CorpusNameSchema,
  workspaceRoot: z.string().min(1).nullable().optional(),
  type: z.array(MemoryTypeWireSchema).max(10).optional(),
  concepts: z.array(z.string().min(1).max(200)).max(20).optional(),
  files: z.array(z.string().min(1).max(2048)).max(20).optional(),
  query: z.string().max(2000).optional(),
  dateRange: z
    .object({
      fromMs: z.number().int().nonnegative().optional(),
      toMs: z.number().int().nonnegative().optional(),
    })
    .optional(),
  limit: z.number().int().positive().max(500).optional(),
});

export const CorpusPrimeParamsSchema = z.object({
  name: CorpusNameSchema,
});

export const CorpusQueryParamsSchema = z.object({
  name: CorpusNameSchema,
  question: z.string().min(1).max(8000),
});

export const CorpusReprimeParamsSchema = z.object({
  name: CorpusNameSchema,
});

export const CorpusRebuildParamsSchema = z.object({
  name: CorpusNameSchema,
});

export const CorpusDeleteParamsSchema = z.object({
  name: CorpusNameSchema,
});
