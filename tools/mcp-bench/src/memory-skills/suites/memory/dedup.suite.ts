/**
 * `mem.dedup` and `mem.dedup.rerank` (benchmark-design.md 3.2; ledger rows
 * `benchmark-design.md:86` and `:93`). Host suites: they run in the bench
 * host against its isolated DB and embedder.
 *
 * ## `mem.dedup`
 *
 * Every `gt-merge@v1` pair gets its own scope (`workspace_root`). The left
 * side is committed first, then the right side, each as one curation pass
 * over the labelled draft (`merge-update-pass.ts`): the curator's collector,
 * the resolve call through the record/replay double, and the curator's commit
 * rule. The pair merged when the right draft was appended to an existing row.
 * Drafts are the labelled sides, not extracted text, so the baselines and the
 * product decide over the same drafts (design 3.2); extraction is measured by
 * `mem.extraction`.
 *
 * Metrics: merge precision, recall and F1 (product confusion over pairs),
 * duplicate-cluster rate (should-merge pairs whose fact is still held by more
 * than one active row), singleton-subject share (scope-local subjects held by
 * one row), resolve calls per merge, and candidate recall (should-merge pairs
 * whose left row reached the resolver at all). Baselines are the pure
 * policies of `write-side-baselines.ts`: byte-equal subject (the pre-563
 * path), never merge, tier-1-only (case-folded subject). Verdict: product F1
 * beats byte-equal F1 by the ledger MinE of 10 points.
 *
 * Expected today: tier 2 runs only when tier 1 found a row
 * (`merge-candidate-collector.ts:187`), so a should-merge pair whose subjects
 * differ after case folding never reaches the resolver; candidate recall is
 * the tier-1-only baseline's recall. Tier 2 cannot be forced on: the collector
 * takes no option (`merge-candidate-collector.ts:134-150`), so the 563
 * "tier 2 always" variant is not offered (it is a Phase 4 fix variant).
 *
 * ## `mem.dedup.rerank`
 *
 * All left sides are inserted into one shared scope. For each should-merge
 * pair the right draft's tier-2 query (`merge-candidate-collector.ts:204-206`,
 * 5 hits, `:23`) is run through `searchRich`; NDCG@5 of the left row is taken
 * in the returned (reranked) order and in the RRF order of the same hits (the
 * no-rerank baseline: RRF score, then BM25 and vector rank, the order
 * `rrfFuse` builds). The reranker's score variance is computed per list from
 * the embedder's own `rerank`. Expected today (forensics M3): delta 0 and
 * variance 0 on every list. Verdict: NDCG@5 beats no-rerank by MinE 0.05.
 * Limitation: the reranker also chooses which 5 of the top-20 RRF rows
 * survive; that membership effect is not separated here.
 */

import type { ExtractedMemoryDraft } from '@ptah-extension/memory-contracts';
import { z } from 'zod';

import { ndcgAtK } from '../../../metrics/retrieval-metrics';
import {
  byteEqualSubjectMerge,
  neverMerge,
  tier1CaseFoldedMerge,
  type MergeSubjectSide,
} from '../../baselines/write-side-baselines';
import {
  mergePairSchema,
  type MergePair,
} from '../../ground-truth/label-schemas';
import type {
  MemorySkillsHostSuite,
  MemorySkillsHostSuiteContext,
} from '../../host/memory-skills-host';
import {
  duplicateClusterRate,
  mergeF1,
  mergePrecision,
  mergeRecall,
  rate,
  singletonSubjectShare,
  type MergeCounts,
} from '../../metrics/curation-metrics';
import { writeSuiteResult, type CaseRecord } from '../../runner/suite-result';
import {
  caseScope,
  commitDrafts,
  deltaOf,
  meetsMinEffect,
  ModelCallLog,
  naReasonOf,
  rateMetrics,
  readGroundTruth,
  recordCase,
  type CaseStatus,
} from './merge-update-pass';
import type { MergeUpdatePorts, PortHit, PortRow } from './merge-update-ports';

