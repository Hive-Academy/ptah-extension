import { z } from 'zod';
import { ShaSchema, ReviewPathSchema } from './review-finding.schema';

export const RepoIdentitySchema = z
  .object({
    owner: z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/),
    name: z
      .string()
      .regex(/^[A-Za-z0-9_.-]{1,100}$/)
      .refine((name) => name !== '.' && name !== '..'),
  })
  .strict();
export type RepoIdentity = z.infer<typeof RepoIdentitySchema>;
export const ReviewStageNameSchema = z.enum([
  'discovery',
  'context',
  'checks',
  'triage',
  'lenses',
  'verification',
  'identity',
  'publication',
]);
export const ReviewStateSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'partial',
  'failed',
  'superseded',
  'skipped',
  'interrupted',
]);
export const ReviewFailureStageSchema = z.enum(['discovery', 'context', 'lanes', 'verification', 'publication', 'other']);
export const ReviewFailureCodeSchema = z.enum(['checkout-missing', 'head-missing', 'git-timeout', 'git-failed', 'command-scope', 'github-auth', 'github-rate-limit', 'github-http', 'publication-blocked', 'lane-unavailable', 'lane-timeout', 'lane-failed', 'prompt-too-large', 'schema-invalid', 'persistence', 'unknown']);
export const ReviewFailureSchema = z.object({ stage: ReviewFailureStageSchema, code: ReviewFailureCodeSchema, message: z.string().max(300) }).strict();
export const ReviewHeadRetrySchema = z.object({ failureCount: z.number().int().min(0), nextEligibleAt: z.string().datetime().nullable(), automaticRetriesStopped: z.boolean() }).strict();
export const ReviewLaneAvailabilitySchema = z
  .object({
    confirmed: z.number().int().min(0).max(1000),
    unknown: z.number().int().min(0).max(1000),
    atLimit: z.number().int().min(0).max(1000),
  })
  .strict();
export const ReviewPollResultSchema = z
  .object({
    at: z.string().datetime(),
    enqueued: z.number().int().min(0).max(10000),
    error: z.string().max(500).nullable(),
  })
  .strict();
export const StageRecordSchema = z
  .object({
    name: ReviewStageNameSchema,
    status: ReviewStateSchema,
    family: z.string().trim().min(1).max(64).nullable(),
    scope: z.string().trim().max(512).nullable(),
    durationMs: z.number().int().min(0).max(86_400_000).nullable(),
    error: z.string().max(2000).nullable(),
    artifactPath: ReviewPathSchema.nullable(),
  })
  .strict();
export type StageRecord = z.infer<typeof StageRecordSchema>;

export const ReviewRunSchema = z
  .object({
    repo: RepoIdentitySchema,
    prNumber: z.number().int().min(1).max(1_000_000_000),
    prTitle: z.string().trim().min(1).max(256).optional(),
    prBodyExcerpt: z.string().trim().max(1000).nullable().optional(),
    headSha: ShaSchema,
    attemptId: z.string().trim().min(1).max(64),
    trigger: z.enum(['poll', 'manual']),
    configHash: ShaSchema.nullable(),
    status: ReviewStateSchema,
    failure: ReviewFailureSchema.nullable().optional(),
    headRetry: ReviewHeadRetrySchema.nullable().optional(),
    createdAt: z.string().datetime(),
    startedAt: z.string().datetime().nullable(),
    completedAt: z.string().datetime().nullable(),
    deadlineAt: z.string().datetime().nullable(),
    coverage: z.array(z.string().trim().min(1).max(256)).max(100),
    postedCount: z.number().int().min(0).max(10000).optional(),
    suppressedCount: z.number().int().min(0).max(10000).optional(),
    laneAvailability: ReviewLaneAvailabilitySchema.optional(),
    lastPoll: ReviewPollResultSchema.nullable().optional(),
    health: z.enum(['online', 'offline', 'degraded']).optional(),
    stages: z.array(StageRecordSchema).max(16),
  })
  .strict();
export type ReviewRun = z.infer<typeof ReviewRunSchema>;
