/**
 * Runs one retrieval suite and scores it into the Task 4b.1 generic scorecard
 * shape (`kind: 'retrieval'`, `claim`, `groundTruth`, `baselines[]` with
 * `native` as one baseline id, `deltas`, `cost` with `cost.source`).
 *
 * A suite runs in two phases the CLI keeps apart: {@link runNativeBaselines}
 * before any host exists (so the scripted rg/glob/read baselines never compete
 * with the host for the CPU, and never see a spool file the tools wrote into
 * the corpus), then {@link runToolQuestions} over the MCP transport.
 * {@link assembleSuite} scores both with the same metrics and tokenizer.
 *
 * Scoring rules (batches.md Task 9.1):
 * - A call that errored (transport, RPC, tool error, `building`,
 *   `unavailable`, `unknown` coverage) or whose text could not be parsed is an
 *   error, never zero hits: it counts in `cost.error_rate`, and it scores 0 on
 *   every quality metric (an error is not a correct abstention either).
 * - A tool that `tools/list` does not show on this host fails the suite with
 *   "tool not exposed on this host" (mechanism: none). It is never `na`.
 * - Verdict `fail` when the error rate is over 1 %, when the primary quality
 *   metric is below the deciding native baseline by more than the noise
 *   margin, or when a suite-specific claim check fails. A failed lifecycle
 *   scenario of the tool also fails it (applied by the CLI after lifecycle).
 * - Deltas are sign-normalised: positive always means the tool is better
 *   (quality: tool − baseline; tokens, calls, latency: baseline − tool).
 */

import type { NativeResult } from '../baselines/native-baselines';
import { p50Latency, p95Latency, resultTokens } from '../metrics/cost-metrics';
import {
  type Answer,
  type Truth,
  hitAt1,
  hitAt5,
  meanReciprocalRank,
  ndcgAtK,
  precision,
  recallAtAll,
  recallAtK,
  strictAccuracyAtK,
} from '../metrics/retrieval-metrics';
import type { ScorecardSuite } from '../scorecard/scorecard.types';
import {
  CallRecorder,
  NO_RETRY,
  type RecordedCall,
  type RetryPolicy,
} from '../transport/call-recorder';
import type { McpToolCaller } from '../transport/mcp-client';
import type { GroundTruthRef } from './question-sets';

/**
 * Allowed drop of the primary metric below native when no measured margin is
 * stored (`baseline/noise-margins.json`, Task 10.1) and no `--noise-margin`
 * is given.
 */
export const NOISE_MARGIN = 0.02;
/** Error rate above which a suite fails. */
export const MAX_ERROR_RATE = 0.01;
/** At most this many failed questions are listed per suite. */
const MAX_LISTED_FAILURES = 25;
const LISTED_ITEMS = 10;

export const QUALITY_METRICS = [
  'hit@1',
  'hit@5',
  'mrr',
  'recall@10',
  'recall_all',
  'precision',
  'acc_at_k',
  'ndcg_at_k',
] as const;
export type QualityMetric = (typeof QUALITY_METRICS)[number];
type QualityValues = Record<QualityMetric, number | null>;

/** The text of a tool result could not be read as an answer; scored as an error. */
export class ToolResultParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolResultParseError';
  }
}

export interface SuiteClaim {
  readonly source: 'prompt' | 'tool-description' | 'ledger' | 'code';
  readonly ref: string;
  readonly text?: string;
}

/** One native baseline of a suite (Batch 8). */
export interface NativeBaselineDefinition<Q> {
  readonly id: string;
  readonly label: string;
  run(question: Q): Promise<NativeResult>;
  /** The baseline the verdict compares the primary metric with (`native`). */
  readonly decides: boolean;
  /** Its answers are scored for quality; `false` for a cost-only or comparison view. */
  readonly scored: boolean;
  /** Maps the native answer to the suite's granularity (file vs `file:line`). */
  mapAnswer?(answer: Answer, question: Q): Answer;
}

/** A {@link NativeBaselineDefinition}: deciding and scored unless `options` says otherwise. */
export function nativeBaseline<Q>(
  id: string,
  label: string,
  run: (question: Q) => ReturnType<NativeBaselineDefinition<Q>['run']>,
  options: Partial<
    Pick<NativeBaselineDefinition<Q>, 'decides' | 'scored' | 'mapAnswer'>
  > = {},
): NativeBaselineDefinition<Q> {
  return {
    id,
    label,
    run,
    decides: options.decides ?? true,
    scored: options.scored ?? true,
    ...(options.mapAnswer ? { mapAnswer: options.mapAnswer } : {}),
  };
}

