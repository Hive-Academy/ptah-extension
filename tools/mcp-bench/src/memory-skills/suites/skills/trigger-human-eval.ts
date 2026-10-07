/**
 * `skill.trigger-eval.human` (benchmark-design.md:100, :291): model-panel
 * should-trigger and near-miss prompts for the authored skills (5 + 5 each,
 * `gt-skill-triggers@v1`, user activity U4), scored by the product's
 * `TriggerEvalService` itself.
 *
 * Ground truth is a cross-family model panel (raters xAI and Google,
 * adjudicator GLM), not a human label. The display label is
 * {@link TRIGGER_EVAL_DISPLAY_LABEL}. The suite id stays
 * `skill.trigger-eval.human`: model-panel labels; id kept for compatibility.
 * `groundTruth.method` stays `labelled`, the closest value 619's closed enum
 * accepts, so `writeSuiteResult` still validates. The honest panel string
 * {@link TRIGGER_EVAL_PANEL_METHOD} is carried on `claim.text`, the free-text
 * field the written result keeps. `funnel` details are a strict schema with
 * no note key, and a top-level `note` is refused.
 *
 * Real product path, and why no model is called. `TriggerEvalService.evaluate`
 * makes exactly one lane call, to GENERATE its prompts; everything after it
 * (embedding, rank, top-K, similarity floor, precision, recall) is local
 * `IEmbedder` arithmetic (`trigger-eval.service.ts:16-25`). The suite resolves
 * a fresh `TriggerEvalService` from a child container in which
 * `LANE_RUNNER_SERVICE` is a {@link LabelledPromptLane}: it hands back the
 * labelled prompt set as the "generated" set and never reaches a model, so the
 * panel prompts run through the product's own scoring path unchanged.
 * `SKILL_CANDIDATE_STORE` is a {@link LabelledSkillLibrary}: the retrieval
 * corpus is the labelled skills' descriptions, and `recordTriggerEval` keeps
 * the measurement in memory (the product database is never written). The
 * child registers `TriggerEvalService` by class, so neither the container's
 * singleton nor the real lane runner is touched.
 *
 * Baseline: the self-generated prompt score (design :100), read from a
 * recorded file of product-generated prompt sets when the plan supplies one
 * and scored the same way. Without it the baseline metrics are `null`.
 *
 * Verdict: always `na`. Without labels (today, U4 pending) the reason is
 * `ground-truth-absent`; with fewer labelled skills than expected it is
 * `ground-truth-incomplete`; a skipped or errored evaluation gives its reason;
 * otherwise `report-only`, because the design sets no threshold (:100).
 * Aggregate rates are micro-averaged over prompts and are exactly `num/den`.
 */

import { existsSync } from 'node:fs';

import {
  SKILL_SYNTHESIS_TOKENS,
  TriggerEvalService,
  type CandidateId,
  type LaneRunRequest,
  type LaneRunResult,
  type SkillSynthesisSettings,
  type TriggerEvalOutcome,
  type TriggerEvalReport,
} from '@ptah-extension/skill-synthesis';
import { z } from 'zod';

import type { BenchHostContainer } from '../../../transport/bench-host-boot';
import {
  funnelDetailsSchema,
  type FunnelDetails,
} from '../../memory-skills-suite-kinds';
import { rate, type Rate } from '../../metrics/curation-metrics';
import type { CaseRecord, SuiteResultInput } from '../../runner/suite-result';
import {
  costOf,
  deltaOf,
  parseJsonLines,
  rateMetrics,
  recordCase,
  resolveHomeFile,
} from '../memory/memory-suite-support';

/** Scorecard display label. 619's suite view has no display-label field. */
export const TRIGGER_EVAL_DISPLAY_LABEL = 'skill.trigger-eval.panel';

/**
 * Honest ground-truth method. Not a human label. 619's `groundTruthSchema`
 * does not accept this string yet, so it is stored on `claim.text`.
 */
