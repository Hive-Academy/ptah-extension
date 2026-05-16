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
}

/** Create an empty AuthEnv (all keys undefined) */
export function createEmptyAuthEnv(): AuthEnv {
  return {};
}
