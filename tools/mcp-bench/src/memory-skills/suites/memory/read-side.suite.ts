/**
 * Read-side memory suites (benchmark-design.md 3.3 :159, 3.4, 3.5). Three host
 * suites over one seeded read world, each under its own workspace key:
 *
 * - `mem.search.fts-and` — recall@10 and NDCG@10 of `searchRich` against the
 *   pinned pre-473 OR builder (`fts-or-query.ts`) over the same FTS index,
 *   scored with 619's `recallAtK`/`ndcgAtK` unchanged.
 * - `mem.injection.recall` — the needed fact present in what the agent sees:
 *   `buildBlock(question)` hit lines plus `buildSessionStartBlock` roster
 *   lines, matched per line with the R-M4 matcher. Baselines: last-N (N = 50),
 *   raw transcript grep top-5, no memory.
 * - `mem.abstention` — false-injection rate (a non-empty `buildBlock` for a
 *   question whose fact is not in memory), mean injected hits and the score
 *   distribution of injected hits against `MIN_SCORE` 0.05
 *   (`memory-prompt-injector.ts:62`). Baseline: no memory (rate 0).
 *
 * Boundary with TASK_2026_619 (context.md): 619 owns `ptah_memory_search` as an
 * MCP retrieval tool and workspace scope/isolation. These suites call the
 * product services in-process (never the MCP transport), measure only the AND
 * vs OR builder change and what the prompt injector puts in front of the
 * agent, and always query under the exact key the rows were written with.
 *
 * Seed modes (plan `options.seed`):
 * - `insert-statements` (default): every seeded fact statement and every
 *   distractor text becomes one row with one chunk and no subject, written
 *   through `MemoryStore.insertMemoryWithChunks` under
 *   `<runDir>/workspaces/<suiteId>`. Held-out facts are not written; their
 *   questions are abstention cases (design 3.5 c). The baselines read the same
 *   statements as a dated stream. No model call.
 * - `fixture-db`: the plan's database fixture is the seeded DB; rows are read
 *   under `seed.workspaceRoot` and the baselines read `seed.sessionFiles`.
 *
 * Relevance is labelled from the DB, not assumed: a row is relevant to a fact
 * when the R-M4 matcher accepts its subject + content + chunk. A question with
 * no relevant row is recorded as a failing case and left out of the ranking
 * denominators (retrieval cannot find what was never stored).
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import type {
  MemorySkillsHostSuite,
  MemorySkillsHostSuiteContext,
} from '../../host/memory-skills-host';
import type { BenchHostContainer } from '../../../transport/bench-host-boot';
import {
  LAST_N_MESSAGES,
  lastNMessagesBaseline,
  noMemoryBaseline,
  rawTranscriptGrepTopK,
  type TimestampedTranscriptMessage,
} from '../../baselines/read-side-baselines';
import {
  abstentionCaseSchema,
  factSchema,
  type Fact,
} from '../../ground-truth/label-schemas';
import {
  matchesFact,
  type MatchableMemoryRow,
} from '../../matching/fact-matcher';
import {
  ndcgAtK,
  rate,
  recallAtK,
  type Rate,
} from '../../metrics/curation-metrics';
import {
  writeSuiteResult,
  type CaseRecord,
  type SuiteResultInput,
} from '../../runner/suite-result';
import {
  costOf,
  deltaOf,
  parseJsonLines,
  rateMetrics,
  readSessionMessages,
  recordCase,
  resolveHomeFile,
  type RecordedCase,
} from './memory-suite-support';
import {
  containerReadSidePort,
  distinctInOrder,
  type ReadSidePort,
  type ReadSideRow,
} from './read-side-port';

export const FTS_AND_SUITE_ID = 'mem.search.fts-and';
export const INJECTION_RECALL_SUITE_ID = 'mem.injection.recall';
export const ABSTENTION_SUITE_ID = 'mem.abstention';

/** Ranking depth of `mem.search.fts-and` (design :159). */
export const RANK_K = 10;
/** `buildBlock` injects at most this many hits (`memory-prompt-injector.ts:59`). */
export const INJECTION_K = 5;
/** The injector's score floor (`memory-prompt-injector.ts:62`), mirrored: it is not exported. */
export const MIN_SCORE = 0.05;
/** Design 3.5: at least 15 abstention cases, else the suite is `na`. */
export const MIN_ABSTENTION_CASES = 15;

