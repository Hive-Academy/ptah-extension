/**
 * Model Fetcher Interface - TASK_AUTH_REFACTOR Phase 3
 *
 * Unified interface for model fetching. Strategies that provide dynamic
 * model lists implement IModelFetcherProvider and register their fetcher
 * during configure().
 *
 * This reuses the existing DynamicModelFetcher type from ProviderModelsService
 * rather than introducing a new abstraction.
 */

import type { ProviderModelInfo } from '@ptah-extension/shared';

/**
 * A function that fetches models for a provider.
 * Compatible with DynamicModelFetcher from provider-models.service.ts.
 */
export type ModelFetcherFn = () => Promise<ProviderModelInfo[]>;

/**
 * Interface for strategies that register dynamic model fetchers
 * during configure(). Not all strategies need this — API-key providers
 * use the existing ProviderModelsService model fetching paths.
 */
export interface IModelFetcherProvider {
  /**
   * Get the model fetcher function for this provider.
   * Returns null if this strategy doesn't provide dynamic models
   * (e.g., CliStrategy, ApiKeyStrategy for direct Anthropic).
   */
  getModelFetcher(): ModelFetcherFn | null;
}
