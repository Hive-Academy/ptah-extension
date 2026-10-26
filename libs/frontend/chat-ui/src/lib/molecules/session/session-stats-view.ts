import type { SessionBudgetState, SessionStatsEntry } from '@ptah-extension/shared';
import type { LiveModelStats } from './session-stats-summary.component';
import type { StatsLimitViewModel } from './plan-limits/stats-limit-view-model.types';
import type { SessionLimitSummary } from './plan-limits/session-limit-summary';
import { budgetTooltip, costTooltip, tokensTooltip } from './session-budget-format';
import { formatCost, formatDuration, formatTokens } from './session-stats-format';

export interface SessionStatsInputs {
  readonly sessionId: string | null;
  readonly snapshot: SessionStatsEntry | null;
  readonly cache?: NonNullable<SessionStatsEntry['cache']> | null;
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

export const STATS_EMPTY = { value: '—', context: 'Context unavailable', tokens: 'Tokens unavailable', cost: 'Cost unavailable' } as const;

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
  if (!live) return STATS_EMPTY.context;
  const text = !sessionContextCue(live).known
    ? STATS_EMPTY.context
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
  let breakdown: string = STATS_EMPTY.tokens;
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
  const parts = [s?.totalCost == null ? STATS_EMPTY.cost : null, costTooltip(b, budgetLine), knownSubtotalOf(s) ? KNOWN_SUBTOTAL_DETAILS : null]
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

/** Formatting-only projection of the same inputs used by the expanded inspector. */
export interface CompactSessionMetric {
  readonly id: 'context' | 'tokens' | 'cost' | 'time';
  readonly label: 'Ctx' | 'Tokens' | 'Cost' | 'Time';
  readonly value: string;
  readonly ariaLabel: string;
  readonly unavailable: boolean;
}

export function compactSessionMetrics(stats: SessionStatsInputs): readonly CompactSessionMetric[] {
  const snapshot = stats.snapshot;
  const tokens = snapshot?.tokenCount;
  const subtotal = knownSubtotalOf(snapshot);
  const cost = snapshot?.totalCost ?? subtotal?.value ?? null;
  const estimate = snapshot?.provisional ? '~' : '';
  const estimatedLabel = snapshot?.provisional ? 'estimated ' : '';
  const partialTokens = snapshot?.coverage === 'partial';
  const metrics: CompactSessionMetric[] = [
    {
      id: 'context', label: 'Ctx', value: stats.context.label,
      ariaLabel: stats.context.known
        ? `Context ${stats.context.label}, ${stats.context.usedTokens?.toLocaleString()} tokens used`
        : STATS_EMPTY.context,
      unavailable: !stats.context.known,
    },
    {
      id: 'tokens', label: 'Tokens',
      value: typeof tokens === 'number' ? `${estimate}${partialTokens ? '≥' : ''}${formatTokens(tokens)}` : STATS_EMPTY.value,
      ariaLabel: typeof tokens === 'number' ? `Tokens ${estimatedLabel}${partialTokens ? 'at least ' : ''}${tokens.toLocaleString()}` : STATS_EMPTY.tokens,
      unavailable: typeof tokens !== 'number',
    },
    {
      id: 'cost', label: 'Cost',
      value: cost === null ? STATS_EMPTY.value : `${estimate}${subtotal ? '≥' : ''}${formatCost(cost)}`,
      ariaLabel: cost === null ? STATS_EMPTY.cost : `Cost ${estimatedLabel}${subtotal ? 'known subtotal ' : ''}${formatCost(cost).slice(1)} US dollars`,
      unavailable: cost === null,
    },
  ];
  const duration = durationMsOf(snapshot);
  if (duration !== null) {
    const value = formatDuration(duration);
    const spokenDuration = value.replace(/([\d.]+)(ms|m|s)\b/g, (_match: string, amount: string, unit: string) => {
      const name = unit === 'ms' ? 'millisecond' : unit === 'm' ? 'minute' : 'second';
      return `${amount} ${name}${Number(amount) === 1 ? '' : 's'}`;
    });
    metrics.push({ id: 'time', label: 'Time', value, ariaLabel: `Time ${spokenDuration}`, unavailable: false });
  }
  return metrics;
}