const GROUND_TRUTH = {
  id: 'gt-memory',
  version: 'v1',
  method: 'seeded',
} as const;

const nonEmpty = z.string().min(1);

/** Plan `options` shared by the three read-side suites. Paths are home-relative. */
export const readSideOptionsSchema = z.strictObject({
  /** `memory-facts.v1.jsonl` as seeded into the isolated home. */
  factsFile: nonEmpty,
  /** `distractors.v1.jsonl`; its `distractor` records become noise rows (insert mode). */
  distractorsFile: nonEmpty.optional(),
  /** `abstentionCaseSchema` lines: statements never written, asked as questions. */
  abstentionFile: nonEmpty.optional(),
  /** Facts deliberately not seeded. Default: facts of category `abstention`. */
  heldOutFactIds: z.array(nonEmpty).optional(),
  seed: z
    .discriminatedUnion('mode', [
      z.strictObject({ mode: z.literal('insert-statements') }),
      z.strictObject({
        mode: z.literal('fixture-db'),
        workspaceRoot: nonEmpty,
        sessionFiles: z.array(nonEmpty).min(1),
      }),
    ])
    .default({ mode: 'insert-statements' }),
});
export type ReadSideOptions = z.infer<typeof readSideOptionsSchema>;

/** A question whose answer is deliberately absent from memory. */
interface AbstentionQuestion {
  readonly id: string;
  readonly question: string;
  /** `held-out-fact` (design 3.5 c) or the abstention case's bait kind. */
  readonly origin: string;
}

/** The seeded read world one suite scores against. */
interface ReadWorld {
  readonly workspaceRoot: string;
  /** Seeded facts in id order; their questions are the scored questions. */
  readonly facts: readonly Fact[];
  readonly abstention: readonly AbstentionQuestion[];
  /** Baseline source material, sessions oldest first. */
  readonly transcripts: readonly (readonly TimestampedTranscriptMessage[])[];
  readonly rows: readonly ReadSideRow[];
  /** Product calls spent building the world. */
  readonly calls: number;
}

/** The `distractor` records of `distractors.v1.jsonl`; turn templates are skipped. */
const distractorLineSchema = z.object({
  kind: z.literal('distractor'),
  id: nonEmpty,
  text: nonEmpty,
});

function byId<T extends { readonly id: string }>(left: T, right: T): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

