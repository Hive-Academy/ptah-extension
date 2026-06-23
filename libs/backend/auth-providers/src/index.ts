export { AUTH_PROVIDERS_TOKENS } from './lib/di/tokens';
export type { AuthProvidersDIToken } from './lib/di/tokens';
export {
  registerAuthProvidersServices,
  registerCuratorAuthServices,
} from './lib/di/register';
export { CuratorAuthResolver } from './lib/auth/curator-auth-resolver';
export {
  CuratorProxyManager,
  type CuratorProxyHandle,
} from './lib/auth/curator-proxy-manager';
export { CuratorAuthError } from './lib/auth/curator-auth.error';
export {
  AuthManager,
  type AuthResult,
  type AuthConfig,
} from './lib/auth/auth-manager';
export {
  normalizeAuthMethod,
  type LegacyAuthMethod,
} from './lib/auth/auth-method.utils';
export { ModelResolver } from './lib/auth/model-resolver';
export {
  ActiveProviderResolver,
  type ActiveAuth,
} from './lib/auth/active-provider-resolver';
export type {
  IAuthStrategy,
  AuthConfigureResult,
  AuthConfigureContext,
} from './lib/auth/auth-strategy.types';
export {
  resolveEffectiveAuthRoute,
  type EffectiveRouteProvider,
  type EffectiveRouteConfig,
  type EffectiveRouteResult,
} from './lib/auth/effective-route';
export {
  ApiKeyStrategy,
  OAuthProxyStrategy,
  LocalNativeStrategy,
  LocalProxyStrategy,
  CliStrategy,
} from './lib/auth/strategies';
export {
  ProviderModelsService,
  type DynamicModelFetcher,
} from './lib/provider-models.service';
export {
  OpenAIResponseTranslator,
  TranslationProxyBase,
  translateAnthropicToOpenAI,
} from './lib/translation';
export type {
  ITranslationProxy,
  TranslationProxyConfig,
} from './lib/translation';
export {
  CopilotAuthService,
  VscodeCopilotAuthService,
  CopilotTranslationProxy,
  COPILOT_PROVIDER_ENTRY,
  COPILOT_DEFAULT_TIERS,
  COPILOT_PROXY_TOKEN_PLACEHOLDER,
  readCopilotToken,
  getCopilotHostsPath,
  getCopilotAppsPath,
  writeCopilotToken,
} from './lib/providers/copilot';
export type {
  ICopilotAuthService,
  ICopilotTranslationProxy,
  CopilotAuthState,
  CopilotHostsFile,
} from './lib/providers/copilot';
export {
  CodexAuthService,
  CodexTranslationProxy,
  CODEX_PROVIDER_ENTRY,
  CODEX_DEFAULT_TIERS,
  CODEX_PROXY_TOKEN_PLACEHOLDER,
} from './lib/providers/codex';
export type { ICodexAuthService, CodexAuthFile } from './lib/providers/codex';
export {
  OpenRouterAuthService,
  OpenRouterTranslationProxy,
  OpenRouterPricingService,
  OPENROUTER_PROXY_TOKEN_PLACEHOLDER,
} from './lib/providers/openrouter';
export type {
  IOpenRouterAuthService,
  OpenRouterModel,
} from './lib/providers/openrouter';
export {
  LmStudioTranslationProxy,
  OllamaModelDiscoveryService,
  OLLAMA_PROVIDER_ENTRY,
  OLLAMA_CLOUD_PROVIDER_ENTRY,
  LM_STUDIO_PROVIDER_ENTRY,
  LOCAL_PROXY_TOKEN_PLACEHOLDER,
  OLLAMA_AUTH_TOKEN_PLACEHOLDER,
  isLocalProviderId,
  isOllamaProviderId,
} from './lib/providers/local';
