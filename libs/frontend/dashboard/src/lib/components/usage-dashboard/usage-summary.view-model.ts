/** Dashboard view-model shapes and top-level summary builder. */
import type { UsageRangeDays, UsageSourceStatus, UsageSummary, UsageTopSession } from '@ptah-extension/shared';
import { resolveModelDisplayName } from '@ptah-extension/shared';
import { providerAccent } from '../provider-account-card/provider-accent';
import { daySpanLabel, enumerateDays, providerDisplayName } from './usage-formatting';
import {
  KEY_SEPARATOR, buildDayRows, finalizeCost, finalizeSavings,
  foldUsageSummary, shareOf,
} from './usage-summary-fold';

// ---------------------------------------------------------------------------
// View-model shapes
// ---------------------------------------------------------------------------

/** One provider line under the raw token cost (requirement 2). */
export interface ProviderUsageRow {
  readonly providerId: string;
  readonly displayName: string;
  /** Sum of the provider's priced facts; `null` when none is priced. */
  readonly costUsd: number | null;
  /** `cost / totalCost`; `null` when the total is unknown or zero. */
  readonly shareOfCost: number | null;
  /** All four token classes summed over every fact of the provider. */
  readonly tokens: number;
  readonly accent: string;
  /** True when at least one of the provider's facts is unpriced. */
  readonly hasUnpricedFacts: boolean;
  /** Facts of the provider without a price — makes a known sum a lower bound. */
  readonly unpricedFactCount: number;
  /** Tokens of those unpriced facts, for the lower-bound tooltip. */
  readonly unpricedTokens: number;
  /** Sum of the provider's facts with known savings; `null` when none does. */
  readonly cacheSavingsUsd: number | null;
  /** Facts without savings data — makes any known sum a lower bound. */
  readonly savingsUnknownFactCount: number;
}

/** KPI strip inputs (requirement 4). `null` means unknown, never zero. */
export interface UsageKpis {
  readonly sessionCount: number;
  readonly messageCount: number;
  readonly subagentCount: number;
  readonly processedTokens: number;
  readonly processedPerActiveDay: number | null;
  readonly activeDayCount: number;
  readonly cachedInputTokens: number;
  /** Cached share of observed input (cached + uncached); `null` without input. */
  readonly cachedShareOfInput: number | null;
  readonly uncachedInputTokens: number;
  readonly cacheWriteTokens: number;
  readonly outputTokens: number;
  /**
   * What cached reads would have cost at the full input rate minus what they
   * cost, summed over the facts that report it. `null` when no in-window fact
   * reports savings — never zero, never guessed.
   */
  readonly cacheSavingsUsd: number | null;
  /** In-window facts whose `cacheSavingsUsd` is null. */
  readonly cacheSavingsUnknownFactCount: number;
  /**
   * `(rawCost + savings) / rawCost`. `null` unless savings is fully known
   * and the raw cost is known and positive — a lower bound gets no multiple.
   */
  readonly savingsMultiple: number | null;
}

/** Cost-quality panel inputs (requirement 6), as token shares by source. */
export interface UsageCostQuality {
  readonly providerReportedTokenShare: number | null;
  readonly modelPricedTokenShare: number | null;
  readonly unpricedTokenShare: number | null;
  readonly cacheSavingsUsd: number | null;
  readonly cacheSavingsUnknownFactCount: number;
}

/** Per-provider daily series for the stacked bar chart. */
export interface ProviderDailySeries {
  readonly providerId: string;
  readonly displayName: string;
  readonly accent: string;
  /** One entry per day, oldest first; unpriced facts contribute 0 to cost. */
  readonly costValues: readonly number[];
  /** Per day: true when the provider had an unpriced fact that day. */
  readonly costUnknownByDay: readonly boolean[];
  readonly tokenValues: readonly number[];
}

/** One row of the Model breakdown (requirement 5). */
export interface ModelBreakdownRow {
  readonly providerId: string;
  readonly modelId: string;
  readonly modelDisplayName: string;
  readonly costUsd: number | null;
  readonly shareOfCost: number | null;
  readonly tokens: number;
  readonly unpriced: boolean;
  readonly cacheSavingsUsd: number | null;
  readonly savingsUnknownFactCount: number;
}