async function buildWorld(
  context: MemorySkillsHostSuiteContext,
  suiteId: string,
  options: ReadSideOptions,
  port: ReadSidePort,
): Promise<ReadWorld> {
  const home = context.isolation.home;
  const allFacts = parseJsonLines(resolveHomeFile(home, options.factsFile))
    .map((line) => factSchema.parse(line))
    .sort(byId);
  const heldOutIds = new Set(
    options.heldOutFactIds ??
      allFacts
        .filter((fact) => fact.category === 'abstention')
        .map((f) => f.id),
  );
  const unknownHeldOut = [...heldOutIds].filter(
    (id) => !allFacts.some((fact) => fact.id === id),
  );
  if (unknownHeldOut.length > 0) {
    throw new Error(
      `heldOutFactIds not in the facts file: ${unknownHeldOut.join(', ')}`,
    );
  }
  const facts = allFacts.filter((fact) => !heldOutIds.has(fact.id));
  const abstention: AbstentionQuestion[] = allFacts
    .filter((fact) => heldOutIds.has(fact.id))
    .map((fact) => ({
      id: fact.id,
      question: fact.question,
      origin: 'held-out-fact',
    }));
  if (options.abstentionFile !== undefined) {
    for (const line of parseJsonLines(
      resolveHomeFile(home, options.abstentionFile),
    )) {
      const item = abstentionCaseSchema.parse(line);
      abstention.push({
        id: item.id,
        question: item.question,
        origin: item.baitKind,
      });
    }
  }
  abstention.sort(byId);

  let calls = 0;
  let workspaceRoot: string;
  let transcripts: TimestampedTranscriptMessage[][];
  if (options.seed.mode === 'fixture-db') {
    workspaceRoot = options.seed.workspaceRoot;
    transcripts = options.seed.sessionFiles.map((file) =>
      readSessionMessages(resolveHomeFile(home, file)),
    );
  } else {
    workspaceRoot = join(context.runDir, 'workspaces', suiteId);
    mkdirSync(workspaceRoot, { recursive: true });
    const distractors =
      options.distractorsFile === undefined
        ? []
        : parseJsonLines(resolveHomeFile(home, options.distractorsFile))
            .map((line) => distractorLineSchema.safeParse(line))
            .flatMap((parsed) => (parsed.success ? [parsed.data] : []))
            .sort(byId);
    for (const fact of facts) {
      await port.insertRow(workspaceRoot, fact.statement);
      calls += 1;
    }
    for (const distractor of distractors) {
      await port.insertRow(workspaceRoot, distractor.text);
      calls += 1;
    }
    transcripts = [statementStream(facts, distractors)];
  }
  const rows = await port.listRows(workspaceRoot);
  calls += 1;
  return { workspaceRoot, facts, abstention, transcripts, rows, calls };
}

/**
 * The insert-mode baseline source: the same statements the DB holds, as one
 * dated session (distractors first, at the earliest fact date; facts by date,
 * then id), so a baseline sees exactly what memory was given.
 */
function statementStream(
  facts: readonly Fact[],
  distractors: readonly { readonly id: string; readonly text: string }[],
): TimestampedTranscriptMessage[] {
  const dated = [...facts].sort(
    (left, right) => left.date.localeCompare(right.date) || byId(left, right),
  );
  const first = dated[0]?.date ?? '1970-01-01';
  return [
    ...distractors.map((distractor) => ({
      timestamp: `${first}T00:00:00.000Z`,
      role: 'user' as const,
      text: distractor.text,
    })),
    ...dated.map((fact) => ({
      timestamp: `${fact.date}T00:00:00.000Z`,
      role: 'user' as const,
      text: fact.statement,
    })),
  ];
}

/** Memory ids of the rows the R-M4 matcher accepts for `fact`, in id order. */
function relevantIds(fact: Fact, rows: readonly ReadSideRow[]): string[] {
  return distinctInOrder(
    rows
      .filter((row) =>
        matchesFact(fact, {
          subject: row.subject,
          content: row.content,
          chunk: row.chunkText,
        }),
      )
      .map((row) => row.memoryId),
  );
}

/** 1-based rank of the first relevant id, or `none`. */
function firstRank(
  ranked: readonly string[],
  relevant: readonly string[],
): string {
  const index = ranked.findIndex((id) => relevant.includes(id));
  return index < 0 ? 'none' : String(index + 1);
}

/** The numbered lines of an injected block: hits (`buildBlock`) or roster subjects. */
export function numberedLines(block: string): string[] {
  return block.split('\n').filter((line) => /^\d+\. /.test(line));
}

/** Question words the naive grep baseline ignores (length-4+ tokens only). */
const GREP_IGNORED = new Set([
  'what',
  'which',
  'when',
  'where',
  'does',
  'did',
  'were',
  'have',
  'with',
  'that',
  'this',
  'about',
  'from',
  'user',
  'want',
  'should',
]);

/** Keywords of a question for the raw-grep baseline: distinct words of 4+ letters. */
export function grepKeywords(question: string): string[] {
  const words = question
    .toLowerCase()
    .split(/[^\p{L}\p{N}.]+/u)
    .map((word) => word.replace(/^\.+|\.+$/g, ''))
    .filter((word) => word.length >= 4 && !GREP_IGNORED.has(word));
  return [...new Set(words)];
}

