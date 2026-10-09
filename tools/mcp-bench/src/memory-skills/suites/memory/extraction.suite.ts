/**
 * `mem.extraction` (benchmark-design.md 3.1, seeded slice + long-session
 * class). Host suite: it drives the real `MemoryCuratorService.curate`
 * (R-M3) inside the bench host, with `CURATOR_LLM` replaced by the
 * record/replay double, then reads the stored rows back through `MemoryStore`.
 *
 * Cases:
 *   - `seeded/<factId>`: one standard seeded session per `gt-memory@v1` fact,
 *     each carrying one bait (design 3.1 slice "Seeded");
 *   - `long-middle/<n>` and `long-head/<n>`: the long-session class. The same
 *     facts are planted in the clamp-dropped middle windows, and again in
 *     window 1 (the head-recall baseline). Middle-window recall and head
 *     recall are reported separately; middle recall is expected to be about 0
 *     today (forensics M2 mode (d)).
 *
 * Every case curates into its own workspace key, so no case can merge into
 * another case's rows and every `resolve` cassette key is independent of case
 * order and of embedder ranking (R9). Cross-session merging is `mem.dedup`'s.
 *
 * Measurement:
 *   - a fact is present when a stored row matches it with the R-M4 matcher;
 *   - a bait is written when a row matches one of its signatures
 *     (`bait-signatures.ts`, provisional);
 *   - every rate is `rate(num, den)` (`curation-metrics.ts`), so its value is
 *     exactly `num / den`, and its counts are in `details` and `baselines`;
 *   - baselines: extract-all (every user/assistant message is a row) and no
 *     memory. The old-prompt baseline is local and live-only (design 3.1) and
 *     is not part of this suite.
 *
 * Verdict: `na: cassette-miss` when any replayed call missed (R-M5); otherwise
 * `na: matcher-unvalidated` until the R-M4 agreement bar is met (option
 * `matcherValidated`); otherwise `pass` only when at least one case ran and
 * every case passed.
 *
 * Host-only: imports the memory-curator barrel and the seeded-session
 * generator (`../../host-only-imports.spec.ts`).
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import {
  CURATOR_MAX_WINDOWS,
  MEMORY_TOKENS,
  planCuratorWindows,
  type CuratorRunStats,
  type MemoryCuratorEvent,
  type MemoryCuratorService,
  type MemoryStore,
} from '@ptah-extension/memory-curator';
import { z } from 'zod';

import { extractAllBaseline } from '../../baselines/write-side-baselines';
import { curatorExtractKey } from '../../doubles/recorded-curator-llm';
import { factSchema, type Fact } from '../../ground-truth/label-schemas';
import {
  fixedDailyClock,
  generateLongSeededSession,
  generateSeededSession,
  maxMiddlePlantings,
  parseDistractorBank,
  type BaitClass,
  type DistractorBankRecord,
  type PlantedStatement,
  type SeededSession,
} from '../../ground-truth/seeded-session-generator';
import type {
  MemorySkillsHostSuite,
  MemorySkillsHostSuiteContext,
} from '../../host/memory-skills-host';
import {
  matchesFact,
  type MatchableMemoryRow,
} from '../../matching/fact-matcher';
import {
  curationDetailsSchema,
  type CurationDetails,
} from '../../memory-skills-suite-kinds';
import { pairedBootstrapDelta } from '../../metrics/bootstrap';
import {
  falseMemoryRate,
  precision,
  rate,
  recall,
  type Rate,
} from '../../metrics/curation-metrics';
import {
  runCaseWithSafetyCap,
  SAFETY_CAP_ERROR,
} from '../../runner/case-runner';
import {
  writeSuiteResult,
  type CaseRecord,
  type SuiteResultInput,
} from '../../runner/suite-result';
import { BAIT_SIGNATURES } from './bait-signatures';

export const EXTRACTION_SUITE_ID = 'mem.extraction';

/** Fixture targets the plan seeds into the isolated home (relative to it). */
export const EXTRACTION_FACTS_TARGET = 'memory-skills/memory-facts.v1.jsonl';
export const EXTRACTION_DISTRACTORS_TARGET =
  'memory-skills/distractors.v1.jsonl';

