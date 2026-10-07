/**
 * Gate and measured noise margins (Task 10.1).
 *
 * Gate rule (context.md): a tool that scores below its native baseline fails.
 * The comparison is the one the runner used: each retrieval suite names its
 * deciding native baseline and primary metric in `details`, and the gate
 * re-reads `deltas[decidingBaseline][primaryMetric]` (sign-normalised, so a
 * negative delta is a tool worse than native) against the suite's noise
 * margin.
 *
 * Noise margin: two standard deviations of that delta over three baseline
 * runs, stored per suite in `baseline/noise-margins.json`. The runner reads
 * the file; `--noise-margin` overrides it; with no file the constant
 * {@link NOISE_MARGIN} applies.
 *
 * A run failure (the bench exited non-zero, including exit 2: scorecard
 * written but a host, baseline or scenario failed to run) is never a verdict.
 * The gate reports it as a run failure and reads no scorecard.
 *
 * Commands (dispatched by `main.ts`):
 *   gate --scorecard <scorecard.json> [--bench-exit <n>] [--noise-margin <n>]
 *        (see gate-command.ts and baseline.ts for the per-suite modes)
 *   measure-noise --from a.json,b.json,c.json [--write]
 *   measure-noise --runs 3 [--host <h>] [--smoke] [--write]
 *        runs the bench three times (each must exit 0) and measures
 */

import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';

import {
  readScorecard,
  scorecardBaselineDirectory,
} from '../scorecard/scorecard-writers';
import type { Scorecard, ScorecardSuite } from '../scorecard/scorecard.types';
import { NOISE_MARGIN } from '../suites/suite-runner';

/**
 * The margins the PR gate reads: `cli-headless`, `--smoke`. Every other mode
 * (host x smoke/full) has its own file, {@link noiseMarginsFile}, so a margin
 * measured on 200-question full runs never judges a 40-question smoke run.
 */
export const NOISE_MARGINS_FILE = 'noise-margins.json';

/** `noise-margins.json` for cli-headless smoke; `noise-margins.<host>.<smoke|full>.json` otherwise. */
export function noiseMarginsFile(host: string, smoke: boolean): string {
  return host === 'cli-headless' && smoke
    ? NOISE_MARGINS_FILE
    : `noise-margins.${host}.${smoke ? 'smoke' : 'full'}.json`;
}
/** Runs a measurement needs (batches.md: three baseline runs). */
export const MEASUREMENT_RUNS = 3;
/** Standard deviations of the delta that make up the margin. */
export const SIGMA_MULTIPLE = 2;

export const noiseMarginsSchema = z.object({
  schemaVersion: z.literal(2),
  measuredAt: z.string().datetime(),
  runs: z.number().int().min(MEASUREMENT_RUNS),
  host: z.enum(['cli-headless', 'electron', 'vscode']),
  smoke: z.boolean(),
  corpusCommit: z.string().min(1),
  sigmaMultiple: z.literal(SIGMA_MULTIPLE),
  /** Margin per suite key (`<tool> / <groundTruth.id>`), with how it was derived. */
  suites: z.record(
    z.string().min(1),
    z.object({
      /** What the gate uses: `max(sdMargin, floor)`. */
      margin: z.number().min(0).max(1),
      /** SIGMA_MULTIPLE x the sample standard deviation over the runs (raw, may be 0). */
      sdMargin: z.number().min(0),
      /** One question's weight, `1 / questions`: a single flipped question must not fail the gate. */
      floor: z.number().min(0).max(1),
      questions: z.number().int().nonnegative(),
      metric: z.string().min(1),
      /** `native-gap` = the gap to the deciding native baseline; `own-metric` = the suite's own metric (no native baseline). */
      measuredAs: z.enum(['native-gap', 'own-metric']),
    }),
  ),
  /** Pass/fail stability per lifecycle row (`<tool> / <scenario>`); a row that changed verdict is `flaky`. */
  lifecycle: z.record(
    z.string().min(1),
    z.object({
      status: z.enum(['pass', 'fail', 'flaky']),
      passes: z.number().int().min(0),
      runsSeen: z.number().int().min(1),
    }),
  ),
});
export type NoiseMargins = z.infer<typeof noiseMarginsSchema>;

