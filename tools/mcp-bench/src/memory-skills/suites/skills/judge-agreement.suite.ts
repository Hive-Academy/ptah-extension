/**
 * `skill.judge-agreement` and `skill.judge-agreement.panel`
 * (benchmark-design.md 4.3, batches.md Task 21.2). LOCAL host suites, never in
 * CI: an LLM judge's accuracy is inform-only (context.md: do not gate CI on
 * LLM-judge accuracy).
 *
 * What runs is the product: `SkillJudgeService.judge` (rubric
 * `skill-judge.service.ts:121-132`) for `skill.judge-agreement`, and
 * `JudgePanelService.evaluate` (`gates/judge-panel.service.ts:261-413`) for
 * `.panel`, both resolved from the bench host's container with the lane runner
 * the host installed (`host/doubles-override.ts`: in record mode that is the
 * real `LaneRunnerService` behind the recording double). The suite only adds a
 * pass-through observer (`judge-lane-tap.ts`) to pin the model and the prompt.
 * Each document is registered through the product's own
 * `SkillCandidateStore.registerCandidate` so the panel can persist its
 * verdict, which is why both suites declare `placement: 'last'`.
 *
 * Corpus (`judge-corpus.ts`): the blinded `gt-skill-rubric@v1` packet, each
 * document judged under its opaque id exactly as the raters read it, plus the
 * 10 committed planted negatives. Every document is judged `repeats` times
 * (default 3).
 *
 * Metrics, on the full set and without the judge-selected `anchor-471`
 * stratum: Spearman(judge mean composite, human consensus total), Cohen's
 * kappa(judge pass at `minJudgeScore`, human pass), the score-by-length and
 * seeded random-scorer baselines, per-document repeat SD and the saturation
 * share (score 10). Controls are per judge call: the `authored` stratum must
 * pass the gate at >= 90%, the `fallback` stratum plus the planted negatives
 * must be scored below it at >= 90% (an `unscored` call counts for neither).
 *
 * Verdict (honesty rule of the Phase 3.5 review): `na` whenever any part is
 * not the real path on trusted ground truth, in this order:
 *   1. `ground-truth-untrusted …`: labels absent (true today, U1), not
 *      matching MANIFEST.json, below the trust bar, or describing other
 *      documents than the judged packet;
 *   2. `lane-runner-replay …`: the judge's outputs came from a cassette;
 *   3. `judge-calls-errored …`: a call threw or hit the safety cap;
 *   4. `model-not-pinned …` / `prompt-not-pinned …` / `prompt-drift …`.
 * Otherwise `pass` when both controls hold and the judge beats the length
 * baseline by >= 0.2 rho on the full set AND without `anchor-471`; else
 * `fail`. The measured numbers always stay in `details` and `metrics`; raw
 * outputs (lane text included) go only to `<runDir>/raw/<suiteId>.jsonl`,
 * and `runDir` lies inside the bench data folder (`host/plan.schema.ts`).
 */

import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import type {
  JudgeDecision,
  JudgePanelService,
  SkillCandidateRow,
  SkillCandidateStore,
  SkillJudgeService,
  SkillSynthesisSettings,
} from '@ptah-extension/skill-synthesis';
import { z } from 'zod';

import { sha256HexSchema } from '../../ground-truth/label-schemas';
import type {
  MemorySkillsHostSuite,
  MemorySkillsHostSuiteContext,
} from '../../host/memory-skills-host';
import type { RubricDetails } from '../../memory-skills-suite-kinds';
import {
  cohenKappa,
  spearmanRho,
  type KappaStatistic,
} from '../../metrics/agreement-metrics';
import { rate, type Rate } from '../../metrics/curation-metrics';
import type { CaseRecord, SuiteResultInput } from '../../runner/suite-result';
import { writeSuiteResult } from '../../runner/suite-result';
import {
  costOf,
  deltaOf,
  rateMetrics,
  recordCase,
  resolveHomeFile,
} from '../memory/memory-suite-support';
import { loadJudgeCorpus, type JudgeDocument } from './judge-corpus';
import type { LaneCall, LaneTap } from './judge-lane-tap';
import {
  ANCHOR_STRATUM,
  groundTruthNaReason,
  loadRubricGroundTruth,
  RUBRIC_BOOTSTRAP,
  RUBRIC_GROUND_TRUTH_ID,
  RUBRIC_GROUND_TRUTH_VERSION,
  type LoadedRubricGroundTruth,
  type RubricGroundTruth,
} from './rubric-ground-truth';