const DEFAULT_SEED = 'TASK_2026_620:gt-memory@v1';
const BOOTSTRAP = { resamples: 10_000, seed: 'TASK_2026_620', alpha: 0.05 };

export const extractionOptionsSchema = z
  .strictObject({
    factsFile: z.string().min(1).default(EXTRACTION_FACTS_TARGET),
    distractorsFile: z.string().min(1).default(EXTRACTION_DISTRACTORS_TARGET),
    /** Version id of the curator cassette the plan supplies. */
    cassetteVersion: z.string().min(1).default('extraction.v1'),
    seed: z.string().min(1).default(DEFAULT_SEED),
    /** R-M4: the matcher's human-agreement bar (`gt-matcher@v1`) is met. */
    matcherValidated: z.boolean().default(false),
    /** Per-case safety cap override (specs); default `case-runner.ts`. */
    capMs: z.number().int().positive().optional(),
    /** Restrict deterministic plan order for a live diagnostic probe. */
    caseLimit: z.number().int().positive().optional(),
  })
  .prefault({});

/** A stored memory row as the matcher reads it. */
export interface ExtractionRow {
  readonly subject: string | null;
  readonly content: string;
  readonly chunks: readonly string[];
}

/** What the suite needs from the product; the host wires the container. */
export interface ExtractionEnv {
  curate(input: {
    sessionId: string;
    workspaceRoot: string;
    transcript: string;
    signal: AbortSignal;
  }): Promise<CuratorRunStats>;
  rowsFor(workspaceRoot: string): readonly ExtractionRow[];
  /** Subscribes to the curator's `curator-error` events; returns the disposer. */
  onCuratorError(
    listener: (event: { sessionId?: string; error: string }) => void,
  ): () => void;
  /** Redacted record-mode cause chain retained by the bench double. */
  curatorFailureDetail?(): string | null;
  /** Calls the record/replay double has seen (extract + resolve). */
  modelCalls(): number;
}

export interface ExtractionRunInput {
  readonly runDir: string;
  /** Root the fixture paths are relative to (the isolated home). */
  readonly home: string;
  readonly workspaceRoot: string;
  readonly options: unknown;
  readonly env: ExtractionEnv;
  /** CI/replay suites must always evaluate their complete deterministic plan. */
  readonly ci?: boolean;
}

type Slice = 'seeded' | 'long-middle' | 'long-head';
type RowLabel = 'seeded' | 'other' | 'unlabelled';

interface PlannedCase {
  readonly caseId: string;
  readonly slice: Slice;
  readonly session: SeededSession;
  /** Facts the case expects to be stored. */
  readonly targets: readonly Fact[];
  /** Facts of the DO-NOT-EXTRACT class planted in this case. */
  readonly abstentions: readonly Fact[];
}

/** One policy's view of a case: the system, extract-all or no memory. */
interface Observation {
  readonly present: ReadonlySet<string>;
  readonly abstentionsWritten: ReadonlySet<string>;
  readonly baitsWritten: ReadonlySet<string>;
  readonly labels: readonly RowLabel[];
}

interface EvaluatedCase {
  readonly planned: PlannedCase;
  readonly system: Observation;
  readonly extractAll: Observation;
  readonly noMemory: Observation;
  readonly record: CaseRecord;
  readonly cassetteMiss: boolean;
}