/** The key a suite's margin is stored under; the runner builds it from the definition. */
export function suiteMarginKey(tool: string, groundTruthId: string): string {
  return `${tool} / ${groundTruthId}`;
}

/** The margin for a suite: `--noise-margin`, else the measured one, else {@link NOISE_MARGIN}. */
export function marginFor(
  margins: NoiseMargins | null,
  key: string,
  override?: number,
): number {
  return override ?? margins?.suites[key]?.margin ?? NOISE_MARGIN;
}

/** Reads the stored margins; `null` when none are stored, an error when the file is invalid. */
export async function loadNoiseMargins(
  baselineDirectory: string,
  host = 'cli-headless',
  smoke = true,
): Promise<NoiseMargins | null> {
  let text: string;
  try {
    text = await readFile(
      join(baselineDirectory, noiseMarginsFile(host, smoke)),
      'utf8',
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  return noiseMarginsSchema.parse(JSON.parse(text) as unknown);
}

// ---------------------------------------------------------------------------
// the deciding comparison
// ---------------------------------------------------------------------------

export interface Deciding {
  readonly key: string;
  readonly primaryMetric: string;
  /** `null` when the suite has no native baseline: the gate then reads the suite's own metric. */
  readonly decidingBaseline: string | null;
  readonly questions: number;
}

/** Suites written before `primaryMetric` was recorded without a deciding baseline. */
const LEGACY_OWN_METRIC: Readonly<Record<string, string>> = {
  ptah_memory_search: 'hit@5',
};

export function decidingOf(suite: ScorecardSuite): Deciding | null {
  if (suite.arm !== undefined || suite.verdict === 'na') return null;
  const details = suite.details as {
    tool: string;
    questions?: number;
    primaryMetric?: string;
    decidingBaseline?: string;
  };
  const primaryMetric =
    details.primaryMetric ?? LEGACY_OWN_METRIC[details.tool];
  if (primaryMetric === undefined) return null;
  return {
    key: suiteMarginKey(details.tool, suite.groundTruth.id),
    primaryMetric,
    decidingBaseline: details.decidingBaseline ?? null,
    questions: details.questions ?? 0,
  };
}

export function deltaOf(
  suite: ScorecardSuite,
  deciding: Deciding,
): number | null {
  if (deciding.decidingBaseline === null)
    return (
      (suite.details as { metrics: Record<string, number | null | undefined> })
        .metrics[deciding.primaryMetric] ?? null
    );
  return (
    suite.deltas[deciding.decidingBaseline]?.[deciding.primaryMetric] ?? null
  );
}

/** How the comparison reads in a report. */
export const describeComparison = (deciding: Deciding): string =>
  `${deciding.primaryMetric} ${deciding.decidingBaseline === null ? '(own metric)' : `vs ${deciding.decidingBaseline}`}`;

// ---------------------------------------------------------------------------
// noise measurement
// ---------------------------------------------------------------------------

const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;

function sampleStandardDeviation(values: readonly number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
}

export interface NoiseMeasurement {
  readonly margins: NoiseMargins;
  /** Suites present in the runs but not measurable (a missing or null delta in some run). */
  readonly unmeasured: readonly string[];
}

/**
 * Margin per suite = max({@link SIGMA_MULTIPLE} x the sample standard deviation
 * of the suite's deciding delta over the runs, one question's weight). A suite
 * with no native baseline (memory) uses the spread of its own primary metric.
 * Lifecycle rows are recorded as pass/fail stability. The runs must come from the same
 * host, corpus commit and mode, and each suite must be unique within a run.
 */
export function computeNoiseMargins(
  runs: readonly Scorecard[],
  measuredAt: string,
  smoke: boolean,
): NoiseMeasurement {
  if (runs.length < MEASUREMENT_RUNS)
    throw new Error(
      `a noise measurement needs ${MEASUREMENT_RUNS} runs, got ${runs.length}`,
    );
  const first = runs[0];
  for (const run of runs.slice(1)) {
    if (run.run.host !== first.run.host)
      throw new Error(
        `runs come from different hosts (${first.run.host}, ${run.run.host})`,
      );
    if (run.corpus.commit !== first.corpus.commit)
      throw new Error(
        `runs come from different corpus commits (${first.corpus.commit}, ${run.corpus.commit})`,
      );
  }
  const perRun = runs.map((run) => {
    const byKey = new Map<
      string,
      { value: number | null; questions: number; own: boolean; metric: string }
    >();
    for (const suite of run.suites) {
      const deciding = decidingOf(suite);
      if (deciding === null) continue;
      if (byKey.has(deciding.key))
        throw new Error(
          `run ${run.run.id} has two deciding suites for ${deciding.key}`,
        );
      byKey.set(deciding.key, {
        value: deltaOf(suite, deciding),
        questions: deciding.questions,
        own: deciding.decidingBaseline === null,
        metric: deciding.primaryMetric,
      });
    }
    return byKey;
  });
  const keys = new Set(perRun.flatMap((byKey) => [...byKey.keys()]));
  const suites: NoiseMargins['suites'] = {};
  const unmeasured: string[] = [];
  for (const key of [...keys].sort()) {
    const entries = perRun.map((byKey) => byKey.get(key));
    if (entries.some((entry) => entry === undefined || entry.value === null)) {
      unmeasured.push(key);
      continue;
    }
    const measured = entries as NonNullable<(typeof entries)[number]>[];
    const questions = Math.min(...measured.map((entry) => entry.questions));
    const sdMargin = round4(
      SIGMA_MULTIPLE *
        sampleStandardDeviation(measured.map((entry) => entry.value as number)),
    );
    const floor = questions > 0 ? round4(1 / questions) : 0;
    suites[key] = {
      margin: Math.max(sdMargin, floor),
      sdMargin,
      floor,
      questions,
      metric: measured[0].metric,
      measuredAs: measured[0].own ? 'own-metric' : 'native-gap',
    };
  }
  const lifecycle: NoiseMargins['lifecycle'] = {};
  const rowName = (row: { tool: string; scenario: string }): string =>
    `${row.tool} / ${row.scenario}`;
  const scored = (run: Scorecard) =>
    run.lifecycle.filter((row) => row.na === undefined);
  const rowKeys = new Set(runs.flatMap((run) => scored(run).map(rowName)));
  for (const key of [...rowKeys].sort()) {
    const seen = runs.flatMap((run) =>
      scored(run).filter((row) => rowName(row) === key),
    );
    const passes = seen.filter((row) => row.pass).length;
    lifecycle[key] = {
      status:
        seen.length < runs.length || (passes !== 0 && passes !== seen.length)
          ? 'flaky'
          : passes === 0
            ? 'fail'
            : 'pass',
      passes,
      runsSeen: seen.length,
    };
  }
  return {
    margins: {
      schemaVersion: 2,
      measuredAt,
      runs: runs.length,
      host: first.run.host,
      smoke,
      corpusCommit: first.corpus.commit,
      sigmaMultiple: SIGMA_MULTIPLE,
      suites,
      lifecycle,
    },
    unmeasured,
  };
}

/** Writes the margins atomically (temp file, then rename). */
export async function writeNoiseMargins(
  baselineDirectory: string,
  margins: NoiseMargins,
): Promise<string> {
  await mkdir(baselineDirectory, { recursive: true });
  const path = join(
    baselineDirectory,
    noiseMarginsFile(margins.host, margins.smoke),
  );
  const temp = `${path}.tmp`;
  await writeFile(
    temp,
    `${JSON.stringify(noiseMarginsSchema.parse(margins), null, 2)}\n`,
    'utf8',
  );
  await rename(temp, path);
  return path;
}

// ---------------------------------------------------------------------------
// gate
// ---------------------------------------------------------------------------

export type SuiteOutcome =
  | 'pass'
  | 'below-native'
  | 'unscored'
  | 'over-error-rate'
  | 'na'
  | 'not-compared'
  // recorded-failure mode
  | 'regression'
  | 'improved'
  | 'changed'
  | 'new'
  | 'missing';

/** Outcomes that fail the gate. */
export const FAILING_OUTCOMES: ReadonlySet<SuiteOutcome> = new Set([
  'below-native',
  'unscored',
  'over-error-rate',
  'regression',
  'changed',
  'missing',
]);

/** Error rate above which claim mode fails a suite (same bound as the runner). */
export const MAX_ERROR_RATE_CLAIM = 0.01;

export interface SuiteGateResult {
  readonly suite: string;
  readonly outcome: SuiteOutcome;
  readonly delta: number | null;
  readonly margin: number | null;
  readonly note: string;
}

export interface GateReport {
  /** `run-failure` means no verdict was read. */
  readonly status: 'pass' | 'fail' | 'run-failure';
  readonly suites: readonly SuiteGateResult[];
  readonly reasons: readonly string[];
  /** Recorded-failure rows that improved beyond noise: not failures, but the baseline should be re-recorded. */
  readonly outOfDate: readonly string[];
}

export interface GateOptions {
  /** Exit code of the bench run that wrote the scorecard. */
  readonly benchExit?: number;
  /** `--noise-margin`. */
  readonly noiseMargin?: number;
}

/** A bench that exited non-zero produced no verdict, whatever it wrote. */
export function runFailureReport(benchExit: number): GateReport {
  return {
    status: 'run-failure',
    suites: [],
    outOfDate: [],
    reasons: [
      `the bench exited ${benchExit}${benchExit === 2 ? ' (scorecard written, but a host, baseline or scenario failed to run)' : ''}: a run failure, not a verdict`,
    ],
  };
}

/** Claim mode for one suite: below native, no score, or over 1 % errors fails. */
export function claimResult(
  suite: ScorecardSuite,
  margins: NoiseMargins | null,
  override?: number,
): SuiteGateResult {
  const tool = (suite.details as { tool: string }).tool;
  const name = suiteMarginKey(tool, suite.groundTruth.id);
  const none = { delta: null, margin: null };
  if (suite.verdict === 'na')
    return {
      suite: name,
      outcome: 'na',
      ...none,
      note: suite.naReason ?? 'na',
    };
  const deciding = decidingOf(suite);
  if (deciding === null || deciding.decidingBaseline === null)
    return {
      suite: name,
      outcome: 'not-compared',
      ...none,
      note: 'no deciding native baseline',
    };
  const delta = deltaOf(suite, deciding);
  const margin = marginFor(margins, deciding.key, override);
  const against = describeComparison(deciding);
  const errorRate = suite.cost.error_rate;
  if (delta === null)
    return {
      suite: name,
      outcome: 'unscored',
      delta,
      margin,
      note: `${against}: no score`,
    };
  if (delta < -margin)
    return {
      suite: name,
      outcome: 'below-native',
      delta,
      margin,
      note: `${against}: ${delta} is below -${margin}`,
    };
  if (errorRate !== null && errorRate > MAX_ERROR_RATE_CLAIM)
    return {
      suite: name,
      outcome: 'over-error-rate',
      delta,
      margin,
      note: `error rate ${errorRate} is over ${MAX_ERROR_RATE_CLAIM}`,
    };
  return {
    suite: name,
    outcome: 'pass',
    delta,
    margin,
    note: `${against}: ${delta} (margin ${margin})`,
  };
}

/** Builds a report from per-row results. */
export function reportOf(results: readonly SuiteGateResult[]): GateReport {
  const reasons = results
    .filter((result) => FAILING_OUTCOMES.has(result.outcome))
    .map((result) => `${result.suite}: ${result.outcome} (${result.note})`);
  return {
    status: reasons.length > 0 ? 'fail' : 'pass',
    suites: results,
    outOfDate: results
      .filter(
        (result) => result.outcome === 'improved' || result.outcome === 'new',
      )
      .map((result) => `${result.suite}: ${result.note}`),
    reasons,
  };
}

/**
 * Claim mode over a whole scorecard. Any non-zero bench exit (2 included) is a
 * run failure and no suite is read. `na` suites (a host that is not available,
 * a tool that does not exist yet) never pass silently and never fail: they are
 * listed with their reason. Per-suite modes live in `baseline.ts`.
 */
export function evaluateGate(
  scorecard: Scorecard,
  margins: NoiseMargins | null,
  options: GateOptions = {},
): GateReport {
  if (options.benchExit !== undefined && options.benchExit !== 0)
    return runFailureReport(options.benchExit);
  return reportOf(
    scorecard.suites
      .filter((suite) => suite.arm === undefined)
      .map((suite) => claimResult(suite, margins, options.noiseMargin)),
  );
}

export function renderGateReport(report: GateReport): string {
  const lines = [`gate: ${report.status}`];
  for (const result of report.suites)
    lines.push(
      `  ${result.outcome.padEnd(12)} ${result.suite}: ${result.note}`,
    );
  for (const note of report.outOfDate)
    lines.push(`  baseline out of date: ${note}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------

export const measureNoiseOptionsSchema = z.object({
  from: z.string().min(1).optional(),
  runs: z.coerce.number().int().min(MEASUREMENT_RUNS).optional(),
  host: z.enum(['cli-headless', 'electron']).default('cli-headless'),
  smoke: z.boolean().default(false),
  write: z.boolean().default(false),
});

/** Runs one bench child with these arguments; resolves with its exit code. */
export type BenchChild = (args: readonly string[]) => Promise<number>;

/** The real child: this same bundle, `bench` command, inheriting stdio. */
export const spawnBenchChild: BenchChild = (args) =>
  new Promise((done, fail) => {
    const child = spawn(process.execPath, [process.argv[1], 'bench', ...args], {
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', fail);
    child.once('close', (code) => done(code ?? 1));
  });

export interface MeasureNoiseDeps {
  readonly bench: BenchChild;
  readonly now: () => Date;
}

/**
 * Measures the margins from scorecards (`--from`) or by running the bench
 * `--runs` times, one after the other, each into its own folder under
 * `out/noise-<stamp>/`. A bench that exits non-zero (exit 2 included) stops
 * the measurement: a run failure is never averaged into a margin.
 * Returns 0 measured, 2 run failure, 1 bad input.
 */
export async function runMeasureNoise(
  options: z.infer<typeof measureNoiseOptionsSchema>,
  projectRoot: string,
  log: (line: string) => void,
  deps: MeasureNoiseDeps = { bench: spawnBenchChild, now: () => new Date() },
): Promise<number> {
  if ((options.from === undefined) === (options.runs === undefined)) {
    log(
      '[noise] give exactly one of --from <a.json,b.json,c.json> or --runs <n>',
    );
    return 1;
  }
  let paths: string[];
  if (options.from !== undefined) {
    paths = options.from.split(',').map((path) => resolve(path.trim()));
  } else {
    const stamp = deps.now().toISOString().replace(/\D/g, '').slice(0, 14);
    paths = [];
    for (let index = 1; index <= (options.runs ?? 0); index += 1) {
      const out = join(projectRoot, 'out', `noise-${stamp}`, `run-${index}`);
      log(`[noise] bench run ${index} of ${options.runs} into ${out}`);
      const code = await deps.bench([
        '--host',
        options.host,
        ...(options.smoke ? ['--smoke'] : []),
        '--out',
        out,
      ]);
      if (code !== 0) {
        log(
          `[noise] bench run ${index} exited ${code}: a run failure, nothing measured`,
        );
        return 2;
      }
      paths.push(join(out, 'scorecard.json'));
    }
  }
  const scorecards = await Promise.all(
    paths.map((path) => readScorecard(path)),
  );
  const { margins, unmeasured } = computeNoiseMargins(
    scorecards,
    deps.now().toISOString(),
    options.smoke,
  );
  for (const [key, entry] of Object.entries(margins.suites))
    log(
      `[noise] ${key}: ${entry.margin} (2 SD ${entry.sdMargin}, floor ${entry.floor}, ${entry.measuredAs})`,
    );
  for (const [key, row] of Object.entries(margins.lifecycle))
    log(
      `[noise] lifecycle ${key}: ${row.status} (${row.passes}/${row.runsSeen} passed)`,
    );
  for (const key of unmeasured)
    log(
      `[noise] ${key}: not measurable (no score in some run), default applies`,
    );
  if (options.write) {
    const path = await writeNoiseMargins(
      scorecardBaselineDirectory(projectRoot),
      margins,
    );
    log(`[noise] wrote ${path}`);
  } else log('[noise] not written (pass --write to store the margins)');
  return 0;
}