/** A breakdown of a suite over a subset of its questions; reported, never deciding. */
export interface SuiteBreakdown<Q> {
  readonly arm: string;
  filter(question: Q): boolean;
  naReason(count: number, total: number): string;
}

export interface FailureEntry {
  readonly question: string;
  readonly expected: string[];
  readonly got: string[];
}

export interface ToolSuiteDefinition<Q extends { readonly id: string }> {
  /** Stable suite id (`symbols-exact`, `references-python-attrs`, …). */
  readonly id: string;
  readonly tool: string;
  readonly claim: SuiteClaim;
  readonly groundTruth: GroundTruthRef;
  readonly primaryMetric: QualityMetric;
  readonly questions: readonly Q[];
  /** Questions in the frozen file, before a `--smoke` sample. */
  readonly questionsInFile: number;
  truth(question: Q): Truth;
  args(question: Q): Record<string, unknown>;
  /** The `/workspace/{root}` the call is made for; default: the corpus root. */
  workspaceRoot?(question: Q): string;
  /** Reads the result text as an answer; throws {@link ToolResultParseError}. */
  parse(text: string, question: Q): Answer;
  readonly natives: readonly NativeBaselineDefinition<Q>[];
  readonly retry?: RetryPolicy;
  /** Called after each scored call, e.g. to probe another argument form. */
  afterAnswer?(question: Q, caller: McpToolCaller): Promise<void>;
  /** Suite-specific claim checks over the scored records; each string fails the suite. */
  claimChecks?(records: readonly QuestionRecord<Q>[]): string[];
  /** Extra sign-normalised deltas per baseline id (merged into `deltas`). */
  extraDeltas?(
    records: readonly QuestionRecord<Q>[],
  ): Record<string, Record<string, number | null>>;
  /** Findings to list with the failures (they do not change the verdict). */
  findings?(): FailureEntry[];
  readonly breakdowns?: readonly SuiteBreakdown<Q>[];
  /** The whole suite is `na` (tool not implemented, frozen `na` record). */
  readonly naReason?: string;
}

export interface NativeOutcome {
  readonly result: NativeResult;
  readonly answer: Answer;
  readonly tokens: number;
}

export type NativeOutcomes = ReadonlyMap<
  string,
  ReadonlyMap<string, NativeOutcome>
>;

export interface ToolOutcome {
  readonly answer: Answer;
  /** Every attempt (retries included) made for the question. */
  readonly attempts: readonly RecordedCall[];
  /** Why the answer is an error, or `null`. */
  readonly error: string | null;
  readonly truncated: boolean;
  /** Tokens of the final result text, when the tool returned one. */
  readonly tokens: number | null;
}

/** Everything known about one question after both phases. */
export interface QuestionRecord<Q> {
  readonly question: Q;
  readonly truth: Truth;
  readonly tool: ToolOutcome | null;
  readonly natives: ReadonlyMap<string, NativeOutcome>;
}

export interface ToolRunContext {
  /** Tools `tools/list` advertised on this host. */
  readonly listedTools: ReadonlySet<string>;
  /** The client for a `/workspace/{root}`; the same root yields the same client. */
  callerFor(workspaceRoot: string): McpToolCaller;
  readonly corpusRoot: string;
  log(line: string): void;
}

const ERRORED_ANSWER: Answer = { ranked: [], abstained: false };

/** Phase 1: every native baseline of the suite, question by question. */
export async function runNativeBaselines<Q extends { readonly id: string }>(
  definition: ToolSuiteDefinition<Q>,
  log: (line: string) => void = () => undefined,
): Promise<NativeOutcomes> {
  const outcomes = new Map<string, Map<string, NativeOutcome>>();
  if (definition.naReason !== undefined) return outcomes;
  for (const native of definition.natives) {
    log(
      `[native] ${definition.id} ${native.id}: ${definition.questions.length} questions`,
    );
    for (const question of definition.questions) {
      const result = await native.run(question);
      const answer = native.mapAnswer
        ? native.mapAnswer(result.answer, question)
        : result.answer;
      const perQuestion = outcomes.get(question.id) ?? new Map();
      perQuestion.set(native.id, {
        result,
        answer: result.error === null ? answer : ERRORED_ANSWER,
        tokens: resultTokens(result.resultText),
      });
      outcomes.set(question.id, perQuestion);
    }
  }
  return outcomes;
}