export const JUDGE_AGREEMENT_SUITE_ID = 'skill.judge-agreement';
export const JUDGE_PANEL_AGREEMENT_SUITE_ID = 'skill.judge-agreement.panel';

/** Design 4.3 bars. */
export const CONTROL_RATE_BAR = 0.9;
export const INFORMATIVE_MARGIN = 0.2;
export const SATURATED_SCORE = 10;
export const POSITIVE_CONTROL_STRATUM = 'authored';
export const NEGATIVE_CONTROL_STRATUM = 'fallback';

/** `created_at` of every registered document row: fixed, so runs compare. */
const CANDIDATE_CREATED_AT = Date.UTC(2026, 9, 6);

export type JudgeKind = 'skill-judge' | 'judge-panel';

const nonEmpty = z.string().min(1);
const raterId = z.string().regex(/^[a-z0-9-]{1,32}$/, 'rater id');

export const judgeAgreementOptionsSchema = z.strictObject({
  /** The judge-lane model id this run is pinned to (`LaneRun.lane.model`). */
  model: nonEmpty,
  /** The synthesis-lane model of the panel's escalation; default `model`. */
  escalationModel: nonEmpty.optional(),
  /** sha256 of the judge rubric a previous run recorded; a change is drift. */
  promptSha256: sha256HexSchema.optional(),
  repeats: z.number().int().min(1).max(10).default(3),
  /** Seed of the random-scorer baseline and the kappa interval. */
  seed: nonEmpty.default('TASK_2026_620:judge-agreement'),
  raters: z.tuple([raterId, raterId]).default(['r1', 'r2']),
  /** Home-relative copies the plan seeds (see the batch report's plan). */
  groundTruthDir: nonEmpty.default('fixtures/memory-skills'),
  documentsDir: nonEmpty.default('judge-agreement/documents'),
  idMapFile: nonEmpty.default('judge-agreement/id-map.json'),
  plantedNegativesDir: nonEmpty.default(
    'fixtures/memory-skills/planted-negatives.v1',
  ),
});
export type JudgeAgreementOptions = z.infer<typeof judgeAgreementOptionsSchema>;

// ---------------------------------------------------------------- ports

/** One judged call's verdict, as the gate sees it. */
export interface JudgeReading {
  readonly status: JudgeDecision['status'];
  readonly score: number | null;
  readonly reason: string;
  /** Judge calls the panel made (1 for the single judge). */
  readonly panellists: number;
  readonly escalated: boolean;
}

/** The product collaborators, resolved by the host adapter or a spec. */
export interface JudgeServices {
  readonly judge: Pick<SkillJudgeService, 'judge'>;
  readonly panel: Pick<JudgePanelService, 'evaluate'>;
  readonly store: Pick<SkillCandidateStore, 'registerCandidate'>;
  /** The product's own `SkillSynthesisService.readSettings()`. */
  readonly settings: SkillSynthesisSettings;
  /** The observer every lane call of `judge` and `panel` goes through. */
  readonly tap: LaneTap;
  /** The installed lane double's mode: `record` reaches the real runner. */
  readonly laneMode: 'record' | 'replay';
}

export interface JudgeAgreementPorts {
  readonly kind: JudgeKind;
  readonly laneMode: 'record' | 'replay';
  readonly minJudgeScore: number;
  readonly tap: LaneTap;
  score(doc: JudgeDocument, signal: AbortSignal): Promise<JudgeReading>;
}

/**
 * Ports over the product services. Each document is registered once through
 * `registerCandidate` (idempotent on `trajectoryHash`) and the stored row is
 * what the judge receives. The gate is forced on (`judgeEnabled: true`): the
 * suite measures the judge whether or not this home switched the gate off;
 * every other setting, `minJudgeScore` included, is the product's.
 */
