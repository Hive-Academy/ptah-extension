/** Accumulation and grouping internals for usage summaries. */
import type { UsageSummary } from '@ptah-extension/shared';
import { resolveModelDisplayName } from '@ptah-extension/shared';

export const KEY_SEPARATOR = '\u0000';

interface SavingsAcc {
  savings: number;
  savingsKnown: boolean;
  savingsUnknown: number;
}

interface ProviderAcc extends SavingsAcc {
  cost: number;
  costKnown: boolean;
  tokens: number;
  hasUnpriced: boolean;
  unpricedCount: number;
  unpricedTokens: number;
  costByDay: number[];
  costUnknownByDay: boolean[];
  tokensByDay: number[];
}

interface ModelAcc {
  cost: number;
  costKnown: boolean;
  tokens: number;
  unpriced: boolean;
}

interface ModelAccSeed extends ModelAcc, SavingsAcc {
  providerId: string;
  modelId: string;
}

interface DayModelAcc extends SavingsAcc {
  cost: number;
  costKnown: boolean;
  tokens: number;
}

export function shareOf(part: number | null, total: number | null): number | null {
  if (part === null || total === null || total <= 0) return null;
  return part / total;
}

export function finalizeCost(acc: { cost: number; costKnown: boolean }): number | null {
  return acc.costKnown ? acc.cost : null;
}

/** Add one fact's savings to a group: known sums grow, nulls only count. */
function addSavings(acc: SavingsAcc, savings: number | null): void {
  if (savings !== null) {
    acc.savings += savings;
    acc.savingsKnown = true;
  } else {
    acc.savingsUnknown++;
  }
}

export function finalizeSavings(acc: SavingsAcc): number | null {
  return acc.savingsKnown ? acc.savings : null;
}


export function foldUsageSummary(summary: UsageSummary, days: readonly string[]) {
  const dayIndex = new Map(days.map((day, i) => [day, i] as const));
  const providers = new Map<string, ProviderAcc>();
  const models = new Map<string, ModelAccSeed>();
  const dayModels = new Map<string, Map<string, DayModelAcc>>();
  const sourceTokens = new Map<string, number>();
  /** Per day: number of that day's facts without a price. */
  const dayUnpricedCount = new Map<string, number>();

  let totalCost = 0;
  let totalCostKnown = false;
  let totalUnpricedFactCount = 0;
  let totalUnpricedTokens = 0;
  let totalSavings = 0;
  let savingsKnown = false;
  let savingsUnknownFactCount = 0;
  let processed = 0;
  let cachedInput = 0;
  let uncachedInput = 0;
  let cacheWrites = 0;
  let output = 0;
  let outOfWindowFactCount = 0;
  let hasUsage = false;

  for (const fact of summary.facts) {
    const index = dayIndex.get(fact.day);
    if (index === undefined) {
      outOfWindowFactCount++;
      continue;
    }

    const tokens =
      fact.inputUncachedTokens +
      fact.cacheReadTokens +
      fact.cacheWriteTokens +
      fact.outputTokens;
    const cost = fact.costUsd;
    const savings = fact.cacheSavingsUsd;

    if (tokens > 0 || (cost ?? 0) > 0) hasUsage = true;
    processed += tokens;
    uncachedInput += fact.inputUncachedTokens;
    cachedInput += fact.cacheReadTokens;
    cacheWrites += fact.cacheWriteTokens;
    output += fact.outputTokens;
    sourceTokens.set(
      fact.costSource,
      (sourceTokens.get(fact.costSource) ?? 0) + tokens,
    );
    if (cost !== null) {
      totalCost += cost;
      totalCostKnown = true;
    } else {
      totalUnpricedFactCount++;
      totalUnpricedTokens += tokens;
      dayUnpricedCount.set(
        fact.day,
        (dayUnpricedCount.get(fact.day) ?? 0) + 1,
      );
    }
    if (savings !== null) {
      totalSavings += savings;
      savingsKnown = true;
    } else {
      savingsUnknownFactCount++;
    }

    const provider = providers.get(fact.providerId) ?? {
      cost: 0,
      costKnown: false,
      tokens: 0,
      hasUnpriced: false,
      unpricedCount: 0,
      unpricedTokens: 0,
      savings: 0,
      savingsKnown: false,
      savingsUnknown: 0,
      costByDay: days.map(() => 0),
      costUnknownByDay: days.map(() => false),
      tokensByDay: days.map(() => 0),
    };
    provider.tokens += tokens;
    if (cost !== null) {
      provider.cost += cost;
      provider.costKnown = true;
      provider.costByDay[index] += cost;
    } else {
      provider.hasUnpriced = true;
      provider.unpricedCount++;
      provider.unpricedTokens += tokens;
      provider.costUnknownByDay[index] = true;
    }
    addSavings(provider, savings);
    provider.tokensByDay[index] += tokens;
    providers.set(fact.providerId, provider);

    const modelKey = `${fact.providerId}${KEY_SEPARATOR}${fact.modelId}`;
    const model = models.get(modelKey) ?? {
      cost: 0,
      costKnown: false,
      tokens: 0,
      unpriced: false,
      savings: 0,
      savingsKnown: false,
      savingsUnknown: 0,
      providerId: fact.providerId,
      modelId: fact.modelId,
    };
    model.tokens += tokens;
    if (cost !== null) {
      model.cost += cost;
      model.costKnown = true;
    } else {
      model.unpriced = true;
    }
    addSavings(model, savings);
    models.set(modelKey, model);

    let byModel = dayModels.get(fact.day);
    if (!byModel) {
      byModel = new Map<string, DayModelAcc>();
      dayModels.set(fact.day, byModel);
    }
    const dayModel = byModel.get(modelKey) ?? {
      cost: 0,
      costKnown: false,
      tokens: 0,
      savings: 0,
      savingsKnown: false,
      savingsUnknown: 0,
    };
    dayModel.tokens += tokens;
    if (cost !== null) {
      dayModel.cost += cost;
      dayModel.costKnown = true;
    }
    addSavings(dayModel, savings);
    byModel.set(modelKey, dayModel);
  }
  return {
    providers, models, dayModels, sourceTokens, dayUnpricedCount,
    totalCost, totalCostKnown, totalUnpricedFactCount, totalUnpricedTokens,
    totalSavings, savingsKnown, savingsUnknownFactCount, processed,
    cachedInput, uncachedInput, cacheWrites, output,
    outOfWindowFactCount, hasUsage,
  };
}

