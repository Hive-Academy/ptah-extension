/**
 * buildUsageViewModel — the pure fold the whole Usage tab renders from.
 * Every honesty rule of TASK_2026_707 is pinned here: unpriced cost never
 * becomes zero, shares are null (not 0) when their denominator is unknown,
 * out-of-window facts are excluded but counted, and cache savings stay
 * unknown ("—") when no fact reports them and a lower bound ("≥") when
 * only some do.
 */
import type { UsageFact } from '@ptah-extension/shared';
import { buildUsageViewModel } from './usage-summary.view-model';
import { buildCostSlices } from './usage-cost-donut.geometry';
import { daySpanLabel, enumerateDays, formatChartUsd, formatCompactTokens, formatCompactUsd, formatDayShort, formatPercent, formatUsd, providerDisplayName } from './usage-formatting';
import {
  usageFact,
  usageSummary,
} from '../../services/dashboard-rpc.testing';

/** Day 18: priced Anthropic Sonnet with every token class. */
const factSonnetDay18: UsageFact = usageFact({
  inputUncachedTokens: 1000,
  cacheReadTokens: 500,
  cacheWriteTokens: 200,
  outputTokens: 300,
  costUsd: 2,
});
/** Day 19: priced Anthropic Opus. */
const factOpusDay19: UsageFact = usageFact({
  day: '2026-10-19',
  modelId: 'claude-opus-4-6',
  inputUncachedTokens: 100,
  outputTokens: 100,
  costUsd: 3,
});
/** Day 19: unpriced OpenCode model. */
const factQwenDay19: UsageFact = usageFact({
  day: '2026-10-19',
  providerId: 'opencode',
  modelId: 'qwen3-coder',
  sourceId: 'opencode-ledger',
  inputUncachedTokens: 700,
  outputTokens: 300,
  costUsd: null,
  costSource: 'unpriced',
});
/** Day 21: outside the [18, 21) window of the default summary. */
const factOutOfWindow: UsageFact = usageFact({
  day: '2026-10-21',
  inputUncachedTokens: 5000,
  outputTokens: 0,
  costUsd: 4,
});

describe('usage-summary view model helpers', () => {
  it('keeps small chart cost ticks distinct instead of collapsing to $0', () => {
    const ticks = [0, 0.002, 0.004, 0.006, 0.008].map(formatChartUsd);
    expect(ticks).toEqual(['$0', '$0.002', '$0.004', '$0.006', '$0.008']);
    expect(new Set(ticks).size).toBe(ticks.length);
    expect(formatChartUsd(0.0034)).toBe('$0.0034');
    expect(formatChartUsd(2.4)).toBe(formatCompactUsd(2.4));
  });

  it('calculates the displayed before-savings multiple for $11.05 saved on $3.82 cost', () => {
    const vm = buildUsageViewModel(usageSummary([
      { ...factSonnetDay18, costUsd: 3.82, cacheSavingsUsd: 11.05 },
    ]))!;
    expect(vm.kpis.savingsMultiple).toBeCloseTo((3.82 + 11.05) / 3.82);
    expect(vm.kpis.savingsMultiple?.toFixed(1)).toBe('3.9');
  });

  it('excludes unpriced cost from donut arcs and groups slices after the top five', () => {
    const items = [1, 2, 3, 4, 5, 6].map((cost, i) => ({
      id: String(i), label: `Model ${i}`, costUsd: cost, color: '#123456', unpriced: false,
    }));
    const slices = buildCostSlices([...items, { id: 'unknown', label: 'Unknown', costUsd: null, color: '#654321', unpriced: true }]);
    expect(slices).toHaveLength(7);
    expect(slices.find((slice) => slice.id === 'other')?.costUsd).toBe(1);
    expect(slices.find((slice) => slice.id === 'unknown')?.percent).toBeNull();
    expect(slices.filter((slice) => slice.percent !== null).reduce((sum, slice) => sum + slice.percent!, 0)).toBeCloseTo(1);
  });
  it('enumerates every UTC day of a half-open window, oldest first', () => {
    expect(enumerateDays('2026-10-18', '2026-10-21')).toEqual([
      '2026-10-18',
      '2026-10-19',
      '2026-10-20',
    ]);
  });

  it('returns an empty window for an empty, reversed or invalid range', () => {
    expect(enumerateDays('2026-10-18', '2026-10-18')).toEqual([]);
    expect(enumerateDays('2026-10-20', '2026-10-18')).toEqual([]);
    expect(enumerateDays('not-a-day', '2026-10-20')).toEqual([]);
  });

  it('labels a same-year span without repeating the year', () => {
    expect(daySpanLabel(['2026-10-18', '2026-10-20'])).toBe(
      'Oct 18 – Oct 20, 2026',
    );
  });

  it('labels a cross-year span with both years', () => {
    expect(daySpanLabel(['2025-12-31', '2026-01-05'])).toBe(
      'Dec 31, 2025 – Jan 5, 2026',
    );
  });

  it('formats money, tokens, percentages and day labels compactly', () => {
    expect(formatUsd(1234.56)).toBe('$1,234.56');
    expect(formatCompactUsd(1234)).toBe('$1.2K');
    expect(formatCompactTokens(46_200_000)).toBe('46.2M');
    expect(formatCompactTokens(3200)).toBe('3.2K');
    expect(formatPercent(0.343)).toBe('34.3%');
    expect(formatDayShort('2026-10-18')).toBe('Oct 18');
  });

  it('maps known provider ids and title-cases unknown ones', () => {
    expect(providerDisplayName('anthropic')).toBe('Anthropic');
    expect(providerDisplayName('z-ai')).toBe('Z.ai');
    expect(providerDisplayName('some-new-agent')).toBe('Some New Agent');
  });
});