/** One row of the Day breakdown (requirement 5). */
export interface DayBreakdownRow {
  readonly day: string;
  readonly costUsd: number | null;
  readonly shareOfCost: number | null;
  readonly tokens: number;
  /** Facts of the day without a price — makes a known sum a lower bound. */
  readonly unpricedFactCount: number;
  /** Highest-cost model of the day; falls back to highest tokens; else `null`. */
  readonly topModelId: string | null;
  readonly topModelDisplayName: string | null;
  readonly cacheSavingsUsd: number | null;
  readonly savingsUnknownFactCount: number;
}

export interface UsageViewModel {
  readonly topSessions: readonly UsageTopSession[];
  readonly range: UsageRangeDays | null;
  readonly days: readonly string[];
  readonly dateSpanLabel: string;
  /** Sum of every priced fact; `null` when no fact in range has a price. */
  readonly totalCostUsd: number | null;
  /**
   * In-window facts without a price. Any value above zero makes
   * `totalCostUsd` a lower bound ("≥") and every cost share a share of
   * *known priced cost*, never of the full cost.
   */
  readonly totalCostUnpricedFactCount: number;
  /** Tokens of those unpriced facts, for the lower-bound tooltip. */
  readonly totalCostUnpricedTokens: number;
  /** Per day: true when the day has at least one unpriced fact. */
  readonly dayCostUnknown: readonly boolean[];
  /** True when any source did not report complete coverage. */
  readonly isPartial: boolean;
  readonly sources: readonly UsageSourceStatus[];
  readonly providers: readonly ProviderUsageRow[];
  readonly kpis: UsageKpis;
  readonly quality: UsageCostQuality;
  readonly providerSeries: readonly ProviderDailySeries[];
  readonly modelRows: readonly ModelBreakdownRow[];
  readonly dayRows: readonly DayBreakdownRow[];
  /** True when at least one in-window fact carries usage. */
  readonly hasUsage: boolean;
  readonly outOfWindowFactCount: number;
}

/**
 * Fold a usage summary into the dashboard view model. `summary === null`
 * yields `null` (nothing loaded yet). `availableModels` resolves model
 * display names through the shared resolver.
 */
