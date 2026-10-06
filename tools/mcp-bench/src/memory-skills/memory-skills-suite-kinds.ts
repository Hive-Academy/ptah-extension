import { z } from 'zod';
import {
  defaultSuiteKindRegistry,
  SuiteKindRegistry,
  SuiteView,
} from '../scorecard/suite-kinds';
import { sha256HexSchema } from './ground-truth/label-schemas';

const nonEmptyString = z.string().min(1);
const int = z.number().int().nonnegative();
const rate = z.number().finite().min(0).max(1).nullable();
const metricValue = z.number().finite().nullable();
const interval = z
  .tuple([z.number().finite(), z.number().finite()])
  .nullable()
  .superRefine((value, ctx) => {
    if (value !== null && value[0] > value[1]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'ci95 must be a [low, high] interval with low <= high',
        path: [],
      });
    }
  });
const confusion = z.strictObject({
  tp: int,
  fp: int,
  fn: int,
  tn: int.optional(),
  unlabelled: int.optional(),
});
type Confusion = z.infer<typeof confusion>;

/**
 * `curation` details (design 6.3): one variant per write-side operation. The
 * projection hash lives on the core `suite.projectionSha256` field, never here.
 */
export const curationDetailsSchema = z.discriminatedUnion('operation', [
  z.strictObject({
    operation: z.literal('extraction'),
    slice: z.enum(['seeded', 'real']),
    confusion,
    recall: rate,
    precision: rate,
    f1: rate,
    fmr: rate,
    baits: int,
    overSuppression: rate,
    byCategory: z.record(z.string(), confusion),
    bySedimentClass: z.record(z.string(), int),
    matcher: z.strictObject({
      id: nonEmptyString,
      version: nonEmptyString,
    }),
    cassette: nonEmptyString.nullable(),
  }),
  z.strictObject({
    operation: z.literal('dedup'),
    pairs: confusion,
    mergePrecision: rate,
    mergeRecall: rate,
    duplicateClusterRate: rate,
    singletonSubjectShare: rate,
    callsPerMerge: metricValue,
  }),
  z.strictObject({
    operation: z.literal('update'),
    cases: int,
    correct: rate,
    stale: rate,
    omission: rate,
    hallucination: rate,
    readPath: z.enum(['searchRich', 'buildBlock']),
  }),
  z.strictObject({
    operation: z.literal('temporal'),
    cases: int,
    accuracy: rate,
    dateVisibleShare: rate,
  }),
  z.strictObject({
    operation: z.literal('abstention'),
    cases: int,
    falseInjectionRate: rate,
    meanInjectedHits: z.number().finite(),
  }),
  z.strictObject({
    operation: z.literal('injection-recall'),
    cases: int,
    accAllCorrect: rate,
    recall: rate,
    k: int,
  }),
  z.strictObject({
    operation: z.literal('retention'),
    policy: z.enum(['current', 'none', 'age-only', 'oracle']),
    simulatedDays: int,
    falseDelete: confusion,
    falseRetain: confusion,
    byKind: z.record(
      z.string(),
      z.strictObject({ falseDelete: int, falseRetain: int }),
    ),
    archivedThenNeeded: int,
    unprocessedObservationsDeleted: int,
    dbBytesByDay: z.array(z.strictObject({ day: int, bytes: int })),
  }),
  z.strictObject({
    operation: z.literal('ranking'),
    target: z.enum(['roster', 'fts-and']),
    ndcgAt10: rate,
    recallAt10: rate,
  }),
  z.strictObject({
    operation: z.literal('rerank'),
    lists: int,
    ndcgAt5: rate,
    ndcgAt5NoRerank: rate,
    zeroVarianceLists: int,
  }),
  z.strictObject({
    operation: z.literal('scope-write'),
    rowsByKeyClass: z.record(z.string(), int),
    nonCanonicalShare: rate,
    emptyRootRows: int,
    crossWorkspaceLeaks: int,
  }),
]);
export type CurationDetails = z.infer<typeof curationDetailsSchema>;