function anyMatch(fact: Fact, rows: readonly MatchableMemoryRow[]): boolean {
  return rows.some((row) => matchesFact(fact, row));
}

function caseRecords<T>(recorded: readonly RecordedCase<T>[]): CaseRecord[] {
  return recorded.map((item) => item.record);
}

function completed<T>(recorded: readonly RecordedCase<T>[]): T[] {
  return recorded.flatMap((item) => (item.value === null ? [] : [item.value]));
}

function sumRate(values: readonly number[]): Rate {
  return rate(
    values.reduce((sum, value) => sum + value, 0),
    values.length,
  );
}

function errorCount(cases: readonly CaseRecord[]): number {
  return cases.filter((record) => record.error != null).length;
}

// ---------------------------------------------------------------- fts-and

interface RankingValue {
  readonly answerable: boolean;
  readonly product: { readonly recall: number; readonly ndcg: number };
  readonly orBaseline: { readonly recall: number; readonly ndcg: number };
}

async function runFtsAnd(
  world: ReadWorld,
  port: ReadSidePort,
): Promise<{ result: SuiteResultInput; cases: CaseRecord[] }> {
  const recorded: RecordedCase<RankingValue>[] = [];
  for (const fact of world.facts) {
    recorded.push(
      await recordCase(
        `fts.${fact.id}`,
        { suite: FTS_AND_SUITE_ID, factId: fact.id, question: fact.question },
        `a row matching ${fact.id} in searchRich top-${RANK_K}`,
        async () => {
          const relevant = relevantIds(fact, world.rows);
          const rich = await port.searchRich(
            fact.question,
            RANK_K,
            world.workspaceRoot,
          );
          const product = distinctInOrder(
            rich.hits.map((hit) => hit.memoryId),
          ).slice(0, RANK_K);
          const orRanked = await port.searchFtsOr(
            fact.question,
            RANK_K,
            world.workspaceRoot,
          );
          const truth = { items: relevant };
          const score = (ranked: readonly string[]) => ({
            recall: recallAtK(
              { ranked: [...ranked], abstained: false },
              truth,
              RANK_K,
            ),
            ndcg: ndcgAtK(
              { ranked: [...ranked], abstained: false },
              truth,
              RANK_K,
            ),
          });
          const value: RankingValue = {
            answerable: relevant.length > 0,
            product: score(product),
            orBaseline: score(orRanked),
          };
          const rankProduct = firstRank(product, relevant);
          const rankOr = firstRank(orRanked, relevant);
          return {
            value,
            verdict: {
              expected: `a row matching ${fact.id} in searchRich top-${RANK_K}`,
              observed: value.answerable
                ? `relevant=${relevant.length}; searchRich rank=${rankProduct}; fts-or rank=${rankOr}; bm25Only=${rich.bm25Only}`
                : 'relevant=0; no stored row matches the fact',
              outcome:
                value.answerable && rankProduct !== 'none' ? 'pass' : 'fail',
              baselineOutcomes: {
                'fts-or':
                  value.answerable && rankOr !== 'none' ? 'pass' : 'fail',
              },
            },
          };
        },
      ),
    );
  }
  const cases = caseRecords(recorded);
  const answerable = completed(recorded).filter((value) => value.answerable);
  const productRecall = sumRate(answerable.map((v) => v.product.recall));
  const productNdcg = sumRate(answerable.map((v) => v.product.ndcg));
  const orRecall = sumRate(answerable.map((v) => v.orBaseline.recall));
  const orNdcg = sumRate(answerable.map((v) => v.orBaseline.ndcg));
  const productMetrics = {
    ...rateMetrics('recallAt10', productRecall),
    ...rateMetrics('ndcgAt10', productNdcg),
  };
  const orMetrics = {
    ...rateMetrics('recallAt10', orRecall),
    ...rateMetrics('ndcgAt10', orNdcg),
  };
  const errors = errorCount(cases);
  const unanswerable = completed(recorded).length - answerable.length;
  const naReason =
    answerable.length === 0 ? 'no-answerable-questions' : undefined;
  const pass =
    errors === 0 &&
    (productRecall.value ?? 0) >= (orRecall.value ?? 0) &&
    (productNdcg.value ?? 0) >= (orNdcg.value ?? 0);
  return {
    cases,
    result: {
      suiteId: FTS_AND_SUITE_ID,
      kind: 'curation',
      details: {
        operation: 'ranking',
        target: 'fts-and',
        ndcgAt10: productNdcg.value,
        recallAt10: productRecall.value,
      },
      claim: {
        source: 'code',
        ref: 'libs/backend/memory-curator/src/lib/fts-query.util.ts',
        text: 'The TASK_2026_473 AND query plan retrieves seeded facts at least as well as the pre-473 OR builder.',
      },
      groundTruth: GROUND_TRUTH,
      baselines: [
        {
          id: 'fts-or',
          label: 'pinned pre-473 OR builder, BM25 only (51f235a1e)',
          metrics: orMetrics,
        },
      ],
      deltas: { 'fts-or': deltaOf(productMetrics, orMetrics) },
      cost: costOf(cases, world.calls + 2 * cases.length),
      modelCalls: 0,
      verdict: naReason !== undefined ? 'na' : pass ? 'pass' : 'fail',
      ...(naReason === undefined ? {} : { naReason }),
      metrics: { ...productMetrics, unanswerable, errors },
      cassetteVersion: null,
    },
  };
}

