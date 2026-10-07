import { z } from 'zod';
import {
  defaultSuiteKindRegistry,
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
const groundTruthSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  method: z.enum(['generated', 'labelled', 'seeded', 'git-history']),
  raterCount: z.number().int().positive().optional(),
  frozenAt: z.string().datetime().optional(),
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
  });
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