/** `liveness` details (design 6.3): fault cases, rescan or snapshot audit. */
export const livenessDetailsSchema = z.strictObject({
  source: z.enum(['fault-injection', 'rescan', 'snapshot-audit']),
  rescan: z
    .strictObject({
      newRows: int,
      extraModelCalls: int,
      duplicateGroupsDelta: int,
    })
    .nullable(),
  snapshotSha256: sha256HexSchema.nullable(),
  unprocessedAgeP95Ms: metricValue,
  sessionsWithObservationsNoMemories: int.nullable(),
  ranPassesWithError: int.nullable(),
  faults: z.array(
    z.strictObject({
      fault: nonEmptyString,
      expected: nonEmptyString,
      observed: nonEmptyString,
      pass: z.boolean(),
    }),
  ),
});
export type LivenessDetails = z.infer<typeof livenessDetailsSchema>;

/** `rubric` details (design 6.3): inter-rater agreement or judge-vs-human. */
export const rubricDetailsSchema = z.discriminatedUnion('mode', [
  z.strictObject({
    mode: z.literal('inter-rater'),
    rubricId: z.literal('471-exemplar-8'),
    rubricVersion: nonEmptyString,
    raters: z.array(nonEmptyString).min(1),
    intraRater: z.boolean(),
    items: int,
    strata: z.record(z.string(), int),
    kappaPassFull: metricValue,
    spearmanTotalFull: metricValue,
    spearmanTotalCandidates: metricValue,
    rawAgreement: rate,
    adjudicated: int,
    anchorStability: z
      .strictObject({ items: int, withinTolerance: int })
      .superRefine((anchor, ctx) => {
        if (anchor.withinTolerance > anchor.items) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'anchorStability.withinTolerance cannot exceed anchorStability.items',
            path: ['withinTolerance'],
          });
        }
      }),
    trusted: z.boolean(),
  }),
  z.strictObject({
    mode: z.literal('judge-vs-human'),
    judge: z.enum(['skill-judge', 'judge-panel']),
    model: nonEmptyString,
    promptSha256: sha256HexSchema,
    repeats: int,
    spearman: metricValue,
    kappa: metricValue,
    meanRepeatSd: metricValue,
    saturationShare: rate,
    positiveControl: z.strictObject({ n: int, passRate: rate }),
    negativeControl: z.strictObject({ n: int, failRate: rate }),
    baselines: z.strictObject({
      lengthSpearman: metricValue,
      randomSpearman: metricValue,
    }),
  }),
]);
export type RubricDetails = z.infer<typeof rubricDetailsSchema>;

/**
 * `funnel` details (design 6.3). `projectionSha256` was dropped (review R7):
 * the core carries it on the suite, so a strict schema rejects it here.
 */
export const funnelDetailsSchema = z.strictObject({
  fixtureId: nonEmptyString,
  stages: z.array(
    z.strictObject({
      stage: z.enum([
        'prefilter',
        'archaeology',
        'cluster',
        'draft',
        'judge',
        'promote',
        'retire',
        'delivery',
        'feed-parity',
        'replay',
        'backlog-drain',
      ]),
      in: int,
      out: int,
      invariants: z.array(
        z.strictObject({
          id: nonEmptyString,
          pass: z.boolean(),
          violations: int,
          exampleIds: z.array(nonEmptyString).max(10),
        }),
      ),
    }),
  ),
  precision: rate.optional(),
  recall: rate.optional(),
  slugCollisionRate: rate.optional(),
  archaeologyAccuracy: z
    .strictObject({ routine: rate, degraded: rate, n: int })
    .optional(),
  backlog: z
    .array(
      z.strictObject({
        stage: nonEmptyString,
        ageP95Days: metricValue,
        slopePerWeek: metricValue,
        judgedShare: rate,
      }),
    )
    .optional(),
});
export type FunnelDetails = z.infer<typeof funnelDetailsSchema>;

/** `outcome` details (design 6.3, section 5): the local inform-only study. */
export const outcomeDetailsSchema = z.strictObject({
  arm: z.enum(['memory', 'skills']),
  tasks: int,
  repeats: int,
  model: nonEmptyString,
  deterministic: z.literal(false),
  conditions: z.array(
    z.strictObject({
      id: z.enum(['M+', 'M0', 'L50', 'G', 'S+', 'S0', 'SA']),
      successRate: rate,
      ci95: interval,
      turnsP50: metricValue,
      tokensInputP50: metricValue,
    }),
  ),
  pairedDelta: z.array(
    z.strictObject({
      versus: nonEmptyString,
      estimate: metricValue,
      ci95: interval,
    }),
  ),
});
export type OutcomeDetails = z.infer<typeof outcomeDetailsSchema>;

function formatMetric(
  value: number | string | boolean | null | undefined,
): string {
  return value === null || value === undefined ? 'na' : String(value);
}

