import { z } from 'zod';
import { LensSchema, SeveritySchema } from './review-config.schema';

export const ShaSchema = z.string().regex(/^[0-9a-f]{40}$/);
export const ReviewPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.includes('\\') &&
      !value.split('/').includes('..') &&
      !/^[A-Za-z]:/.test(value),
    'Unsafe path',
  );
const short = z.string().trim().min(1).max(256);
const prose = z.string().trim().min(1).max(4000);
const evidence = z
  .object({
    path: ReviewPathSchema,
    line: z.number().int().min(1).max(10000000),
    excerpt: z.string().trim().min(1).max(2000),
  })
  .strict();

export const CandidateFindingSchema = z
  .object({
    schemaVersion: z.literal(1),
    lens: LensSchema,
    title: short,
    failureMode: prose,
    affectedBehavior: prose,
    scenario: prose,
    path: ReviewPathSchema,
    line: z.number().int().min(1).max(10000000).nullable(),
    evidence: z.array(evidence).min(1).max(20),
    affectedCaller: short.nullable(),
    severity: SeveritySchema,
    category: z.enum([
      'functional',
      'stability',
      'security',
      'data-integrity',
      'maintainability',
      'performance',
    ]),
    confidence: z.number().min(0).max(1),
    verification: z.enum(['cross-family', 'same-family-weaker']).optional(),
    suggestedDiff: z.string().max(16000).nullable(),
    fixPrompt: prose,
  })
  .strict();
export type CandidateFinding = z.infer<typeof CandidateFindingSchema>;
export const ReviewFindingSchema = CandidateFindingSchema.extend({
  verification: z.enum(['cross-family', 'same-family-weaker']),
});
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;

export const LensOutputSchema = z
  .object({
    schemaVersion: z.literal(1),
    headSha: ShaSchema,
    findings: z.array(CandidateFindingSchema).max(100),
    coverage: z.array(short).max(100),
  })
  .strict()
  .refine(
    (value) =>
      new TextEncoder().encode(JSON.stringify(value)).length <= 1_000_000,
    'Payload too large',
  );
export type LensOutput = z.infer<typeof LensOutputSchema>;

export const VerifierVerdictSchema = z
  .object({
    schemaVersion: z.literal(1),
    candidateId: short,
    headSha: ShaSchema,
    verdict: z.enum(['accepted', 'disproved', 'inconclusive']),
    checkedEvidence: z
      .array(
        z
          .object({
            path: ReviewPathSchema,
            line: z.number().int().min(1).max(10000000),
            observation: prose,
          })
          .strict(),
      )
      .min(1)
      .max(20),
    reason: prose,
    confidence: z.number().min(0).max(1),
    verifierFamily: short,
  })
  .strict();
export type VerifierVerdict = z.infer<typeof VerifierVerdictSchema>;

export const IdentityVerdictSchema = z
  .object({
    candidateId: short,
    priorFindingId: short.nullable(),
    relation: z.enum(['same', 'distinct', 'uncertain']),
    evidence: z
      .object({
        path: ReviewPathSchema,
        symbol: short,
        behavior: prose,
        reason: prose,
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.relation === 'same' && value.priorFindingId === null)
      context.addIssue({
        code: 'custom',
        message: 'Same requires prior finding ID',
        path: ['priorFindingId'],
      });
  });
export type IdentityVerdict = z.infer<typeof IdentityVerdictSchema>;
