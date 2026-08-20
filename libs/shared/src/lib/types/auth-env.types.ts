/**
 * Authentication environment variables as a value object.
 * Instead of mutating process.env, auth configuration produces this object.
 * Consumers merge it with process.env when needed: { ...process.env, ...authEnv }
 */
export interface AuthEnv {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_BASE_URL?: string;
  ANTHROPIC_AUTH_TOKEN?: string;
  ANTHROPIC_DEFAULT_SONNET_MODEL?: string;
  ANTHROPIC_DEFAULT_OPUS_MODEL?: string;
  ANTHROPIC_DEFAULT_HAIKU_MODEL?: string;
  /**
   * Per-tier display metadata. The SDK reads these alongside the `_MODEL` var
   * so a remapped tier renders with the provider model's own label instead of
   * Claude's — without them the picker shows a bare model id and the wrong
   * description.
   */
  ANTHROPIC_DEFAULT_SONNET_MODEL_NAME?: string;
  ANTHROPIC_DEFAULT_OPUS_MODEL_NAME?: string;
  ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME?: string;
  ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION?: string;
  ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION?: string;
  ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION?: string;
  /**
   * Comma-separated capability allowlist for a remapped tier.
   *
   * The SDK parses this as `value.toLowerCase().split(',').map(trim)` and asks
   * `.includes(capability)`. It is an ALLOWLIST, not a hint: once set, any
   * capability absent from the list is reported unsupported, overriding the
   * SDK's built-in per-model detection. Only set it from data a provider
   * actually declares — a guess silently disables working features.
   */
  ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES?: string;
  ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES?: string;
  ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES?: string;
}

/**
 * Capability names the SDK queries against
 * `ANTHROPIC_DEFAULT_<TIER>_MODEL_SUPPORTED_CAPABILITIES`.
 */
export type ModelCapability =
  | 'adaptive_thinking'
  | 'effort'
  | 'interleaved_thinking'
  | 'max_effort'
  | 'temperature'
  | 'thinking'
  | 'xhigh_effort';

/** Create an empty AuthEnv (all keys undefined) */
export function createEmptyAuthEnv(): AuthEnv {
  return {};
}
