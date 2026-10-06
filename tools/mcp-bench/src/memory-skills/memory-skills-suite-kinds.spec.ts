import {
  createSuiteKindRegistry,
  getSuiteKind,
  SuiteView,
} from '../scorecard/suite-kinds';
import { createScorecardSchema } from '../scorecard/scorecard.types';
import {
  curationDetailsSchema,
  funnelDetailsSchema,
  livenessDetailsSchema,
  outcomeDetailsSchema,
  registerMemorySkillsSuiteKinds,
  rubricDetailsSchema,
} from './memory-skills-suite-kinds';

const CURATION_EXTRACTION = {
  operation: 'extraction',
  slice: 'seeded',
  confusion: { tp: 9, fp: 3, fn: 2, tn: 4, unlabelled: 1 },
  recall: 0.82,
  precision: 0.75,
  f1: 0.78,
  fmr: 0.05,
  baits: 12,
  overSuppression: 0.01,
  byCategory: {
    extraction: { tp: 5, fp: 1, fn: 1 },
    temporal: { tp: 4, fp: 2, fn: 1 },
  },
  bySedimentClass: { worktree: 3, 'dead-branch': 2 },
  matcher: { id: 'fact-matcher', version: '1.0.0' },
  cassette: 'gt-curation-seeded@v1',
};

const CURATION_RETENTION = {
  operation: 'retention',
  policy: 'current',
  simulatedDays: 180,
  falseDelete: { tp: 0, fp: 2, fn: 180 },
  falseRetain: { tp: 0, fp: 5, fn: 180 },
  byKind: {
    fact: { falseDelete: 1, falseRetain: 3 },
    event: { falseDelete: 1, falseRetain: 2 },
  },
  archivedThenNeeded: 3,
  unprocessedObservationsDeleted: 0,
  dbBytesByDay: [
    { day: 0, bytes: 1024 },
    { day: 90, bytes: 2048 },
    { day: 180, bytes: 3072 },
  ],
};

const CURATION_ABSTENTION = {
  operation: 'abstention',
  cases: 30,
  falseInjectionRate: 0.03,
  meanInjectedHits: 0.5,
};

const LIVENESS_FAULT_INJECTION = {
  source: 'fault-injection',
  rescan: null,
  snapshotSha256: 'a'.repeat(64),
  unprocessedAgeP95Ms: null,
  sessionsWithObservationsNoMemories: 0,
  ranPassesWithError: 1,
  faults: [
    {
      fault: 'curator-crash',
      expected: '0 unprocessed observations',
      observed: '0 unprocessed observations',
      pass: true,
    },
    {
      fault: 'db-locked',
      expected: '0 unprocessed observations',
      observed: '2 unprocessed observations',
      pass: false,
    },
  ],
};

const RUBRIC_INTER_RATER = {
  mode: 'inter-rater',
  rubricId: '471-exemplar-8',
  rubricVersion: 'v1',
  raters: ['rater-a', 'rater-b'],
  intraRater: true,
  items: 30,
  strata: { authored: 10, promoted: 10, fallback: 10 },
  kappaPassFull: 0.78,
  spearmanTotalFull: 0.9,
  spearmanTotalCandidates: 0.85,
  rawAgreement: 0.9,
  adjudicated: 4,
  anchorStability: { items: 5, withinTolerance: 4 },
  trusted: false,
};

const RUBRIC_JUDGE_VS_HUMAN = {
  mode: 'judge-vs-human',
  judge: 'skill-judge',
  model: 'claude-sonnet-4-5',
  promptSha256: 'c'.repeat(64),
  repeats: 3,
  spearman: 0.61,
  kappa: 0.55,
  meanRepeatSd: 0.4,
  saturationShare: 0.11,
  positiveControl: { n: 18, passRate: 0.94 },
  negativeControl: { n: 28, failRate: 0.96 },
  baselines: { lengthSpearman: 0.32, randomSpearman: 0.01 },
};