export const DEDUP_SUITE_ID = 'mem.dedup';
export const DEDUP_RERANK_SUITE_ID = 'mem.dedup.rerank';

/** Design 3.2: ≥ 40 should-merge and ≥ 40 should-not-merge pairs. */
export const MIN_SHOULD_MERGE_PAIRS = 40;
export const MIN_SHOULD_NOT_MERGE_PAIRS = 40;
/** Ledger MinE: 10 points of merge F1 over byte-equal subject (`:86`). */
export const DEDUP_MIN_EFFECT = 0.1;
/** Ledger MinE: 0.05 NDCG@5 over no-rerank (`:93`). */
export const RERANK_MIN_EFFECT = 0.05;

/** `TIER2_PER_DRAFT_LIMIT` (`merge-candidate-collector.ts:23`). */
const TIER2_PER_DRAFT_LIMIT = 5;
/** `TIER2_QUERY_MAX_CHARS` (`merge-candidate-collector.ts:29`). */
const TIER2_QUERY_MAX_CHARS = 512;
/** The reranker's candidate clip (`memory-search.service.ts:374`). */
const RERANK_CANDIDATE_MAX_CHARS = 512;
/** Salience hint of a labelled draft; it only sets `memories.salience`. */
const LABELLED_DRAFT_SALIENCE = 0.5;

const GROUND_TRUTH = {
  id: 'gt-merge',
  version: 'v1',
  method: 'labelled',
} as const;

const optionsSchema = z.strictObject({
  /** `gt-merge@v1` JSONL, home-relative (seeded as a `file` fixture). */
  mergePairs: z.string().min(1),
  /** Version id of the curator cassette set the run replays or records. */
  cassetteVersion: z.string().min(1).nullable().default(null),
});

export interface DedupSuiteDeps {
  readonly resolvePorts: (
    context: MemorySkillsHostSuiteContext,
  ) => MergeUpdatePorts;
  /** Monotonic clock for latencies. Default `performance.now`. */
  readonly now?: () => number;
  /** Per-case safety cap; default `case-runner.ts`'s 120 s. */
  readonly capMs?: number;
}

type MergePolicy = (left: MergeSubjectSide, right: MergeSubjectSide) => boolean;

const BASELINES: readonly {
  readonly id: string;
  readonly label: string;
  readonly policy: MergePolicy;
}[] = [
  {
    id: 'byte-equal-subject',
    label: 'Byte-equal subject (pre-563 path)',
    policy: byteEqualSubjectMerge,
  },
  { id: 'never-merge', label: 'Never merge', policy: neverMerge },
  {
    id: 'tier1-only',
    label: 'Tier 1 only (case-folded subject)',
    policy: tier1CaseFoldedMerge,
  },
];

const DEDUP_METRICS = [
  'mergePrecision',
  'mergeRecall',
  'mergeF1',
  'duplicateClusterRate',
  'singletonSubjectShare',
  'callsPerMerge',
] as const;

/** The draft a labelled pair side becomes (both arms decide over it). */
export function labelledDraft(side: MergePair['left']): ExtractedMemoryDraft {
  return {
    kind: 'fact',
    subject: side.subject,
    content: side.statement,
    salienceHint: LABELLED_DRAFT_SALIENCE,
  };
}

function subjectKey(subject: string | null): string {
  return (subject ?? '').trim().toLowerCase();
}

/** Rows per scope-local, case-folded subject. */
function rowsPerSubject(rows: readonly PortRow[]): number[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = subjectKey(row.subject);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.values()];
}

/** Counts of a pair set; `tn` is the should-not-merge pairs left apart. */
interface PairCounts extends MergeCounts {
  trueNegative: number;
}

function countPairs(
  decisions: readonly { kind: MergePair['kind']; merged: boolean }[],
): PairCounts {
  const counts = {
    truePositive: 0,
    falsePositive: 0,
    falseNegative: 0,
    trueNegative: 0,
  };
  for (const { kind, merged } of decisions) {
    if (kind === 'should-merge') {
      if (merged) counts.truePositive += 1;
      else counts.falseNegative += 1;
    } else if (merged) counts.falsePositive += 1;
    else counts.trueNegative += 1;
  }
  return counts;
}

