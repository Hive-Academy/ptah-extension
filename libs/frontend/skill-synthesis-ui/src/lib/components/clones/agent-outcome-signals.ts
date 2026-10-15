/**
 * Agents-tab outcome metrics (Req 9.1).
 *
 * Replaces the "Success" percentage on `kind === 'agent'` cards and the
 * agent drawer. Skills and commands keep `formatSuccessRate`. Absent
 * signals and a zero run count render "no data yet" — never a fabricated
 * 0% or 100%. Rates are whole-number percentages with their counts.
 */
import type { AgentOutcomeSignals, OutcomeRatio } from '@ptah-extension/shared';

/** One labelled figure in the clone card / drawer metric row. */
export interface CloneMetric {
  readonly label: string;
  readonly value: string;
  readonly testId: string;
}

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
  signals: AgentOutcomeSignals | null | undefined,
  windowDays: number | null,
): CloneMetric[] {
  const days = resolveWindowDays(windowDays, signals);
  if (signals == null || signals.runCount === 0) {
    return [
      {
        label: `Outcomes (${days}d)`,
        value: 'no data yet',
        testId: 'clone-metric-outcome-empty',
      },
    ];
  }

  const reviewed = signals.reviewPass.denominator > 0;
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
  signals: AgentOutcomeSignals | null | undefined,
): number {
  const candidate = windowDays ?? signals?.windowDays ?? DEFAULT_WINDOW_DAYS;
  if (Number.isFinite(candidate) && candidate > 0) {
    return Math.round(candidate);
  }
  return DEFAULT_WINDOW_DAYS;
}

function formatDelivered(ratio: OutcomeRatio): string {
  if (ratio.denominator === 0) return 'no verified runs';
  return formatPercent(ratio);
}

function formatReview(ratio: OutcomeRatio): string {
  if (ratio.denominator === 0) return 'not reviewed yet';
  return formatPercent(ratio);
}

function formatPercent(ratio: OutcomeRatio): string {
  const pct = Math.round((ratio.numerator / ratio.denominator) * 100);
  return `${pct}% (${ratio.numerator}/${ratio.denominator})`;
}