export function judgeAgreementPorts(
  kind: JudgeKind,
  services: JudgeServices,
): JudgeAgreementPorts {
  const settings: SkillSynthesisSettings = {
    ...services.settings,
    judgeEnabled: true,
  };
  const rows = new Map<string, SkillCandidateRow>();
  const rowOf = (doc: JudgeDocument): SkillCandidateRow => {
    const known = rows.get(doc.opaqueId);
    if (known !== undefined) return known;
    const { candidate } = services.store.registerCandidate({
      name: doc.name,
      description: doc.description,
      bodyPath: doc.path,
      sourceSessionIds: [],
      trajectoryHash: `judge-agreement:${doc.opaqueId}:${doc.sha256}`,
      embedding: null,
      createdAt: CANDIDATE_CREATED_AT,
      workspaceRoot: null,
    });
    rows.set(doc.opaqueId, candidate);
    return candidate;
  };
  return {
    kind,
    laneMode: services.laneMode,
    minJudgeScore: settings.minJudgeScore,
    tap: services.tap,
    async score(doc, signal) {
      const candidate = rowOf(doc);
      if (kind === 'skill-judge') {
        const decision = await services.judge.judge(
          candidate,
          doc.body,
          settings,
        );
        return {
          status: decision.status,
          score: decision.score,
          reason: decision.reason,
          panellists: 1,
          escalated: false,
        };
      }
      const result = await services.panel.evaluate({
        candidate,
        body: doc.body,
        settings,
        signal,
      });
      return {
        status: result.verdict.status,
        score: result.verdict.score,
        reason: result.reason,
        panellists: result.panellists,
        escalated: result.escalated,
      };
    },
  };
}

// ---------------------------------------------------------------- scoring

interface JudgedRun {
  readonly doc: JudgeDocument;
  readonly repeat: number;
  readonly reading: JudgeReading | null;
  readonly calls: readonly LaneCall[];
  readonly record: CaseRecord;
}

interface DocumentSummary {
  readonly doc: JudgeDocument;
  readonly scores: readonly number[];
  readonly mean: number | null;
  readonly sd: number | null;
}

export interface SubsetAgreement {
  readonly items: number;
  readonly spearman: number | null;
  readonly kappa: KappaStatistic | null;
  readonly lengthSpearman: number | null;
  readonly randomSpearman: number | null;
  /** Judge rho minus length rho; `null` when either is undefined. */
  readonly marginOverLength: number | null;
}

function isScored(
  reading: JudgeReading | null,
): reading is JudgeReading & { score: number } {
  return reading?.status === 'scored' && reading.score !== null;
}

function gatePasses(reading: JudgeReading | null, min: number): boolean {
  return isScored(reading) && reading.score >= min;
}

function gateFails(reading: JudgeReading | null, min: number): boolean {
  return isScored(reading) && reading.score < min;
}

function isPositiveControl(doc: JudgeDocument): boolean {
  return doc.stratum === POSITIVE_CONTROL_STRATUM;
}

function isNegativeControl(doc: JudgeDocument): boolean {
  return (
    doc.source === 'planted-negative' ||
    doc.stratum === NEGATIVE_CONTROL_STRATUM
  );
}

interface Expectation {
  readonly expected: string;
  readonly holds: (reading: JudgeReading) => boolean;
}

function expectationOf(
  doc: JudgeDocument,
  truth: RubricGroundTruth,
  min: number,
): Expectation {
  if (isPositiveControl(doc)) {
    return {
      expected: `positive control: scored >= ${min}`,
      holds: (reading) => gatePasses(reading, min),
    };
  }
  if (isNegativeControl(doc)) {
    return {
      expected: `negative control: scored < ${min}`,
      holds: (reading) => gateFails(reading, min),
    };
  }
  const human =
    truth.state === 'loaded' ? truth.consensus.get(doc.opaqueId) : undefined;
  if (human === undefined) {
    return {
      expected: 'a scored verdict (no human label)',
      holds: (reading) => isScored(reading),
    };
  }
  return {
    expected: `judge gate agrees with the human ${human.pass ? 'pass' : 'fail'}`,
    holds: (reading) =>
      isScored(reading) && reading.score >= min === human.pass,
  };
}

function observedOf(reading: JudgeReading, kind: JudgeKind): string {
  const score = reading.score === null ? '' : ` ${reading.score}`;
  const panel =
    kind === 'judge-panel'
      ? `, panellists ${reading.panellists}${reading.escalated ? ', escalated' : ''}`
      : '';
  return `${reading.status}${score} (${reading.reason})${panel}`;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function populationSd(values: readonly number[]): number {
  const centre = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - centre) ** 2)));
}