export const TRIGGER_EVAL_PANEL_METHOD =
  'model-panel:xAI+Google; adjudicator=GLM';

/** Raters in the panel (xAI and Google). The GLM adjudicator is not a third rater. */
export const TRIGGER_EVAL_PANEL_RATER_COUNT = 2;

/**
 * Suite id. model-panel labels; id kept for compatibility with the host
 * registry and with result files named `<suiteId>.suite.json`.
 */
export const TRIGGER_EVAL_HUMAN_SUITE_ID = 'skill.trigger-eval.human';

/** Home-relative target the plan seeds `gt-skill-triggers@v1` into. */
export const TRIGGER_LABELS_TARGET = 'memory-skills/skill-triggers.v1.jsonl';

/** The authored skills design :291 labels (batches.md:99). */
export const EXPECTED_LABELLED_SKILLS = 23;

export const SELF_GENERATED_BASELINE_ID = 'self-generated';

// ---------------------------------------------------------------- labels

const skillIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'skill id: a lower-case slug');
const promptsSchema = z.array(z.string().trim().min(1)).min(1);

/** One line of `gt-skill-triggers@v1`: a skill's description and its labelled prompts. */
export const triggerLabelSchema = z.strictObject({
  skillId: skillIdSchema,
  /** The skill's description at the pinned commit: the only text retrieval sees. */
  description: z.string().trim().min(1),
  shouldTrigger: promptsSchema,
  nearMiss: promptsSchema,
});
export type TriggerLabel = z.infer<typeof triggerLabelSchema>;

/** One line of the recorded self-generated baseline: the product's own prompt set. */
export const triggerPromptSetSchema = z.strictObject({
  skillId: skillIdSchema,
  shouldTrigger: promptsSchema,
  nearMiss: promptsSchema,
});
export type TriggerPromptSetLine = z.infer<typeof triggerPromptSetSchema>;

export const triggerHumanOptionsSchema = z
  .strictObject({
    labelsFile: z.string().min(1).default(TRIGGER_LABELS_TARGET),
    /** Recorded product-generated prompt sets (the self-consistency baseline). */
    selfGeneratedFile: z.string().min(1).optional(),
    expectedSkills: z
      .number()
      .int()
      .positive()
      .default(EXPECTED_LABELLED_SKILLS),
    groundTruthVersion: z.string().min(1).default('v1'),
    /** Per-case safety cap override (specs); default `case-runner.ts`. */
    capMs: z.number().int().positive().optional(),
  })
  .prefault({});
export type TriggerHumanOptions = z.infer<typeof triggerHumanOptionsSchema>;

function readUnique<T extends { skillId: string }>(
  path: string,
  schema: z.ZodType<T>,
): T[] {
  const lines = parseJsonLines(path).map((value, index) => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      throw new Error(
        `${path}:${index + 1} is not a valid line\n${z.prettifyError(parsed.error)}`,
      );
    }
    return parsed.data;
  });
  const seen = new Set<string>();
  for (const line of lines) {
    if (seen.has(line.skillId)) {
      throw new Error(`${path} labels skill ${line.skillId} twice`);
    }
    seen.add(line.skillId);
  }
  return lines;
}

// ---------------------------------------------------------------- doubles

interface PromptSet {
  readonly shouldTrigger: readonly string[];
  readonly nearMiss: readonly string[];
}

/**
 * The `LANE_RUNNER_SERVICE` the scoring container sees. It answers the
 * service's one generation call with the prompt set being scored; it holds no
 * model and makes no I/O.
 */
export class LabelledPromptLane {
  private current: PromptSet | null = null;
  private served = 0;

  serve(set: PromptSet): void {
    this.current = set;
  }

  clear(): void {
    this.current = null;
  }

  /** Generation calls answered so far. */
  calls(): number {
    return this.served;
  }

