import type {
  SessionBudgetState,
  SessionHandoverState,
} from '@ptah-extension/shared';

/**
 * Pure text for the session budget banner: figures on the stats chip's scale
 * and the work-in-flight line of a waiting handover.
 */

/** A finite, non-negative integer; `waitingFor` is not validated upstream. */
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** `1 subagent`, `2 subagents`. */
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** `50%`, `100.2%`. */
export function formatPercent(percent: number): string {
  const rounded = Math.round(percent * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}

/** Same scale as the stats chip: `14.1M`, `950.0k`, `812`. */
export function formatTokens(count: number | null): string {
  if (count === null) return '—';
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

/** Same scale as the stats chip: `$8.96`, `$0.0042`. */
export function formatUsd(amount: number | null): string {
  if (amount === null) return '—';
  if (Number.isInteger(amount)) return `$${amount}`;
  return amount < 0.01 ? `$${amount.toFixed(4)}` : `$${amount.toFixed(2)}`;
}

export function isCostMeasure(budget: SessionBudgetState): boolean {
  return budget.measure === 'cost' || budget.measure === 'cost-lower-bound';
}

/** "<used> of <limit> <unit>", formatted like the stats chip. */
export function budgetAmount(budget: SessionBudgetState): string {
  const used = formatTokens(budget.used);
  const limit = formatTokens(budget.limit);
  switch (budget.measure) {
    case 'tokens':
      return `${used} of ${limit} tokens`;
    case 'weighted-fallback':
      return `${used} of ${limit} weighted tokens (estimate)`;
    case 'cost-lower-bound':
      return `≥ ${formatUsd(budget.used)} of ${formatUsd(budget.limit)} of cost`;
    case 'cost':
      return `${formatUsd(budget.used)} of ${formatUsd(budget.limit)} of cost`;
  }
}

/**
 * "Waiting for the turn to end, 2 subagents, 1 lane." An invalid subagent
 * count is left out; lanes that are `null` (the lane provider failed) or
 * invalid read "lane status unknown", never 0 (627 S22).
 */
export function waitingLine(
  waiting: SessionHandoverState['waitingFor'],
  turnRunning: boolean,
): string {
  const parts: string[] = [];
  if (turnRunning) parts.push('the turn to end');
  const subagents = waiting?.subagents;
  if (isCount(subagents) && subagents > 0) {
    parts.push(plural(subagents, 'subagent'));
  }
  const lanes = waiting?.lanes;
  const lanesUnknown = waiting !== undefined && !isCount(lanes);
  if (isCount(lanes) && lanes > 0) parts.push(plural(lanes, 'lane'));
  if (parts.length === 0) {
    return lanesUnknown
      ? 'Waiting for running work, lane status unknown.'
      : 'Waiting for the turn to end.';
  }
  const unknown = lanesUnknown ? ', lane status unknown' : '';
  return `Waiting for ${parts.join(', ')}${unknown}.`;
}
