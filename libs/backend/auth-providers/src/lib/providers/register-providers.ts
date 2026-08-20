/**
 * Provider DI Registrations â€” consolidated.
 *
 * Previously: 4 copy-pasted blocks at di/register.ts:407-487.
 * Now: one function called once from registerSdkServices.
 *
 * Order of registrations is preserved from the prior inlined state â€” all
 * provider services MUST be registered before AuthManager resolves, because
 * AuthManager's strategies (ApiKeyStrategy, OAuthProxyStrategy,
 * LocalNativeStrategy, LocalProxyStrategy) depend on these tokens.
 */

import { DependencyContainer, Lifecycle } from 'tsyringe';
import { AUTH_PROVIDERS_TOKENS } from '../di/tokens';
import { CopilotAuthService, CopilotTranslationProxy } from './copilot';
import { CodexAuthService, CodexTranslationProxy } from './codex';
import {
  OpenRouterAuthService,
  OpenRouterTranslationProxy,
  OpenRouterPricingService,
} from './openrouter';
import { SakanaAuthService, SakanaTranslationProxy } from './sakana';
import {
  OllamaModelDiscoveryService,
  LmStudioTranslationProxy,
  OllamaCloudMetadataService,
} from './local';

/**
 * Register all provider services in the agent-sdk DI container.
 *
 * See function-level header in di/register.ts; this helper is invoked from
 * registerSdkServices at the same call position the four inlined blocks
 * previously occupied.
 */
export function registerProviders(container: DependencyContainer): void {
  container.register(
    AUTH_PROVIDERS_TOKENS.SDK_COPILOT_AUTH,
    { useClass: CopilotAuthService },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    AUTH_PROVIDERS_TOKENS.SDK_COPILOT_PROXY,
    { useClass: CopilotTranslationProxy },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    AUTH_PROVIDERS_TOKENS.SDK_CODEX_AUTH,
    { useClass: CodexAuthService },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    AUTH_PROVIDERS_TOKENS.SDK_CODEX_PROXY,
    { useClass: CodexTranslationProxy },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    AUTH_PROVIDERS_TOKENS.SDK_OPENROUTER_AUTH,
    { useClass: OpenRouterAuthService },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    AUTH_PROVIDERS_TOKENS.SDK_OPENROUTER_PROXY,
    { useClass: OpenRouterTranslationProxy },
    { lifecycle: Lifecycle.Singleton },
  );
  container.register(
    AUTH_PROVIDERS_TOKENS.SDK_OPENROUTER_PRICING,
    { useClass: OpenRouterPricingService },
    { lifecycle: Lifecycle.Singleton },
  );
  container.register(
    AUTH_PROVIDERS_TOKENS.SDK_SAKANA_AUTH,
    { useClass: SakanaAuthService },
    { lifecycle: Lifecycle.Singleton },
  );
  container.register(
    AUTH_PROVIDERS_TOKENS.SDK_SAKANA_PROXY,
    { useClass: SakanaTranslationProxy },
    { lifecycle: Lifecycle.Singleton },
  );
  container.register(
    AUTH_PROVIDERS_TOKENS.SDK_OLLAMA_CLOUD_METADATA,
    { useClass: OllamaCloudMetadataService },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    AUTH_PROVIDERS_TOKENS.SDK_OLLAMA_DISCOVERY,
    { useClass: OllamaModelDiscoveryService },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    AUTH_PROVIDERS_TOKENS.SDK_LM_STUDIO_PROXY,
    { useClass: LmStudioTranslationProxy },
    { lifecycle: Lifecycle.Singleton },
  );
}