// ------------------------------------------------------- injection recall

interface InjectionValue {
  readonly product: boolean;
  readonly lastN: boolean;
  readonly grep: boolean;
  readonly none: boolean;
}

async function runInjectionRecall(
  world: ReadWorld,
  port: ReadSidePort,
): Promise<{ result: SuiteResultInput; cases: CaseRecord[] }> {
  const lastN = lastNMessagesBaseline(world.transcripts);
  const recorded: RecordedCase<InjectionValue>[] = [];
  for (const fact of world.facts) {
    const expected = `${fact.id} present in the injected text`;
    recorded.push(
      await recordCase(
        `inject.${fact.id}`,
        {
          suite: INJECTION_RECALL_SUITE_ID,
          factId: fact.id,
          question: fact.question,
        },
        expected,
        async () => {
          const block = await port.buildBlock(
            fact.question,
            world.workspaceRoot,
          );
          const roster = await port.buildSessionStartBlock(world.workspaceRoot);
          const hitLines = numberedLines(block);
          const rosterLines = numberedLines(roster);
          const inBlock = anyMatch(
            fact,
            hitLines.map((line) => ({ content: line })),
          );
          const inRoster = anyMatch(
            fact,
            rosterLines.map((line) => ({ content: line })),
          );
          const value: InjectionValue = {
            product: inBlock || inRoster,
            lastN: anyMatch(fact, lastN),
            grep: anyMatch(
              fact,
              rawTranscriptGrepTopK(
                world.transcripts,
                grepKeywords(fact.question),
              ),
            ),
            none: anyMatch(fact, noMemoryBaseline()),
          };
          const outcomeOf = (hit: boolean) =>
            (hit ? 'pass' : 'fail') as 'pass' | 'fail';
          return {
            value,
            verdict: {
              expected,
              observed: `block hits=${hitLines.length}; roster subjects=${rosterLines.length}; found in ${inBlock ? 'block' : inRoster ? 'roster' : 'neither'}`,
              outcome: outcomeOf(value.product),
              baselineOutcomes: {
                'last-n': outcomeOf(value.lastN),
                'grep-top5': outcomeOf(value.grep),
                'no-memory': outcomeOf(value.none),
              },
            },
          };
        },
      ),
    );
  }
  const cases = caseRecords(recorded);
  const values = completed(recorded);
  const share = (pick: (value: InjectionValue) => boolean): Rate =>
    rate(values.filter(pick).length, values.length);
  // Every seeded question needs exactly one fact, so Acc@k all-correct
  // equals per-question recall; both are reported as the design asks.
  const metricsOf = (pick: (value: InjectionValue) => boolean) => ({
    ...rateMetrics('recall', share(pick)),
    ...rateMetrics('accAllCorrect', share(pick)),
  });
  const productMetrics = metricsOf((value) => value.product);
  const baselines = [
    {
      id: 'last-n',
      label: `last ${LAST_N_MESSAGES} seed messages, newest last`,
      metrics: metricsOf((v) => v.lastN),
    },
    {
      id: 'grep-top5',
      label: 'raw transcript grep, top-5 lines by keyword hits',
      metrics: metricsOf((v) => v.grep),
    },
    {
      id: 'no-memory',
      label: 'no memory injected',
      metrics: metricsOf((v) => v.none),
    },
  ];
  const productRecall = share((value) => value.product);
  const bestNaive = Math.max(
    share((value) => value.lastN).value ?? 0,
    share((value) => value.grep).value ?? 0,
  );
  const errors = errorCount(cases);
  const naReason = values.length === 0 ? 'no-completed-questions' : undefined;
  const pass = errors === 0 && (productRecall.value ?? 0) >= bestNaive;
  return {
    cases,
    result: {
      suiteId: INJECTION_RECALL_SUITE_ID,
      kind: 'curation',
      details: {
        operation: 'injection-recall',
        cases: values.length,
        accAllCorrect: productRecall.value,
        recall: productRecall.value,
        k: INJECTION_K,
      },
      claim: {
        source: 'code',
        ref: 'libs/backend/agent-sdk/src/lib/helpers/memory-prompt-injector.ts:107-258',
        text: 'Injected memory carries the fact a seeded question needs at least as often as a naive context.',
      },
      groundTruth: GROUND_TRUTH,
      baselines,
      deltas: Object.fromEntries(
        baselines.map((baseline) => [
          baseline.id,
          deltaOf(productMetrics, baseline.metrics),
        ]),
      ),
      cost: costOf(cases, world.calls + 2 * cases.length),
      modelCalls: 0,
      verdict: naReason !== undefined ? 'na' : pass ? 'pass' : 'fail',
      ...(naReason === undefined ? {} : { naReason }),
      metrics: { ...productMetrics, errors },
      cassetteVersion: null,
    },
  };
}

