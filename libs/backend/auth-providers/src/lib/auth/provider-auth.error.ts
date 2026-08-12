/**
 * The requested provider is configured but cannot be used right now — no API
 * key, an unauthenticated OAuth provider, or a proxy that would not start.
 *
 * Callers discriminate on `name === 'ProviderAuthError'` rather than
 * `instanceof`, because the two consuming libs never import this class: the
 * port they inject lives in `agent-sdk` and this implementation lives here.
 * Renaming the class without renaming the `name` string therefore breaks the
 * check silently, which is why both are stated in the same place.
 */
export class ProviderAuthError extends Error {
  readonly providerId: string;

  constructor(providerId: string, message: string) {
    super(message);
    this.name = 'ProviderAuthError';
    this.providerId = providerId;
    Object.setPrototypeOf(this, ProviderAuthError.prototype);
  }
}
