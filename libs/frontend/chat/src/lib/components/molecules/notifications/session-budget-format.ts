import type {
  SessionBudgetStage,
  SessionBudgetState,
} from '@ptah-extension/shared';

/**
 * Pure helpers for the session budget banner: the display stage and figures
 * on the stats chip's scale.
 */

/** Budget stages from lowest to highest, for the display-stage comparison. */
const STAGE_RANK: Readonly<Record<SessionBudgetStage, number>> = {
  unknown: 0,
  normal: 1,
  tighten: 2,
  handoff: 3,
  limit: 4,
};

/**
 * The stage to display: the higher of the authoritative stage and the live
 * (estimated) stage of the running turn. Display only (D25).
 */
export function displayBudgetStage(
  stage: SessionBudgetStage,
  live: 'handoff' | 'limit' | null,
): SessionBudgetStage {
  return live && STAGE_RANK[live] > STAGE_RANK[stage] ? live : stage;
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