describe('buildUsageViewModel', () => {
  const availableModels = [{ id: 'claude-opus-4-6', name: 'Claude Opus 4.6' }];

  it('returns null when nothing has loaded', () => {
    expect(buildUsageViewModel(null)).toBeNull();
  });

  it('folds tokens, cost, shares, kpis and quality over the window', () => {
    const vm = buildUsageViewModel(
      usageSummary([factSonnetDay18, factOpusDay19, factQwenDay19, factOutOfWindow]),
      availableModels,
    )!;

    expect(vm.days).toEqual(['2026-10-18', '2026-10-19', '2026-10-20']);
    expect(vm.dateSpanLabel).toBe('Oct 18 – Oct 20, 2026');
    // Three days is not a selectable 7/30/90 range.
    expect(vm.range).toBeNull();
    expect(vm.hasUsage).toBe(true);
    expect(vm.outOfWindowFactCount).toBe(1);
    expect(vm.sources).toEqual([]);
    expect(vm.isPartial).toBe(false);

    // Total = priced facts only: 2 + 3. The unpriced fact never adds zero.
    expect(vm.totalCostUsd).toBe(5);
    // The unpriced fact makes the total a lower bound, never a full total.
    expect(vm.totalCostUnpricedFactCount).toBe(1);
    expect(vm.totalCostUnpricedTokens).toBe(1000);
    expect(vm.dayCostUnknown).toEqual([false, true, false]);

    // Providers: priced first by cost, then tokens; the unpriced one last.
    expect(vm.providers.map((p) => p.providerId)).toEqual([
      'anthropic',
      'opencode',
    ]);
    const anthropic = vm.providers[0]!;
    expect(anthropic.costUsd).toBe(5);
    expect(anthropic.shareOfCost).toBe(1);
    expect(anthropic.tokens).toBe(2200);
    expect(anthropic.hasUnpricedFacts).toBe(false);
    expect(anthropic.unpricedFactCount).toBe(0);
    expect(anthropic.unpricedTokens).toBe(0);
    const opencode = vm.providers[1]!;
    expect(opencode.costUsd).toBeNull();
    expect(opencode.shareOfCost).toBeNull();
    expect(opencode.tokens).toBe(1000);
    expect(opencode.hasUnpricedFacts).toBe(true);
    expect(opencode.unpricedFactCount).toBe(1);
    expect(opencode.unpricedTokens).toBe(1000);

    // Model rows are provider-qualified and sorted cost desc, then tokens.
    expect(vm.modelRows.map((r) => r.modelId)).toEqual([
      'claude-opus-4-6',
      'claude-sonnet-4-5',
      'qwen3-coder',
    ]);
    expect(vm.modelRows[0]!.modelDisplayName).toBe('Claude Opus 4.6');
    expect(vm.modelRows[0]!.costUsd).toBe(3);
    expect(vm.modelRows[0]!.shareOfCost).toBeCloseTo(0.6);
    expect(vm.modelRows[2]!.costUsd).toBeNull();
    expect(vm.modelRows[2]!.shareOfCost).toBeNull();
    expect(vm.modelRows[2]!.unpriced).toBe(true);

    // KPIs fold the four token classes over every in-window fact.
    expect(vm.kpis.processedTokens).toBe(3200);
    expect(vm.kpis.activeDayCount).toBe(2);
    expect(vm.kpis.processedPerActiveDay).toBe(1600);
    expect(vm.kpis.cachedInputTokens).toBe(500);
    expect(vm.kpis.cachedShareOfInput).toBeCloseTo(500 / 2300);
    expect(vm.kpis.uncachedInputTokens).toBe(1800);
    expect(vm.kpis.cacheWriteTokens).toBe(200);
    expect(vm.kpis.outputTokens).toBe(700);
    // These facts report no savings: the totals stay unknown, never zero.
    expect(vm.kpis.cacheSavingsUsd).toBeNull();
    expect(vm.kpis.cacheSavingsUnknownFactCount).toBe(3);
    expect(vm.kpis.savingsMultiple).toBeNull();

    // Quality: token shares by cost source.
    expect(vm.quality.providerReportedTokenShare).toBeCloseTo(2200 / 3200);
    expect(vm.quality.modelPricedTokenShare).toBe(0);
    expect(vm.quality.unpricedTokenShare).toBeCloseTo(1000 / 3200);
    expect(vm.quality.cacheSavingsUsd).toBeNull();
    expect(vm.quality.cacheSavingsUnknownFactCount).toBe(3);

    // Chart series: one value per day, oldest first; unpriced adds 0 cost.
    const anthropicSeries = vm.providerSeries[0]!;
    expect(anthropicSeries.costValues).toEqual([2, 3, 0]);
    expect(anthropicSeries.costUnknownByDay).toEqual([false, false, false]);
    expect(anthropicSeries.tokenValues).toEqual([2000, 200, 0]);
    const opencodeSeries = vm.providerSeries[1]!;
    expect(opencodeSeries.costValues).toEqual([0, 0, 0]);
    expect(opencodeSeries.costUnknownByDay).toEqual([false, true, false]);
    expect(opencodeSeries.tokenValues).toEqual([0, 1000, 0]);

    // Day rows: top model by cost; a day without facts stays empty.
    expect(vm.dayRows).toHaveLength(3);
    expect(vm.dayRows[0]!.costUsd).toBe(2);
    expect(vm.dayRows[0]!.shareOfCost).toBeCloseTo(0.4);
    expect(vm.dayRows[0]!.tokens).toBe(2000);
    expect(vm.dayRows[0]!.unpricedFactCount).toBe(0);
    expect(vm.dayRows[0]!.topModelId).toBe('claude-sonnet-4-5');
    expect(vm.dayRows[1]!.costUsd).toBe(3);
    expect(vm.dayRows[1]!.tokens).toBe(1200);
    expect(vm.dayRows[1]!.unpricedFactCount).toBe(1);
    expect(vm.dayRows[1]!.topModelId).toBe('claude-opus-4-6');
    expect(vm.dayRows[2]!.costUsd).toBeNull();
    expect(vm.dayRows[2]!.shareOfCost).toBeNull();
    expect(vm.dayRows[2]!.tokens).toBe(0);
    expect(vm.dayRows[2]!.topModelId).toBeNull();
  });

  it('picks the day top model by tokens when no model of the day is priced', () => {
    const vm = buildUsageViewModel(usageSummary([factQwenDay19]))!;
    expect(vm.dayRows[1]!.costUsd).toBeNull();
    expect(vm.dayRows[1]!.topModelId).toBe('qwen3-coder');
  });

  it('marks the summary partial from any non-complete source', () => {
    const vm = buildUsageViewModel(
      usageSummary([factSonnetDay18], {
        sources: [
          { sourceId: 'claude-ledger', status: 'partial', reason: 'one malformed line' },
          { sourceId: 'antigravity', status: 'complete' },
        ],
      }),
    )!;
    expect(vm.isPartial).toBe(true);
    expect(vm.sources).toHaveLength(2);
  });

  it('keeps a known zero total distinct from an unknown total', () => {
    const vm = buildUsageViewModel(
      usageSummary([
        usageFact({
          inputUncachedTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 0,
          costUsd: 0,
        }),
      ]),
    )!;
    expect(vm.hasUsage).toBe(false);
    expect(vm.totalCostUsd).toBe(0);
  });

  it('reports an unknown total when no fact in range has a price', () => {
    const vm = buildUsageViewModel(usageSummary([factQwenDay19]))!;
    expect(vm.totalCostUsd).toBeNull();
    expect(vm.providers[0]!.costUsd).toBeNull();
    expect(vm.providers[0]!.shareOfCost).toBeNull();
    expect(vm.quality.unpricedTokenShare).toBe(1);
  });

  it('renders an empty window without inventing usage', () => {
    const vm = buildUsageViewModel(usageSummary([], { range: 7 }))!;
    expect(vm.range).toBe(7);
    expect(vm.days).toHaveLength(7);
    expect(vm.dateSpanLabel).toBe('Oct 14 – Oct 20, 2026');
    expect(vm.hasUsage).toBe(false);
    expect(vm.totalCostUsd).toBeNull();
    expect(vm.providers).toEqual([]);
    expect(vm.modelRows).toEqual([]);
    expect(vm.kpis.processedTokens).toBe(0);
    expect(vm.kpis.processedPerActiveDay).toBeNull();
    expect(vm.kpis.cachedShareOfInput).toBeNull();
    expect(vm.quality.providerReportedTokenShare).toBeNull();
    expect(vm.quality.unpricedTokenShare).toBeNull();
    // Empty days still get rows, all unknown/empty.
    expect(vm.dayRows).toHaveLength(7);
    expect(vm.dayRows.every((row) => row.costUsd === null && row.tokens === 0)).toBe(true);
  });
});