function metricRow(
  label: string,
  value: number | string | boolean | null | undefined,
): string {
  return `| ${label} | ${formatMetric(value)} |`;
}

function confusionCell(counts: Confusion): string {
  const parts = [`tp ${counts.tp}`, `fp ${counts.fp}`, `fn ${counts.fn}`];
  if (counts.tn !== undefined) parts.push(`tn ${counts.tn}`);
  if (counts.unlabelled !== undefined)
    parts.push(`unlabelled ${counts.unlabelled}`);
  return parts.join(' / ');
}

function formatInterval(value: readonly [number, number] | null): string {
  return value === null ? 'na' : `[${value[0]}, ${value[1]}]`;
}

function costAndVerdictRows(view: SuiteView<unknown>): string[] {
  return [
    metricRow('calls', view.cost.calls),
    metricRow('cost.source', view.cost.source),
    metricRow('latency_ms.p50', view.cost.latency_ms.p50),
    metricRow('latency_ms.p95', view.cost.latency_ms.p95),
    metricRow('error_rate', view.cost.error_rate),
    `| Verdict | ${view.verdict}${view.naReason === undefined ? '' : ` (${view.naReason})`} |`,
    '',
  ];
}

function renderCuration(view: SuiteView<CurationDetails>): string[] {
  const details = view.details;
  const rows = ['| Metric | Value |', '| --- | ---: |'];
  switch (details.operation) {
    case 'extraction':
      rows.push(
        metricRow('slice', details.slice),
        metricRow('confusion', confusionCell(details.confusion)),
        metricRow('recall', details.recall),
        metricRow('precision', details.precision),
        metricRow('f1', details.f1),
        metricRow('fmr', details.fmr),
        metricRow('baits', details.baits),
        metricRow('overSuppression', details.overSuppression),
        ...Object.entries(details.byCategory).map(([category, counts]) =>
          metricRow(`byCategory.${category}`, confusionCell(counts)),
        ),
        ...Object.entries(details.bySedimentClass).map(
          ([sedimentClass, count]) =>
            metricRow(`bySedimentClass.${sedimentClass}`, count),
        ),
        metricRow(
          'matcher',
          `${details.matcher.id}@${details.matcher.version}`,
        ),
        metricRow('cassette', details.cassette),
      );
      break;
    case 'dedup':
      rows.push(
        metricRow('pairs', confusionCell(details.pairs)),
        metricRow('mergePrecision', details.mergePrecision),
        metricRow('mergeRecall', details.mergeRecall),
        metricRow('duplicateClusterRate', details.duplicateClusterRate),
        metricRow('singletonSubjectShare', details.singletonSubjectShare),
        metricRow('callsPerMerge', details.callsPerMerge),
      );
      break;
    case 'update':
      rows.push(
        metricRow('cases', details.cases),
        metricRow('correct', details.correct),
        metricRow('stale', details.stale),
        metricRow('omission', details.omission),
        metricRow('hallucination', details.hallucination),
        metricRow('readPath', details.readPath),
      );
      break;
    case 'temporal':
      rows.push(
        metricRow('cases', details.cases),
        metricRow('accuracy', details.accuracy),
        metricRow('dateVisibleShare', details.dateVisibleShare),
      );
      break;
    case 'abstention':
      rows.push(
        metricRow('cases', details.cases),
        metricRow('falseInjectionRate', details.falseInjectionRate),
        metricRow('meanInjectedHits', details.meanInjectedHits),
      );
      break;
    case 'injection-recall':
      rows.push(
        metricRow('cases', details.cases),
        metricRow('accAllCorrect', details.accAllCorrect),
        metricRow('recall', details.recall),
        metricRow('k', details.k),
      );
      break;
    case 'retention':
      rows.push(
        metricRow('policy', details.policy),
        metricRow('simulatedDays', details.simulatedDays),
        metricRow('falseDelete', confusionCell(details.falseDelete)),
        metricRow('falseRetain', confusionCell(details.falseRetain)),
        ...Object.entries(details.byKind).map(([kind, counts]) =>
          metricRow(
            `byKind.${kind}`,
            `falseDelete ${counts.falseDelete} / falseRetain ${counts.falseRetain}`,
          ),
        ),
        metricRow('archivedThenNeeded', details.archivedThenNeeded),
        metricRow(
          'unprocessedObservationsDeleted',
          details.unprocessedObservationsDeleted,
        ),
        metricRow('dbBytesByDay', `${details.dbBytesByDay.length} days`),
      );
      break;
    case 'ranking':
      rows.push(
        metricRow('target', details.target),
        metricRow('ndcgAt10', details.ndcgAt10),
        metricRow('recallAt10', details.recallAt10),
      );
      break;
    case 'rerank':
      rows.push(
        metricRow('lists', details.lists),
        metricRow('ndcgAt5', details.ndcgAt5),
        metricRow('ndcgAt5NoRerank', details.ndcgAt5NoRerank),
        metricRow('zeroVarianceLists', details.zeroVarianceLists),
      );
      break;
    case 'scope-write':
      rows.push(
        ...Object.entries(details.rowsByKeyClass).map(([keyClass, count]) =>
          metricRow(`rowsByKeyClass.${keyClass}`, count),
        ),
        metricRow('nonCanonicalShare', details.nonCanonicalShare),
        metricRow('emptyRootRows', details.emptyRootRows),
        metricRow('crossWorkspaceLeaks', details.crossWorkspaceLeaks),
      );
      break;
  }
  return [
    `## curation: ${details.operation}`,
    '',
    ...rows,
    ...costAndVerdictRows(view),
  ];
}