interface DedupOutcome {
  readonly merged: boolean;
  readonly targetInCandidates: boolean;
  readonly rows: readonly PortRow[];
  readonly resolveCalls: number;
}

/** The six headline metrics of one arm, each with its `num`/`den`. */
function dedupMetrics(input: {
  readonly counts: PairCounts;
  readonly rowsPerShouldMergeFact: readonly number[];
  readonly rowsPerSubjectAll: readonly number[];
  readonly calls: number;
}): Record<string, number | null> {
  const merges = input.counts.truePositive + input.counts.falsePositive;
  return {
    ...rateMetrics('mergePrecision', mergePrecision(input.counts)),
    ...rateMetrics('mergeRecall', mergeRecall(input.counts)),
    ...rateMetrics('mergeF1', mergeF1(input.counts)),
    ...rateMetrics(
      'duplicateClusterRate',
      duplicateClusterRate(input.rowsPerShouldMergeFact),
    ),
    ...rateMetrics(
      'singletonSubjectShare',
      singletonSubjectShare(input.rowsPerSubjectAll),
    ),
    ...rateMetrics('callsPerMerge', rate(input.calls, merges)),
  };
}

/** A pure policy over every pair: merged ⇒ one row under the left subject. */
function baselineMetrics(
  pairs: readonly MergePair[],
  policy: MergePolicy,
): Record<string, number | null> {
  const merged = pairs.map((pair) => policy(pair.left, pair.right));
  const rows: PortRow[][] = pairs.map((pair, index) =>
    merged[index]
      ? [{ id: 'left', subject: pair.left.subject }]
      : [
          { id: 'left', subject: pair.left.subject },
          { id: 'right', subject: pair.right.subject },
        ],
  );
  return dedupMetrics({
    counts: countPairs(
      pairs.map((pair, index) => ({ kind: pair.kind, merged: merged[index] })),
    ),
    rowsPerShouldMergeFact: pairs.flatMap((pair, index) =>
      pair.kind === 'should-merge' ? [rows[index].length] : [],
    ),
    rowsPerSubjectAll: rows.flatMap(rowsPerSubject),
    calls: 0,
  });
}

function parseOptions(options: unknown): z.infer<typeof optionsSchema> {
  return optionsSchema.parse(options ?? {});
}

function belowMinimum(pairs: readonly MergePair[]): boolean {
  const shouldMerge = pairs.filter((p) => p.kind === 'should-merge').length;
  return (
    shouldMerge < MIN_SHOULD_MERGE_PAIRS ||
    pairs.length - shouldMerge < MIN_SHOULD_NOT_MERGE_PAIRS
  );
}