/**
 * Phase 2: ask every question over the transport. Returns `null` when the
 * suite makes no call (tool not listed, or the suite is `na`).
 */
export async function runToolQuestions<Q extends { readonly id: string }>(
  definition: ToolSuiteDefinition<Q>,
  context: ToolRunContext,
): Promise<ReadonlyMap<string, ToolOutcome> | null> {
  if (definition.naReason !== undefined) return null;
  if (!context.listedTools.has(definition.tool)) return null;
  const recorders = new Map<string, CallRecorder>();
  const recorderFor = (root: string): CallRecorder => {
    let recorder = recorders.get(root);
    if (recorder === undefined) {
      recorder = new CallRecorder(context.callerFor(root), {
        workspaceRoot: root,
      });
      recorders.set(root, recorder);
    }
    return recorder;
  };
  const outcomes = new Map<string, ToolOutcome>();
  context.log(
    `[tool] ${definition.id} ${definition.tool}: ${definition.questions.length} questions`,
  );
  for (const question of definition.questions) {
    const root = definition.workspaceRoot?.(question) ?? context.corpusRoot;
    const recorded = await recorderFor(root).answer(
      definition.tool,
      definition.args(question),
      definition.retry ?? NO_RETRY,
    );
    outcomes.set(
      question.id,
      scoreAttempt(definition, question, recorded.attempts),
    );
    await definition.afterAnswer?.(question, context.callerFor(root));
  }
  return outcomes;
}

function scoreAttempt<Q extends { readonly id: string }>(
  definition: ToolSuiteDefinition<Q>,
  question: Q,
  attempts: readonly RecordedCall[],
): ToolOutcome {
  const final = attempts[attempts.length - 1];
  const tokens =
    final.errorClass === 'transport' || final.errorClass === 'rpc-error'
      ? null
      : resultTokens(final.text);
  if (final.errored) {
    return {
      answer: ERRORED_ANSWER,
      attempts,
      error: `${final.errorClass}: ${final.text.slice(0, 200)}`,
      truncated: final.truncated,
      tokens,
    };
  }
  try {
    return {
      answer: definition.parse(final.text, question),
      attempts,
      error: null,
      truncated: final.truncated,
      tokens,
    };
  } catch (error: unknown) {
    if (!(error instanceof ToolResultParseError)) throw error;
    return {
      answer: ERRORED_ANSWER,
      attempts,
      error: `parse: ${error.message}`,
      truncated: final.truncated,
      tokens,
    };
  }
}