const BASELINES = [
  { id: 'extract-all', label: 'extract-all (every message is a row)' },
  { id: 'no-memory', label: 'no memory' },
] as const;
type BaselineId = (typeof BASELINES)[number]['id'];

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function readJsonl<T>(path: string, parse: (value: unknown) => T): T[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return parse(JSON.parse(line));
      } catch (error: unknown) {
        throw new Error(
          `${path}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
    });
}

/** A fixture path relative to `home`; refuses one that escapes it. */
function fixturePath(home: string, relative: string): string {
  const root = resolve(home);
  const full = resolve(root, relative);
  if (!full.startsWith(`${root}${sep}`)) {
    throw new Error(`fixture ${relative} lies outside the isolated home`);
  }
  return full;
}

function planting(fact: Fact): PlantedStatement {
  return { factId: fact.id, statement: fact.statement, date: fact.date };
}

/** Long-session groups: pairs, the last group takes the odd fact (cap 4). */
function longGroups(facts: readonly Fact[]): Fact[][] {
  const groups: Fact[][] = [];
  for (let index = 0; index + 1 < facts.length; index += 2) {
    groups.push([facts[index], facts[index + 1]]);
  }
  if (facts.length % 2 === 1 && groups.length > 0) {
    groups[groups.length - 1].push(facts[facts.length - 1]);
  }
  const cap = maxMiddlePlantings();
  if (groups.some((group) => group.length > cap)) {
    throw new Error(`a long session plants at most ${cap} middle facts`);
  }
  return groups;
}

export function planExtractionCases(
  facts: readonly Fact[],
  bank: readonly DistractorBankRecord[],
  seed: string,
): PlannedCase[] {
  const cases: PlannedCase[] = facts.map((fact) => ({
    caseId: `seeded/${fact.id}`,
    slice: 'seeded',
    session: generateSeededSession({
      seed,
      planting: planting(fact),
      bank,
      clock: fixedDailyClock,
    }),
    targets: fact.category === 'abstention' ? [] : [fact],
    abstentions: fact.category === 'abstention' ? [fact] : [],
  }));
  const durable = facts.filter((fact) => fact.category !== 'abstention');
  longGroups(durable).forEach((group, index) => {
    for (const placement of ['middle', 'head'] as const) {
      cases.push({
        caseId: `long-${placement}/${index + 1}`,
        slice: placement === 'middle' ? 'long-middle' : 'long-head',
        session: generateLongSeededSession({
          seed,
          plantings: group.map(planting),
          bank,
          clock: fixedDailyClock,
          factPlacement: placement,
        }),
        targets: group,
        abstentions: [],
      });
    }
  });
  const unsigned = cases
    .flatMap((c) => c.session.baits)
    .find((bait) => BAIT_SIGNATURES[bait.id] === undefined);
  if (unsigned !== undefined) {
    throw new Error(
      `bait ${unsigned.id} has no signature; FMR would pass vacuously`,
    );
  }
  return cases;
}

function observe(
  rows: readonly MatchableMemoryRow[],
  planned: PlannedCase,
): Observation {
  const present = new Set<string>();
  const abstentionsWritten = new Set<string>();
  const baitsWritten = new Set<string>();
  const labels = rows.map((row): RowLabel => {
    let label: RowLabel = 'unlabelled';
    for (const fact of planned.targets) {
      if (matchesFact(fact, row)) {
        present.add(fact.id);
        label = 'seeded';
      }
    }
    let other = false;
    for (const fact of planned.abstentions) {
      if (matchesFact(fact, row)) {
        abstentionsWritten.add(fact.id);
        other = true;
      }
    }
    for (const bait of planned.session.baits) {
      const signatures = BAIT_SIGNATURES[bait.id] ?? [];
      if (signatures.some((signature) => matchesFact(signature, row))) {
        baitsWritten.add(bait.id);
        other = true;
      }
    }
    return label === 'seeded' ? label : other ? 'other' : label;
  });
  return { present, abstentionsWritten, baitsWritten, labels };
}

function passes(observation: Observation, planned: PlannedCase): boolean {
  return (
    planned.targets.every((fact) => observation.present.has(fact.id)) &&
    observation.abstentionsWritten.size === 0 &&
    observation.baitsWritten.size === 0
  );
}

function describeObservation(observation: Observation, rows: number): string {
  const list = (values: ReadonlySet<string>): string =>
    values.size === 0 ? 'none' : [...values].sort().join(', ');
  const count = (label: RowLabel): number =>
    observation.labels.filter((value) => value === label).length;
  return (
    `present: ${list(observation.present)}; abstention written: ` +
    `${list(observation.abstentionsWritten)}; baits written: ` +
    `${list(observation.baitsWritten)}; rows: ${rows} (seeded ` +
    `${count('seeded')}, other ${count('other')}, unlabelled ` +
    `${count('unlabelled')})`
  );
}

function expectation(planned: PlannedCase): string {
  const ids = (facts: readonly Fact[]): string =>
    facts.length === 0 ? 'none' : facts.map((fact) => fact.id).join(', ');
  const baits = planned.session.baits.map((bait) => bait.id);
  return (
    `present: ${ids(planned.targets)}; not written: ` +
    `${[...planned.abstentions.map((fact) => fact.id), ...baits].join(', ') || 'none'}`
  );
}

function caseWorkspace(workspaceRoot: string, caseId: string): string {
  return join(
    workspaceRoot,
    '.memory-skills-bench',
    EXTRACTION_SUITE_ID,
    caseId.replace(/[^A-Za-z0-9.-]/g, '-'),
  );
}

async function runCase(
  planned: PlannedCase,
  input: ExtractionRunInput,
  capMs: number | undefined,
): Promise<EvaluatedCase> {
  const { session } = planned;
  const workspaceRoot = caseWorkspace(input.workspaceRoot, planned.caseId);
  const errors: string[] = [];
  const dispose = input.env.onCuratorError((event) => {
    if (event.sessionId === session.sessionId) errors.push(event.error);
  });
  let caseError: string | null = null;
  let latencyMs = 0;
  let attempts = 1;
  try {
    const run = await runCaseWithSafetyCap(
      (signal) =>
        input.env.curate({
          sessionId: session.sessionId,
          workspaceRoot,
          transcript: session.transcript,
          signal,
        }),
      capMs === undefined ? {} : { capMs },
    );
    latencyMs = run.latencyMs;
    attempts = run.attempts;
    if (run.outcome === SAFETY_CAP_ERROR) caseError = SAFETY_CAP_ERROR;
  } catch (error: unknown) {
    caseError = `curator-threw: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    dispose();
  }
  const failureDetail = input.env.curatorFailureDetail?.();
  const miss = errors.find((error) => error.includes('Cassette miss for '));
  if (caseError === null && miss !== undefined) {
    caseError = `cassette-miss: ${miss}`;
  } else if (caseError === null && errors.length > 0) {
    caseError = `curator-error: ${errors[0]}${failureDetail ? `; cause-chain: ${failureDetail}` : ''}`;
  }

  const rows = input.env
    .rowsFor(workspaceRoot)
    .map((row) => ({ ...row, chunk: row.chunks.join('\n') }));
  const system = observe(rows, planned);
  const extractAll = observe(
    extractAllBaseline(
      session.turns.map((turn) => ({ role: turn.role, text: turn.text })),
    ),
    planned,
  );
  const noMemory = observe([], planned);
  const outcome =
    caseError === null && passes(system, planned) ? 'pass' : 'fail';
  const firstWindow = planCuratorWindows(session.transcript, {
    maxWindows: CURATOR_MAX_WINDOWS,
  }).windows[0];
  const record: CaseRecord = {
    caseId: planned.caseId,
    inputSha256: sha256(session.transcript),
    expected: expectation(planned),
    observed: describeObservation(system, rows.length),
    outcome,
    baselineOutcomes: {
      'extract-all': passes(extractAll, planned) ? 'pass' : 'fail',
      'no-memory': passes(noMemory, planned) ? 'pass' : 'fail',
    },
    cassetteKey:
      firstWindow === undefined ? null : curatorExtractKey(firstWindow.text),
    latencyMs,
    attempts,
    error: caseError,
  };
  return {
    planned,
    system,
    extractAll,
    noMemory,
    record,
    cassetteMiss: caseError?.startsWith('cassette-miss') === true,
  };
}

