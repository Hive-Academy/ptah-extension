import { z } from 'zod';
import type {
  ExtractedMemoryDraft,
  MemoryType,
} from '@ptah-extension/memory-contracts';

const KIND_VALUES = ['fact', 'preference', 'event', 'entity'] as const;

const TYPE_VALUES = [
  'bugfix',
  'feature',
  'decision',
  'discovery',
  'refactor',
  'change',
] as const;

const optionalNonEmptyString = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined));

const optionalSubject = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) =>
    typeof v === 'string' && v.trim() ? v.trim().toLowerCase() : null,
  );

const salienceHint = z
  .union([z.number(), z.string(), z.null(), z.undefined()])
  .transform((v) => {
    const n =
      typeof v === 'number'
        ? v
        : typeof v === 'string' && v.trim()
          ? Number(v)
          : 0.3;
    if (!Number.isFinite(n)) return 0.3;
    return Math.max(0, Math.min(1, n));
  });

const stringArray = z
  .union([z.array(z.unknown()), z.null(), z.undefined()])
  .transform((v) => {
    if (!Array.isArray(v)) return [] as readonly string[];
    const out: string[] = [];
    for (const item of v) {
      if (typeof item === 'string') {
        const s = item.trim();
        if (s) out.push(s);
      }
    }
    return out as readonly string[];
  });

const memoryTypeField = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v): MemoryType => {
    if (typeof v === 'string') {
      const lower = v.trim().toLowerCase();
      for (const t of TYPE_VALUES) if (t === lower) return t;
    }
    return 'discovery';
  });

export const ExtractedDraftSchema = z
  .object({
    kind: z.enum(KIND_VALUES),
    subject: optionalSubject,
    content: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((v) => (typeof v === 'string' && v.trim() ? v.trim() : '')),
    salienceHint: salienceHint,
    request: optionalNonEmptyString,
    investigated: optionalNonEmptyString,
    learned: optionalNonEmptyString,
    completed: optionalNonEmptyString,
    nextSteps: optionalNonEmptyString,
    type: memoryTypeField,
    concepts: stringArray.transform((arr) => arr.slice(0, 5)),
    files: stringArray,
  })
  .passthrough()
  .transform((d): ExtractedMemoryDraft | null => {
    if (!d.content) return null;
    const draft: ExtractedMemoryDraft = {
      kind: d.kind,
      subject: d.subject,
      content: d.content,
      salienceHint: d.salienceHint,
      type: d.type,
      concepts: d.concepts,
      files: d.files,
      ...(d.request !== undefined ? { request: d.request } : {}),
      ...(d.investigated !== undefined ? { investigated: d.investigated } : {}),
      ...(d.learned !== undefined ? { learned: d.learned } : {}),
      ...(d.completed !== undefined ? { completed: d.completed } : {}),
      ...(d.nextSteps !== undefined ? { nextSteps: d.nextSteps } : {}),
    };
    return draft;
  });

export const ExtractedResponseSchema = z
  .object({
    memories: z.array(z.unknown()).default([]),
  })
  .passthrough();

export type ExtractedResponseShape = z.infer<typeof ExtractedResponseSchema>;
