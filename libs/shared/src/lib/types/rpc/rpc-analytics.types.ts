import { z } from 'zod';

const id = z.string().min(1).max(160).regex(/^[\w.\-:/]+$/);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) =>
  !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) &&
  new Date(`${value}T00:00:00.000Z`).toISOString().startsWith(value),
);
const instant = z.string().datetime({ offset: false });
const count = z.number().int().nonnegative().safe();
const usd = z.number().finite().nonnegative();

export const UsageSummaryParamsSchema = z.object({
  range: z.union([z.literal(7), z.literal(30), z.literal(90)]),
  workspace: z.string().min(1).max(4096).optional(),
}).strict();
export type UsageRangeDays = 7 | 30 | 90;
export type UsageSummaryParams = z.infer<typeof UsageSummaryParamsSchema>;

export const UsageFactSchema = z.object({
  day, providerId: id, modelId: id,
  inputUncachedTokens: count, cacheReadTokens: count,
  cacheWriteTokens: count, outputTokens: count,
  costUsd: usd.nullable(), cacheSavingsUsd: usd.nullable(),
  costSource: z.enum(['provider-reported', 'model-priced', 'unpriced']),
  requestCount: count.optional(), sourceId: id,
}).strict().refine((value) =>
  (value.costUsd === null) === (value.costSource === 'unpriced'),
);
export type CostSource = 'provider-reported' | 'model-priced' | 'unpriced';
export type UsageFact = z.infer<typeof UsageFactSchema>;

export const UsageSourceStatusSchema = z.object({
  sourceId: id,
  status: z.enum(['complete', 'partial', 'unavailable']),
  reason: z.string().max(500).optional(),
  scannedFiles: count.optional(), malformedRecords: count.optional(),
}).strict();
export type UsageSourceStatus = z.infer<typeof UsageSourceStatusSchema>;

export const UsageSummarySchema = z.object({
  version: z.literal(1), generatedAt: instant, timeZone: z.literal('UTC'),
  fromDay: day, untilDayExclusive: day,
  facts: z.array(UsageFactSchema).max(100000),
  sources: z.array(UsageSourceStatusSchema).max(100),
  pricing: z.object({
    source: z.enum(['openrouter', 'bundled', 'unavailable']),
    asOf: instant.nullable(),
  }).strict(),
}).strict();
export type UsageSummary = z.infer<typeof UsageSummarySchema>;