export function buildDayRows(
  days: readonly string[],
  dayModels: ReadonlyMap<string, Map<string, DayModelAcc>>,
  dayUnpricedCount: ReadonlyMap<string, number>,
  models: ReadonlyMap<string, ModelAccSeed>,
  totalCostUsd: number | null,
  availableModels?: ReadonlyArray<{ id: string; name: string }>,
) {
  const dayRows = days.map((day) => {
    const byModel = dayModels.get(day);
    if (!byModel) {
      return {
        day,
        costUsd: null,
        shareOfCost: null,
        tokens: 0,
        unpricedFactCount: dayUnpricedCount.get(day) ?? 0,
        topModelId: null,
        topModelDisplayName: null,
        cacheSavingsUsd: null,
        savingsUnknownFactCount: 0,
      };
    }
    let dayCost = 0;
    let dayCostKnown = false;
    let dayTokens = 0;
    let daySavings = 0;
    let daySavingsKnown = false;
    let daySavingsUnknown = 0;
    let topCost: { key: string; cost: number } | null = null;
    let topTokens: { key: string; tokens: number } | null = null;
    for (const [key, acc] of byModel) {
      dayTokens += acc.tokens;
      daySavings += acc.savings;
      daySavingsUnknown += acc.savingsUnknown;
      if (acc.savingsKnown) daySavingsKnown = true;
      if (acc.costKnown) {
        dayCost += acc.cost;
        dayCostKnown = true;
        if (!topCost || acc.cost > topCost.cost) topCost = { key, cost: acc.cost };
      }
      if (!topTokens || acc.tokens > topTokens.tokens) {
        topTokens = { key, tokens: acc.tokens };
      }
    }
    const costUsd = dayCostKnown ? dayCost : null;
    const topKey = topCost?.key ?? topTokens?.key ?? null;
    const topAcc = topKey !== null ? models.get(topKey) ?? null : null;
    return {
      day,
      costUsd,
      shareOfCost: shareOf(costUsd, totalCostUsd),
      tokens: dayTokens,
      unpricedFactCount: dayUnpricedCount.get(day) ?? 0,
      topModelId: topAcc?.modelId ?? null,
      topModelDisplayName: topAcc
        ? resolveModelDisplayName(topAcc.modelId, availableModels)
        : null,
      cacheSavingsUsd: daySavingsKnown ? daySavings : null,
      savingsUnknownFactCount: daySavingsUnknown,
    };
  });
  return dayRows;
}