// -------------------------------------------------------------- abstention

interface AbstentionValue {
  readonly injectedHits: number;
  readonly scores: readonly number[];
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

async function runAbstention(
  world: ReadWorld,
  port: ReadSidePort,
): Promise<{ result: SuiteResultInput; cases: CaseRecord[] }> {
  const recorded: RecordedCase<AbstentionValue>[] = [];
  for (const item of world.abstention) {
    const expected = 'buildBlock injects nothing';
    recorded.push(
      await recordCase(
        `abstain.${item.id}`,
        {
          suite: ABSTENTION_SUITE_ID,
          id: item.id,
          origin: item.origin,
          question: item.question,
        },
        expected,
        async () => {
          const block = await port.buildBlock(
            item.question,
            world.workspaceRoot,
          );
          const injectedHits = numberedLines(block).length;
          // The injector's reader is `search(query, MAX_HITS, root)` over
          // `searchRich`; the same call exposes the scores it filtered.
          const rich = await port.searchRich(
            item.question,
            INJECTION_K,
            world.workspaceRoot,
          );
          const scores =
            injectedHits === 0
              ? []
              : rich.hits
                  .map((hit) => hit.score)
                  .filter((score) => score >= MIN_SCORE);
          return {
            value: { injectedHits, scores },
            verdict: {
              expected,
              observed: `origin=${item.origin}; injected hits=${injectedHits}; top score=${scores.length === 0 ? 'none' : Math.max(...scores).toFixed(6)}`,
              outcome: injectedHits === 0 ? 'pass' : 'fail',
              baselineOutcomes: { 'no-memory': 'pass' },
            },
          };
        },
      ),
    );
  }
  const cases = caseRecords(recorded);
  const values = completed(recorded);
  const falseInjection = rate(
    values.filter((value) => value.injectedHits > 0).length,
    values.length,
  );
  const totalHits = values.reduce((sum, value) => sum + value.injectedHits, 0);
  const scores = values.flatMap((value) => value.scores);
  const errors = errorCount(cases);
  const naReason =
    values.length < MIN_ABSTENTION_CASES
      ? `cases-below-design-minimum: ${values.length} of ${MIN_ABSTENTION_CASES}`
      : undefined;
  const pass = errors === 0 && falseInjection.num === 0;
  const productMetrics = rateMetrics('falseInjectionRate', falseInjection);
  const noMemoryMetrics = rateMetrics(
    'falseInjectionRate',
    rate(0, values.length),
  );
  return {
    cases,
    result: {
      suiteId: ABSTENTION_SUITE_ID,
      kind: 'curation',
      details: {
        operation: 'abstention',
        cases: values.length,
        falseInjectionRate: falseInjection.value,
        meanInjectedHits: values.length === 0 ? 0 : totalHits / values.length,
      },
      claim: {
        source: 'code',
        ref: 'libs/backend/agent-sdk/src/lib/helpers/memory-prompt-injector.ts:62,115',
        text: 'The MIN_SCORE 0.05 floor keeps memory out of the prompt when the asked fact is not stored.',
      },
      groundTruth: GROUND_TRUTH,
      baselines: [
        {
          id: 'no-memory',
          label: 'no memory injected',
          metrics: noMemoryMetrics,
        },
      ],
      deltas: { 'no-memory': deltaOf(productMetrics, noMemoryMetrics) },
      cost: costOf(cases, world.calls + 2 * cases.length),
      modelCalls: 0,
      verdict: naReason !== undefined ? 'na' : pass ? 'pass' : 'fail',
      ...(naReason === undefined ? {} : { naReason }),
      metrics: {
        ...productMetrics,
        meanInjectedHits:
          values.length === 0 ? null : totalHits / values.length,
        injectedHits: totalHits,
        minScore: MIN_SCORE,
        injectedScoreMin: scores.length === 0 ? null : Math.min(...scores),
        injectedScoreP50: median(scores),
        injectedScoreMax: scores.length === 0 ? null : Math.max(...scores),
        errors,
      },
      cassetteVersion: null,
    },
  };
}

// ---------------------------------------------------------------- suites

type ReadSideRun = (
  world: ReadWorld,
  port: ReadSidePort,
) => Promise<{ result: SuiteResultInput; cases: CaseRecord[] }>;

function readSideSuite(
  id: string,
  run: ReadSideRun,
  portOf: (container: BenchHostContainer) => ReadSidePort,
): MemorySkillsHostSuite {
  return {
    id,
    async run(context) {
      const options = readSideOptionsSchema.parse(context.options ?? {});
      const port = portOf(context.container);
      const world = await buildWorld(context, id, options, port);
      const { result, cases } = await run(world, port);
      writeSuiteResult(context.runDir, result, cases);
    },
  };
}

/** The three read-side host suites. Specs pass a fake port; the host uses the container. */
export function createReadSideSuites(
  portOf: (
    container: BenchHostContainer,
  ) => ReadSidePort = containerReadSidePort,
): readonly MemorySkillsHostSuite[] {
  return [
    readSideSuite(FTS_AND_SUITE_ID, runFtsAnd, portOf),
    readSideSuite(INJECTION_RECALL_SUITE_ID, runInjectionRecall, portOf),
    readSideSuite(ABSTENTION_SUITE_ID, runAbstention, portOf),
  ];
}

/** Registered in the host entry's `HOST_SUITES`. */
export const READ_SIDE_SUITES = createReadSideSuites();
