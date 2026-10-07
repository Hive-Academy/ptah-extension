/**
 * The `gate` and `record-baseline` commands (dispatched by `main.ts`).
 *
 *   gate --scorecard <scorecard.json> [--bench-exit <n>] [--noise-margin <n>]
 *        exit 0 pass, 1 a row fails its mode, 2 run failure (bench exit, or no
 *        baseline to compare with: nothing was judged)
 *   record-baseline --scorecard <scorecard.json> [--claim <key>[,<key>...]]
 *        writes baseline/gate-baseline.json; every suite and lifecycle row is
 *        `recorded-failure` unless named in --claim
 */

import { resolve } from 'node:path';
import { z } from 'zod';

import {
  readScorecard,
  scorecardBaselineDirectory,
} from '../scorecard/scorecard-writers';
import {
  BaselineMissingError,
  buildBaseline,
  evaluateWithBaseline,
  loadBaseline,
  writeBaseline,
} from './baseline';
import {
  loadNoiseMargins,
  measureNoiseOptionsSchema,
  renderGateReport,
  runFailureReport,
  runMeasureNoise,
  type GateReport,
} from './gate';

export const gateOptionsSchema = z.object({
  scorecard: z.string().min(1),
  'bench-exit': z.coerce.number().int().min(0).optional(),
  'noise-margin': z.coerce.number().min(0).max(1).optional(),
});

export const recordBaselineOptionsSchema = z.object({
  scorecard: z.string().min(1),
  claim: z.string().min(1).optional(),
});

function finish(report: GateReport, log: (line: string) => void): number {
  log(renderGateReport(report));
  for (const reason of report.reasons) log(`[gate] ${reason}`);
  if (report.status === 'run-failure') return 2;
  return report.status === 'pass' ? 0 : 1;
}

export async function runGate(
  options: z.infer<typeof gateOptionsSchema>,
  projectRoot: string,
  log: (line: string) => void,
): Promise<number> {
  const benchExit = options['bench-exit'];
  if (benchExit !== undefined && benchExit !== 0)
    return finish(runFailureReport(benchExit), log);
  const directory = scorecardBaselineDirectory(projectRoot);
  let baseline;
  try {
    baseline = await loadBaseline(directory);
  } catch (error) {
    if (!(error instanceof BaselineMissingError)) throw error;
    log(`[gate] ${error.message}`);
    return 2;
  }
  const report = evaluateWithBaseline(
    await readScorecard(resolve(options.scorecard)),
    baseline,
    await loadNoiseMargins(directory),
    { noiseMargin: options['noise-margin'] },
  );
  return finish(report, log);
}

export async function runRecordBaseline(
  options: z.infer<typeof recordBaselineOptionsSchema>,
  projectRoot: string,
  log: (line: string) => void,
  now: () => Date = () => new Date(),
): Promise<number> {
  const scorecard = await readScorecard(resolve(options.scorecard));
  const baseline = buildBaseline(
    scorecard,
    now().toISOString(),
    options.claim?.split(',').map((key) => key.trim()),
  );
  const path = await writeBaseline(
    scorecardBaselineDirectory(projectRoot),
    baseline,
  );
  const claim = Object.values({
    ...baseline.modes.suites,
    ...baseline.modes.lifecycle,
  }).filter((mode) => mode === 'claim').length;
  log(
    `[baseline] wrote ${path}: ${Object.keys(baseline.modes.suites).length} suites, ${Object.keys(baseline.modes.lifecycle).length} lifecycle rows, ${claim} in claim mode`,
  );
  return 0;
}

export const GATE_USAGE = `gate --scorecard <scorecard.json> [--bench-exit <n>] [--noise-margin <0..1>]   (exit 0 pass, 1 a row fails its mode, 2 run failure)
  record-baseline --scorecard <scorecard.json> [--claim <key>[,<key>...]]
  measure-noise (--from <a.json,b.json,c.json> | --runs <n>) [--host cli-headless|electron] [--smoke] [--write]`;

type StrictParse = <T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
  flags: Record<string, unknown>,
) => z.infer<z.ZodObject<T>>;

/** Runs `gate`, `record-baseline` or `measure-noise`; `null` when the command is none of them. */
export async function runGateCommand(
  command: string,
  flags: Record<string, unknown>,
  projectRoot: string,
  log: (line: string) => void,
  strictParse: StrictParse,
): Promise<number | null> {
  if (command === 'gate')
    return runGate(strictParse(gateOptionsSchema, flags), projectRoot, log);
  if (command === 'record-baseline')
    return runRecordBaseline(
      strictParse(recordBaselineOptionsSchema, flags),
      projectRoot,
      log,
    );
  if (command === 'measure-noise')
    return runMeasureNoise(
      strictParse(measureNoiseOptionsSchema, flags),
      projectRoot,
      log,
    );
  return null;
}