const FUNNEL = {
  fixtureId: 'gt-skill-sessions@v1',
  stages: [
    {
      stage: 'prefilter',
      in: 30,
      out: 12,
      invariants: [
        {
          id: 'routine-recall',
          pass: true,
          violations: 0,
          exampleIds: [],
        },
      ],
    },
    {
      stage: 'draft',
      in: 12,
      out: 9,
      invariants: [
        {
          id: 'fallback-marked',
          pass: false,
          violations: 3,
          exampleIds: ['s-001', 's-002', 's-003'],
        },
      ],
    },
  ],
  precision: 0.8,
  recall: 0.92,
  slugCollisionRate: 0,
  archaeologyAccuracy: { routine: 0.7, degraded: 0.8, n: 30 },
  backlog: [
    { stage: 'prefilter', ageP95Days: 6.5, slopePerWeek: -1.2, judgedShare: 1 },
  ],
};

const OUTCOME = {
  arm: 'memory',
  tasks: 48,
  repeats: 2,
  model: 'claude-sonnet-4-5',
  deterministic: false,
  conditions: [
    {
      id: 'M+',
      successRate: 0.6,
      ci95: [0.45, 0.74],
      turnsP50: 12.5,
      tokensInputP50: 30000,
    },
    {
      id: 'M0',
      successRate: 0.4,
      ci95: [0.26, 0.55],
      turnsP50: 14,
      tokensInputP50: 32000,
    },
  ],
  pairedDelta: [{ versus: 'M0', estimate: 0.2, ci95: [0.02, 0.38] }],
};

const SEEDED_GROUND_TRUTH = {
  id: 'gt-memory@v1',
  version: '1.0.0',
  method: 'seeded',
  raterCount: 2,
  frozenAt: '2026-10-01T00:00:00.000Z',
} as const;

function suiteView(
  kind: string,
  details: unknown,
  groundTruth: SuiteView<unknown>['groundTruth'] = SEEDED_GROUND_TRUTH,
): SuiteView<unknown> {
  return {
    kind,
    details,
    claim: { source: 'ledger', ref: 'context.md:157' },
    groundTruth,
    baselines: [{ id: 'b-563', label: '563 replay', metrics: { f1: 0.7 } }],
    deltas: { 'b-563': { f1: 0.08 } },
    cost: {
      source: 'cassette',
      calls: 12,
      latency_ms: { p50: 811.7, p95: 2400.4 },
      error_rate: 0,
      tokens: { input: 42000, output: 9000 },
    },
    verdict: 'pass',
  };
}

function scorecardWith(suite: SuiteView<unknown>): object {
  return {
    schemaVersion: 1,
    run: {
      id: 'run-620-001',
      startedAt: '2026-10-07T00:00:00.000Z',
      host: 'cli-headless',
      os: 'win32',
      node: 'v24.0.0',
      guardMode: 'not-applied',
      guard: { partial: false, unprobed: [] },
      hostExit: { kind: 'clean', exitCode: 0, signal: null },
    },
    product: { version: '0.0.0', commit: 'd716e0e8f' },
    corpus: {
      repo: 'ptah-extension',
      commit: 'd716e0e8f',
      eligibleFiles: 1,
      tsVersion: '6.0.3',
    },
    artifacts: [],
    suites: [suite],
    lifecycle: [],
    eagerSelection: { eager: [], deferred: [], rule: 'none' },
  };
}

