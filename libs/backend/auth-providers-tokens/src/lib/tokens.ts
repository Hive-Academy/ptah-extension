export const AUTH_PROVIDERS_TOKENS = {
  SDK_AUTH_MANAGER: Symbol.for('SdkAuthManager'),
  SDK_AUTH_ENV: Symbol.for('SdkAuthEnv'),
  SDK_PROVIDER_MODELS: Symbol.for('SdkProviderModels'),
  SDK_MODEL_RESOLVER: Symbol.for('SdkModelResolver'),
  SDK_ACTIVE_PROVIDER_RESOLVER: Symbol.for('SdkActiveProviderResolver'),
  SDK_WORKSPACE_PROVIDER_PROFILE_RESOLVER: Symbol.for(
    'SdkWorkspaceProviderProfileResolver',
  ),
  SDK_PROVIDER_PROXY_POOL: Symbol.for('SdkProviderProxyPool'),

  SDK_API_KEY_STRATEGY: Symbol.for('SdkApiKeyStrategy'),
  SDK_OAUTH_PROXY_STRATEGY: Symbol.for('SdkOAuthProxyStrategy'),
  SDK_LOCAL_NATIVE_STRATEGY: Symbol.for('SdkLocalNativeStrategy'),
  SDK_LOCAL_PROXY_STRATEGY: Symbol.for('SdkLocalProxyStrategy'),
  SDK_CLI_STRATEGY: Symbol.for('SdkCliStrategy'),

  SDK_COPILOT_AUTH: Symbol.for('SdkCopilotAuth'),
  SDK_COPILOT_PROXY: Symbol.for('SdkCopilotProxy'),
  SDK_CODEX_AUTH: Symbol.for('SdkCodexAuth'),
  SDK_CODEX_PROXY: Symbol.for('SdkCodexProxy'),
  SDK_OPENROUTER_AUTH: Symbol.for('SdkOpenRouterAuth'),
  SDK_OPENROUTER_PROXY: Symbol.for('SdkOpenRouterProxy'),
  SDK_OPENROUTER_PRICING: Symbol.for('SdkOpenRouterPricing'),
  SDK_SAKANA_AUTH: Symbol.for('SdkSakanaAuth'),
  SDK_SAKANA_PROXY: Symbol.for('SdkSakanaProxy'),
  SDK_OLLAMA_DISCOVERY: Symbol.for('SdkOllamaDiscovery'),
  SDK_LM_STUDIO_PROXY: Symbol.for('SdkLmStudioProxy'),
  SDK_OLLAMA_CLOUD_METADATA: Symbol.for('SdkOllamaCloudMetadata'),

  SDK_CURATOR_PROXY_MANAGER: Symbol.for('SdkCuratorProxyManager'),
  SDK_CURATOR_COPILOT_PROXY: Symbol.for('SdkCuratorCopilotProxy'),
  SDK_CURATOR_CODEX_PROXY: Symbol.for('SdkCuratorCodexProxy'),
  SDK_CURATOR_OPENROUTER_PROXY: Symbol.for('SdkCuratorOpenRouterProxy'),
  SDK_CURATOR_LM_STUDIO_PROXY: Symbol.for('SdkCuratorLmStudioProxy'),
} as const;

export type AuthProvidersDIToken = keyof typeof AUTH_PROVIDERS_TOKENS;