describe('buildUsageViewModel cache savings', () => {
  it('aggregates savings per provider, model, day and in total when every fact reports', () => {
    const vm = buildUsageViewModel(
      usageSummary([
        { ...factSonnetDay18, cacheSavingsUsd: 1.5 },
        { ...factOpusDay19, cacheSavingsUsd: 0.5 },
        { ...factQwenDay19, cacheSavingsUsd: 0.4 },
      ]),
    )!;

    expect(vm.kpis.cacheSavingsUsd).toBeCloseTo(2.4);
    expect(vm.kpis.cacheSavingsUnknownFactCount).toBe(0);
    // Savings is fully known, but the Qwen fact has no price: the raw cost
    // denominator is only partly known, so no multiple is shown at all.
    expect(vm.kpis.savingsMultiple).toBeNull();
    expect(vm.quality.cacheSavingsUsd).toBeCloseTo(2.4);
    expect(vm.quality.cacheSavingsUnknownFactCount).toBe(0);

    expect(vm.providers[0]!.cacheSavingsUsd).toBeCloseTo(2);
    expect(vm.providers[0]!.savingsUnknownFactCount).toBe(0);
    // An unpriced fact can still report savings: the contract refine ties
    // only costUsd to costSource.
    expect(vm.providers[1]!.cacheSavingsUsd).toBeCloseTo(0.4);
    expect(vm.providers[1]!.savingsUnknownFactCount).toBe(0);
    expect(vm.modelRows[0]!.cacheSavingsUsd).toBeCloseTo(0.5);
    expect(vm.dayRows[0]!.cacheSavingsUsd).toBeCloseTo(1.5);
    expect(vm.dayRows[1]!.cacheSavingsUsd).toBeCloseTo(0.9);
    // The empty third day reports nothing.
    expect(vm.dayRows[2]!.cacheSavingsUsd).toBeNull();
  });

  it('computes the savings multiple only when cost and savings are both fully known', () => {
    const vm = buildUsageViewModel(
      usageSummary([
        { ...factSonnetDay18, cacheSavingsUsd: 1.5 },
        { ...factOpusDay19, cacheSavingsUsd: 0.5 },
        {
          ...factQwenDay19,
          costUsd: 1,
          costSource: 'model-priced',
          cacheSavingsUsd: 0.4,
        },
      ]),
    )!;

    expect(vm.totalCostUsd).toBe(6);
    expect(vm.totalCostUnpricedFactCount).toBe(0);
    expect(vm.kpis.cacheSavingsUsd).toBeCloseTo(2.4);
    expect(vm.kpis.cacheSavingsUnknownFactCount).toBe(0);
    // (6 + 2.4) / 6.
    expect(vm.kpis.savingsMultiple).toBeCloseTo(1.4);
  });

  it('marks a partially known sum as a lower bound and hides the multiple', () => {
    const vm = buildUsageViewModel(
      usageSummary([
        { ...factSonnetDay18, cacheSavingsUsd: 1.5 },
        factOpusDay19,
        factQwenDay19,
      ]),
    )!;

    expect(vm.kpis.cacheSavingsUsd).toBeCloseTo(1.5);
    expect(vm.kpis.cacheSavingsUnknownFactCount).toBe(2);
    expect(vm.kpis.savingsMultiple).toBeNull();

    const anthropic = vm.providers[0]!;
    expect(anthropic.cacheSavingsUsd).toBeCloseTo(1.5);
    expect(anthropic.savingsUnknownFactCount).toBe(1);
    const opencode = vm.providers[1]!;
    expect(opencode.cacheSavingsUsd).toBeNull();
    expect(opencode.savingsUnknownFactCount).toBe(1);

    expect(vm.modelRows[0]!.cacheSavingsUsd).toBeNull();
    expect(vm.modelRows[0]!.savingsUnknownFactCount).toBe(1);

    expect(vm.dayRows[0]!.cacheSavingsUsd).toBeCloseTo(1.5);
    expect(vm.dayRows[0]!.savingsUnknownFactCount).toBe(0);
    // Day 19 has two facts and neither reports savings.
    expect(vm.dayRows[1]!.cacheSavingsUsd).toBeNull();
    expect(vm.dayRows[1]!.savingsUnknownFactCount).toBe(2);
  });

  it('keeps every savings total null when no fact reports savings', () => {
    const vm = buildUsageViewModel(
      usageSummary([factSonnetDay18, factOpusDay19, factQwenDay19]),
    )!;

    expect(vm.kpis.cacheSavingsUsd).toBeNull();
    expect(vm.kpis.cacheSavingsUnknownFactCount).toBe(3);
    expect(vm.kpis.savingsMultiple).toBeNull();
    expect(vm.providers[0]!.cacheSavingsUsd).toBeNull();
    expect(vm.modelRows[0]!.cacheSavingsUsd).toBeNull();
    expect(vm.dayRows[0]!.cacheSavingsUsd).toBeNull();
  });

  it('aggregates savings on a zero-cost fact but computes no multiple', () => {
    const vm = buildUsageViewModel(
      usageSummary([
        usageFact({
          inputUncachedTokens: 10,
          outputTokens: 0,
          costUsd: 0,
          cacheSavingsUsd: 1,
        }),
      ]),
    )!;

    expect(vm.totalCostUsd).toBe(0);
    expect(vm.kpis.cacheSavingsUsd).toBe(1);
    expect(vm.kpis.cacheSavingsUnknownFactCount).toBe(0);
    // The multiple needs a known, positive raw cost.
    expect(vm.kpis.savingsMultiple).toBeNull();
  });
});