function omit(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

function isolatedRegistry() {
  const registry = createSuiteKindRegistry();
  registerMemorySkillsSuiteKinds(registry);
  return registry;
}

describe('memory/skills suite kinds', () => {
  it('registers the five kinds into the default registry on import', () => {
    for (const kind of ['curation', 'liveness', 'rubric', 'funnel', 'outcome'])
      expect(getSuiteKind(kind)).toBeDefined();
  });

  it('registers exactly the five kinds into an isolated registry', () => {
    expect(isolatedRegistry().getRegisteredSuiteKinds()).toEqual([
      'curation',
      'liveness',
      'rubric',
      'funnel',
      'outcome',
    ]);
  });

  it('rejects a second registration of the same kind', () => {
    const registry = isolatedRegistry();
    expect(() => registerMemorySkillsSuiteKinds(registry)).toThrow(
      'suite kind already registered: curation',
    );
  });

  describe('valid details', () => {
    it('parses curation extraction details', () => {
      expect(curationDetailsSchema.parse(CURATION_EXTRACTION)).toEqual(
        CURATION_EXTRACTION,
      );
    });

    it('parses curation retention details', () => {
      expect(curationDetailsSchema.parse(CURATION_RETENTION)).toEqual(
        CURATION_RETENTION,
      );
    });

    it('parses curation abstention details', () => {
      expect(curationDetailsSchema.parse(CURATION_ABSTENTION)).toEqual(
        CURATION_ABSTENTION,
      );
    });

    it('parses liveness fault-injection details', () => {
      expect(livenessDetailsSchema.parse(LIVENESS_FAULT_INJECTION)).toEqual(
        LIVENESS_FAULT_INJECTION,
      );
    });

    it('parses rubric inter-rater details', () => {
      expect(rubricDetailsSchema.parse(RUBRIC_INTER_RATER)).toEqual(
        RUBRIC_INTER_RATER,
      );
    });

    it('parses rubric judge-vs-human details', () => {
      expect(rubricDetailsSchema.parse(RUBRIC_JUDGE_VS_HUMAN)).toEqual(
        RUBRIC_JUDGE_VS_HUMAN,
      );
    });

    it('parses funnel details', () => {
      expect(funnelDetailsSchema.parse(FUNNEL)).toEqual(FUNNEL);
    });

    it('parses outcome details', () => {
      expect(outcomeDetailsSchema.parse(OUTCOME)).toEqual(OUTCOME);
    });
  });

  describe('invalid details', () => {
    it('rejects an unknown curation operation', () => {
      expect(
        curationDetailsSchema.safeParse({
          ...CURATION_EXTRACTION,
          operation: 'replay',
        }).success,
      ).toBe(false);
    });

    it('rejects curation extraction without fmr', () => {
      expect(
        curationDetailsSchema.safeParse(omit(CURATION_EXTRACTION, 'fmr'))
          .success,
      ).toBe(false);
    });

    it('rejects a negative case count on curation abstention', () => {
      expect(
        curationDetailsSchema.safeParse({
          ...CURATION_ABSTENTION,
          cases: -1,
        }).success,
      ).toBe(false);
    });

    it('rejects an unknown liveness source', () => {
      expect(
        livenessDetailsSchema.safeParse({
          ...LIVENESS_FAULT_INJECTION,
          source: 'fuzz',
        }).success,
      ).toBe(false);
    });

    it('rejects a liveness fault row without a pass flag', () => {
      expect(
        livenessDetailsSchema.safeParse({
          ...LIVENESS_FAULT_INJECTION,
          faults: [omit(LIVENESS_FAULT_INJECTION.faults[0], 'pass')],
        }).success,
      ).toBe(false);
    });

    it('rejects a non-hex promptSha256 on rubric judge-vs-human', () => {
      expect(
        rubricDetailsSchema.safeParse({
          ...RUBRIC_JUDGE_VS_HUMAN,
          promptSha256: 'not-a-sha',
        }).success,
      ).toBe(false);
    });

    it('rejects anchor stability beyond its item count', () => {
      expect(
        rubricDetailsSchema.safeParse({
          ...RUBRIC_INTER_RATER,
          anchorStability: { items: 3, withinTolerance: 4 },
        }).success,
      ).toBe(false);
    });

    it('rejects a stray projectionSha256 in funnel details (the core owns it)', () => {
      expect(
        funnelDetailsSchema.safeParse({
          ...FUNNEL,
          projectionSha256: 'a'.repeat(64),
        }).success,
      ).toBe(false);
    });

    it('rejects an unknown funnel stage', () => {
      expect(
        funnelDetailsSchema.safeParse({
          ...FUNNEL,
          stages: [{ ...FUNNEL.stages[0], stage: 'ship' }],
        }).success,
      ).toBe(false);
    });

    it('rejects a deterministic outcome suite', () => {
      expect(
        outcomeDetailsSchema.safeParse({ ...OUTCOME, deterministic: true })
          .success,
      ).toBe(false);
    });

    it('rejects an unknown outcome condition id', () => {
      expect(
        outcomeDetailsSchema.safeParse({
          ...OUTCOME,
          conditions: [{ ...OUTCOME.conditions[0], id: 'M1' }],
        }).success,
      ).toBe(false);
    });

    it('rejects an inverted ci95 interval on outcome details', () => {
      expect(
        outcomeDetailsSchema.safeParse({
          ...OUTCOME,
          conditions: [{ ...OUTCOME.conditions[0], ci95: [0.9, 0.2] }],
        }).success,
      ).toBe(false);
    });
  });

  describe('scorecard integration through 619 core', () => {
    it('parses a full rubric scorecard with raterCount 2', () => {
      const registry = isolatedRegistry();
      const scorecard = createScorecardSchema(registry).parse(
        scorecardWith(
          suiteView('rubric', RUBRIC_INTER_RATER, {
            id: 'skill-labels.v1',
            version: '1.0.0',
            method: 'labelled',
            raterCount: 2,
            frozenAt: '2026-10-01T00:00:00.000Z',
          }),
        ),
      );
      const suite = scorecard.suites[0];
      expect(suite.kind).toBe('rubric');
      expect(suite.groundTruth.raterCount).toBe(2);
      expect((suite.details as { rubricId: string }).rubricId).toBe(
        '471-exemplar-8',
      );
    });

    it('rejects a scorecard whose funnel details carry projectionSha256', () => {
      const registry = isolatedRegistry();
      const clean = createScorecardSchema(registry).safeParse(
        scorecardWith(suiteView('funnel', FUNNEL)),
      );
      const stray = createScorecardSchema(registry).safeParse(
        scorecardWith(
          suiteView('funnel', { ...FUNNEL, projectionSha256: 'a'.repeat(64) }),
        ),
      );
      expect(clean.success).toBe(true);
      expect(stray.success).toBe(false);
    });
  });

  describe('markdown renderers', () => {
    it('renders curation extraction details with cost and verdict rows', () => {
      const lines =
        isolatedRegistry()
          .getSuiteKind('curation')
          ?.renderMarkdown?.(suiteView('curation', CURATION_EXTRACTION)) ?? [];
      expect(lines[0]).toBe('## curation: extraction');
      expect(lines).toContain('| recall | 0.82 |');
      expect(lines).toContain('| byCategory.extraction | tp 5 / fp 1 / fn 1 |');
      expect(lines).toContain('| calls | 12 |');
      expect(lines).toContain('| Verdict | pass |');
    });

    it('renders liveness faults as a table', () => {
      const lines =
        isolatedRegistry()
          .getSuiteKind('liveness')
          ?.renderMarkdown?.(suiteView('liveness', LIVENESS_FAULT_INJECTION)) ??
        [];
      expect(lines[0]).toBe('## liveness');
      expect(lines).toContain('| faults | 1/2 pass |');
      expect(lines).toContain(
        '| db-locked | 0 unprocessed observations | 2 unprocessed observations | fail |',
      );
      expect(lines).toContain('| Verdict | pass |');
    });

    it('renders rubric inter-rater agreement', () => {
      const lines =
        isolatedRegistry()
          .getSuiteKind('rubric')
          ?.renderMarkdown?.(suiteView('rubric', RUBRIC_INTER_RATER)) ?? [];
      expect(lines[0]).toBe('## rubric: inter-rater (471-exemplar-8@v1)');
      expect(lines).toContain('| raters | rater-a, rater-b |');
      expect(lines).toContain('| anchorStability | 4/5 within tolerance |');
      expect(lines).toContain('| Verdict | pass |');
    });

    it('renders funnel stages, optional metrics and backlog', () => {
      const lines =
        isolatedRegistry()
          .getSuiteKind('funnel')
          ?.renderMarkdown?.(suiteView('funnel', FUNNEL)) ?? [];
      expect(lines[0]).toBe('## funnel: gt-skill-sessions@v1');
      expect(lines).toContain(
        '| prefilter | 30 | 12 | 1/1 pass, 0 violations |',
      );
      expect(lines).toContain('| draft | 12 | 9 | 0/1 pass, 3 violations |');
      expect(lines).toContain('| slugCollisionRate | 0 |');
      expect(lines).toContain('| prefilter | 6.5 | -1.2 | 1 |');
      expect(lines).toContain('| Verdict | pass |');
    });

    it('renders outcome conditions and paired deltas', () => {
      const lines =
        isolatedRegistry()
          .getSuiteKind('outcome')
          ?.renderMarkdown?.(suiteView('outcome', OUTCOME)) ?? [];
      expect(lines[0]).toBe('## outcome: memory');
      expect(lines).toContain('| M+ | 0.6 | [0.45, 0.74] | 12.5 | 30000 |');
      expect(lines).toContain('| M0 | 0.4 | [0.26, 0.55] | 14 | 32000 |');
      expect(lines).toContain('| M0 | 0.2 | [0.02, 0.38] |');
      expect(lines).toContain('| deterministic | false |');
      expect(lines).toContain('| Verdict | pass |');
    });
  });
});