async function runDedup(
  context: MemorySkillsHostSuiteContext,
  deps: DedupSuiteDeps,
): Promise<void> {
  const options = parseOptions(context.options);
  const pairs = readGroundTruth(
    context.isolation.home,
    options.mergePairs,
    mergePairSchema,
  );
  const ports = deps.resolvePorts(context);
  const now = deps.now ?? (() => performance.now());
  const log = new ModelCallLog(now);

  const records: CaseRecord[] = [];
  const statuses: CaseStatus[] = [];
  const completed: { pair: MergePair; outcome: DedupOutcome }[] = [];
  for (const pair of pairs) {
    const expected = pair.kind === 'should-merge' ? 'merged' : 'separate';
    const recorded = await recordCase<DedupOutcome>(
      pair.id,
      { kind: pair.kind, left: pair.left, right: pair.right },
      expected,
      async (signal, attempt) => {
        const workspaceRoot = caseScope(
          context.workspaceRoot,
          DEDUP_SUITE_ID,
          pair.id,
          attempt,
        );
        const left = await commitDrafts(
          ports,
          {
            drafts: [labelledDraft(pair.left)],
            workspaceRoot,
            sessionId: `${DEDUP_SUITE_ID}:${pair.id}:${pair.left.session}`,
            signal,
          },
          log,
        );
        const leftRowId = left.decisions[0].rowId;
        const right = await commitDrafts(
          ports,
          {
            drafts: [labelledDraft(pair.right)],
            workspaceRoot,
            sessionId: `${DEDUP_SUITE_ID}:${pair.id}:${pair.right.session}`,
            signal,
          },
          log,
        );
        return {
          merged: right.decisions[0].merged,
          targetInCandidates: right.collection.candidates.some(
            (candidate) => candidate.id === leftRowId,
          ),
          rows: ports.listRows(workspaceRoot),
          resolveCalls: left.resolveCalls + right.resolveCalls,
        };
      },
      (outcome) => {
        const observed = outcome.merged ? 'merged' : 'separate';
        return {
          expected,
          observed: `${observed}; target-in-candidates=${outcome.targetInCandidates ? 'yes' : 'no'}`,
          outcome: observed === expected ? 'pass' : 'fail',
          baselineOutcomes: Object.fromEntries(
            BASELINES.map(({ id, policy }) => [
              id,
              (policy(pair.left, pair.right) ? 'merged' : 'separate') ===
              expected
                ? 'pass'
                : 'fail',
            ]),
          ),
        };
      },
      { now, capMs: deps.capMs },
    );
    records.push(recorded.record);
    statuses.push(recorded.status);
    if (recorded.value !== null) {
      completed.push({ pair, outcome: recorded.value });
    }
  }

  const counts = countPairs(
    completed.map(({ pair, outcome }) => ({
      kind: pair.kind,
      merged: outcome.merged,
    })),
  );
  const shouldMerge = completed.filter(
    ({ pair }) => pair.kind === 'should-merge',
  );
  const product = {
    ...dedupMetrics({
      counts,
      rowsPerShouldMergeFact: shouldMerge.map(
        ({ outcome }) => outcome.rows.length,
      ),
      rowsPerSubjectAll: completed.flatMap(({ outcome }) =>
        rowsPerSubject(outcome.rows),
      ),
      calls: completed.reduce(
        (sum, { outcome }) => sum + outcome.resolveCalls,
        0,
      ),
    }),
    ...rateMetrics(
      'candidateRecall',
      rate(
        shouldMerge.filter(({ outcome }) => outcome.targetInCandidates).length,
        shouldMerge.length,
      ),
    ),
  };
  const baselines = BASELINES.map(({ id, label, policy }) => ({
    id,
    label,
    metrics: baselineMetrics(pairs, policy),
  }));
  const byteEqual = baselines[0].metrics;
  const naReason = naReasonOf(statuses, belowMinimum(pairs));

  writeSuiteResult(
    context.runDir,
    {
      suiteId: DEDUP_SUITE_ID,
      kind: 'curation',
      arm: 'memory',
      details: {
        operation: 'dedup',
        pairs: {
          tp: counts.truePositive,
          fp: counts.falsePositive,
          fn: counts.falseNegative,
          tn: counts.trueNegative,
        },
        mergePrecision: product['mergePrecision'],
        mergeRecall: product['mergeRecall'],
        duplicateClusterRate: product['duplicateClusterRate'],
        singletonSubjectShare: product['singletonSubjectShare'],
        callsPerMerge: product['callsPerMerge'],
      },
      claim: {
        source: 'ledger',
        ref: '.ptah/specs/TASK_2026_620_a13e/benchmark-design.md:86',
        text: 'searchRich merge candidates: more correct merges (563)',
      },
      groundTruth: GROUND_TRUTH,
      baselines,
      deltas: Object.fromEntries(
        baselines.map((baseline) => [
          baseline.id,
          deltaOf(product, baseline.metrics, DEDUP_METRICS),
        ]),
      ),
      cost: log.cost(),
      modelCalls: log.calls,
      verdict:
        naReason !== undefined
          ? 'na'
          : meetsMinEffect(
                product['mergeF1'],
                byteEqual['mergeF1'],
                DEDUP_MIN_EFFECT,
              )
            ? 'pass'
            : 'fail',
      ...(naReason === undefined ? {} : { naReason }),
      metrics: product,
      cassetteVersion: log.calls === 0 ? null : options.cassetteVersion,
    },
    records,
  );
}