/** Mean of each quality metric over the pairs; `null` for an empty set. */
export function qualityMetrics(
  pairs: readonly { readonly answer: Answer; readonly truth: Truth }[],
  k = 10,
): QualityValues {
  const mean = (
    score: (answer: Answer, truth: Truth) => number,
  ): number | null =>
    pairs.length === 0
      ? null
      : round(
          pairs.reduce((sum, pair) => sum + score(pair.answer, pair.truth), 0) /
            pairs.length,
        );
  return {
    'hit@1': mean(hitAt1),
    'hit@5': mean(hitAt5),
    mrr: mean(meanReciprocalRank),
    'recall@10': mean((answer, truth) => recallAtK(answer, truth, 10)),
    recall_all: mean(recallAtAll),
    precision: mean(precision),
    acc_at_k: mean((answer, truth) => strictAccuracyAtK(answer, truth, k)),
    ndcg_at_k: mean((answer, truth) => ndcgAtK(answer, truth, k)),
  };
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function median(values: readonly number[]): number | null {
  const value = p50Latency(values);
  return value === undefined ? null : round(value);
}

function percentile95(values: readonly number[]): number | null {
  const value = p95Latency(values);
  return value === undefined ? null : round(value);
}

function nativeMetrics<Q>(
  native: NativeBaselineDefinition<Q>,
  records: readonly QuestionRecord<Q>[],
): Record<string, number | null> {
  const outcomes = records.flatMap((record) => {
    const outcome = record.natives.get(native.id);
    return outcome === undefined ? [] : [{ outcome, truth: record.truth }];
  });
  const quality = native.scored
    ? qualityMetrics(
        outcomes.map(({ outcome, truth }) => ({
          answer: outcome.answer,
          truth,
        })),
      )
    : {};
  const errored = outcomes.filter(
    ({ outcome }) => outcome.result.error !== null,
  );
  return {
    ...quality,
    result_tokens_p50: median(outcomes.map(({ outcome }) => outcome.tokens)),
    calls_per_answer:
      outcomes.length === 0
        ? null
        : round(
            outcomes.reduce(
              (sum, { outcome }) => sum + outcome.result.commands,
              0,
            ) / outcomes.length,
          ),
    latency_ms_p50: median(
      outcomes.map(({ outcome }) => outcome.result.latencyMs),
    ),
    latency_ms_p95: percentile95(
      outcomes.map(({ outcome }) => outcome.result.latencyMs),
    ),
    error_rate:
      outcomes.length === 0 ? null : round(errored.length / outcomes.length),
  };
}

interface ToolSide {
  readonly quality: QualityValues;
  readonly truncationRate: number | null;
  readonly calls: number;
  readonly answers: number;
  readonly errorRate: number | null;
  readonly latencyP50: number | null;
  readonly latencyP95: number | null;
  readonly tokensP50: number | null;
}

function toolSide<Q>(records: readonly QuestionRecord<Q>[]): ToolSide | null {
  const asked = records.filter((record) => record.tool !== null);
  if (asked.length === 0) return null;
  const outcomes = asked.map((record) => record.tool as ToolOutcome);
  const calls = outcomes.flatMap((outcome) => outcome.attempts);
  return {
    quality: qualityMetrics(
      asked.map((record) => ({
        answer: (record.tool as ToolOutcome).answer,
        truth: record.truth,
      })),
    ),
    truncationRate: round(
      outcomes.filter((outcome) => outcome.truncated).length / outcomes.length,
    ),
    calls: calls.length,
    answers: outcomes.length,
    errorRate: round(
      outcomes.filter((outcome) => outcome.error !== null).length /
        outcomes.length,
    ),
    latencyP50: median(calls.map((call) => call.wallMs)),
    latencyP95: percentile95(calls.map((call) => call.wallMs)),
    tokensP50: median(
      outcomes.flatMap((outcome) =>
        outcome.tokens === null ? [] : [outcome.tokens],
      ),
    ),
  };
}

function deltasFor(
  tool: ToolSide | null,
  baseline: Record<string, number | null>,
  scored: boolean,
): Record<string, number | null> {
  const difference = (
    toolValue: number | null | undefined,
    baseValue: number | null | undefined,
    lowerIsBetter: boolean,
  ): number | null =>
    toolValue === null ||
    toolValue === undefined ||
    baseValue === null ||
    baseValue === undefined
      ? null
      : round(lowerIsBetter ? baseValue - toolValue : toolValue - baseValue);
  const deltas: Record<string, number | null> = {};
  if (scored)
    for (const metric of QUALITY_METRICS)
      deltas[metric] = difference(
        tool?.quality[metric],
        baseline[metric],
        false,
      );
  deltas['result_tokens_p50'] = difference(
    tool?.tokensP50,
    baseline['result_tokens_p50'],
    true,
  );
  deltas['calls_per_answer'] = difference(
    tool === null || tool.answers === 0
      ? null
      : round(tool.calls / tool.answers),
    baseline['calls_per_answer'],
    true,
  );
  deltas['latency_ms_p50'] = difference(
    tool?.latencyP50,
    baseline['latency_ms_p50'],
    true,
  );
  return deltas;
}

function listFailures<Q extends { readonly id: string }>(
  definition: ToolSuiteDefinition<Q>,
  records: readonly QuestionRecord<Q>[],
): FailureEntry[] {
  const failures: FailureEntry[] = [];
  const listedNativeErrors = new Set<string>();
  for (const record of records) {
    if (failures.length >= MAX_LISTED_FAILURES) break;
    if (record.tool === null) continue;
    const { answer, error } = record.tool;
    const score = qualityMetrics([{ answer, truth: record.truth }])[
      definition.primaryMetric
    ];
    if (error === null && score === 1) continue;
    failures.push({
      question: record.question.id,
      expected: record.truth.abstain
        ? ['(abstain)']
        : record.truth.items.slice(0, LISTED_ITEMS),
      got:
        error !== null
          ? [`error: ${error}`]
          : answer.abstained
            ? ['(abstained)']
            : answer.ranked.slice(0, LISTED_ITEMS),
    });
  }
  for (const record of records) {
    if (failures.length >= MAX_LISTED_FAILURES) break;
    for (const native of definition.natives) {
      if (failures.length >= MAX_LISTED_FAILURES) break;
      const outcome = record.natives.get(native.id);
      if (outcome === undefined || outcome.result.error === null) continue;
      const errorKey = `${native.id}\u0000${outcome.result.error}`;
      if (listedNativeErrors.has(errorKey)) continue;
      listedNativeErrors.add(errorKey);
      failures.push({
        question: record.question.id,
        expected: record.truth.abstain
          ? ['(abstain)']
          : record.truth.items.slice(0, LISTED_ITEMS),
        got: [`native ${native.id} error: ${outcome.result.error}`],
      });
    }
  }
  return failures;
}

function toolMetricsBlock(
  tool: ToolSide | null,
): Record<string, number | null> {
  return {
    ...(tool?.quality ??
      Object.fromEntries(QUALITY_METRICS.map((metric) => [metric, null]))),
    truncation_rate: tool?.truncationRate ?? null,
  };
}

/** What the CLI knows beyond the two phases. */
export interface AssembleOptions {
  readonly listedTools: ReadonlySet<string>;
  /** Override for the noise margin (`--noise-margin`). */
  readonly noiseMargin?: number;
  /**
   * Why the suite could not be measured (its host failed to start or a
   * baseline broke). The suite fails with this reason; what was measured
   * before the failure is kept.
   */
  readonly failure?: string;
}

/**
 * Scores one suite: the deciding suite first, then one `na` breakdown suite
 * per {@link SuiteBreakdown}.
 */
export function assembleSuite<Q extends { readonly id: string }>(
  definition: ToolSuiteDefinition<Q>,
  natives: NativeOutcomes,
  tools: ReadonlyMap<string, ToolOutcome> | null,
  options: AssembleOptions,
): ScorecardSuite[] {
  const records: QuestionRecord<Q>[] = definition.questions.map((question) => ({
    question,
    truth: definition.truth(question),
    tool: tools?.get(question.id) ?? null,
    natives: natives.get(question.id) ?? new Map(),
  }));
  if (definition.naReason !== undefined) {
    return [
      suiteRecord(definition, records, null, {
        verdict: 'na',
        naReason: definition.naReason,
        extraFailures: [],
      }),
    ];
  }
  const listed = options.listedTools.has(definition.tool);
  const decider = definition.natives.find(
    (native) => native.decides && native.scored,
  );
  const tool = listed ? toolSide(records) : null;
  const reasons: string[] = [];
  if (options.failure !== undefined) {
    reasons.push(options.failure);
  } else if (!listed) {
    reasons.push(
      `tool not exposed on this host (mechanism: none): ${definition.tool} is not in tools/list`,
    );
  } else {
    if (decider !== undefined) {
      const baselineErrorRate = nativeMetrics(decider, records)['error_rate'];
      if (
        baselineErrorRate !== null &&
        baselineErrorRate > MAX_ERROR_RATE
      )
        reasons.push(
          `deciding baseline ${decider.id} error rate ${baselineErrorRate} is over ${MAX_ERROR_RATE}`,
        );
    }
    if (tool !== null) {
      if (tool.errorRate !== null && tool.errorRate > MAX_ERROR_RATE)
        reasons.push(`error rate ${tool.errorRate} is over ${MAX_ERROR_RATE}`);
      if (decider !== undefined) {
        const baseValue = nativeMetrics(decider, records)[
          definition.primaryMetric
        ];
        const toolValue = tool.quality[definition.primaryMetric];
        const margin = options.noiseMargin ?? NOISE_MARGIN;
        if (
          toolValue !== null &&
          baseValue !== null &&
          baseValue !== undefined &&
          toolValue < baseValue - margin
        )
          reasons.push(
            `${definition.primaryMetric} ${toolValue} is below ${decider.id} ${baseValue} by more than ${margin}`,
          );
      }
    }
    reasons.push(...(definition.claimChecks?.(records) ?? []));
  }
  const main = suiteRecord(definition, records, tool, {
    verdict: reasons.length > 0 ? 'fail' : 'pass',
    extraFailures: [
      ...reasons.map((reason) => ({
        question: '(verdict)',
        expected: [`${definition.tool} meets its claim`],
        got: [reason],
      })),
      ...(definition.findings?.() ?? []),
    ],
  });
  const views = (definition.breakdowns ?? []).map((breakdown) => {
    const subset = records.filter((record) =>
      breakdown.filter(record.question),
    );
    return suiteRecord(
      { ...definition, questions: subset.map((record) => record.question) },
      subset,
      listed ? toolSide(subset) : null,
      {
        verdict: 'na',
        naReason: breakdown.naReason(subset.length, records.length),
        arm: breakdown.arm,
        extraFailures: [],
      },
    );
  });
  return [main, ...views];
}

/** Names the metric and native baseline that decide the suite, so the gate re-reads the same comparison. */
function decidingFields<Q extends { readonly id: string }>(
  definition: ToolSuiteDefinition<Q>,
): { primaryMetric?: QualityMetric; decidingBaseline?: string } {
  const decider = definition.natives.find(
    (native) => native.decides && native.scored,
  );
  return decider === undefined
    ? { primaryMetric: definition.primaryMetric }
    : {
        primaryMetric: definition.primaryMetric,
        decidingBaseline: decider.id,
      };
}

function suiteRecord<Q extends { readonly id: string }>(
  definition: ToolSuiteDefinition<Q>,
  records: readonly QuestionRecord<Q>[],
  tool: ToolSide | null,
  outcome: {
    readonly verdict: 'pass' | 'fail' | 'na';
    readonly naReason?: string;
    readonly arm?: string;
    readonly extraFailures: readonly FailureEntry[];
  },
): ScorecardSuite {
  const baselines = definition.natives.map((native) => ({
    id: native.id,
    label: native.label,
    metrics: nativeMetrics(native, records),
  }));
  const deltas: Record<string, Record<string, number | null>> = {};
  for (const [index, native] of definition.natives.entries())
    deltas[native.id] = deltasFor(
      tool,
      baselines[index].metrics,
      native.scored,
    );
  for (const [id, extra] of Object.entries(
    outcome.verdict === 'na' && outcome.arm === undefined
      ? {}
      : (definition.extraDeltas?.(records) ?? {}),
  ))
    if (deltas[id] !== undefined) deltas[id] = { ...deltas[id], ...extra };
  return {
    kind: 'retrieval',
    details: {
      tool: definition.tool,
      questions: records.length,
      metrics: toolMetricsBlock(tool),
      ...decidingFields(definition),
      failures: [
        ...outcome.extraFailures,
        ...listFailures(definition, records),
      ],
    },
    claim: { ...definition.claim },
    groundTruth: { ...definition.groundTruth },
    ...(outcome.arm === undefined ? {} : { arm: outcome.arm }),
    baselines,
    deltas,
    cost: {
      source: tool === null ? 'none' : 'live',
      calls: tool?.calls ?? 0,
      latency_ms: {
        p50: tool?.latencyP50 ?? null,
        p95: tool?.latencyP95 ?? null,
      },
      error_rate: tool?.errorRate ?? null,
      tokens: { result_p50: tool?.tokensP50 ?? null },
    },
    verdict: outcome.verdict,
    ...(outcome.naReason === undefined ? {} : { naReason: outcome.naReason }),
  };
}

/**
 * A deterministic sample of `count` questions (`--smoke`), in file order.
 * Seeded so every run and host scores the same subset.
 */
export function sampleQuestions<Q>(
  questions: readonly Q[],
  count: number,
  random: () => number,
): Q[] {
  if (questions.length <= count) return [...questions];
  const indexes = questions.map((_, index) => index);
  for (let index = indexes.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [indexes[index], indexes[swap]] = [indexes[swap], indexes[index]];
  }
  return indexes
    .slice(0, count)
    .sort((left, right) => left - right)
    .map((index) => questions[index]);
}

/**
 * Fails every passing suite of a tool that failed a lifecycle scenario, and
 * names the scenario in its failures. `na` suites are left as they are.
 */
export function applyLifecycleVerdicts(
  suites: readonly ScorecardSuite[],
  lifecycle: readonly {
    scenario: string;
    tool: string;
    pass: boolean;
    na?: string;
  }[],
): ScorecardSuite[] {
  return suites.map((suite) => {
    const details = suite.details as {
      tool: string;
      failures: FailureEntry[];
    };
    const failed = lifecycle.filter(
      (item) =>
        !item.pass && item.na === undefined && item.tool === details.tool,
    );
    if (suite.verdict === 'na' || failed.length === 0) return suite;
    return {
      ...suite,
      verdict: 'fail',
      details: {
        ...details,
        failures: [
          ...failed.map((item) => ({
            question: '(lifecycle)',
            expected: [`${item.scenario} passes`],
            got: [`lifecycle scenario ${item.scenario} failed`],
          })),
          ...details.failures,
        ],
      },
    };
  });
}