  async run(request: LaneRunRequest): Promise<LaneRunResult> {
    const set = this.current;
    if (set === null) {
      throw new Error(
        'LabelledPromptLane: a lane call arrived with no prompt set being scored',
      );
    }
    this.served += 1;
    const json = {
      shouldTrigger: [...set.shouldTrigger],
      nearMiss: [...set.nearMiss],
    };
    return {
      status: 'ok',
      run: {
        lane: {
          config: {
            id: request.laneId,
            provider: '',
            model: 'labelled-prompts',
            defaultTier: 'haiku',
            structuredOutput: 'parse',
            toolUse: 'none',
            timeoutMs: 0,
            maxInputChars: 0,
            maxPasses: 1,
          },
          auth: undefined,
          model: 'labelled-prompts',
        },
        text: JSON.stringify(json),
        json,
        structuredOutputHonoured: false,
        usage: {},
        truncated: false,
        degradedReason: null,
        executions: 0,
        passesAllowed: 1,
      },
    };
  }
}

interface LibraryRow {
  readonly id: CandidateId;
  readonly name: string;
  readonly description: string;
}

/**
 * The `SKILL_CANDIDATE_STORE` the scoring container sees: the labelled skills
 * as the active library, and the measurements kept in memory.
 */
export class LabelledSkillLibrary {
  readonly recorded = new Map<string, unknown>();

  constructor(private readonly rows: readonly LibraryRow[]) {}

  listByStatus(status: string): LibraryRow[] {
    return status === 'promoted' ? [...this.rows] : [];
  }

  recordTriggerEval(id: string, measurement: unknown): void {
    this.recorded.set(id, measurement);
  }

  /** The labelled skills carry no stored (transcript) embedding. */
  getEmbedding(): null {
    return null;
  }

  searchActiveByEmbedding(): [] {
    return [];
  }
}

// ---------------------------------------------------------------- scoring

/** The product's skip reasons (not exported by name from the barrel). */
type TriggerEvalSkipReason = Extract<
  TriggerEvalOutcome,
  { status: 'skipped' }
>['reason'];

/** What one skill's evaluation produced, read off the product report. */
export interface SkillScore {
  readonly skillId: string;
  readonly status: 'evaluated' | 'skipped';
  readonly skipReason: TriggerEvalSkipReason | null;
  readonly unmeasuredReason: TriggerEvalReport['unmeasuredReason'];
  readonly positives: number;
  readonly truePositives: number;
  readonly negatives: number;
  readonly falsePositives: number;
  readonly precision: number | null;
  readonly recall: number | null;
}

export interface ScoredSkill {
  readonly record: CaseRecord;
  readonly score: SkillScore | null;
}

export interface TriggerScoringEnv {
  /** The host container; the product service is resolved from a child of it. */
  readonly container: BenchHostContainer;
  readonly readSettings: () => SkillSynthesisSettings;
}

function scoreOf(skillId: string, outcome: TriggerEvalOutcome): SkillScore {
  if (outcome.status === 'skipped') {
    return {
      skillId,
      status: 'skipped',
      skipReason: outcome.reason,
      unmeasuredReason: null,
      positives: 0,
      truePositives: 0,
      negatives: 0,
      falsePositives: 0,
      precision: null,
      recall: null,
    };
  }
  const { report } = outcome;
  const should = report.outcomes.filter((o) => o.kind === 'should-trigger');
  const near = report.outcomes.filter((o) => o.kind === 'near-miss');
  return {
    skillId,
    status: 'evaluated',
    skipReason: null,
    unmeasuredReason: report.unmeasuredReason,
    positives: should.length,
    truePositives: should.filter((o) => o.triggered).length,
    negatives: near.length,
    falsePositives: near.filter((o) => o.triggered).length,
    precision: report.measurement.precision,
    recall: report.measurement.recall,
  };
}

function observedOf(score: SkillScore): string {
  if (score.status === 'skipped') return `skipped: ${score.skipReason}`;
  return (
    `tp ${score.truePositives}/${score.positives} should-trigger, ` +
    `fp ${score.falsePositives}/${score.negatives} near-miss, ` +
    `precision ${score.precision ?? 'null'}, recall ${score.recall ?? 'null'}` +
    (score.unmeasuredReason === null ? '' : ` (${score.unmeasuredReason})`)
  );
}

