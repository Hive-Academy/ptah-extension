import type { ModelPricing } from '@ptah-extension/shared';

export interface IPricingProvider {
  getPricing(modelId: string): Promise<ModelPricing | null>;
}
