import type { SessionBudgetState, SessionStatsEntry } from '@ptah-extension/shared';
import type { LiveModelStats } from './session-stats-summary.component';
import type { StatsLimitViewModel } from './plan-limits/stats-limit-view-model.types';
import type { SessionLimitSummary } from './plan-limits/session-limit-summary';
import { budgetTooltip, costTooltip, tokensTooltip } from './session-budget-format';
import { formatTokens } from './session-stats-format';

export interface SessionStatsInputs {
  readonly sessionId: string | null;
  readonly snapshot: SessionStatsEntry | null;
  readonly liveModelStats: LiveModelStats | null;
  readonly compactionCount: number;
  readonly limits: StatsLimitViewModel | null;
  readonly budget: SessionBudgetState | null;
  readonly context: SessionContextCue;
  readonly limitSummary: SessionLimitSummary;
}

export interface SessionContextCue {
  readonly hasLive: boolean;
  readonly known: boolean;
  readonly percent: number | null;
  readonly label: string;
  readonly usedTokens: number | null;
}

export const KNOWN_SUBTOTAL_DETAILS =
  'Only part of this session has a known price. This is the sum of the priced part, not the session total.';
export const AGENTS_DETAILS =
  'Unique subagents this session has run, over its whole lifetime.';

const ESTIMATE_LINE =
  'Live estimate while the turn runs; final figures replace it when it ends.';

function withEstimateLine(text: string | null): string {
  return text ? `${ESTIMATE_LINE}\n\n${text}` : ESTIMATE_LINE;
}

export function sessionContextCue(live: LiveModelStats | null): SessionContextCue {
  const capacity = live?.contextCapacity;
  const known = !!live && live.contextKnown !== false &&
    Number.isFinite(live.contextUsed) && live.contextUsed >= 0 &&
    Number.isFinite(live.contextPercent) && !!capacity &&
    capacity.model === live.model &&
    (capacity.source === 'sdk-native' ||
      (capacity.source === 'provider-catalog' &&
        typeof capacity.providerId === 'string' && capacity.providerId.length > 0)) &&
    typeof capacity.tokens === 'number' && Number.isFinite(capacity.tokens) &&
    capacity.tokens > 0 && live.contextWindow === capacity.tokens;
  return {
    hasLive: !!live,
    known,
    percent: known ? live.contextPercent : null,
    label: known ? `${live.contextPercent}%` : '—',
    usedTokens: known ? live.contextUsed : null,
  };
}

export function contextDetailsText(live: LiveModelStats | null, compactions: number): string | null {
  if (!live) return null;
  const text = !sessionContextCue(live).known
    ? 'Context unknown: the latest main request or its verified capacity is unavailable.'
    : [
        `Context used (latest main request): ${live.contextUsed.toLocaleString()} tokens`,
        `Context Window: ${live.contextWindow.toLocaleString()} tokens`,
        `Usage: ${live.contextPercent}%`,
      ].join('\n');
  return compactions > 0
    ? `${text}\nNumber of context compactions during this session: ${compactions}`
    : text;
}

export function tokenDetailsText(s: SessionStatsEntry | null, b: SessionBudgetState | null): string {
  let breakdown = 'Token usage unavailable.';
  if (s) {
    const t = s.tokens;
    const lines = [
      `Input (uncached): ${t.input.toLocaleString()}`,
      `Output: ${t.output.toLocaleString()}`,
      `Cache Read: ${t.cacheRead.toLocaleString()}`,
      `Cache Creation: ${t.cacheCreation.toLocaleString()}`,
      typeof s.tokenCount === 'number' ? `Total: ${s.tokenCount.toLocaleString()}` : 'Total: unavailable',
    ];
    if (s.coverage === 'partial') lines.push('Some usage could not be counted.');
    breakdown = lines.join('\n');
  }
  const budgetLine = budgetTooltip(b, {
    tokensLabel: typeof s?.tokenCount === 'number' ? formatTokens(s.tokenCount) : '—',
    totalCost: s?.totalCost ?? null,
  });
  const text = tokensTooltip(b, budgetLine, breakdown);
  return s?.provisional ? withEstimateLine(text) : text;
}

export function costDetailsText(s: SessionStatsEntry | null, b: SessionBudgetState | null): string | null {
  const budgetLine = budgetTooltip(b, {
    tokensLabel: typeof s?.tokenCount === 'number' ? formatTokens(s.tokenCount) : '—',
    totalCost: s?.totalCost ?? null,
  });
  const parts = [costTooltip(b, budgetLine), knownSubtotalOf(s) ? KNOWN_SUBTOTAL_DETAILS : null]
    .filter((part): part is string => part !== null);
  const text = parts.length ? parts.join('\n\n') : null;
  return s?.provisional ? withEstimateLine(text) : text;
}

export function knownSubtotalOf(s: SessionStatsEntry | null): { value: number } | null {
  if (!s || s.totalCost !== null || s.pricingCoverage !== 'partial') return null;
  return typeof s.knownCost === 'number' && Number.isFinite(s.knownCost)
    ? { value: s.knownCost } : null;
}

export function agentCountOf(s: SessionStatsEntry | null): number | null {
  const count = s?.agentSessionCount;
  return typeof count === 'number' && count > 0 ? count : null;
}

export function durationMsOf(s: SessionStatsEntry | null): number | null {
  const duration = s?.durationMs;
  return typeof duration === 'number' && duration > 0 ? duration : null;
}

export function lanesAriaLabelFor(count: number): string {
  return `${count} lane run${count === 1 ? '' : 's'}, not in session totals`;
}
