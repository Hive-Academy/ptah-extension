import { z } from 'zod';

const metricValueSchema = z.number().finite().nullable();
const latencySchema = z.object({
  p50: metricValueSchema,
  p95: metricValueSchema,
});
const suiteMetricsSchema = z
  .object({
    'hit@1': metricValueSchema.optional(),
    'hit@5': metricValueSchema.optional(),
    mrr: metricValueSchema.optional(),
    'recall@10': metricValueSchema.optional(),
    recall_all: metricValueSchema.optional(),
    precision: metricValueSchema.optional(),
    acc_at_k: metricValueSchema.optional(),
    ndcg_at_k: metricValueSchema.optional(),
    tokens_p50: metricValueSchema.optional(),
    calls_per_answer: metricValueSchema.optional(),
    latency_ms: latencySchema.optional(),
    error_rate: metricValueSchema.optional(),
    truncation_rate: metricValueSchema.optional(),
  })
  .catchall(metricValueSchema);
const suiteSchema = z
  .object({
    tool: z.string().min(1),
    claim: z
      .string()
      .regex(
        /ptah-core-prompt\.ts:\d+$/,
        'claim must point to ptah-core-prompt.ts:<line>',
      ),
    questions: z.number().int().nonnegative(),
    tool_metrics: suiteMetricsSchema,
    native_metrics: suiteMetricsSchema.extend({ baseline: z.string().min(1) }),
    delta: z.object({
      quality: metricValueSchema,
      tokens: metricValueSchema,
      calls: metricValueSchema,
      latency_ms_p50: metricValueSchema,
    }),
    verdict: z.enum(['pass', 'fail', 'na']),
    naReason: z.string().min(1).optional(),
    failures: z
      .array(
        z.object({
          question: z.string(),
          expected: z.array(z.string()),
          got: z.array(z.string()),
        }),
      )
      .default([]),
  })
  .superRefine((suite, context) => {
    if (suite.verdict === 'na' && suite.naReason === undefined)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'na suites require naReason',
        path: ['naReason'],
      });
    if (suite.verdict !== 'na' && suite.naReason !== undefined)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'naReason is only valid for na suites',
        path: ['naReason'],
      });
  });
export const scorecardSchema = z.object({
  schemaVersion: z.literal(1),
  run: z.object({
    id: z.string().min(1),
    startedAt: z.string().datetime(),
    host: z.enum(['cli-headless', 'electron', 'vscode']),
    os: z.enum(['win32', 'linux']),
    node: z.string().min(1),
  }),
  product: z.object({ version: z.string().min(1), commit: z.string().min(1) }),
  corpus: z.object({
    repo: z.string().min(1),
    commit: z.string().min(1),
    eligibleFiles: z.number().int().nonnegative(),
    tsVersion: z.string().min(1),
  }),
  suites: z.array(suiteSchema),
  lifecycle: z.array(
    z.object({
      scenario: z.string().min(1),
      tool: z.string().min(1),
      pass: z.boolean(),
      detail: z.string(),
    }),
  ),
  eagerSelection: z.object({
    eager: z.array(z.string()),
    deferred: z.array(z.string()),
    rule: z.string().min(1),
  }),
});
export interface LatencyMetrics {
  p50: number | null;
  p95: number | null;
}
export interface SuiteMetrics {
  [metric: string]: number | null | LatencyMetrics | string | undefined;
  'hit@1'?: number | null;
  'hit@5'?: number | null;
  mrr?: number | null;
  'recall@10'?: number | null;
  recall_all?: number | null;
  precision?: number | null;
  acc_at_k?: number | null;
  ndcg_at_k?: number | null;
  tokens_p50?: number | null;
  calls_per_answer?: number | null;
  latency_ms?: LatencyMetrics;
  error_rate?: number | null;
  truncation_rate?: number | null;
}
export interface ScorecardSuite {
  tool: string;
  claim: string;
  questions: number;
  tool_metrics: SuiteMetrics;
  native_metrics: SuiteMetrics & { baseline: string };
  delta: {
    quality: number | null;
    tokens: number | null;
    calls: number | null;
    latency_ms_p50: number | null;
  };
  verdict: 'pass' | 'fail' | 'na';
  naReason?: string;
  failures: Array<{ question: string; expected: string[]; got: string[] }>;
}
export interface Scorecard {
  schemaVersion: 1;
  run: {
    id: string;
    startedAt: string;
    host: 'cli-headless' | 'electron' | 'vscode';
    os: 'win32' | 'linux';
    node: string;
  };
  product: { version: string; commit: string };
  corpus: {
    repo: string;
    commit: string;
    eligibleFiles: number;
    tsVersion: string;
  };
  suites: ScorecardSuite[];
  lifecycle: Array<{
    scenario: string;
    tool: string;
    pass: boolean;
    detail: string;
  }>;
  eagerSelection: { eager: string[]; deferred: string[]; rule: string };
}
export interface VerdictSummary {
  passed: number;
  failed: number;
  notApplicable: number;
}
export function summarizeVerdicts(
  suites: readonly ScorecardSuite[],
): VerdictSummary {
  return suites.reduce<VerdictSummary>(
    (summary, suite) => {
      if (suite.verdict === 'pass') summary.passed += 1;
      if (suite.verdict === 'fail') summary.failed += 1;
      if (suite.verdict === 'na') summary.notApplicable += 1;
      return summary;
    },
    { passed: 0, failed: 0, notApplicable: 0 },
  );
}
