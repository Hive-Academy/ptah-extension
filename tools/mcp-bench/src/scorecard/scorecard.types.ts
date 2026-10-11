import { z } from 'zod';
import { LOWER_IS_BETTER } from '../metrics/retrieval-metrics';
import {
  defaultSuiteKindRegistry,
  GROUND_TRUTH_METHODS,
  refineGroundTruthPanel,
  SuiteKindRegistry,
  SuiteView,
} from './suite-kinds';
import './retrieval-suite-kind';

const metricValueSchema = z.number().finite().nullable();
const claimSchema = z
  .object({
    source: z.enum(['prompt', 'tool-description', 'ledger', 'code']),
    ref: z.string().min(1),
    text: z.string().optional(),
  })
  .superRefine((claim, context) => {
    if (
      claim.source === 'prompt' &&
      !/ptah-core-prompt\.ts:\d+$/.test(claim.ref)
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'prompt claims must point to ptah-core-prompt.ts:<line>',
        path: ['ref'],
      });
  });
const groundTruthSchema = z
  .object({
    id: z.string().min(1),
    version: z.string().min(1),
    method: z.enum(GROUND_TRUTH_METHODS),
    panel: z.string().min(1).optional(),
    raterCount: z.number().int().positive().optional(),
    frozenAt: z.string().datetime().optional(),
  })
  .superRefine((groundTruth, context) => {
    refineGroundTruthPanel(groundTruth, context);
  });
const costSchema = z.object({
  source: z.enum(['live', 'cassette', 'none']),
  calls: z.number().finite().nonnegative(),
  latency_ms: z.object({ p50: metricValueSchema, p95: metricValueSchema }),
  error_rate: metricValueSchema,
  tokens: z.object({
    result_p50: metricValueSchema.optional(),
    input: metricValueSchema.optional(),
    output: metricValueSchema.optional(),
    billed: metricValueSchema.optional(),
  }),
});
/**
 * One suite without its kind-dependent checks: every field, plus the checks
 * that hold for any kind (unique baseline ids, deltas naming known baselines,
 * `naReason` exactly on `na` suites). `details` is left unparsed and `kind` is
 * not looked up in a registry. {@link createSuiteSchema} builds on this schema.
 */
