export { AUTH_PROVIDERS_TOKENS } from './lib/di/tokens';
export type { AuthProvidersDIToken } from './lib/di/tokens';
export { registerAuthProvidersServices } from './lib/di/register';

// Auth subsystem
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

// Provider models
export {
  ProviderModelsService,
  type DynamicModelFetcher,
} from './lib/provider-models.service';

// Translation infrastructure
export {
  OpenAIResponseTranslator,
  TranslationProxyBase,
  translateAnthropicToOpenAI,
} from './lib/translation';
export type {
  ITranslationProxy,
  TranslationProxyConfig,
} from './lib/translation';

// Copilot provider
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

// Codex provider
export {
  CodexAuthService,
  CodexTranslationProxy,
  CODEX_PROVIDER_ENTRY,
  CODEX_DEFAULT_TIERS,
  CODEX_PROXY_TOKEN_PLACEHOLDER,
} from './lib/providers/codex';
export type { ICodexAuthService, CodexAuthFile } from './lib/providers/codex';

// OpenRouter provider
export {
  OpenRouterAuthService,
  OpenRouterTranslationProxy,
  OPENROUTER_PROXY_TOKEN_PLACEHOLDER,
} from './lib/providers/openrouter';
export type { IOpenRouterAuthService } from './lib/providers/openrouter';

// Local providers
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
