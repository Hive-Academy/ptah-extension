/**
 * What every funnel stage suite shares: the per-invariant record, the verdict
 * rule, and the assembly of a `funnel` suite result (schema
 * `funnelDetailsSchema`, `memory-skills-suite-kinds.ts`).
 *
 * Verdict rule, in order:
 *  1. any cassette miss ⇒ `na: cassette-miss` (R-M5: the product swallows a
 *     miss into its own fallback, so the run measured the fallback, not the
 *     recorded model);
 *  2. the run itself did not complete ⇒ `fail` with the run's error (a
 *     safety-cap abort is a `fail`, design 4.4);
 *  3. any evaluated invariant with `pass: false` ⇒ `fail`;
 *  4. any invariant that could not be evaluated ⇒ `na`, naming each one;
 *  5. otherwise `pass`.
 * `funnelDetailsSchema` has no "not evaluated" invariant state, so only
 * evaluated invariants are listed in `details`; the rest are in `naReason`.
 *
 * Imports only Node, zod and parent-loadable modules.
 */

import {
  funnelDetailsSchema,
  type FunnelDetails,
} from '../../memory-skills-suite-kinds';
import type { Rate } from '../../metrics/curation-metrics';
import {
  runCaseWithSafetyCap,
  SAFETY_CAP_ERROR,
  SAFETY_CAP_MS,
} from '../../runner/case-runner';
import type { CaseRecord, SuiteResultInput } from '../../runner/suite-result';
import {
  costOf,
  inputSha256,
  rateMetrics,
} from '../memory/memory-suite-support';
import type { FunnelLaneStats } from './funnel-port';
import { compareCodeUnits } from '../../../utils/compare-code-units';

export type FunnelStage = FunnelDetails['stages'][number]['stage'];

/** One invariant: evaluated with its violating ids, or not evaluated with why. */
export type InvariantResult =
  | {
      readonly id: string;
      readonly evaluated: true;
      readonly pass: boolean;
      /** Every violating id, sorted; the details keep the first ten. */
      readonly violations: readonly string[];
    }
  | { readonly id: string; readonly evaluated: false; readonly reason: string };

/** Evaluated invariant that passes iff nothing violates it. */
export function invariantOf(
  id: string,
  violations: readonly string[],
): InvariantResult {
  const sorted = [...violations].sort(compareCodeUnits);
  return { id, evaluated: true, pass: sorted.length === 0, violations: sorted };
}

/** Evaluated threshold invariant: `pass` is the threshold, `violations` the misses. */
export function thresholdInvariantOf(
  id: string,
  pass: boolean,
  violations: readonly string[],
): InvariantResult {
  return {
    id,
    evaluated: true,
    pass,
    violations: [...violations].sort(compareCodeUnits),
  };
}

export function notEvaluated(id: string, reason: string): InvariantResult {
  return { id, evaluated: false, reason };
}

/** How one capped, non-retried piece of work ended. */
export type OnceOutcome<T> =
  | {
      readonly outcome: 'completed';
      readonly value: T;
      readonly latencyMs: number;
    }
  | {
      readonly outcome: 'safety-cap' | 'error';
      readonly error: string;
      readonly latencyMs: number;
    };

/**
 * Run `work` once under the safety cap (`case-runner.ts`). The case runner
 * retries a capped attempt (R11); every funnel run writes into the shared
 * database, so a second attempt would measure a different state. The retry is
 * refused and the cap is reported as `safety-cap`. Never throws.
 */