function perfect(score: SkillScore): boolean {
  return (
    score.status === 'evaluated' &&
    score.unmeasuredReason === null &&
    score.positives > 0 &&
    score.truePositives === score.positives &&
    score.falsePositives === 0
  );
}

export interface ScoringRun {
  readonly scores: ReadonlyMap<string, ScoredSkill>;
  /** Generation calls the labelled lane answered: never a model call. */
  readonly laneCalls: number;
  /** Measurements the service wrote, by skill id (kept in memory only). */
  readonly recorded: ReadonlyMap<string, unknown>;
}

/**
 * Score `sets` (prompt sets by skill id) against `library` with the product's
 * `TriggerEvalService`, one skill at a time. A skill without a set is still
 * part of the retrieval corpus.
 */
export async function scoreWithProductService(
  env: TriggerScoringEnv,
  library: readonly Pick<TriggerLabel, 'skillId' | 'description'>[],
  sets: ReadonlyMap<string, PromptSet>,
  capMs?: number,
): Promise<ScoringRun> {
  const lane = new LabelledPromptLane();
  const store = new LabelledSkillLibrary(
    library.map((skill) => ({
      id: skill.skillId as CandidateId,
      name: skill.skillId,
      description: skill.description,
    })),
  );
  const child = env.container.createChildContainer();
  child.register(SKILL_SYNTHESIS_TOKENS.LANE_RUNNER_SERVICE, {
    useValue: lane,
  });
  child.register(SKILL_SYNTHESIS_TOKENS.SKILL_CANDIDATE_STORE, {
    useValue: store,
  });
  // By class, in the child: a fresh instance wired to the doubles above, not
  // the container's singleton (which holds the real lane runner).
  child.register(TriggerEvalService, { useClass: TriggerEvalService });
  if (
    child.resolve(SKILL_SYNTHESIS_TOKENS.LANE_RUNNER_SERVICE) !== lane ||
    child.resolve(SKILL_SYNTHESIS_TOKENS.SKILL_CANDIDATE_STORE) !== store
  ) {
    throw new Error(
      'the scoring container does not resolve the labelled lane and library',
    );
  }
  const service = child.resolve(TriggerEvalService);
  const settings = env.readSettings();

  const scores = new Map<string, ScoredSkill>();
  for (const skill of library) {
    const set = sets.get(skill.skillId);
    if (set === undefined) continue;
    lane.serve(set);
    try {
      const recorded = await recordCase<SkillScore>(
        `skill/${skill.skillId}`,
        { skillId: skill.skillId, description: skill.description, ...set },
        'every labelled should-trigger prompt retrieves the skill and no near-miss does',
        async (signal) => {
          const outcome = await service.evaluate(
            {
              id: skill.skillId as CandidateId,
              description: skill.description,
              displayName: skill.skillId,
            },
            settings,
            signal,
          );
          const score = scoreOf(skill.skillId, outcome);
          return {
            value: score,
            verdict: {
              expected:
                'every labelled should-trigger prompt retrieves the skill and no near-miss does',
              observed: observedOf(score),
              outcome: perfect(score) ? 'pass' : 'fail',
            },
          };
        },
        capMs,
      );
      scores.set(skill.skillId, {
        record: recorded.record,
        score: recorded.value,
      });
    } finally {
      lane.clear();
    }
  }
  return { scores, laneCalls: lane.calls(), recorded: store.recorded };
}

/** Micro-averaged precision and recall over the evaluated skills' prompts. */
export interface AggregateRates {
  readonly precision: Rate;
  readonly recall: Rate;
  readonly evaluated: number;
  readonly perfect: number;
}