/** The rates of one policy over the evaluated cases. */
interface PolicyRates {
  readonly recallSeeded: Rate;
  readonly recallLongMiddle: Rate;
  readonly recallLongHead: Rate;
  readonly precisionSeeded: Rate;
  readonly fmrSeeded: Rate;
}

function policyRates(
  cases: readonly EvaluatedCase[],
  pick: (evaluated: EvaluatedCase) => Observation,
): PolicyRates {
  const sliceRecall = (slice: Slice): Rate => {
    const inSlice = cases.filter((c) => c.planned.slice === slice);
    // Fact ids repeat across long groups only by construction of the slice,
    // so the (case, fact) pair is the unit.
    const seeded = inSlice.flatMap((c) =>
      c.planned.targets.map((fact) => `${c.planned.caseId}#${fact.id}`),
    );
    const present = inSlice.flatMap((c) =>
      [...pick(c).present].map((id) => `${c.planned.caseId}#${id}`),
    );
    return recall(seeded, present);
  };
  const seeded = cases.filter((c) => c.planned.slice === 'seeded');
  const baits = seeded.flatMap((c) => c.planned.session.baits);
  const written = seeded.reduce((sum, c) => sum + pick(c).baitsWritten.size, 0);
  return {
    recallSeeded: sliceRecall('seeded'),
    recallLongMiddle: sliceRecall('long-middle'),
    recallLongHead: sliceRecall('long-head'),
    precisionSeeded: precision(seeded.flatMap((c) => [...pick(c).labels])),
    fmrSeeded: falseMemoryRate(written, baits.length),
  };
}

