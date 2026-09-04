/**
 * The requested provider is configured and authenticated, but its upstream
 * answered 429 recently enough that it is still cooling down.
 *
 * Distinct from `ProviderAuthError` on purpose: auth is a CONFIGURATION fault
 * the user fixes, quota is a CLOCK the provider owns. Consumers back off for
 * {@link ProviderQuotaError.retryAfterMs} rather than surfacing "fix your
 * credentials", and — critically — neither one falls back to the active chat
 * provider, because that is the foreground quota background work exists to stay
 * off.
 *
 * Callers discriminate on `name === 'ProviderQuotaError'` rather than
 * `instanceof`, for exactly the reason `ProviderAuthError`'s docblock gives: the
 * two consuming libs never import this class. `skill-synthesis` mirrors the
 * string as `PROVIDER_QUOTA_ERROR_NAME` in
 * `lanes/lane-auth-resolver.port.ts`, and `agent-sdk` mirrors it in
 * `curator-llm-adapter/sdk-internal-query.curator-llm.ts`. Renaming the class
 * without renaming the `name` string breaks both checks silently, which is why
 * both are stated in the same place.
 */
export class ProviderQuotaError extends Error {
  readonly providerId: string;
  /** How long the caller should wait. Honours `retry-after` when one arrived. */
  readonly retryAfterMs: number;

  constructor(providerId: string, retryAfterMs: number, message: string) {
    super(message);
    this.name = 'ProviderQuotaError';
    this.providerId = providerId;
    this.retryAfterMs = retryAfterMs;
    Object.setPrototypeOf(this, ProviderQuotaError.prototype);
  }
}
