/**
 * Custom Provider Types
 *
 * Shared constants and the construction-time config for user-defined
 * OpenAI-compatible provider entries (`lane: 'openai'` in
 * `provider.custom.entries`, surfaced through the registry as
 * `requiresProxy: true`).
 *
 * Unlike OpenRouter/Sakana there is no per-provider auth service interface
 * here: every custom entry authenticates the same way (Bearer key read from
 * SecretStorage under its own provider id), so the proxy reads the key
 * directly through `IAuthSecretsService` rather than through a bespoke
 * service.
 */

/**
 * Placeholder API key handed to the SDK as `ANTHROPIC_AUTH_TOKEN` while a
 * custom-provider translation proxy manages the real credential internally.
 *
 * One shared constant rather than one per entry: the value is never sent
 * upstream, it only has to be non-empty so the SDK does not fall back to
 * `ANTHROPIC_API_KEY`. Mirrors `OPENROUTER_PROXY_TOKEN_PLACEHOLDER` /
 * `SAKANA_PROXY_TOKEN_PLACEHOLDER`.
 */
export const CUSTOM_PROXY_TOKEN_PLACEHOLDER = 'custom-provider-proxy-token';

/**
 * Construction-time configuration for a {@link
 * import('./custom-openai-translation-proxy').CustomOpenAiTranslationProxy}.
 *
 * Everything the generic proxy needs that a built-in subclass would otherwise
 * hardcode as a module constant.
 */
export interface CustomOpenAiProxyConfig {
  /**
   * The provider id the API key is stored under
   * (`AuthSecretsService.getProviderKey(providerId)`). For custom entries this
   * is the user-chosen id from `provider.custom.entries`.
   */
  providerId: string;

  /**
   * Display name, used in log prefixes and in the user-facing error strings
   * the base class builds (`<name> API error (500): ...`).
   */
  name: string;

  /**
   * The provider's base URL exactly as configured. Normalized to an
   * OpenAI-style API root at construction — see `normalizeOpenAiApiRoot`.
   */
  baseUrl: string;

  /** Where the user obtains a key; quoted in the 401 message when present. */
  helpUrl?: string;

  /**
   * Models advertised on the proxy's own `/v1/models` route. Custom entries
   * usually have none (models come from `defaultTiers` or the user's typed
   * slug), so this defaults to an empty list.
   */
  staticModels?: ReadonlyArray<{ id: string }>;
}
