import { z } from 'zod';

const rootKey = z.object({ prNumber: z.number().int().positive(), slot: z.number().int().positive() }).strict();
export const adjudicationSchema = z.object({
  version: z.string().min(1),
  roots: z.array(rootKey.extend({ path: z.string().min(1), line: z.number().int().positive(),
    lens: z.string().min(1), category: z.string().min(1), summary: z.string().min(1),
    disposition: z.enum(['confirmed', 'disputed']).default('confirmed') }).strict()),
  extras: z.array(z.object({ prNumber: z.number().int().positive(), findingKey: z.string().min(1),
    disposition: z.enum(['actionable', 'disputed']) }).strict()).default([]),
}).strict();
export type Adjudication = z.infer<typeof adjudicationSchema>;
export function parseAdjudication(input: unknown, version: string): Adjudication {
  const value = adjudicationSchema.parse(input);
  if (value.version !== version) throw new Error('Adjudication version differs from fixture manifest');
  return value;
}
