import { inject, injectable } from 'tsyringe';
import { OpenRouterPricingService } from '@ptah-extension/auth-providers';
import { calculateMessageCost, findModelPricing, pricesCacheTokens } from '@ptah-extension/shared';
import type { CostSource } from '@ptah-extension/shared';
import type { UsageContribution } from './usage-source.types';

@injectable()
export class UsagePricingService {
  constructor(@inject(OpenRouterPricingService) private readonly openRouter: Pick<OpenRouterPricingService, 'getPricing'>) {}

  async price(contribution: UsageContribution): Promise<{ costUsd: number | null; cacheSavingsUsd: number | null; costSource: CostSource; priceSource: 'openrouter' | 'bundled' | 'unavailable' }> {
    let pricing = null;
    let priceSource: 'openrouter' | 'bundled' | 'unavailable' = 'unavailable';
    try {
      pricing = await this.openRouter.getPricing(contribution.modelProviderId ? contribution.modelId : `${contribution.providerId}/${contribution.modelId}`);
      if (pricing) priceSource = 'openrouter';
    } catch { /* The bundled card is the offline fallback. */ }
    if (!pricing) {
      pricing = findModelPricing(contribution.modelProviderId ? contribution.modelId : `${contribution.providerId}/${contribution.modelId}`);
      if (pricing) priceSource = 'bundled';
    }
    const savings = pricing?.inputCostPerToken !== undefined && contribution.cacheReadTokens === 0 ? 0
      : pricing?.inputCostPerToken !== undefined && pricing.cacheReadCostPerToken !== undefined
        ? Math.max(0, contribution.cacheReadTokens * (pricing.inputCostPerToken - pricing.cacheReadCostPerToken)) : null;
    const cacheSavingsUsd = savings !== null && Number.isFinite(savings) ? savings : null;
    if (contribution.reportedCostUsd !== undefined && Number.isFinite(contribution.reportedCostUsd) && contribution.reportedCostUsd >= 0) {
      return { costUsd: contribution.reportedCostUsd, cacheSavingsUsd, costSource: 'provider-reported', priceSource };
    }
    const tokens = {
      input: contribution.inputUncachedTokens, output: contribution.outputTokens,
      cacheHit: contribution.cacheReadTokens, cacheCreation: contribution.cacheWriteTokens,
    };
    if (!pricing || !pricesCacheTokens(pricing, tokens)) {
      return { costUsd: null, cacheSavingsUsd: null, costSource: 'unpriced', priceSource: 'unavailable' };
    }
    const costUsd = calculateMessageCost(contribution.modelId, tokens, pricing);
    return { costUsd, cacheSavingsUsd: costUsd === null ? null : cacheSavingsUsd, costSource: costUsd === null ? 'unpriced' : 'model-priced', priceSource };
  }
}
