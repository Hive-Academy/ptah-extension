/**
 * Agents-tab outcome metrics (Req 9.1).
 *
 * Replaces the "Success" percentage on `kind === 'agent'` cards and the
 * agent drawer. Skills and commands keep `formatSuccessRate`. Absent
 * signals and a zero run count render "no data yet" — never a fabricated
 * 0% or 100%. Rates are whole-number percentages with their counts.
 *
 * NULL-SAFE BOUNDARY. The shared DTO still types every count as `number`,
 * but this formatter accepts `number | null | undefined` for the run count
 * and both ratio parts, so an absent rate can never reach the division in
 * `formatPercent` and print `NaN%`. An absent ratio renders the same
 * absence label as a zero denominator — the outcome-side statement of what
 * `formatSuccessRate` renders as "No grade" on the graded surfaces.
 */
import type { AgentOutcomeSignals, OutcomeRatio } from '@ptah-extension/shared';

/** One labelled figure in the clone card / drawer metric row. */
export interface CloneMetric {
  readonly label: string;
  readonly value: string;
  readonly testId: string;
}

export type OutcomeStatus =
  'loading' | 'ready' | 'unavailable' | 'not-persistent';

/**
 * A pass/success ratio as this module accepts it. The shared `OutcomeRatio`
 * still types both parts as `number`; `null`/`undefined` parts mean the
 * producer never computed the rate, and must render an absence label rather
 * than reach the division in {@link formatPercent}.
 */
export interface NullableOutcomeRatio {
  readonly numerator: number | null | undefined;
  readonly denominator: number | null | undefined;
}

/**
 * `AgentOutcomeSignals` as this formatter accepts it: the run count and both
 * ratio parts widened to `number | null | undefined`. A real
 * `AgentOutcomeSignals` stays assignable — callers need no cast.
 */
export type AgentOutcomeSignalsInput = Omit<
  AgentOutcomeSignals,
  'runCount' | 'delivered' | 'reviewPass'
> & {
  readonly runCount: number | null | undefined;
  readonly delivered: NullableOutcomeRatio;
  readonly reviewPass: NullableOutcomeRatio;
};

/**
 * Window the RPC contract uses when the handler has not answered yet
 * (`AgentOutcomeSignalsResult.windowDays`, fixed at 30).
 */
const DEFAULT_WINDOW_DAYS = 30;

/**
 * Format one agent's outcome signals for the metric row.
 *
 * @param signals record for this slug, or null/undefined when the slug is
 *   absent from the RPC map ("no data yet")
 * @param windowDays window echoed by `agent:outcomeSignals`; null until
 *   that call returns. A positive finite value wins over `signals.windowDays`.
 */
export function formatAgentOutcomeSignals(
  signals: AgentOutcomeSignalsInput | null | undefined,
  windowDays: number | null,
  status: OutcomeStatus = 'ready',
): CloneMetric[] {
  const days = resolveWindowDays(windowDays, signals);
  if (signals == null && status === 'loading') {
    return [
      {
        label: 'Outcomes',
        value: 'Loading outcome data…',
        testId: 'clone-metric-outcome-loading',
      },
    ];
  }
  if (signals == null && status === 'unavailable') {
    return [
      {
        label: 'Outcomes',
        value: 'Outcome data unavailable',
        testId: 'clone-metric-outcome-unavailable',
      },
    ];
  }
  if (signals == null || !isRecordedCount(signals.runCount)) {
    return [
      {
        label: `Outcomes (${days}d)`,
        value: 'no data yet',
        testId: 'clone-metric-outcome-empty',
      },
    ];
  }

  const reviewed = hasRatio(signals.reviewPass);
  const out: CloneMetric[] = [
    {
      label: 'Window',
      value: `(last ${days} days)`,
      testId: 'clone-metric-outcome-window',
    },
    {
      label: 'Delivered',
      value: formatDelivered(signals.delivered),
      testId: 'clone-metric-outcome-delivered',
    },
    {
      label: 'Review pass',
      value: formatReview(signals.reviewPass),
      testId: 'clone-metric-outcome-review',
    },
  ];

  // Hidden while the review line says "not reviewed yet" (Req 9.1).
  // A null or non-finite average is the same fact: do not invent 0.0.
  if (
    reviewed &&
    signals.avgReviseRounds !== null &&
    Number.isFinite(signals.avgReviseRounds)
  ) {
    out.push({
      label: 'Avg revise rounds',
      value: signals.avgReviseRounds.toFixed(1),
      testId: 'clone-metric-outcome-revise',
    });
  }

  out.push({
    label: 'Top failure',
    value: signals.topFailureClass ?? 'no failures recorded',
    testId: 'clone-metric-outcome-failure',
  });

  return out;
}

function resolveWindowDays(
  windowDays: number | null,
  signals: AgentOutcomeSignalsInput | null | undefined,
): number {
  const candidate = windowDays ?? signals?.windowDays ?? DEFAULT_WINDOW_DAYS;
  if (Number.isFinite(candidate) && candidate > 0) {
    return Math.round(candidate);
  }
  return DEFAULT_WINDOW_DAYS;
}

function formatDelivered(ratio: NullableOutcomeRatio): string {
  if (!hasRatio(ratio)) return 'no verified runs';
  return formatPercent(ratio);
}

function formatReview(ratio: NullableOutcomeRatio): string {
  if (!hasRatio(ratio)) return 'not reviewed yet';
  return formatPercent(ratio);
}

/**
 * True when both parts are real numbers and the denominator is positive.
 * Everything else — null, undefined, non-finite, non-positive — is the same
 * fact: no rate exists to show, so the absence label renders, never `NaN%`.
 */
function hasRatio(ratio: NullableOutcomeRatio): ratio is OutcomeRatio {
  return (
    typeof ratio.numerator === 'number' &&
    Number.isFinite(ratio.numerator) &&
    typeof ratio.denominator === 'number' &&
    Number.isFinite(ratio.denominator) &&
    ratio.denominator > 0
  );
}

/** True only for a real, positive run count; `0` and absent are both empty. */
function isRecordedCount(count: number | null | undefined): boolean {
  return typeof count === 'number' && Number.isFinite(count) && count > 0;
}

function formatPercent(ratio: OutcomeRatio): string {
  const pct = Math.round((ratio.numerator / ratio.denominator) * 100);
  return `${pct}% (${ratio.numerator}/${ratio.denominator})`;
}