export function buildUsageViewModel(
  summary: UsageSummary | null,
  availableModels?: ReadonlyArray<{ id: string; name: string }>,
): UsageViewModel | null {
  if (!summary) return null;
  const days = enumerateDays(summary.fromDay, summary.untilDayExclusive);
  const {
    providers, models, dayModels, sourceTokens, dayUnpricedCount,
    totalCost, totalCostKnown, totalUnpricedFactCount, totalUnpricedTokens,
    totalSavings, savingsKnown, savingsUnknownFactCount, processed,
    cachedInput, uncachedInput, cacheWrites, output,
    outOfWindowFactCount, hasUsage,
  } = foldUsageSummary(summary, days);

  const totalCostUsd = totalCostKnown ? totalCost : null;
  const totalTokens = processed;

  const providerRows: ProviderUsageRow[] = Array.from(
    providers.entries(),
  ).map(([providerId, acc]) => ({
    providerId,
    displayName: providerDisplayName(providerId),
    costUsd: finalizeCost(acc),
    shareOfCost: shareOf(finalizeCost(acc), totalCostUsd),
    tokens: acc.tokens,
    accent: providerAccent(providerId),
    hasUnpricedFacts: acc.hasUnpriced,
    unpricedFactCount: acc.unpricedCount,
    unpricedTokens: acc.unpricedTokens,
    cacheSavingsUsd: finalizeSavings(acc),
    savingsUnknownFactCount: acc.savingsUnknown,
  }));
  providerRows.sort(
    (a, b) =>
      (b.costUsd ?? -1) - (a.costUsd ?? -1) ||
      b.tokens - a.tokens ||
      a.providerId.localeCompare(b.providerId),
  );

  const modelRows: ModelBreakdownRow[] = Array.from(models.values()).map(
    (acc) => ({
      providerId: acc.providerId,
      modelId: acc.modelId,
      modelDisplayName: resolveModelDisplayName(
        acc.modelId,
        availableModels,
      ),
      costUsd: finalizeCost(acc),
      shareOfCost: shareOf(finalizeCost(acc), totalCostUsd),
      tokens: acc.tokens,
      unpriced: acc.unpriced,
      cacheSavingsUsd: finalizeSavings(acc),
      savingsUnknownFactCount: acc.savingsUnknown,
    }),
  );
  modelRows.sort(
    (a, b) =>
      (b.costUsd ?? -1) - (a.costUsd ?? -1) ||
      b.tokens - a.tokens ||
      `${a.providerId}${KEY_SEPARATOR}${a.modelId}`.localeCompare(
        `${b.providerId}${KEY_SEPARATOR}${b.modelId}`,
      ),
  );

  const activeDayCount = dayModels.size;
  const observedInput = cachedInput + uncachedInput;
  const kpis: UsageKpis = {
    sessionCount: summary.sessionCount ?? 0,
    messageCount: summary.messageCount ?? 0,
    subagentCount: summary.subagentCount ?? 0,
    processedTokens: processed,
    processedPerActiveDay:
      activeDayCount > 0 ? processed / activeDayCount : null,
    activeDayCount,
    cachedInputTokens: cachedInput,
    cachedShareOfInput:
      observedInput > 0 ? cachedInput / observedInput : null,
    uncachedInputTokens: uncachedInput,
    cacheWriteTokens: cacheWrites,
    outputTokens: output,
    cacheSavingsUsd: savingsKnown ? totalSavings : null,
    cacheSavingsUnknownFactCount: savingsUnknownFactCount,
    // The multiple is honest only when savings AND raw cost are fully known
    // and the cost is positive: one unpriced fact makes the denominator a
    // lower bound, so no multiple is shown at all.
    savingsMultiple:
      savingsKnown &&
      savingsUnknownFactCount === 0 &&
      totalUnpricedFactCount === 0 &&
      totalCostUsd !== null &&
      totalCostUsd > 0
        ? (totalCostUsd + totalSavings) / totalCostUsd
        : null,
  };

  const quality: UsageCostQuality = {
    providerReportedTokenShare: shareOf(
      sourceTokens.get('provider-reported') ?? 0,
      totalTokens,
    ),
    modelPricedTokenShare: shareOf(
      sourceTokens.get('model-priced') ?? 0,
      totalTokens,
    ),
    unpricedTokenShare: shareOf(sourceTokens.get('unpriced') ?? 0, totalTokens),
    cacheSavingsUsd: kpis.cacheSavingsUsd,
    cacheSavingsUnknownFactCount: savingsUnknownFactCount,
  };

  const providerSeries: ProviderDailySeries[] = providerRows.map((row) => {
    const acc = providers.get(row.providerId)!;
    return {
      providerId: row.providerId,
      displayName: row.displayName,
      accent: row.accent,
      costValues: acc.costByDay,
      costUnknownByDay: acc.costUnknownByDay,
      tokenValues: acc.tokensByDay,
    };
  });
  const dayRows: DayBreakdownRow[] = buildDayRows(
    days, dayModels, dayUnpricedCount, models, totalCostUsd, availableModels,
  );

  return {
    topSessions: summary.topSessions ?? [],
    range: days.length === 7 || days.length === 30 || days.length === 90
      ? (days.length as UsageRangeDays)
      : null,
    days,
    dateSpanLabel: daySpanLabel(days),
    totalCostUsd,
    totalCostUnpricedFactCount: totalUnpricedFactCount,
    totalCostUnpricedTokens: totalUnpricedTokens,
    dayCostUnknown: days.map((day) => (dayUnpricedCount.get(day) ?? 0) > 0),
    isPartial: summary.sources.some((source) => source.status !== 'complete'),
    sources: summary.sources,
    providers: providerRows,
    kpis,
    quality,
    providerSeries,
    modelRows,
    dayRows,
    hasUsage,
    outOfWindowFactCount,
  };
}
