import 'reflect-metadata';
import { OpenRouterPricingService } from '@ptah-extension/auth-providers';
import { UsagePricingService } from './usage-pricing.service';
import type { UsageContribution } from './usage-source.types';

const row: UsageContribution = {
  key: 'one', timestampMs: Date.now(), providerId: 'anthropic', modelId: 'missing-model-xyz',
  inputUncachedTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0,
  outputTokens: 2, sourceId: 'test',
};

describe('UsagePricingService', () => {
  const router = { getPricing: jest.fn<Promise<null | { inputCostPerToken: number; outputCostPerToken: number; cacheReadCostPerToken?: number }>, [string]>() };
  const service = new UsagePricingService(router);

  beforeEach(() => router.getPricing.mockReset());

  it('uses provider reported spend before any model estimate', async () => {
    router.getPricing.mockResolvedValue({ inputCostPerToken: 0.01, outputCostPerToken: 0.02, cacheReadCostPerToken: 0.002 });
    expect(await service.price({ ...row, reportedCostUsd: 0.42 })).toMatchObject({
      costUsd: 0.42, cacheSavingsUsd: 0, costSource: 'provider-reported',
    });
  });

  it('marks unknown models unpriced', async () => {
    router.getPricing.mockResolvedValue(null);
    expect(await service.price(row)).toMatchObject({ costUsd: null, cacheSavingsUsd: null, costSource: 'unpriced' });
  });

  it('computes cache savings for priced reported usage', async () => {
    router.getPricing.mockResolvedValue({ inputCostPerToken: 0.01, outputCostPerToken: 0.02, cacheReadCostPerToken: 0.002 });
    expect(await service.price({ ...row, cacheReadTokens: 10, reportedCostUsd: 0.5 })).toMatchObject({ costUsd: 0.5, cacheSavingsUsd: 0.08 });
  });

  it('uses provider-qualified OpenRouter pricing', async () => {
    router.getPricing.mockResolvedValue({ inputCostPerToken: 0.01, outputCostPerToken: 0.02 });
    expect(await service.price(row)).toMatchObject({ costUsd: 0.14, costSource: 'model-priced', priceSource: 'openrouter' });
    expect(router.getPricing).toHaveBeenCalledWith('anthropic/missing-model-xyz');
  });
});