function renderLiveness(view: SuiteView<LivenessDetails>): string[] {
  const details = view.details;
  const rows = ['| Metric | Value |', '| --- | ---: |'];
  if (details.rescan !== null)
    rows.push(
      metricRow('rescan.newRows', details.rescan.newRows),
      metricRow('rescan.extraModelCalls', details.rescan.extraModelCalls),
      metricRow(
        'rescan.duplicateGroupsDelta',
        details.rescan.duplicateGroupsDelta,
      ),
    );
  rows.push(
    metricRow('source', details.source),
    metricRow('snapshotSha256', details.snapshotSha256),
    metricRow('unprocessedAgeP95Ms', details.unprocessedAgeP95Ms),
    metricRow(
      'sessionsWithObservationsNoMemories',
      details.sessionsWithObservationsNoMemories,
    ),
    metricRow('ranPassesWithError', details.ranPassesWithError),
    metricRow(
      'faults',
      `${details.faults.filter((fault) => fault.pass).length}/${details.faults.length} pass`,
    ),
  );
  return [
    '## liveness',
    '',
    ...rows,
    '',
    '| Fault | Expected | Observed | Pass |',
    '| --- | --- | --- | --- |',
    ...details.faults.map(
      (fault) =>
        `| ${fault.fault} | ${fault.expected} | ${fault.observed} | ${fault.pass ? 'pass' : 'fail'} |`,
    ),
    '',
    ...costAndVerdictRows(view),
  ];
}

function renderRubric(view: SuiteView<RubricDetails>): string[] {
  const details = view.details;
  if (details.mode === 'inter-rater')
    return [
      `## rubric: inter-rater (${details.rubricId}@${details.rubricVersion})`,
      '',
      '| Metric | Value |',
      '| --- | ---: |',
      metricRow('raters', details.raters.join(', ')),
      metricRow('intraRater', details.intraRater),
      metricRow('items', details.items),
      ...Object.entries(details.strata).map(([stratum, count]) =>
        metricRow(`strata.${stratum}`, count),
      ),
      metricRow('kappaPassFull', details.kappaPassFull),
      metricRow('spearmanTotalFull', details.spearmanTotalFull),
      metricRow('spearmanTotalCandidates', details.spearmanTotalCandidates),
      metricRow('rawAgreement', details.rawAgreement),
      metricRow('adjudicated', details.adjudicated),
      metricRow(
        'anchorStability',
        `${details.anchorStability.withinTolerance}/${details.anchorStability.items} within tolerance`,
      ),
      metricRow('trusted', details.trusted),
      ...costAndVerdictRows(view),
    ];
  return [
    `## rubric: judge-vs-human (${details.judge})`,
    '',
    '| Metric | Value |',
    '| --- | ---: |',
    metricRow('model', details.model),
    metricRow('promptSha256', details.promptSha256),
    metricRow('repeats', details.repeats),
    metricRow('spearman', details.spearman),
    metricRow('kappa', details.kappa),
    metricRow('meanRepeatSd', details.meanRepeatSd),
    metricRow('saturationShare', details.saturationShare),
    metricRow(
      'positiveControl',
      `${details.positiveControl.n} cases, passRate ${formatMetric(details.positiveControl.passRate)}`,
    ),
    metricRow(
      'negativeControl',
      `${details.negativeControl.n} cases, failRate ${formatMetric(details.negativeControl.failRate)}`,
    ),
    metricRow('baselines.lengthSpearman', details.baselines.lengthSpearman),
    metricRow('baselines.randomSpearman', details.baselines.randomSpearman),
    ...costAndVerdictRows(view),
  ];
}