/** 1-based rank of `id` in `ranked`, or `null` when absent. */
function rankOf(ranked: readonly string[], id: string): number | null {
  const index = ranked.indexOf(id);
  return index < 0 ? null : index + 1;
}

/** Hits in RRF order: fused score, then BM25 rank, then vector rank. */
function rrfOrder(hits: readonly PortHit[]): string[] {
  const rank = (value: number | null): number =>
    value === null ? Number.POSITIVE_INFINITY : value;
  return [...hits]
    .sort(
      (a, b) =>
        b.score - a.score ||
        rank(a.bm25Rank) - rank(b.bm25Rank) ||
        rank(a.vecRank) - rank(b.vecRank),
    )
    .map((hit) => hit.memoryId);
}

function distinct(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

function variance(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  return values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
}

interface RerankOutcome {
  readonly ndcg: number;
  readonly ndcgNoRerank: number;
  readonly rank: number | null;
  readonly rankNoRerank: number | null;
  readonly zeroVariance: boolean | null;
}

async function runRerank(
  context: MemorySkillsHostSuiteContext,
  deps: DedupSuiteDeps,
): Promise<void> {
  const options = parseOptions(context.options);
  const pairs = readGroundTruth(
    context.isolation.home,
    options.mergePairs,
    mergePairSchema,
  );
  const ports = deps.resolvePorts(context);
  const now = deps.now ?? (() => performance.now());

  // One shared scope holds every pair's left side, so each query competes
  // with the other pairs' rows as merge candidates do in a real workspace.
  const workspaceRoot = caseScope(
    context.workspaceRoot,
    DEDUP_RERANK_SUITE_ID,
    'corpus',
    1,
  );
  const leftRowOf = new Map<string, string>();
  for (const pair of pairs) {
    leftRowOf.set(
      pair.id,
      await ports.insertRow({
        sessionId: `${DEDUP_RERANK_SUITE_ID}:${pair.id}:${pair.left.session}`,
        workspaceRoot,
        draft: labelledDraft(pair.left),
      }),
    );
  }

  let searchCalls = 0;
  const records: CaseRecord[] = [];
  const statuses: CaseStatus[] = [];
  const completed: RerankOutcome[] = [];
  const expected = 'reranked-rank<no-rerank-rank or first';
  for (const pair of pairs.filter((p) => p.kind === 'should-merge')) {
    const target = leftRowOf.get(pair.id);
    // Unreachable: every pair's left side was inserted above.
    if (target === undefined) throw new Error(`no left row for ${pair.id}`);
    const recorded = await recordCase<RerankOutcome>(
      pair.id,
      { left: pair.left, right: pair.right },
      expected,
      async () => {
        const query = `${pair.right.subject} ${pair.right.statement}`
          .trim()
          .slice(0, TIER2_QUERY_MAX_CHARS);
        searchCalls += 1;
        const { hits } = await ports.searchRich(
          query,
          TIER2_PER_DRAFT_LIMIT,
          workspaceRoot,
        );
        const reranked = distinct(hits.map((hit) => hit.memoryId));
        const noRerank = distinct(rrfOrder(hits));
        let zeroVariance: boolean | null = null;
        if (ports.reranker !== null && hits.length > 0) {
          searchCalls += 1;
          const scored = await ports.reranker.rerank(
            query,
            hits.map((hit, index) => ({
              id: String(index),
              text: hit.chunkText.slice(0, RERANK_CANDIDATE_MAX_CHARS),
            })),
            hits.length,
          );
          zeroVariance = variance(scored.map((s) => s.score)) === 0;
        }
        const truth = { items: [target] };
        return {
          ndcg: ndcgAtK(
            { ranked: reranked, abstained: false },
            truth,
            TIER2_PER_DRAFT_LIMIT,
          ),
          ndcgNoRerank: ndcgAtK(
            { ranked: noRerank, abstained: false },
            truth,
            TIER2_PER_DRAFT_LIMIT,
          ),
          rank: rankOf(reranked, target),
          rankNoRerank: rankOf(noRerank, target),
          zeroVariance,
        };
      },
      (outcome) => {
        const improved =
          outcome.rank !== null &&
          (outcome.rank === 1 ||
            outcome.rankNoRerank === null ||
            outcome.rank < outcome.rankNoRerank);
        const spread =
          outcome.zeroVariance === null
            ? 'no-reranker'
            : outcome.zeroVariance
              ? 'zero'
              : 'nonzero';
        return {
          expected,
          observed: `rank=${outcome.rank ?? 'absent'}; no-rerank=${outcome.rankNoRerank ?? 'absent'}; variance=${spread}`,
          outcome: improved ? 'pass' : 'fail',
          baselineOutcomes: {
            'no-rerank': outcome.rankNoRerank === 1 ? 'pass' : 'fail',
          },
        };
      },
      { now, capMs: deps.capMs },
    );
    records.push(recorded.record);
    statuses.push(recorded.status);
    if (recorded.value !== null) completed.push(recorded.value);
  }

  const lists = completed.length;
  const sum = (pick: (o: RerankOutcome) => number): number =>
    completed.reduce((total, outcome) => total + pick(outcome), 0);
  const ndcg = rate(
    sum((o) => o.ndcg),
    lists,
  );
  const ndcgNoRerank = rate(
    sum((o) => o.ndcgNoRerank),
    lists,
  );
  const measured = completed.filter((o) => o.zeroVariance !== null);
  const zeroVarianceLists = measured.filter((o) => o.zeroVariance).length;
  const product = {
    ...rateMetrics('ndcgAt5', ndcg),
    ...rateMetrics('ndcgAt5NoRerank', ndcgNoRerank),
    ndcgAt5Delta:
      ndcg.value === null || ndcgNoRerank.value === null
        ? null
        : ndcg.value - ndcgNoRerank.value,
    ...rateMetrics(
      'zeroVarianceShare',
      rate(zeroVarianceLists, measured.length),
    ),
  };
  const baseline = {
    id: 'no-rerank',
    label: 'No rerank (RRF order of the same hits)',
    metrics: rateMetrics('ndcgAt5', ndcgNoRerank),
  };
  const naReason =
    naReasonOf(statuses, belowMinimum(pairs)) ??
    (ports.reranker === null ? 'no-reranker' : undefined);

  writeSuiteResult(
    context.runDir,
    {
      suiteId: DEDUP_RERANK_SUITE_ID,
      kind: 'curation',
      arm: 'memory',
      details: {
        operation: 'rerank',
        lists,
        ndcgAt5: ndcg.value,
        ndcgAt5NoRerank: ndcgNoRerank.value,
        zeroVarianceLists,
      },
      claim: {
        source: 'ledger',
        ref: '.ptah/specs/TASK_2026_620_a13e/benchmark-design.md:93',
        text: 'Reranking improves merge-candidate order',
      },
      groundTruth: GROUND_TRUTH,
      baselines: [baseline],
      deltas: {
        'no-rerank': deltaOf(product, baseline.metrics, ['ndcgAt5']),
      },
      cost: {
        calls: searchCalls,
        latency_ms: { p50: null, p95: null },
        error_rate: null,
        tokens: {},
      },
      modelCalls: 0,
      verdict:
        naReason !== undefined
          ? 'na'
          : meetsMinEffect(ndcg.value, ndcgNoRerank.value, RERANK_MIN_EFFECT)
            ? 'pass'
            : 'fail',
      ...(naReason === undefined ? {} : { naReason }),
      metrics: product,
      cassetteVersion: null,
    },
    records,
  );
}

/** The two suites, for the host's `HOST_SUITES`. */
export function createDedupSuites(
  deps: DedupSuiteDeps,
): readonly MemorySkillsHostSuite[] {
  return [
    { id: DEDUP_SUITE_ID, run: (context) => runDedup(context, deps) },
    { id: DEDUP_RERANK_SUITE_ID, run: (context) => runRerank(context, deps) },
  ];
}
