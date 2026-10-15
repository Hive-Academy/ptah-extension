import { z } from 'zod';
import { OUTCOME_TASK_KINDS, TASK_TYPES } from '@ptah-extension/shared';
import { DEPTHS } from './route-decide-args.schema';

export const FALLBACK_CAUSES = [
  'timeout',
  'unreachable',
  'auth',
  'provider-error',
  'bad-output',
  'low-confidence',
  'payload-too-large',
  'question-limit',
] as const;
export const EXCLUSION_RULES = [
  'at-limit',
  'disabled',
  'not-installed',
  'never-on-a-lane',
  'reviewer-family',
  'pruned',
  'not-listed',
] as const;
export const PROVENANCE = [
  'reported',
  'fallback',
  'configured',
  'tier',
  'lane-default',
] as const;

const Confidence = z.number().min(0).max(1).nullable();
const Cause = z.enum(FALLBACK_CAUSES).nullable();
const ModelProposal = z
  .object({
    option: z.string(),
    confidence: Confidence,
  })
  .strict()
  .nullable();
const Excluded = z
  .object({
    phaseId: z.string(),
    candidate: z.string(),
    rule: z.enum(EXCLUSION_RULES),
  })
  .strict();

export const ChosenEntrySchema = z
  .object({
    phaseId: z.string(),
    status: z.literal('chosen'),
    executor: z
      .object({
        kind: z.enum(['lane', 'subagent']),
        id: z.string().refine((id) => id !== 'unavailable'),
        cli: z.string().optional(),
        ptahCliId: z.string().optional(),
        role: z.string().optional(),
        family: z.string(),
      })
      .strict(),
    model: z.string(),
    provenance: z.enum(PROVENANCE),
    score: z.number().int().min(0).max(100),
    source: z.enum(['model', 'ranking', 'pin']),
    taskKind: z.enum(OUTCOME_TASK_KINDS),
    confidence: Confidence,
    fallbackCause: Cause,
    modelProposal: ModelProposal,
    reason: z.string(),
  })
  .strict();

export const UnavailableEntrySchema = z
  .object({
    phaseId: z.string(),
    status: z.literal('unavailable'),
    executor: z.literal('unavailable'),
    exclusionReason: z.enum([
      'no-eligible-candidate',
      'reviewer-family',
      'pin-unavailable',
    ]),
    excludedBy: z.array(
      z
        .object({
          candidate: z.string(),
          rule: z.enum(EXCLUSION_RULES),
        })
        .strict(),
    ),
    pinRule: z.enum(EXCLUSION_RULES).nullable(),
    needsDisclosedFallback: z.boolean(),
    source: z.enum(['pin', 'ranking']),
    model: z.null(),
    provenance: z.null(),
    score: z.null(),
    confidence: z.null(),
    fallbackCause: z.null(),
    reason: z.string(),
  })
  .strict();

const Usage = z
  .object({
    requests: z.number().int().min(0).max(2),
    inputTokens: z.number().int().nullable(),
    outputTokens: z.number().int().nullable(),
    costUsd: z.number().nullable(),
  })
  .strict();

const Answer = <T extends z.ZodType>(value: T) =>
  z
    .object({
      value: value.nullable(),
      source: z.enum(['model', 'skill-table']),
      confidence: Confidence,
      fallbackCause: Cause,
      modelProposal: ModelProposal,
    })
    .strict();

export const PreflightResultSchema = z
  .object({
    stage: z.literal('pre-flight'),
    taskType: Answer(z.enum(TASK_TYPES)),
    depth: Answer(z.enum(DEPTHS)),
    overallConfidence: Confidence,
    reasons: z.array(z.string()),
    usage: Usage,
  })
  .strict();

export const GateResultSchema = z
  .object({
    stage: z.literal('gate-0.1'),
    roster: z.array(
      z.discriminatedUnion('status', [
        ChosenEntrySchema,
        UnavailableEntrySchema,
      ]),
    ),
    overallSource: z.enum(['model', 'ranking', 'mixed']),
    overallConfidence: Confidence,
    excluded: z.array(Excluded),
    reasons: z.array(z.string()),
    usage: Usage,
  })
  .strict();

export const RouteDecideResultSchema = z.discriminatedUnion('stage', [
  PreflightResultSchema,
  GateResultSchema,
]);

export type PreflightResult = z.infer<typeof PreflightResultSchema>;
export type GateResult = z.infer<typeof GateResultSchema>;
export type RouteDecideResult = z.infer<typeof RouteDecideResultSchema>;
export type ChosenEntry = z.infer<typeof ChosenEntrySchema>;
export type UnavailableEntry = z.infer<typeof UnavailableEntrySchema>;
