/**
 * Provider DI Registrations — consolidated.
 *
 * Previously: 4 copy-pasted blocks at di/register.ts:407-487.
 * Now: one function called once from registerSdkServices.
 *
 * Order of registrations is preserved from the prior inlined state — all
 * provider services MUST be registered before AuthManager resolves, because
 * AuthManager's strategies (ApiKeyStrategy, OAuthProxyStrategy,
 * LocalNativeStrategy, LocalProxyStrategy) depend on these tokens.
 */

import { DependencyContainer, Lifecycle } from 'tsyringe';
import { SDK_TOKENS } from '../di/tokens';
import { CopilotAuthService, CopilotTranslationProxy } from './copilot';
import { CodexAuthService, CodexTranslationProxy } from './codex';
import {
  OpenRouterAuthService,
  OpenRouterTranslationProxy,
} from './openrouter';
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
  // ============================================================
  // Copilot Provider Services
  // Auth service and translation proxy for GitHub Copilot integration
  // Must be registered before AuthManager resolves (which depends on these)
  // ============================================================

  container.register(
    SDK_TOKENS.SDK_COPILOT_AUTH,
    { useClass: CopilotAuthService },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_COPILOT_PROXY,
    { useClass: CopilotTranslationProxy },
    { lifecycle: Lifecycle.Singleton },
  );

  // ============================================================
  // Codex Provider Services
  // Auth service and translation proxy for OpenAI Codex integration
  // Must be registered before AuthManager resolves (which depends on these)
  // ============================================================

  container.register(
    SDK_TOKENS.SDK_CODEX_AUTH,
    { useClass: CodexAuthService },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_CODEX_PROXY,
    { useClass: CodexTranslationProxy },
    { lifecycle: Lifecycle.Singleton },
  );

  // ============================================================
  // OpenRouter Provider Services
  // Auth service (reads API key from SecretStorage) and translation proxy
  // (Anthropic <-> OpenAI Chat Completions). Must be registered before
  // AuthManager resolves (which depends on these via ApiKeyStrategy).
  // ============================================================

  container.register(
    SDK_TOKENS.SDK_OPENROUTER_AUTH,
    { useClass: OpenRouterAuthService },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_OPENROUTER_PROXY,
    { useClass: OpenRouterTranslationProxy },
    { lifecycle: Lifecycle.Singleton },
  );

  // ============================================================
  // Local Model Provider Services
  // Ollama: model discovery service (Anthropic-native, no proxy)
  // LM Studio: translation proxy (OpenAI-compat, still needs proxy)
  // Must be registered before AuthManager resolves (which depends on these)
  // ============================================================

  // Ollama Cloud metadata service — must be registered BEFORE
  // OllamaModelDiscoveryService (which now injects it via SDK_OLLAMA_CLOUD_METADATA)
  container.register(
    SDK_TOKENS.SDK_OLLAMA_CLOUD_METADATA,
    { useClass: OllamaCloudMetadataService },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_OLLAMA_DISCOVERY,
    { useClass: OllamaModelDiscoveryService },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    SDK_TOKENS.SDK_LM_STUDIO_PROXY,
    { useClass: LmStudioTranslationProxy },
    { lifecycle: Lifecycle.Singleton },
  );
}