const RATE_KEYS = {
  recallSeeded: 'recall.seeded',
  recallLongMiddle: 'recall.longMiddle',
  recallLongHead: 'recall.longHead',
  precisionSeeded: 'precision.seeded',
  fmrSeeded: 'fmr.seeded',
} as const satisfies Record<keyof PolicyRates, string>;

/** `metric`, `metric.num`, `metric.den` for every rate. */
function rateMetrics(rates: PolicyRates): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const [field, key] of Object.entries(RATE_KEYS)) {
    const value = rates[field as keyof PolicyRates];
    out[key] = value.value;
    out[`${key}.num`] = value.num;
    out[`${key}.den`] = value.den;
  }
  return out;
}

function difference(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : left - right;
}

/** Per-(case, fact) recall indicators of the seeded slice, for the paired bootstrap. */
function seededIndicators(
  cases: readonly EvaluatedCase[],
  pick: (evaluated: EvaluatedCase) => Observation,
): number[] {
  return cases
    .filter((c) => c.planned.slice === 'seeded')
    .flatMap((c) =>
      c.planned.targets.map((fact) => (pick(c).present.has(fact.id) ? 1 : 0)),
    );
}

type ExtractionDetails = Extract<CurationDetails, { operation: 'extraction' }>;

function extractionDetails(
  cases: readonly EvaluatedCase[],
  cassette: string,
): ExtractionDetails {
  const seeded = cases.filter((c) => c.planned.slice === 'seeded');
  const labels = seeded.flatMap((c) => [...c.system.labels]);
  const count = (label: RowLabel): number =>
    labels.filter((value) => value === label).length;
  const rates = policyRates(cases, (c) => c.system);
  const recallValue = rates.recallSeeded.value;
  const precisionValue = rates.precisionSeeded.value;

  const byCategory: Record<
    string,
    { tp: number; fp: number; fn: number; tn?: number }
  > = {};
  for (const c of seeded) {
    for (const fact of c.planned.targets) {
      const entry = (byCategory[fact.category] ??= { tp: 0, fp: 0, fn: 0 });
      if (c.system.present.has(fact.id)) entry.tp += 1;
      else entry.fn += 1;
    }
    for (const fact of c.planned.abstentions) {
      const entry = (byCategory[fact.category] ??= {
        tp: 0,
        fp: 0,
        fn: 0,
        tn: 0,
      });
      if (c.system.abstentionsWritten.has(fact.id)) entry.fp += 1;
      else entry.tn = (entry.tn ?? 0) + 1;
    }
  }
  for (const slice of ['long-middle', 'long-head'] as const) {
    const sliceRate =
      slice === 'long-middle' ? rates.recallLongMiddle : rates.recallLongHead;
    byCategory[slice] = {
      tp: sliceRate.num,
      fp: 0,
      fn: sliceRate.den - sliceRate.num,
    };
  }

  const bySedimentClass: Record<string, number> = {};
  for (const c of seeded) {
    for (const bait of c.planned.session.baits) {
      const baitClass: BaitClass = bait.baitClass;
      bySedimentClass[`${baitClass}.planted`] =
        (bySedimentClass[`${baitClass}.planted`] ?? 0) + 1;
      bySedimentClass[`${baitClass}.written`] =
        (bySedimentClass[`${baitClass}.written`] ?? 0) +
        (c.system.baitsWritten.has(bait.id) ? 1 : 0);
    }
  }

  return {
    operation: 'extraction',
    slice: 'seeded',
    // Row-level tp/fp (precision) and fact-level fn (recall); see the report.
    confusion: {
      tp: count('seeded'),
      fp: count('other'),
      fn: rates.recallSeeded.den - rates.recallSeeded.num,
      unlabelled: count('unlabelled'),
    },
    recall: recallValue,
    precision: precisionValue,
    // Derived score, not a count rate: 2PR / (P + R).
    f1:
      recallValue === null ||
      precisionValue === null ||
      recallValue + precisionValue === 0
        ? null
        : (2 * precisionValue * recallValue) / (precisionValue + recallValue),
    fmr: rates.fmrSeeded.value,
    baits: rates.fmrSeeded.den,
    overSuppression: null,
    byCategory,
    bySedimentClass,
    matcher: { id: 'r-m4-fact-matcher', version: 'v1' },
    cassette,
  };
}

