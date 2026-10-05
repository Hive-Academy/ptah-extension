import type { SessionBudgetState } from '@ptah-extension/shared';
import {
  formatCost,
  formatOptionalTokens,
  formatTokens,
} from './session-stats-format';

/**
 * Text the stats chips add for a session budget (TASK_2026_597 N7).
 * Pure functions: a `null` budget, or a measure a helper does not cover,
 * returns `null` so the chip stays exactly as without a budget.
 */

/** The figures the chips already show, used as the budget numerator. */
export interface BudgetChipFigures {
  /** The TOKENS chip label (`14.9M`, or `—`). */
  readonly tokensLabel: string;
  /** The snapshot's session cost; `null` when unknown. */
  readonly totalCost: number | null;
}

/** A configured dollar limit: `$30`, or `$12.50` when it has cents. */
export function formatBudgetUsd(limit: number): string {
  return Number.isInteger(limit) ? `$${limit}` : `$${limit.toFixed(2)}`;
}

/** `/ 50.0M` beside TOKENS when the budget is counted in tokens. */
export function tokensBudgetSuffix(
  budget: SessionBudgetState | null,
): string | null {
  return budget?.measure === 'tokens'
    ? `/ ${formatTokens(budget.limit)}`
    : null;
}

/** `/ $30` beside the COST badge when the budget is counted in dollars. */
export function costBudgetSuffix(
  budget: SessionBudgetState | null,
): string | null {
  return budget?.measure === 'cost'
    ? `/ ${formatBudgetUsd(budget.limit)}`
    : null;
}

/**
 * Replaces the COST value for the two fallbacks the snapshot cannot show:
 * a lower bound when some models are unpriced, and a weighted token
 * estimate when none is. `null` keeps the badge.
 */
export function costBudgetText(
  budget: SessionBudgetState | null,
): string | null {
  if (!budget || budget.used === null) return null;
  if (budget.measure === 'cost-lower-bound') {
    return `≥ ${formatCost(budget.used)} / ${formatBudgetUsd(budget.limit)} (some models have no price)`;
  }
  if (budget.measure === 'weighted-fallback') {
    return `est. ${formatTokens(budget.used)} / ${formatTokens(budget.limit)} weighted tokens (no price for this model)`;
  }
  return null;
}

/**
 * "Session budget: …" line. The numerator is the chip's own figure for
 * `tokens` and `cost`; only the two fallbacks use the budget's `used`.
 */
export function budgetTooltip(
  budget: SessionBudgetState | null,
  figures: BudgetChipFigures,
): string | null {
  if (!budget || budget.percent === null) return null;
  let used: string;
  let limit: string;
  if (budget.measure === 'tokens') {
    used = figures.tokensLabel;
    limit = formatTokens(budget.limit);
  } else if (budget.measure === 'weighted-fallback') {
    used = formatOptionalTokens(budget.used ?? undefined);
    limit = formatTokens(budget.limit);
  } else {
    const cost =
      budget.measure === 'cost' ? figures.totalCost : (budget.used ?? null);
    used = `${budget.measure === 'cost-lower-bound' ? '≥ ' : ''}${formatCost(cost)}`;
    limit = formatBudgetUsd(budget.limit);
  }
  return `Session budget: ${Math.floor(budget.percent)}% used (${used} of ${limit}). At 50% Ptah lowers auto-compact; at 80% it prepares a handoff; at 100% new messages pause.`;
}

/** COST chip tooltip: the budget line unless the budget is counted in tokens. */
export function costTooltip(
  budget: SessionBudgetState | null,
  budgetLine: string | null,
): string | null {
  return budget?.measure === 'tokens' ? null : budgetLine;
}

/** TOKENS chip tooltip: the token breakdown, plus the budget line for `tokens`. */
export function tokensTooltip(
  budget: SessionBudgetState | null,
  budgetLine: string | null,
  breakdown: string,
): string {
  const line = budget?.measure === 'tokens' ? budgetLine : null;
  return line ? `${breakdown}\n\n${line}` : breakdown;
}