function summarise(runs: readonly JudgedRun[]): DocumentSummary[] {
  const byDoc = new Map<string, { doc: JudgeDocument; scores: number[] }>();
  for (const run of runs) {
    const entry = byDoc.get(run.doc.opaqueId) ?? { doc: run.doc, scores: [] };
    if (isScored(run.reading)) entry.scores.push(run.reading.score);
    byDoc.set(run.doc.opaqueId, entry);
  }
  return [...byDoc.values()].map(({ doc, scores }) => ({
    doc,
    scores,
    mean: scores.length === 0 ? null : mean(scores),
    sd: scores.length < 2 ? null : populationSd(scores),
  }));
}

/** A seeded uniform score in [0, 1): the random-scorer baseline. */
export function randomScore(seed: string, opaqueId: string): number {
  const digest = createHash('sha256')
    .update(`${seed}:${opaqueId}`, 'utf8')
    .digest();
  return digest.readUInt32BE(0) / 2 ** 32;
}

function subsetAgreement(
  summaries: readonly DocumentSummary[],
  truth: LoadedRubricGroundTruth | null,
  options: { seed: string; min: number },
): SubsetAgreement {
  const items = summaries.flatMap((summary) => {
    const human = truth?.consensus.get(summary.doc.opaqueId);
    return summary.mean === null || human === undefined
      ? []
      : [{ id: summary.doc.opaqueId, judge: summary.mean, human, summary }];
  });
  const map = <T>(pick: (item: (typeof items)[number]) => T) =>
    Object.fromEntries(items.map((item) => [item.id, pick(item)]));
  const humanTotals = map((item) => item.human.total);
  const spearman = spearmanRho(
    map((item) => item.judge),
    humanTotals,
  ).value;
  const lengthSpearman = spearmanRho(
    map((item) => item.summary.doc.bodyChars),
    humanTotals,
  ).value;
  const randomSpearman = spearmanRho(
    map((item) => randomScore(options.seed, item.id)),
    humanTotals,
  ).value;
  return {
    items: items.length,
    spearman,
    kappa:
      items.length === 0
        ? null
        : cohenKappa(
            map((item) => item.judge >= options.min),
            map((item) => item.human.pass),
            { ...RUBRIC_BOOTSTRAP, seed: options.seed },
          ),
    lengthSpearman,
    randomSpearman,
    marginOverLength:
      spearman === null || lengthSpearman === null
        ? null
        : spearman - lengthSpearman,
  };
}

function subsetMetrics(
  prefix: string,
  subset: SubsetAgreement,
): Record<string, number | null> {
  return {
    [`${prefix}.items`]: subset.items,
    [`${prefix}.spearman`]: subset.spearman,
    [`${prefix}.kappa`]: subset.kappa?.value ?? null,
    [`${prefix}.kappa.ci95.low`]: subset.kappa?.interval?.[0] ?? null,
    [`${prefix}.kappa.ci95.high`]: subset.kappa?.interval?.[1] ?? null,
    [`${prefix}.lengthSpearman`]: subset.lengthSpearman,
    [`${prefix}.randomSpearman`]: subset.randomSpearman,
    [`${prefix}.marginOverLength`]: subset.marginOverLength,
  };
}

function informative(subset: SubsetAgreement): boolean {
  return (
    subset.marginOverLength !== null &&
    subset.marginOverLength >= INFORMATIVE_MARGIN
  );
}