function percentile(values: readonly number[], share: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1)
  ];
}

export async function runExtractionSuite(
  input: ExtractionRunInput,
): Promise<{ result: SuiteResultInput; cases: CaseRecord[] }> {
  const options = extractionOptionsSchema.parse(input.options);
  if (input.ci && options.caseLimit !== undefined) {
    throw new Error('caseLimit is refused for CI/replay suites');
  }
  const facts = readJsonl(fixturePath(input.home, options.factsFile), (value) =>
    factSchema.parse(value),
  );
  const bank = parseDistractorBank(
    readFileSync(fixturePath(input.home, options.distractorsFile), 'utf8'),
  );
  const planned = planExtractionCases(facts, bank, options.seed).slice(
    0,
    options.caseLimit,
  );

  const callsBefore = input.env.modelCalls();
  const evaluated: EvaluatedCase[] = [];
  for (const entry of planned) {
    evaluated.push(await runCase(entry, input, options.capMs));
    // Fail closed: a curator that never reaches the double was constructed
    // before the override and would call the real adapter.
    if (evaluated.length === 1 && input.env.modelCalls() === callsBefore) {
      throw new Error(
        'the curator did not call the record/replay double; CURATOR_LLM was not replaced',
      );
    }
  }
  const modelCalls = input.env.modelCalls() - callsBefore;

  const details = curationDetailsSchema.parse({
    ...extractionDetails(evaluated, options.cassetteVersion),
    ...(options.caseLimit === undefined
      ? {}
      : {
          caseLimit: options.caseLimit,
          truncationNote: 'suite truncated by caseLimit' as const,
        }),
  });

  const system = policyRates(evaluated, (c) => c.system);
  const baselineRates: Record<BaselineId, PolicyRates> = {
    'extract-all': policyRates(evaluated, (c) => c.extractAll),
    'no-memory': policyRates(evaluated, (c) => c.noMemory),
  };
  const systemIndicators = seededIndicators(evaluated, (c) => c.system);
  const deltas: Record<string, Record<string, number | null>> = {};
  for (const baseline of BASELINES) {
    const other = baselineRates[baseline.id];
    const interval = pairedBootstrapDelta(
      seededIndicators(
        evaluated,
        baseline.id === 'extract-all' ? (c) => c.extractAll : (c) => c.noMemory,
      ),
      systemIndicators,
      BOOTSTRAP,
    );
    const row: Record<string, number | null> = {};
    for (const [field, key] of Object.entries(RATE_KEYS)) {
      const name = field as keyof PolicyRates;
      row[key] = difference(system[name].value, other[name].value);
    }
    row['recall.seeded.ci95.lo'] = interval === null ? null : interval[0];
    row['recall.seeded.ci95.hi'] = interval === null ? null : interval[1];
    deltas[baseline.id] = row;
  }

  const records = evaluated.map((c) => c.record);
  const misses = evaluated.filter((c) => c.cassetteMiss).length;
  const allPass =
    records.length > 0 && records.every((record) => record.outcome === 'pass');
  const verdict: SuiteResultInput['verdict'] =
    options.caseLimit !== undefined || misses > 0 || !options.matcherValidated
      ? 'na'
      : allPass
        ? 'pass'
        : 'fail';
  const naReason =
    options.caseLimit !== undefined
      ? 'truncated-probe'
      : misses > 0
        ? 'cassette-miss'
        : !options.matcherValidated
          ? 'matcher-unvalidated'
          : undefined;
  const latencies = records.map((record) => record.latencyMs);

  const result: SuiteResultInput = {
    suiteId: EXTRACTION_SUITE_ID,
    kind: 'curation',
    details,
    claim: {
      // 619 reserves `prompt` for ptah-core-prompt.ts:<line>; the curator's
      // extraction prompt is product code, so it is a `code` claim.
      source: 'code',
      ref: 'libs/backend/agent-sdk/src/lib/curator-llm-adapter/extract-prompt.ts:54-66',
      text: 'durable facts are extracted; sediment classes are not',
    },
    groundTruth: { id: 'gt-memory', version: 'v1', method: 'seeded' },
    baselines: BASELINES.map((baseline) => ({
      id: baseline.id,
      label: baseline.label,
      metrics: rateMetrics(baselineRates[baseline.id]),
    })),
    deltas,
    cost: {
      calls: modelCalls,
      latency_ms: {
        p50: percentile(latencies, 0.5),
        p95: percentile(latencies, 0.95),
      },
      error_rate: rate(
        records.filter((record) => record.error != null).length,
        records.length,
      ).value,
      tokens: {},
    },
    modelCalls,
    verdict,
    ...(naReason === undefined ? {} : { naReason }),
    metrics: {
      [RATE_KEYS.recallSeeded]: system.recallSeeded.value,
      [RATE_KEYS.recallLongMiddle]: system.recallLongMiddle.value,
      [RATE_KEYS.recallLongHead]: system.recallLongHead.value,
      [RATE_KEYS.precisionSeeded]: system.precisionSeeded.value,
      [RATE_KEYS.fmrSeeded]: system.fmrSeeded.value,
    },
    cassetteVersion: options.cassetteVersion,
  };
  writeSuiteResult(input.runDir, result, records);
  return { result, cases: records };
}