export const suiteCoreSchema: z.ZodType<SuiteView<unknown>> = z
  .object({
    kind: z.string().min(1),
    displayLabel: z.string().min(1).max(80).optional(),
    details: z.unknown(),
    claim: claimSchema,
    groundTruth: groundTruthSchema,
    arm: z.string().min(1).optional(),
    projectionSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/, 'projectionSha256 must be lowercase hex')
      .optional(),
    baselines: z.array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        metrics: z.record(z.string(), metricValueSchema),
      }),
    ),
    deltas: z.record(z.string(), z.record(z.string(), metricValueSchema)),
    cost: costSchema,
    verdict: z.enum(['pass', 'fail', 'na']),
    naReason: z.string().min(1).optional(),
  })
  .superRefine((suite, context) => {
    const baselineIds = new Set<string>();
    for (const [index, baseline] of suite.baselines.entries()) {
      if (baselineIds.has(baseline.id))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate baseline id: ${baseline.id}`,
          path: ['baselines', index, 'id'],
        });
      baselineIds.add(baseline.id);
    }
    for (const id of Object.keys(suite.deltas))
      if (!baselineIds.has(id))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `delta names unknown baseline: ${id}`,
          path: ['deltas', id],
        });
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

/**
 * One full suite: {@link suiteCoreSchema} plus the kind checks (the kind is
 * registered in `registry`, and `details` parses with that kind's schema).
 * This is the per-suite schema {@link createScorecardSchema} uses.
 */
export function createSuiteSchema(
  registry: SuiteKindRegistry,
): z.ZodType<SuiteView<unknown>> {
  return suiteCoreSchema.superRefine((suite, context) => {
    const registeredKind = registry.getSuiteKind(suite.kind);
    if (registeredKind === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `unregistered suite kind: ${suite.kind}`,
        path: ['kind'],
      });
      return;
    }
    const details = registeredKind.detailsSchema.safeParse(suite.details);
    if (!details.success)
      for (const issue of details.error.issues)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: issue.message,
          path: ['details', ...issue.path],
        });
    if (suite.kind === 'retrieval' && details.success)
      validateRetrievalSuite(
        suite,
        details.data as {
          questions: number;
          primaryMetric?: string;
          decidingBaseline?: string;
          metrics: Record<string, number | null | undefined>;
        },
        context,
      );
  });
}

function validateRetrievalSuite(
  suite: SuiteView<unknown>,
  details: {
    questions: number;
    primaryMetric?: string;
    decidingBaseline?: string;
    metrics: Record<string, number | null | undefined>;
  },
  context: z.RefinementCtx,
): void {
  const metric = details.primaryMetric;
  const baseline = suite.baselines.find(
    (item) => item.id === details.decidingBaseline,
  );
  if (metric !== undefined && details.metrics[metric] === undefined)
    issue(context, 'primaryMetric must resolve to a tool metric', [
      'details',
      'primaryMetric',
    ]);
  if (
    details.decidingBaseline !== undefined &&
    (!baseline ||
      metric === undefined ||
      baseline.metrics[metric] === undefined)
  )
    issue(context, 'decidingBaseline must resolve to a baseline metric', [
      'details',
      'decidingBaseline',
    ]);
  for (const baselineItem of suite.baselines)
    for (const [metricName, delta] of Object.entries(
      suite.deltas[baselineItem.id] ?? {},
    )) {
      const lowerIsBetter = scorecardMetricLowerIsBetter(metricName);
      if (lowerIsBetter === undefined) continue;
      const tool = details.metrics[metricName];
      const native = baselineItem.metrics[metricName];
      if (tool == null || native == null) {
        if (delta !== null)
          issue(
            context,
            'delta must be null when a tool or baseline metric is null',
            ['deltas', baselineItem.id, metricName],
          );
      } else {
        const expected = round(lowerIsBetter ? native - tool : tool - native);
        // Existing hand-authored scorecards may carry a comparison margin for
        // tied values. Preserve them; runner-produced non-zero differences are
        // still validated against its rounded, sign-normalised calculation.
        if (
          expected !== 0 &&
          (delta === null || Math.abs(delta - expected) > 1e-4 + 1e-9)
        )
          issue(context, 'delta must equal tool minus baseline', [
            'deltas',
            baselineItem.id,
            metricName,
          ]);
      }
    }
}

function scorecardMetricLowerIsBetter(metric: string): boolean | undefined {
  const scorecardMetricNames: Readonly<Record<string, boolean>> = {
    'hit@1': LOWER_IS_BETTER.hitAt1,
    'hit@5': LOWER_IS_BETTER.hitAt5,
    mrr: LOWER_IS_BETTER.meanReciprocalRank,
    'recall@10': LOWER_IS_BETTER.recallAtK,
    recall_all: LOWER_IS_BETTER.recallAtAll,
    precision: LOWER_IS_BETTER.precision,
    acc_at_k: LOWER_IS_BETTER.strictAccuracyAtK,
    ndcg_at_k: LOWER_IS_BETTER.ndcgAtK,
  };
  return scorecardMetricNames[metric];
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function issue(
  context: z.RefinementCtx,
  message: string,
  path: PropertyKey[],
): void {
  context.addIssue({ code: z.ZodIssueCode.custom, message, path });
}

/** {@link createSuiteSchema} over the default registry (`retrieval` registered). */
export const suiteSchema = createSuiteSchema(defaultSuiteKindRegistry);

export function createScorecardSchema(registry: SuiteKindRegistry) {
  return z
    .object({
      schemaVersion: z.literal(1),
      run: z.object({
        id: z.string().min(1),
        startedAt: z.string().datetime(),
        host: z.enum(['cli-headless', 'electron', 'vscode']),
        os: z.enum(['win32', 'linux']),
        node: z.string().min(1),
        /** `--smoke` run (a 40-question sample per suite). Absent in scorecards written before Batch 11. */
        smoke: z.boolean().optional(),
        guardMode: z.enum(['hash', 'process-watch', 'not-applied']),
        guard: z.object({
          partial: z.boolean(),
          unprobed: z.array(
            z.object({
              pid: z.number().int().nonnegative(),
              name: z.string().min(1),
              handles: z.number().int().nonnegative(),
            }),
          ),
        }),
        hostExit: z.object({
          kind: z.enum([
            'clean',
            'crash-on-shutdown',
            'killed',
            'exited-early',
          ]),
          exitCode: z.number().int().nullable(),
          signal: z.string().nullable(),
          detail: z.string().min(1).optional(),
        }),
      }),
      product: z.object({
        version: z.string().min(1),
        commit: z.string().min(1),
      }),
      corpus: z.object({
        repo: z.string().min(1),
        commit: z.string().min(1),
        eligibleFiles: z.number().int().nonnegative(),
        tsVersion: z.string().min(1),
      }),
      artifacts: z.array(
        z.object({
          kind: z.string().min(1),
          path: z.string().min(1),
          sha256: z
            .string()
            .regex(/^[a-f0-9]{64}$/, 'sha256 must be lowercase hex'),
          schemaId: z.string().min(1),
        }),
      ),
      suites: z.array(createSuiteSchema(registry)),
      lifecycle: z.array(
        z.object({
          scenario: z.string().min(1),
          tool: z.string().min(1),
          pass: z.boolean(),
          detail: z.string(),
          /**
           * Set (with `pass: false`) when the host cannot run the scenario at all,
           * with the reason. Not a failure: it fails no suite and the gate never
           * judges it.
           */
          na: z.string().min(1).optional(),
        }),
      ),
      eagerSelection: z.object({
        eager: z.array(z.string()),
        deferred: z.array(z.string()),
        rule: z.string().min(1),
      }),
    })
    .superRefine((scorecard, context) => {
      if (
        scorecard.run.guard.unprobed.length > 0 &&
        !scorecard.run.guard.partial
      )
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'guard.partial must be true when unprobed processes exist',
          path: ['run', 'guard', 'partial'],
        });
      if (
        scorecard.run.guard.partial &&
        (scorecard.run.guardMode === 'hash' ||
          scorecard.run.guardMode === 'not-applied')
      )
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'partial guard requires process-watch mode',
          path: ['run', 'guardMode'],
        });
    });
}

export const scorecardSchema = createScorecardSchema(defaultSuiteKindRegistry);

export type Scorecard = z.infer<typeof scorecardSchema>;
export type ScorecardSuite = Scorecard['suites'][number];
export type VerdictSummary = {
  passed: number;
  failed: number;
  notApplicable: number;
};
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
