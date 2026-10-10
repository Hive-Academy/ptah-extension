import { computeProjectionSha256, SuiteView } from '../scorecard/suite-kinds';

/**
 * One recorded per-case line of `<suiteId>.cases.jsonl` (design 6.4). Only the
 * five projected fields enter the R-C4 projection; `latencyMs`, `error`,
 * `baselineOutcomes` and `cassetteKey` are recorded for the run but never
 * projected.
 */
export interface RecordedSuiteCase {
  caseId: string;
  inputSha256: string;
  expected: string;
  observed: string;
  outcome: 'pass' | 'fail';
  baselineOutcomes?: Record<string, 'pass' | 'fail'>;
  cassetteKey?: string | null;
  latencyMs?: number | null;
  error?: string | null;
}

/**
 * Volatile run facts (design 7, R-C4): the run id, the run timestamps, the host
 * pid and port and the safety-cap timing are all dropped wholesale from the
 * projection. They are carried here so the projection is built from the whole
 * run picture and still hashes identically across runs.
 */
export interface ProjectionRunFacts {
  runId: string;
  startedAt: string;
  hostPid?: number | null;
  hostPort?: number | null;
  safetyCapMs?: number | null;
}

/** Everything the runner holds for one suite when it builds the projection. */
export interface SuiteProjectionInput {
  suite: SuiteView<unknown>;
  cases: readonly RecordedSuiteCase[];
  cassetteVersion: string | null;
  run: ProjectionRunFacts;
}

/**
 * The deterministic projection of one suite (design 7, R-C4 step 2): verdict,
 * details quality fields, the five projected per-case fields, ground truth,
 * cassette version and `cost.calls`. Latency, tokens, run ids, timestamps, host
 * pid/port and safety-cap timing never enter.
 */
export interface SuiteProjection {
  verdict: SuiteView<unknown>['verdict'];
  details: unknown;
  cases: Array<{
    caseId: string;
    inputSha256: string;
    expected: string;
    observed: string;
    outcome: 'pass' | 'fail';
  }>;
  groundTruth: SuiteView<unknown>['groundTruth'];
  cassetteVersion: string | null;
  calls: number;
}

/**
 * Builds the projection: whitelists the deterministic fields, drops every
 * volatile one, and rounds all numbers to 6 decimals. Canonical key order and
 * the SHA-256 are applied by 619's `computeProjectionSha256`.
 */
export function buildSuiteProjection(
  input: SuiteProjectionInput,
): SuiteProjection {
  return roundProjection({
    verdict: input.suite.verdict,
    details: input.suite.details,
    cases: input.cases.map((record) => ({
      caseId: record.caseId,
      inputSha256: record.inputSha256,
      expected: record.expected,
      observed: record.observed,
      outcome: record.outcome,
    })),
    groundTruth: input.suite.groundTruth,
    cassetteVersion: input.cassetteVersion,
    calls: input.suite.cost.calls,
  }) as SuiteProjection;
}

/** Builds the projection and hashes it through 619's core helper. */
export function computeSuiteProjectionSha256(
  input: SuiteProjectionInput,
): string {
  return computeProjectionSha256(buildSuiteProjection(input));
}

const DECIMALS_SCALE = 1_000_000;
// Above this magnitude, value * DECIMALS_SCALE would pass Number.MAX_SAFE_INTEGER
// and the round-trip division could corrupt the value; such doubles carry no
// 6-decimal precision anyway, so they pass through unchanged.
const ROUND_SAFE_ABS = 9_000_000_000;

function roundNumber(value: number): number {
  if (!Number.isFinite(value) || Math.abs(value) >= ROUND_SAFE_ABS)
    return value;
  return Math.round(value * DECIMALS_SCALE) / DECIMALS_SCALE;
}

function roundProjection(
  value: unknown,
  ancestors: Set<object> = new Set(),
): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return value;
  if (typeof value === 'number') return roundNumber(value);
  if (Array.isArray(value)) {
    if (ancestors.has(value))
      throw new Error('projection cannot contain cycles');
    ancestors.add(value);
    const rounded = value.map((item) => roundProjection(item, ancestors));
    ancestors.delete(value);
    return rounded;
  }
  if (typeof value === 'object') {
    if (ancestors.has(value))
      throw new Error('projection cannot contain cycles');
    ancestors.add(value);
    const record: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>))
      if (item !== undefined) record[key] = roundProjection(item, ancestors);
    ancestors.delete(value);
    return record;
  }
  throw new Error(`projection cannot contain ${typeof value} values`);
}