/** The container-backed environment inside the bench host. */
export function hostExtractionEnv(
  context: MemorySkillsHostSuiteContext,
): ExtractionEnv {
  const curator = context.container.resolve<MemoryCuratorService>(
    MEMORY_TOKENS.MEMORY_CURATOR,
  );
  const store = context.container.resolve<MemoryStore>(
    MEMORY_TOKENS.MEMORY_STORE,
  );
  const double = context.doubles.curator;
  return {
    // A user-initiated pass skips the background-work governor wait, as
    // `memory:runNow` does; the extract and resolve inputs are unchanged.
    curate: (request) => curator.curate({ ...request, userInitiated: true }),
    rowsFor: (workspaceRoot) =>
      store.list({ workspaceRoot, limit: 500 }).memories.map((memory) => ({
        subject: memory.subject,
        content: memory.content,
        chunks: store.getChunks(memory.id).map((chunk) => chunk.text),
      })),
    onCuratorError: (listener) => {
      const subscription = curator.onEvent((event: MemoryCuratorEvent) => {
        if (event.kind === 'curator-error') {
          listener({ sessionId: event.sessionId, error: event.error ?? '' });
        }
      });
      return () => subscription.dispose();
    },
    modelCalls: () => {
      const counts = double.callCounts();
      return counts.extract + counts.resolve;
    },
    curatorFailureDetail: () => double.lastFailureMessage(),
  };
}

export function createExtractionSuite(): MemorySkillsHostSuite {
  return {
    id: EXTRACTION_SUITE_ID,
    run: async (context) => {
      await runExtractionSuite({
        runDir: context.runDir,
        home: context.isolation.home,
        workspaceRoot: context.workspaceRoot,
        options: context.options,
        env: hostExtractionEnv(context),
        ci: context.ci,
      });
    },
  };
}
