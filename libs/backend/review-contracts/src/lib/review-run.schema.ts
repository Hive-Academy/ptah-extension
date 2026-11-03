import { z } from 'zod';
import { ShaSchema, ReviewPathSchema } from './review-finding.schema';

export const RepoIdentitySchema = z
  .object({ owner: z.literal('Hive-Academy'), name: z.literal('PtahCode') })
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
]);
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
    headSha: ShaSchema,
    attemptId: z.string().trim().min(1).max(64),
    trigger: z.enum(['poll', 'manual']),
    configHash: ShaSchema,
    status: ReviewStateSchema,
    createdAt: z.string().datetime(),
    startedAt: z.string().datetime().nullable(),
    completedAt: z.string().datetime().nullable(),
    deadlineAt: z.string().datetime(),
    coverage: z.array(z.string().trim().min(1).max(256)).max(100),
    stages: z.array(StageRecordSchema).max(8),
  })
  .strict();
export type ReviewRun = z.infer<typeof ReviewRunSchema>;
