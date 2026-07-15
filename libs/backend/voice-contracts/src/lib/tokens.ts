/**
 * DI tokens for the voice-provider ports. UPPER_SNAKE keys, `Symbol.for(...)`
 * values with Ptah-prefixed unique descriptions (GATEWAY_TOKENS / memory-
 * contracts convention). The concrete registry + selector + vault are wired in
 * `voice-providers` and `apps/ptah-electron` under these tokens.
 */
export const VOICE_CONTRACT_TOKENS = {
  VOICE_PROVIDER_REGISTRY: Symbol.for('PtahVoiceProviderRegistry'),
  VOICE_PROVIDER_SELECTOR: Symbol.for('PtahVoiceProviderSelector'),
  VOICE_TOKEN_VAULT: Symbol.for('PtahVoiceTokenVault'),
} as const;
