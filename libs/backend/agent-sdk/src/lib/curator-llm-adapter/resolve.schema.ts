import { z } from 'zod';
import type { ResolvedMemoryDraft } from '@ptah-extension/memory-contracts';
import { ExtractedDraftSchema } from './extract.schema';

const mergeTargetId = z
  .union([z.string(), z.null(), z.undefined()])
  // `.optional()` must come BEFORE `.transform()`. In zod 4.6.5 a transformed
  // field is required for KEY PRESENCE even when its inner union accepts
  // `undefined`: an explicit `undefined` parses, an absent key fails with
  // `expected "nonoptional"`. Without this the curator silently rejects every
  // draft the model returns without a `mergeTargetId` key.
  .optional()
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
