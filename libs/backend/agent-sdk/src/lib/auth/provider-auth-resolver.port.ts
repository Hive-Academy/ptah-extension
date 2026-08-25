import type { ProviderTierScope } from '@ptah-extension/shared';
import type { OneShotAuthOverride } from '../helpers/sdk-query-runner.service';

/**
 * Resolves a per-call provider credential + tier snapshot for a caller that
 * wants to run somewhere OTHER than the active chat provider.
 *
 * ## Why the port lives here and the implementation does not
 *
 * `auth-providers` depends on `agent-sdk`, one way. Declaring the port here
 * and the implementation there is what keeps that direction: `agent-sdk`
 * consumers (the memory curator adapter today, background lanes tomorrow)
 * inject the token and never learn that `ProviderAuthResolver` exists. Moving
 * the port into `auth-providers` would invert the dependency and close the
 * cycle the split exists to break.
 *
 * ## The return value is a SNAPSHOT, never a global mutation
 *
 * `resolve()` returns an `OneShotAuthOverride` that the caller hands to
 * `IInternalQuery.execute({ auth })` / `SdkQueryRunner.runOneShot`. Neither
 * writes `process.env` nor the injected `AuthEnv`. A caller that instead
 * routes through `ProviderModelsService.setModelTier`/`applyPersistedTiers`
 * repoints the user's live chat session mid-conversation; that is the whole
 * reason this port hands back a value instead of applying one.
 *
 * `null` means "ride the active provider" — either no provider was requested,
 * or the requested provider IS the active one. It is not an error.
 * `ProviderAuthError` (thrown) means the requested provider is configured but
 * unusable; how to treat that is the caller's decision and the two current
 * callers deliberately disagree (the memory curator falls back to the active
 * provider; a background lane stalls rather than spend foreground quota).
 *
 * `ProviderQuotaError` (thrown) means the provider that would actually be
 * dialled is still cooling down from an upstream 429; it carries
 * `retryAfterMs`. Both callers agree on this one: NOBODY falls back, because
 * the provider being gated is very often the active one — `''` resolves to it —
 * and falling back would aim background work at the exhausted quota. Matched by
 * `name`, never `instanceof`; the implementation lives in `auth-providers`.
 */
export interface IProviderAuthResolver {
  /**
   * @param providerId - Registry provider id, or `''` to ride the active
   *   provider. Never compared against a literal provider id by callers.
   * @param scope - Which persisted tier mapping to read. Defaults to
   *   `'mainAgent'`, which is what makes the existing curator call site
   *   behave identically without passing anything.
   */
  resolve(
    providerId: string,
    scope?: ProviderTierScope,
  ): Promise<OneShotAuthOverride | null>;
}
