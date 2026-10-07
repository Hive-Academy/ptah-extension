/**
 * Recorded-failure mode and the committed gate baseline (Task 10.1).
 *
 * The baseline (`baseline/gate-baseline.json`) holds one recorded scorecard and
 * a mode per suite and per lifecycle row:
 *
 * - `recorded-failure` (default for everything in Phase 1): the row passes only
 *   when the current run equals the recorded one within the suite's stored
 *   noise margin. A regression beyond noise fails. An improvement beyond noise
 *   is not a failure, but the report lists it as "baseline out of date".
 *   A tool with no score passes only when the baseline records it as unscored
 *   with the same reason.
 * - `claim`: the claim gate of `gate.ts` (below native, no score, or over 1 %
 *   errors fails; a failed lifecycle scenario fails). Phase 2 switches rows to
 *   it one by one.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

import { scorecardSchema } from '../scorecard/scorecard.types';
import type { Scorecard, ScorecardSuite } from '../scorecard/scorecard.types';
import {
  claimResult,
  decidingOf,
  describeComparison,
  deltaOf,
  marginFor,
  reportOf,
  runFailureReport,
  suiteMarginKey,
  type GateOptions,
  type GateReport,
  type NoiseMargins,
  type SuiteGateResult,
} from './gate';

export const BASELINE_FILE = 'gate-baseline.json';

export const gateModeSchema = z.enum(['recorded-failure', 'claim']);
export type GateMode = z.infer<typeof gateModeSchema>;

export const gateBaselineSchema = z.object({
  schemaVersion: z.literal(1),
  recordedAt: z.string().datetime(),
  /** Mode per suite key (`<tool> / <groundTruth.id>`) and lifecycle key (`<tool> / <scenario>`). Absent = `recorded-failure`. */
  modes: z.object({
    suites: z.record(z.string().min(1), gateModeSchema),
    lifecycle: z.record(z.string().min(1), gateModeSchema),
  }),
  scorecard: scorecardSchema,
});
export type GateBaseline = z.infer<typeof gateBaselineSchema>;

export class BaselineMissingError extends Error {
  constructor(path: string) {
    super(
      `no gate baseline at ${path}: record one from a scorecard with ` +
        '`npx nx run mcp-bench:record-baseline --scorecard <scorecard.json>` and commit it',
    );
    this.name = 'BaselineMissingError';
  }
}

export const lifecycleKey = (tool: string, scenario: string): string =>
  `${tool} / ${scenario}`;

const suiteKeyOf = (suite: ScorecardSuite): string =>
  suiteMarginKey(
    (suite.details as { tool: string }).tool,
    suite.groundTruth.id,
  );

export async function loadBaseline(
  baselineDirectory: string,
): Promise<GateBaseline> {
  const path = join(baselineDirectory, BASELINE_FILE);
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new BaselineMissingError(path);
    throw error;
  }
  return gateBaselineSchema.parse(JSON.parse(text) as unknown);
}

/** A baseline from a scorecard; every suite and lifecycle row defaults to `recorded-failure`, `claimKeys` switch rows to `claim`. */
export function buildBaseline(
  scorecard: Scorecard,
  recordedAt: string,
  claimKeys: readonly string[] = [],
): GateBaseline {
  const claim = new Set(claimKeys);
  const mode = (key: string): GateMode =>
    claim.has(key) ? 'claim' : 'recorded-failure';
  const suites: Record<string, GateMode> = {};
  for (const suite of scorecard.suites)
    if (suite.arm === undefined) {
      const key = suiteKeyOf(suite);
      suites[key] = mode(key);
    }
  const lifecycle: Record<string, GateMode> = {};
  for (const row of scorecard.lifecycle) {
    const key = lifecycleKey(row.tool, row.scenario);
    lifecycle[key] = mode(key);
  }
  return {
    schemaVersion: 1,
    recordedAt,
    modes: { suites, lifecycle },
    scorecard,
  };
}

export async function writeBaseline(
  baselineDirectory: string,
  baseline: GateBaseline,
): Promise<string> {
  await mkdir(baselineDirectory, { recursive: true });
  const path = join(baselineDirectory, BASELINE_FILE);
  const temp = `${path}.tmp`;
  await writeFile(
    temp,
    `${JSON.stringify(gateBaselineSchema.parse(baseline), null, 2)}\n`,
    'utf8',
  );
  await rename(temp, path);
  return path;
}

/** The suite's own failure reasons (the `(verdict)` entries), which say why it has no score. */
function verdictReasons(suite: ScorecardSuite): string[] {
  const failures =
    (
      suite.details as {
        failures?: { question: string; got: string[] }[];
      }
    ).failures ?? [];
  return failures
    .filter((failure) => failure.question === '(verdict)')
    .flatMap((failure) => failure.got);
}