function renderFunnel(view: SuiteView<FunnelDetails>): string[] {
  const details = view.details;
  const optionalRows: string[] = [];
  if (details.precision !== undefined)
    optionalRows.push(metricRow('precision', details.precision));
  if (details.recall !== undefined)
    optionalRows.push(metricRow('recall', details.recall));
  if (details.slugCollisionRate !== undefined)
    optionalRows.push(
      metricRow('slugCollisionRate', details.slugCollisionRate),
    );
  if (details.archaeologyAccuracy !== undefined)
    optionalRows.push(
      metricRow(
        'archaeologyAccuracy.routine',
        details.archaeologyAccuracy.routine,
      ),
      metricRow(
        'archaeologyAccuracy.degraded',
        details.archaeologyAccuracy.degraded,
      ),
      metricRow('archaeologyAccuracy.n', details.archaeologyAccuracy.n),
    );
  const lines = [
    `## funnel: ${details.fixtureId}`,
    '',
    '| Stage | in | out | invariants |',
    '| --- | ---: | ---: | --- |',
    ...details.stages.map((stage) => {
      const passed = stage.invariants.filter(
        (invariant) => invariant.pass,
      ).length;
      const violations = stage.invariants.reduce(
        (sum, invariant) => sum + invariant.violations,
        0,
      );
      return `| ${stage.stage} | ${stage.in} | ${stage.out} | ${passed}/${stage.invariants.length} pass, ${violations} violations |`;
    }),
  ];
  if (optionalRows.length > 0)
    lines.push('', '| Metric | Value |', '| --- | ---: |', ...optionalRows);
  if (details.backlog !== undefined && details.backlog.length > 0)
    lines.push(
      '',
      '| Stage | ageP95Days | slopePerWeek | judgedShare |',
      '| --- | ---: | ---: | ---: |',
      ...details.backlog.map(
        (row) =>
          `| ${row.stage} | ${formatMetric(row.ageP95Days)} | ${formatMetric(row.slopePerWeek)} | ${formatMetric(row.judgedShare)} |`,
      ),
    );
  return [...lines, '', ...costAndVerdictRows(view)];
}

function renderOutcome(view: SuiteView<OutcomeDetails>): string[] {
  const details = view.details;
  return [
    `## outcome: ${details.arm}`,
    '',
    '| Metric | Value |',
    '| --- | ---: |',
    metricRow('tasks', details.tasks),
    metricRow('repeats', details.repeats),
    metricRow('model', details.model),
    metricRow('deterministic', details.deterministic),
    '',
    '| Condition | successRate | ci95 | turnsP50 | tokensInputP50 |',
    '| --- | ---: | --- | ---: | ---: |',
    ...details.conditions.map(
      (condition) =>
        `| ${condition.id} | ${formatMetric(condition.successRate)} | ${formatInterval(condition.ci95)} | ${formatMetric(condition.turnsP50)} | ${formatMetric(condition.tokensInputP50)} |`,
    ),
    '',
    '| Versus | estimate | ci95 |',
    '| --- | ---: | --- |',
    ...details.pairedDelta.map(
      (delta) =>
        `| ${delta.versus} | ${formatMetric(delta.estimate)} | ${formatInterval(delta.ci95)} |`,
    ),
    '',
    ...costAndVerdictRows(view),
  ];
}

/** Registers the five memory/skills suite kinds into the given registry. */
export function registerMemorySkillsSuiteKinds(
  registry: SuiteKindRegistry,
): void {
  registry.registerSuiteKind('curation', curationDetailsSchema, renderCuration);
  registry.registerSuiteKind('liveness', livenessDetailsSchema, renderLiveness);
  registry.registerSuiteKind('rubric', rubricDetailsSchema, renderRubric);
  registry.registerSuiteKind('funnel', funnelDetailsSchema, renderFunnel);
  registry.registerSuiteKind('outcome', outcomeDetailsSchema, renderOutcome);
}

registerMemorySkillsSuiteKinds(defaultSuiteKindRegistry);
