import { z } from 'zod';
import { ReviewFindingSchema } from './review-finding.schema';
import {
  OperatorSettingsSchema,
  RepositorySettingsSchema,
} from './review-config.schema';
import {
  RepoIdentitySchema,
  ReviewRunSchema,
  ReviewStateSchema,
} from './review-run.schema';

const noParams = z.object({}).strict();
const attempt = z
  .object({ attemptId: z.string().trim().min(1).max(64) })
  .strict();
const repo = z.object({ repo: RepoIdentitySchema }).strict();
const result = z
  .object({ ok: z.boolean(), error: z.string().max(500).optional() })
  .strict();
export const ReviewSettingsReadSchema = z.object({
  settings: OperatorSettingsSchema.nullable(),
  hasToken: z.boolean(),
  tokenStorage: z.enum(['encrypted', 'plaintext']),
}).strict();
export const ReviewSettingsUpdateSchema = z.object({
  settings: OperatorSettingsSchema,
  attestation: z.object({ who: z.string().min(1).max(39),
    permissions: z.tuple([z.literal('Pull requests: Read and write'), z.literal('Contents: Read'), z.literal('Metadata: Read')]) }).strict().optional(),
}).strict();
export const ReviewRpcSchemas = {
  'review:listRuns': {
    params: z
      .object({
        repo: RepoIdentitySchema.optional(),
        state: ReviewStateSchema.optional(),
        cursor: z.string().max(256).optional(),
        limit: z.number().int().min(1).max(100).default(25),
      })
      .strict(),
    result: z
      .object({
        runs: z.array(ReviewRunSchema).max(100),
        nextCursor: z.string().max(256).nullable(),
        poll: z.object({ status: z.enum(['succeeded', 'failed']).nullable(), error: z.string().max(500).nullable(),
          lastSuccessAt: z.string().datetime().nullable(), lastErrorAt: z.string().datetime().nullable() }).strict(),
      })
      .strict(),
  },
  'review:getRun': { params: attempt, result: ReviewRunSchema.nullable() },
  'review:listFindings': {
    params: attempt,
    result: z.object({ findings: z.array(ReviewFindingSchema).max(100) }).strict(),
  },
  'review:listRepositories': {
    params: noParams,
    result: z.array(RepositorySettingsSchema).max(1),
  },
  'review:getSettings': { params: noParams, result: ReviewSettingsReadSchema },
  'review:updateSettings': {
    params: ReviewSettingsUpdateSchema,
    result: OperatorSettingsSchema,
  },
  'review:setPublicationPause': {
    params: z
      .object({ paused: z.boolean(), repo: RepoIdentitySchema.optional() })
      .strict(),
    result,
  },
  'review:retryHead': {
    params: z
      .object({
        repo: RepoIdentitySchema,
        prNumber: z.number().int().min(1).max(1_000_000_000),
      })
      .strict(),
    result: result.extend({ attemptId: z.string().min(1).max(64).optional() }),
  },
  'review:refresh': { params: repo, result },
  'review:verifyBot': {
    params: noParams,
    result: z
      .object({
        valid: z.boolean(),
        login: z.string().trim().min(1).max(39).nullable(),
        error: z.string().max(500).optional(),
      })
      .strict(),
  },
  'review:replaceBotToken': {
    params: z.object({ token: z.string().min(1).max(4096) }).strict(),
    result,
  },
  'review:removeBotToken': { params: noParams, result },
  'review:exportRun': {
    params: attempt,
    result: z
      .object({
        content: z.string().max(1_000_000),
        fileName: z.string().trim().min(1).max(128),
      })
      .strict(),
  },
} as const;
export type ReviewRpcMethod = keyof typeof ReviewRpcSchemas;
