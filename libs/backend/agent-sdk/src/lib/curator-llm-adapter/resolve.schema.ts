import { z } from 'zod';
import type { ResolvedMemoryDraft } from '@ptah-extension/memory-contracts';
import { ExtractedDraftSchema } from './extract.schema';

const mergeTargetId = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => (typeof v === 'string' && v.trim() ? v.trim() : null));

export const ResolvedDraftSchema = z
  .object({
    mergeTargetId: mergeTargetId,
  })
  .passthrough()
  .transform((raw): ResolvedMemoryDraft | null => {
    const parsed = ExtractedDraftSchema.safeParse(raw);
    if (!parsed.success) return null;
    const base = parsed.data;
    if (!base) return null;
    return { ...base, mergeTargetId: raw.mergeTargetId };
  });

export const ResolvedResponseSchema = z
  .object({
    memories: z.array(z.unknown()).default([]),
  })
  .passthrough();

export type ResolvedResponseShape = z.infer<typeof ResolvedResponseSchema>;