function recordedResult(
  current: ScorecardSuite,
  recorded: ScorecardSuite | undefined,
  margins: NoiseMargins | null,
  override?: number,
): SuiteGateResult {
  const name = suiteKeyOf(current);
  const result = (
    outcome: SuiteGateResult['outcome'],
    note: string,
    delta: number | null = null,
    margin: number | null = null,
  ): SuiteGateResult => ({ suite: name, outcome, delta, margin, note });
  if (recorded === undefined)
    return result('new', 'not in the baseline: record it');
  const deciding = decidingOf(current);
  const recordedDeciding = decidingOf(recorded);
  if (deciding === null || recordedDeciding === null) {
    // Nothing numeric to compare (na, or no deciding native): the verdict must match.
    if (current.verdict === recorded.verdict)
      return result('pass', `verdict ${current.verdict} as recorded`);
    return result(
      current.verdict === 'pass' ? 'improved' : 'changed',
      `verdict ${recorded.verdict} recorded, ${current.verdict} now${current.naReason ? ` (${current.naReason})` : ''}`,
    );
  }
  const margin = marginFor(margins, deciding.key, override);
  const label = describeComparison(deciding);
  const now = deltaOf(current, deciding);
  const was = deltaOf(recorded, recordedDeciding);
  if (now === null || was === null) {
    if (now === null && was === null) {
      const nowReasons = verdictReasons(current);
      const wasReasons = verdictReasons(recorded);
      return JSON.stringify(nowReasons) === JSON.stringify(wasReasons)
        ? result('pass', `unscored as recorded: ${nowReasons.join('; ')}`)
        : result(
            'changed',
            `unscored with a different reason: recorded "${wasReasons.join('; ')}", now "${nowReasons.join('; ')}"`,
          );
    }
    return now === null
      ? result('regression', `scored ${was} when recorded, no score now`)
      : result(
          'improved',
          `recorded unscored, now ${now}: baseline out of date`,
          now,
          margin,
        );
  }
  if (now < was - margin)
    return result(
      'regression',
      `${label}: ${now} is below recorded ${was} by more than ${margin}`,
      now,
      margin,
    );
  if (now > was + margin)
    return result(
      'improved',
      `${label}: ${now} is above recorded ${was} by more than ${margin}: baseline out of date`,
      now,
      margin,
    );
  return result(
    'pass',
    `${label}: ${now} equals recorded ${was} within ${margin}`,
    now,
    margin,
  );
}

function lifecycleResults(
  current: Scorecard,
  baseline: GateBaseline,
  margins: NoiseMargins | null,
): SuiteGateResult[] {
  const recorded = new Map(
    baseline.scorecard.lifecycle.map((row) => [
      lifecycleKey(row.tool, row.scenario),
      row,
    ]),
  );
  const results: SuiteGateResult[] = [];
  const seen = new Set<string>();
  const row = (
    key: string,
    outcome: SuiteGateResult['outcome'],
    note: string,
  ): SuiteGateResult => ({
    suite: `lifecycle: ${key}`,
    outcome,
    delta: null,
    margin: null,
    note,
  });
  for (const item of current.lifecycle) {
    const key = lifecycleKey(item.tool, item.scenario);
    seen.add(key);
    const mode = baseline.modes.lifecycle[key] ?? 'recorded-failure';
    const was = recorded.get(key);
    if (mode === 'claim')
      results.push(
        item.pass
          ? row(key, 'pass', 'scenario passes')
          : row(key, 'regression', `scenario fails: ${item.detail}`),
      );
    else if (was === undefined)
      results.push(row(key, 'new', 'not in the baseline: record it'));
    else if (was.pass === item.pass)
      results.push(
        row(key, 'pass', `${item.pass ? 'passes' : 'fails'} as recorded`),
      );
    else if (margins?.lifecycle[key]?.status === 'flaky')
      results.push(
        row(
          key,
          'pass',
          `flaky across the noise runs: ${item.pass ? 'passes' : 'fails'} now, tolerated`,
        ),
      );
    else if (item.pass)
      results.push(
        row(
          key,
          'improved',
          'recorded as failing, passes now: baseline out of date',
        ),
      );
    else
      results.push(
        row(
          key,
          'regression',
          `recorded as passing, fails now: ${item.detail}`,
        ),
      );
  }
  for (const key of recorded.keys())
    if (!seen.has(key))
      results.push(
        row(key, 'missing', 'recorded in the baseline, absent from this run'),
      );
  return results;
}

/**
 * The gate against a committed baseline. Any non-zero bench exit is a run
 * failure and nothing is read. Suites and lifecycle rows are judged by their
 * stored mode; a suite the baseline records but this run lacks fails
 * (`missing`); a suite the baseline lacks is listed as out of date.
 */
export function evaluateWithBaseline(
  current: Scorecard,
  baseline: GateBaseline,
  margins: NoiseMargins | null,
  options: GateOptions = {},
): GateReport {
  if (options.benchExit !== undefined && options.benchExit !== 0)
    return runFailureReport(options.benchExit);
  const recorded = new Map(
    baseline.scorecard.suites
      .filter((suite) => suite.arm === undefined)
      .map((suite) => [suiteKeyOf(suite), suite]),
  );
  const results: SuiteGateResult[] = [];
  const seen = new Set<string>();
  for (const suite of current.suites) {
    if (suite.arm !== undefined) continue;
    const key = suiteKeyOf(suite);
    seen.add(key);
    results.push(
      (baseline.modes.suites[key] ?? 'recorded-failure') === 'claim'
        ? claimResult(suite, margins, options.noiseMargin)
        : recordedResult(
            suite,
            recorded.get(key),
            margins,
            options.noiseMargin,
          ),
    );
  }
  for (const key of recorded.keys())
    if (!seen.has(key))
      results.push({
        suite: key,
        outcome: 'missing',
        delta: null,
        margin: null,
        note: 'recorded in the baseline, absent from this run',
      });
  results.push(...lifecycleResults(current, baseline, margins));
  return reportOf(results);
}