export function aggregate(scores: Iterable<SkillScore | null>): AggregateRates {
  let tp = 0;
  let fp = 0;
  let positives = 0;
  let evaluated = 0;
  let perfectCount = 0;
  for (const score of scores) {
    if (score === null || score.status !== 'evaluated') continue;
    if (score.unmeasuredReason !== null) continue;
    evaluated += 1;
    tp += score.truePositives;
    fp += score.falsePositives;
    positives += score.positives;
    if (perfect(score)) perfectCount += 1;
  }
  return {
    precision: rate(tp, tp + fp),
    recall: rate(tp, positives),
    evaluated,
    perfect: perfectCount,
  };
}

function aggregateMetrics(
  rates: AggregateRates,
): Record<string, number | null> {
  return {
    ...rateMetrics('precision', rates.precision),
    ...rateMetrics('recall', rates.recall),
  };
}

const NULL_RATES: AggregateRates = {
  precision: rate(0, 0),
  recall: rate(0, 0),
  evaluated: 0,
  perfect: 0,
};

// ---------------------------------------------------------------- suite

export interface TriggerHumanInput {
  readonly home: string;
  readonly options: unknown;
  readonly env: TriggerScoringEnv;
}

function naReasonOf(
  labelled: number,
  expected: number,
  scored: readonly ScoredSkill[],
): string {
  const errored = scored.filter((entry) => entry.score === null).length;
  if (errored > 0) return `case-error: ${errored} of ${scored.length} skills`;
  const skipped = scored.find((entry) => entry.score?.status === 'skipped');
  if (skipped?.score?.skipReason) {
    return `${skipped.score.skipReason}: the product service skipped the evaluation`;
  }
  const unmeasured = scored.find(
    (entry) => entry.score?.unmeasuredReason != null,
  );
  if (unmeasured?.score?.unmeasuredReason) {
    return `${unmeasured.score.unmeasuredReason}: a labelled set was not scoreable`;
  }
  if (labelled < expected) {
    return `ground-truth-incomplete: ${labelled} of ${expected} skills labelled`;
  }
  return 'report-only: benchmark-design.md:100 sets no threshold';
}

