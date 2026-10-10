import { KnownFailureEntry } from '../ground-truth/label-schemas';

export interface KnownFailureSuite {
  readonly id: string;
  readonly verdict: 'pass' | 'fail' | 'na';
  readonly metrics: Readonly<Record<string, number | null>>;
  readonly executedCases?: number;
}

export interface KnownFailureGateSignals {
  readonly cassetteMisses?: readonly string[];
  readonly guardTrips?: readonly string[];
  readonly networkHits?: readonly string[];
}

export interface KnownFailuresGateInput {
  readonly entries: readonly KnownFailureEntry[];
  readonly suites: readonly KnownFailureSuite[];
  readonly signals?: KnownFailureGateSignals;
}

export type KnownFailureFindingKind =
  | 'cassette-miss'
  | 'duplicate-entry'
  | 'guard-trip'
  | 'metric-missing'
  | 'network-hit'
  | 'new-failure'
  | 'not-measurable'
  | 'remove-entry'
  | 'suite-missing'
  | 'tighten-recorded-value'
  | 'worsened'
  | 'zero-cases';

export interface KnownFailureFinding {
  readonly kind: KnownFailureFindingKind;
  readonly suiteId?: string;
  readonly metric?: string;
  readonly message: string;
}

export interface KnownFailuresGateResult {
  readonly passed: boolean;
  readonly findings: readonly KnownFailureFinding[];
}

/**
 * Applies the recorded-failure ratchet from benchmark design section 7. A
 * caller adapts scorecard suites to this compact shape because the shared
 * scorecard core deliberately does not own task-620 suite identifiers.
 */
export function evaluateKnownFailures(
  input: KnownFailuresGateInput,
): KnownFailuresGateResult {
  const findings: KnownFailureFinding[] = [];
  const suites = new Map(input.suites.map((suite) => [suite.id, suite]));
  const entries = new Map<string, KnownFailureEntry>();

  for (const entry of input.entries) {
    const key = entryKey(entry.suiteId, entry.metric);
    if (entries.has(key)) {
      findings.push({
        kind: 'duplicate-entry',
        suiteId: entry.suiteId,
        metric: entry.metric,
        message: `duplicate known-failure entry for ${entry.suiteId}.${entry.metric}`,
      });
      continue;
    }
    entries.set(key, entry);
  }

  for (const entry of entries.values()) {
    const suite = suites.get(entry.suiteId);
    if (suite === undefined) {
      findings.push({
        kind: 'suite-missing',
        suiteId: entry.suiteId,
        metric: entry.metric,
        message: `known-failure suite no longer exists: ${entry.suiteId}`,
      });
      continue;
    }
    if (suite.verdict === 'na') {
      findings.push({
        kind: 'not-measurable',
        suiteId: suite.id,
        metric: entry.metric,
        message: `known failure is not measurable: ${suite.id}.${entry.metric}`,
      });
      continue;
    }
    if (suite.verdict === 'pass') {
      findings.push({
        kind: 'remove-entry',
        suiteId: suite.id,
        metric: entry.metric,
        message: `remove the known-failure entry for ${suite.id}.${entry.metric}`,
      });
      continue;
    }

    const value = suite.metrics[entry.metric];
    if (value === undefined || value === null) {
      findings.push({
        kind: 'metric-missing',
        suiteId: suite.id,
        metric: entry.metric,
        message: `known-failure metric no longer exists: ${suite.id}.${entry.metric}`,
      });
      continue;
    }

    const movement = directionalMovement(value, entry);
    if (movement > entry.tolerance) {
      findings.push({
        kind: 'tighten-recorded-value',
        suiteId: suite.id,
        metric: entry.metric,
        message: `tighten recordedValue for improved known failure ${suite.id}.${entry.metric}`,
      });
    } else if (movement < -entry.tolerance) {
      findings.push({
        kind: 'worsened',
        suiteId: suite.id,
        metric: entry.metric,
        message: `known failure worsened: ${suite.id}.${entry.metric}`,
      });
    }
  }

  for (const suite of input.suites) {
    if (suite.executedCases === 0) {
      findings.push({
        kind: 'zero-cases',
        suiteId: suite.id,
        message: `suite executed zero cases: ${suite.id}`,
      });
    }
    if (suite.verdict === 'na' && !hasListedEntry(entries, suite.id)) {
      findings.push({
        kind: 'not-measurable',
        suiteId: suite.id,
        message: `suite is not measurable: ${suite.id}`,
      });
    }
    if (suite.verdict !== 'fail') continue;

    const metrics = Object.entries(suite.metrics).filter(
      (metric): metric is [string, number] => metric[1] !== null,
    );
    if (metrics.length === 0) {
      if (!hasListedEntry(entries, suite.id)) addNewFailure(findings, suite.id);
      continue;
    }
    for (const [metric] of metrics)
      if (!entries.has(entryKey(suite.id, metric)))
        addNewFailure(findings, suite.id, metric);
  }

  for (const cassette of input.signals?.cassetteMisses ?? [])
    findings.push({
      kind: 'cassette-miss',
      message: `cassette miss: ${cassette}`,
    });
  for (const guardTrip of input.signals?.guardTrips ?? [])
    findings.push({ kind: 'guard-trip', message: `guard trip: ${guardTrip}` });
  for (const networkHit of input.signals?.networkHits ?? [])
    findings.push({
      kind: 'network-hit',
      message: `network hit: ${networkHit}`,
    });

  findings.sort(compareFindings);
  return { passed: findings.length === 0, findings };
}

function addNewFailure(
  findings: KnownFailureFinding[],
  suiteId: string,
  metric?: string,
): void {
  findings.push({
    kind: 'new-failure',
    suiteId,
    metric,
    message: `new failure is not recorded: ${suiteId}${metric === undefined ? '' : `.${metric}`}`,
  });
}

function directionalMovement(value: number, entry: KnownFailureEntry): number {
  const delta = value - entry.recordedValue;
  return entry.direction === 'higher-is-better' ? delta : -delta;
}

function entryKey(suiteId: string, metric: string): string {
  return `${suiteId}\u0000${metric}`;
}

function hasListedEntry(
  entries: ReadonlyMap<string, KnownFailureEntry>,
  suiteId: string,
): boolean {
  return [...entries.values()].some((entry) => entry.suiteId === suiteId);
}

function compareFindings(
  left: KnownFailureFinding,
  right: KnownFailureFinding,
): number {
  return [left.suiteId ?? '', left.metric ?? '', left.kind, left.message]
    .join('\u0000')
    .localeCompare(
      [right.suiteId ?? '', right.metric ?? '', right.kind, right.message].join(
        '\u0000',
      ),
    );
}