export async function runOnceUnderCap<T>(
  work: (signal: AbortSignal) => Promise<T>,
  capMs?: number,
): Promise<OnceOutcome<T>> {
  let attempts = 0;
  try {
    const run = await runCaseWithSafetyCap(
      async (signal) => {
        attempts += 1;
        if (attempts > 1) throw new NotRetryable();
        return work(signal);
      },
      { capMs },
    );
    if (run.outcome === 'completed') {
      return {
        outcome: 'completed',
        value: run.value,
        latencyMs: run.latencyMs,
      };
    }
    return {
      outcome: 'safety-cap',
      error: SAFETY_CAP_ERROR,
      latencyMs: run.latencyMs,
    };
  } catch (error: unknown) {
    if (error instanceof NotRetryable) {
      // The first attempt ran into the cap; its runtime is the cap.
      return {
        outcome: 'safety-cap',
        error: SAFETY_CAP_ERROR,
        latencyMs: capMs ?? SAFETY_CAP_MS,
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      outcome: 'error',
      error: message.length > 0 ? message : 'error',
      latencyMs: 0,
    };
  }
}

class NotRetryable extends Error {
  constructor() {
    super('not retryable after a capped attempt');
    this.name = 'NotRetryable';
  }
}

/** How a run of the funnel ended, before any stage is scored. */
export interface FunnelRunOutcome {
  /** `null` when the run completed. */
  readonly error: string | null;
  readonly latencyMs: number;
  readonly attempts: number;
  readonly lane: FunnelLaneStats;
  /** Product operations the run made (triggers, drain ticks, service calls). */
  readonly operations: number;
}

export interface StageScore {
  readonly stage: FunnelStage;
  readonly in: number;
  readonly out: number;
  readonly invariants: readonly InvariantResult[];
  readonly metrics: Readonly<Record<string, number | null>>;
  readonly cases: readonly CaseRecord[];
  readonly baselines?: SuiteResultInput['baselines'];
  readonly deltas?: SuiteResultInput['deltas'];
  readonly extra?: Omit<FunnelDetails, 'fixtureId' | 'stages'>;
}

export interface StageSuiteMeta {
  readonly suiteId: string;
  readonly claim: SuiteResultInput['claim'];
  readonly groundTruth: SuiteResultInput['groundTruth'];
  readonly fixtureId: string;
  readonly cassetteVersion: string | null;
}

/** The verdict rule of the module header. */
export function stageVerdict(
  run: FunnelRunOutcome,
  invariants: readonly InvariantResult[],
): { verdict: SuiteResultInput['verdict']; naReason?: string } {
  if (run.lane.misses > 0) {
    return { verdict: 'na', naReason: 'cassette-miss' };
  }
  if (run.error !== null) return { verdict: 'fail' };
  if (invariants.some((inv) => inv.evaluated && !inv.pass)) {
    return { verdict: 'fail' };
  }
  const open = invariants.filter(
    (inv): inv is Extract<InvariantResult, { evaluated: false }> =>
      !inv.evaluated,
  );
  if (open.length > 0) {
    return {
      verdict: 'na',
      naReason: `not evaluated: ${open.map((inv) => `${inv.id} (${inv.reason})`).join('; ')}`,
    };
  }
  return { verdict: 'pass' };
}

/** The case that records the shared run itself (R11: every run's runtime). */
export function runCase(
  caseId: string,
  input: unknown,
  run: FunnelRunOutcome,
): CaseRecord {
  return {
    caseId,
    inputSha256: inputSha256(input),
    expected: 'the scripted run completes',
    observed: run.error === null ? 'completed' : `error: ${run.error}`,
    outcome: run.error === null ? 'pass' : 'fail',
    latencyMs: run.latencyMs,
    attempts: run.attempts,
    error: run.error,
    cassetteKey: null,
  };
}

/** A case evaluated from the run's observations; its runtime is the run's. */
export function scoredCase(
  caseId: string,
  input: unknown,
  expected: string,
  observed: string,
  pass: boolean,
): CaseRecord {
  return {
    caseId,
    inputSha256: inputSha256(input),
    expected,
    observed,
    outcome: pass ? 'pass' : 'fail',
    latencyMs: 0,
    error: null,
  };
}

/** The `funnel` suite result of one stage; `details` validated before writing. */
export function stageSuiteResult(
  meta: StageSuiteMeta,
  run: FunnelRunOutcome,
  score: StageScore,
): { result: SuiteResultInput; cases: CaseRecord[] } {
  const details = funnelDetailsSchema.parse({
    fixtureId: meta.fixtureId,
    stages: [
      {
        stage: score.stage,
        in: score.in,
        out: score.out,
        invariants: score.invariants
          .filter(
            (inv): inv is Extract<InvariantResult, { evaluated: true }> =>
              inv.evaluated,
          )
          .map((inv) => ({
            id: inv.id,
            pass: inv.pass,
            violations: inv.violations.length,
            exampleIds: inv.violations.slice(0, 10),
          })),
      },
    ],
    ...(score.extra ?? {}),
  });
  const { verdict, naReason } = stageVerdict(run, score.invariants);
  const cases = [...score.cases];
  const invariantMetrics: Record<string, number> = {};
  for (const inv of score.invariants) {
    if (inv.evaluated) {
      invariantMetrics[`invariant.${inv.id}.violations`] =
        inv.violations.length;
    }
  }
  return {
    cases,
    result: {
      suiteId: meta.suiteId,
      kind: 'funnel',
      details,
      claim: meta.claim,
      groundTruth: meta.groundTruth,
      baselines: score.baselines ?? [],
      deltas: score.deltas ?? {},
      cost: costOf(cases, run.operations + run.lane.calls),
      modelCalls: run.lane.calls,
      verdict,
      ...(naReason === undefined ? {} : { naReason }),
      metrics: {
        [`${score.stage}.in`]: score.in,
        [`${score.stage}.out`]: score.out,
        'lane.misses': run.lane.misses,
        ...invariantMetrics,
        ...score.metrics,
      },
      cassetteVersion: meta.cassetteVersion,
    },
  };
}

/** `rateMetrics` for several rates at once. */
export function ratesMetrics(
  rates: Readonly<Record<string, Rate>>,
): Record<string, number | null> {
  return Object.assign(
    {},
    ...Object.entries(rates).map(([name, value]) => rateMetrics(name, value)),
  ) as Record<string, number | null>;
}