export async function runTriggerEvalHuman(
  input: TriggerHumanInput,
): Promise<{ result: SuiteResultInput; cases: CaseRecord[] }> {
  const options = triggerHumanOptionsSchema.parse(input.options);
  const labelsPath = resolveHomeFile(input.home, options.labelsFile);
  // `labelled` is the closest closed-enum value (`generated|labelled|seeded|git-history`).
  // The panel string cannot go here until 619 widens `groundTruthSchema.method`.
  const groundTruth: SuiteResultInput['groundTruth'] = {
    id: 'gt-skill-triggers',
    version: options.groundTruthVersion,
    method: 'labelled',
    raterCount: TRIGGER_EVAL_PANEL_RATER_COUNT,
  };
  const claim: SuiteResultInput['claim'] = {
    source: 'code',
    ref: 'libs/backend/skill-synthesis/src/lib/gates/trigger-eval.service.ts:13-25',
    text:
      'Retrieval on a skill description is measured against prompts it should and should not answer, with no model in the scoring path. ' +
      `Ground truth note: ${TRIGGER_EVAL_PANEL_METHOD}. Display label: ${TRIGGER_EVAL_DISPLAY_LABEL}. ` +
      'model-panel labels; id kept for compatibility.',
  };
  const fixtureId = `gt-skill-triggers@${options.groundTruthVersion}`;

  if (!existsSync(labelsPath)) {
    const details: FunnelDetails = funnelDetailsSchema.parse({
      fixtureId,
      stages: [],
      precision: null,
      recall: null,
    });
    return {
      cases: [],
      result: {
        suiteId: TRIGGER_EVAL_HUMAN_SUITE_ID,
        kind: 'funnel',
        details,
        claim,
        groundTruth,
        baselines: [
          {
            id: SELF_GENERATED_BASELINE_ID,
            label: 'self-generated prompt score (not scored: no labelled set)',
            metrics: aggregateMetrics(NULL_RATES),
          },
        ],
        deltas: {},
        cost: costOf([], 0),
        modelCalls: 0,
        verdict: 'na',
        naReason: `ground-truth-absent: ${fixtureId} is not labelled yet (U4)`,
        metrics: {
          ...aggregateMetrics(NULL_RATES),
          skills: 0,
          expectedSkills: options.expectedSkills,
        },
        cassetteVersion: null,
      },
    };
  }

  const labels = readUnique(labelsPath, triggerLabelSchema);
  const humanSets = new Map<string, PromptSet>(
    labels.map((label) => [label.skillId, label]),
  );
  const human = await scoreWithProductService(
    input.env,
    labels,
    humanSets,
    options.capMs,
  );

  let baseline: ScoringRun | null = null;
  let baselineLabel =
    'self-generated prompt score (not supplied: no recorded product-generated prompt sets)';
  if (options.selfGeneratedFile !== undefined) {
    const lines = readUnique(
      resolveHomeFile(input.home, options.selfGeneratedFile),
      triggerPromptSetSchema,
    );
    const known = new Set(labels.map((label) => label.skillId));
    const sets = new Map<string, PromptSet>(
      lines
        .filter((line) => known.has(line.skillId))
        .map((line) => [line.skillId, line]),
    );
    baseline = await scoreWithProductService(
      input.env,
      labels,
      sets,
      options.capMs,
    );
    baselineLabel = `self-generated prompt score over ${sets.size} of ${labels.length} labelled skills (recorded product-generated prompt sets)`;
  }

  const scored = [...human.scores.values()];
  const rates = aggregate(scored.map((entry) => entry.score));
  const baselineRates =
    baseline === null
      ? NULL_RATES
      : aggregate([...baseline.scores.values()].map((entry) => entry.score));
  const cases = scored.map(({ record }) => {
    const other = baseline?.scores.get(record.caseId.slice('skill/'.length));
    if (other?.score == null) return record;
    return {
      ...record,
      baselineOutcomes: {
        [SELF_GENERATED_BASELINE_ID]: perfect(other.score)
          ? ('pass' as const)
          : ('fail' as const),
      },
    };
  });

  const productMetrics = aggregateMetrics(rates);
  const baselineMetrics = aggregateMetrics(baselineRates);
  const promptsLabelled = labels.reduce(
    (sum, label) => sum + label.shouldTrigger.length + label.nearMiss.length,
    0,
  );
  const promptsScored = scored.reduce(
    (sum, entry) =>
      sum +
      (entry.score === null
        ? 0
        : entry.score.positives + entry.score.negatives),
    0,
  );
  const details: FunnelDetails = funnelDetailsSchema.parse({
    fixtureId,
    stages: [],
    precision: rates.precision.value,
    recall: rates.recall.value,
  });
  const laneCalls = human.laneCalls + (baseline?.laneCalls ?? 0);

  return {
    cases,
    result: {
      suiteId: TRIGGER_EVAL_HUMAN_SUITE_ID,
      kind: 'funnel',
      details,
      claim,
      groundTruth,
      baselines: [
        {
          id: SELF_GENERATED_BASELINE_ID,
          label: baselineLabel,
          metrics: baselineMetrics,
        },
      ],
      deltas: {
        [SELF_GENERATED_BASELINE_ID]: deltaOf(productMetrics, baselineMetrics),
      },
      // `calls` are product evaluations; the labelled lane answers them, so
      // none is a model call.
      cost: costOf(cases, laneCalls),
      modelCalls: 0,
      verdict: 'na',
      naReason: naReasonOf(labels.length, options.expectedSkills, scored),
      metrics: {
        ...productMetrics,
        skills: labels.length,
        expectedSkills: options.expectedSkills,
        'skills.evaluated': rates.evaluated,
        'skills.perfect': rates.perfect,
        promptsLabelled,
        promptsScored,
      },
      cassetteVersion: null,
    },
  };
}