function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * The rubric each scoring started from: the system prompt of the FIRST lane
 * call of every judged run (the single judge, or the panel's first panellist).
 * Later panel calls carry a per-document lens and are not the pin.
 */
function rubricPin(runs: readonly JudgedRun[]): {
  sha256: string;
  distinct: number;
} {
  const distinct = [
    ...new Set(
      runs
        .map((run) => run.calls[0]?.systemPromptSha256)
        .filter((sha): sha is string => sha !== undefined),
    ),
  ].sort();
  return {
    sha256:
      distinct.length === 1 ? distinct[0] : sha256Text(distinct.join('\n')),
    distinct: distinct.length,
  };
}

function modelProblem(
  calls: readonly LaneCall[],
  options: JudgeAgreementOptions,
): string | null {
  const pinOf = (laneId: string): string =>
    laneId === 'synthesis'
      ? (options.escalationModel ?? options.model)
      : options.model;
  const reported = calls.filter((call) => call.model !== null);
  if (reported.length === 0) return 'no lane call reported a model';
  const off = [
    ...new Set(
      reported
        .filter((call) => call.model !== pinOf(call.laneId))
        .map((call) => `${call.laneId}=${call.model}`),
    ),
  ].sort();
  return off.length === 0
    ? null
    : `lane reported ${off.join(', ')}; the plan pins ${options.model}${options.escalationModel === undefined ? '' : ` (escalation ${options.escalationModel})`}`;
}

function documentMismatch(
  corpus: readonly JudgeDocument[],
  truth: LoadedRubricGroundTruth,
): number {
  const judged = new Map(
    corpus
      .filter((doc) => doc.source === 'labelled')
      .map((doc) => [doc.opaqueId, doc.sha256]),
  );
  let mismatched = 0;
  for (const doc of truth.documents) {
    if (judged.get(doc.opaqueId) !== doc.sha256) mismatched += 1;
    judged.delete(doc.opaqueId);
  }
  return mismatched + judged.size;
}

export interface JudgeAgreementInput {
  readonly suiteId: string;
  readonly runDir: string;
  readonly options: JudgeAgreementOptions;
  readonly corpus: readonly JudgeDocument[];
  readonly truth: RubricGroundTruth;
  readonly ports: JudgeAgreementPorts;
  /** Per-call safety cap; default the runner's 120 s. */
  readonly capMs?: number;
}

export interface JudgeAgreementOutput {
  readonly result: SuiteResultInput;
  readonly cases: CaseRecord[];
  /** Raw per-call outputs, inside `runDir` (bench data folder). */
  readonly rawPath: string;
}

/** Judge every document `repeats` times and score the judge against humans. */
export async function runJudgeAgreement(
  input: JudgeAgreementInput,
): Promise<JudgeAgreementOutput> {
  const { options, ports, truth } = input;
  const min = ports.minJudgeScore;
  const rawPath = join(input.runDir, 'raw', `${input.suiteId}.jsonl`);
  mkdirSync(join(input.runDir, 'raw'), { recursive: true });
  // Created once; an earlier run's raw outputs are never overwritten.
  writeFileSync(rawPath, '', { encoding: 'utf8', flag: 'wx' });

  const runs: JudgedRun[] = [];
  for (const doc of input.corpus) {
    const expectation = expectationOf(doc, truth, min);
    for (let repeat = 1; repeat <= options.repeats; repeat += 1) {
      const before = ports.tap.calls.length;
      const recorded = await recordCase(
        `${doc.opaqueId}/r${repeat}`,
        {
          suiteId: input.suiteId,
          opaqueId: doc.opaqueId,
          sha256: doc.sha256,
          repeat,
        },
        expectation.expected,
        async (signal) => {
          const reading = await ports.score(doc, signal);
          return {
            value: reading,
            verdict: {
              expected: expectation.expected,
              observed: observedOf(reading, ports.kind),
              outcome: expectation.holds(reading) ? 'pass' : 'fail',
            },
          };
        },
        input.capMs,
      );
      const calls = ports.tap.calls.slice(before);
      const run: JudgedRun = {
        doc,
        repeat,
        reading: recorded.value,
        calls,
        record: { ...recorded.record, cassetteKey: null },
      };
      runs.push(run);
      appendFileSync(
        rawPath,
        `${JSON.stringify({
          opaqueId: doc.opaqueId,
          source: doc.source,
          stratum: doc.stratum,
          repeat,
          reading: run.reading,
          latencyMs: run.record.latencyMs,
          error: run.record.error ?? null,
          calls,
        })}\n`,
        'utf8',
      );
    }
  }

  const completed = runs.filter((run) => run.reading !== null);
  const errored = runs.length - completed.length;
  const positive = completed.filter((run) => isPositiveControl(run.doc));
  const negative = completed.filter((run) => isNegativeControl(run.doc));
  const positiveRate = rate(
    positive.filter((run) => gatePasses(run.reading, min)).length,
    positive.length,
  );
  const negativeRate = rate(
    negative.filter((run) => gateFails(run.reading, min)).length,
    negative.length,
  );
  const scoredRuns = completed.filter((run) => isScored(run.reading));
  const saturation = rate(
    scoredRuns.filter((run) => run.reading?.score === SATURATED_SCORE).length,
    scoredRuns.length,
  );
  const summaries = summarise(runs).filter(
    (summary) => summary.doc.source === 'labelled',
  );
  const sds = summaries
    .map((summary) => summary.sd)
    .filter((sd): sd is number => sd !== null);
  const meanRepeatSd = sds.length === 0 ? null : mean(sds);
  const loaded = truth.state === 'loaded' ? truth : null;
  const subsetOptions = { seed: options.seed, min };
  const all = subsetAgreement(summaries, loaded, subsetOptions);
  const withoutAnchor = subsetAgreement(
    summaries.filter((summary) => summary.doc.stratum !== ANCHOR_STRATUM),
    loaded,
    subsetOptions,
  );
  const calls = ports.tap.calls;
  const pin = rubricPin(runs);

  const panelRates: Record<string, Rate> =
    ports.kind === 'judge-panel'
      ? {
          'panel.singlePanellist': rate(
            completed.filter((run) => run.reading?.panellists === 1).length,
            completed.length,
          ),
          'panel.escalated': rate(
            completed.filter((run) => run.reading?.escalated === true).length,
            completed.length,
          ),
        }
      : {};
  const metrics: Record<string, number | null> = {
    minJudgeScore: min,
    repeats: options.repeats,
    'documents.labelled': summaries.length,
    'documents.planted': input.corpus.filter(
      (doc) => doc.source === 'planted-negative',
    ).length,
    'calls.total': calls.length,
    'runs.errored': errored,
    ...rateMetrics('positiveControl.passRate', positiveRate),
    ...rateMetrics('negativeControl.failRate', negativeRate),
    ...rateMetrics('saturationShare', saturation),
    ...rateMetrics(
      'unscoredShare',
      rate(completed.length - scoredRuns.length, completed.length),
    ),
    meanRepeatSd,
    'promptPin.distinct': pin.distinct,
    ...subsetMetrics('all', all),
    ...subsetMetrics('withoutAnchor', withoutAnchor),
    ...Object.fromEntries(
      Object.entries(panelRates).flatMap(([name, value]) =>
        Object.entries(rateMetrics(name, value)),
      ),
    ),
  };

  const baselines: SuiteResultInput['baselines'] = [
    {
      id: 'score-by-length',
      label: 'body characters as the score (design 4.3)',
      metrics: {
        'all.spearman': all.lengthSpearman,
        'withoutAnchor.spearman': withoutAnchor.lengthSpearman,
      },
    },
    {
      id: 'random-scorer',
      label: `seeded uniform random score (${options.seed})`,
      metrics: {
        'all.spearman': all.randomSpearman,
        'withoutAnchor.spearman': withoutAnchor.randomSpearman,
      },
    },
  ];

  const docMismatch =
    loaded === null ? 0 : documentMismatch(input.corpus, loaded);
  const models = modelProblem(calls, options);
  const naReason =
    groundTruthNaReason(truth) ??
    (docMismatch > 0
      ? `ground-truth-untrusted: ${docMismatch} documents differ between the labels and the judged packet`
      : null) ??
    (ports.laneMode === 'replay'
      ? 'lane-runner-replay: the judge outputs come from a cassette, not the real lane runner'
      : null) ??
    (errored > 0
      ? `judge-calls-errored: ${errored} of ${runs.length} judged runs threw or hit the safety cap`
      : null) ??
    (models === null ? null : `model-not-pinned: ${models}`) ??
    (pin.distinct !== 1
      ? `prompt-not-pinned: ${pin.distinct} distinct judge rubrics observed`
      : null) ??
    (options.promptSha256 !== undefined && options.promptSha256 !== pin.sha256
      ? `prompt-drift: judge rubric sha256 ${pin.sha256}, pinned ${options.promptSha256}`
      : null);
  const scored =
    positiveRate.value !== null &&
    positiveRate.value >= CONTROL_RATE_BAR &&
    negativeRate.value !== null &&
    negativeRate.value >= CONTROL_RATE_BAR &&
    informative(all) &&
    informative(withoutAnchor);
  const verdict: SuiteResultInput['verdict'] =
    naReason !== null ? 'na' : scored ? 'pass' : 'fail';

  const details: RubricDetails = {
    mode: 'judge-vs-human',
    judge: ports.kind,
    model: options.model,
    promptSha256: pin.sha256,
    repeats: options.repeats,
    spearman: all.spearman,
    kappa: all.kappa?.value ?? null,
    meanRepeatSd,
    saturationShare: saturation.value,
    positiveControl: { n: positiveRate.den, passRate: positiveRate.value },
    negativeControl: { n: negativeRate.den, failRate: negativeRate.value },
    baselines: {
      lengthSpearman: all.lengthSpearman,
      randomSpearman: all.randomSpearman,
    },
  };
  const cases = runs.map((run) => run.record);
  return {
    rawPath,
    cases,
    result: {
      suiteId: input.suiteId,
      kind: 'rubric',
      details,
      claim:
        ports.kind === 'skill-judge'
          ? {
              source: 'code',
              ref: 'libs/backend/skill-synthesis/src/lib/skill-judge.service.ts:121-132',
              text: 'The judge gate passes good skills and fails bad ones: its scores track human rubric totals better than body length does.',
            }
          : {
              source: 'code',
              ref: 'libs/backend/skill-synthesis/src/lib/gates/judge-panel.service.ts:261-413',
              text: 'The judge panel passes good skills and fails bad ones: its verdicts track human rubric totals better than body length does.',
            },
      groundTruth: {
        id: RUBRIC_GROUND_TRUTH_ID,
        version: RUBRIC_GROUND_TRUTH_VERSION,
        method: 'labelled',
        ...(loaded === null ? {} : { raterCount: 2 }),
      },
      baselines,
      deltas: Object.fromEntries(
        baselines.map((baseline) => [
          baseline.id,
          deltaOf(metrics, baseline.metrics),
        ]),
      ),
      cost: costOf(cases, calls.length),
      modelCalls: calls.length,
      verdict,
      ...(naReason === null ? {} : { naReason }),
      metrics,
      cassetteVersion: null,
    },
  };
}

// ---------------------------------------------------------------- host suites

export interface JudgeAgreementSuiteDeps {
  /** Host adapter (`judge-agreement-ports.ts`); specs pass their own. */
  readonly resolveServices: (
    context: MemorySkillsHostSuiteContext,
  ) => JudgeServices;
}

function homeReader(home: string, dir: string) {
  return (name: string): Buffer | null => {
    const path = resolveHomeFile(home, join(dir, name));
    return existsSync(path) ? readFileSync(path) : null;
  };
}

/** Both suites; registered in the host entry's `HOST_SUITES`, local plans only. */
export function createJudgeAgreementSuites(
  deps: JudgeAgreementSuiteDeps,
): MemorySkillsHostSuite[] {
  const suites: [string, JudgeKind][] = [
    [JUDGE_AGREEMENT_SUITE_ID, 'skill-judge'],
    [JUDGE_PANEL_AGREEMENT_SUITE_ID, 'judge-panel'],
  ];
  return suites.map(([id, kind]) => ({
    id,
    // Registers one candidate row per judged document in the shared database.
    placement: 'last',
    async run(context: MemorySkillsHostSuiteContext) {
      if (context.ci) {
        throw new Error(
          `${id} is local-only: an LLM judge's accuracy never gates CI`,
        );
      }
      const options = judgeAgreementOptionsSchema.parse(context.options ?? {});
      const home = context.isolation.home;
      const corpus = loadJudgeCorpus({
        documentsDir: resolveHomeFile(home, options.documentsDir),
        idMapFile: resolveHomeFile(home, options.idMapFile),
        plantedNegativesDir: resolveHomeFile(home, options.plantedNegativesDir),
      });
      const truth = loadRubricGroundTruth(
        homeReader(home, options.groundTruthDir),
        { raters: options.raters },
      );
      const ports = judgeAgreementPorts(kind, deps.resolveServices(context));
      const { result, cases } = await runJudgeAgreement({
        suiteId: id,
        runDir: context.runDir,
        options,
        corpus,
        truth,
        ports,
      });
      writeSuiteResult(context.runDir, result, cases);
    },
  }));
}
