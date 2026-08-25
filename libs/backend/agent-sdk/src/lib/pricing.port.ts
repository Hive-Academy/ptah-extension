import type { ModelPricing } from '@ptah-extension/shared';

export interface IPricingProvider {
  getPricing(modelId: string): Promise<ModelPricing | null>;
  /**
   * Resolve once the provider's catalog has been fetched and merged into the
   * shared runtime pricing map, reporting whether that actually happened.
   *
   * Exists for callers that must not observe the map mid-warmup. `warmup()` is
   * fired at DI registration and returns void, so a consumer asking for the
   * whole map at its own startup — the webview, which owns a SEPARATE module
   * instance of `pricing.utils` and can only learn the catalog by being handed
   * it — otherwise races the fetch and caches the bundled table forever.
   *
   * Never rejects: a failed fetch resolves `false` so the caller can serve what
   * it has and decide whether to retry.
   */
  ensureHydrated(): Promise<boolean>;
}
