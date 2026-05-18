import { Lifecycle, type DependencyContainer } from 'tsyringe';
import { createEmptyAuthEnv } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import { AUTH_PROVIDERS_TOKENS } from './tokens';
import { ProviderModelsService } from '../provider-models.service';
import { AuthManager } from '../auth/auth-manager';
import { ModelResolver } from '../auth/model-resolver';
import {
  ApiKeyStrategy,
  OAuthProxyStrategy,
  LocalNativeStrategy,
  LocalProxyStrategy,
  CliStrategy,
} from '../auth/strategies';
import { registerProviders } from '../providers/register-providers';

export function registerAuthProvidersServices(
  container: DependencyContainer,
  logger: Logger,
): void {
  logger.info('[auth-providers] Registering auth + provider services...');

  // Shared mutable AuthEnv singleton — must be registered before AuthManager,
  // ProviderModelsService, ModelResolver, and any strategy that injects it.
  container.registerInstance(
    AUTH_PROVIDERS_TOKENS.SDK_AUTH_ENV,
    createEmptyAuthEnv(),
  );

  // Provider models service — depends on Logger, ConfigManager, AuthEnv.
  container.register(
    AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_MODELS,
    { useClass: ProviderModelsService },
    { lifecycle: Lifecycle.Singleton },
  );

  // Provider services (Copilot, Codex, OpenRouter, Ollama, LM Studio).
  // Must register before AuthManager (strategies depend on these tokens).
  registerProviders(container);

  // Auth strategies — must register before AuthManager resolves.
  container.register(
    AUTH_PROVIDERS_TOKENS.SDK_API_KEY_STRATEGY,
    { useClass: ApiKeyStrategy },
    { lifecycle: Lifecycle.Singleton },
  );
  container.register(
    AUTH_PROVIDERS_TOKENS.SDK_OAUTH_PROXY_STRATEGY,
    { useClass: OAuthProxyStrategy },
    { lifecycle: Lifecycle.Singleton },
  );
  container.register(
    AUTH_PROVIDERS_TOKENS.SDK_LOCAL_NATIVE_STRATEGY,
    { useClass: LocalNativeStrategy },
    { lifecycle: Lifecycle.Singleton },
  );
  container.register(
    AUTH_PROVIDERS_TOKENS.SDK_LOCAL_PROXY_STRATEGY,
    { useClass: LocalProxyStrategy },
    { lifecycle: Lifecycle.Singleton },
  );
  container.register(
    AUTH_PROVIDERS_TOKENS.SDK_CLI_STRATEGY,
    { useClass: CliStrategy },
    { lifecycle: Lifecycle.Singleton },
  );

  // ModelResolver — single source of truth for tier→model resolution.
  container.register(
    AUTH_PROVIDERS_TOKENS.SDK_MODEL_RESOLVER,
    { useClass: ModelResolver },
    { lifecycle: Lifecycle.Singleton },
  );

  // AuthManager — thin orchestrator depending on every strategy + ProviderModels.
  container.register(
    AUTH_PROVIDERS_TOKENS.SDK_AUTH_MANAGER,
    { useClass: AuthManager },
    { lifecycle: Lifecycle.Singleton },
  );

  logger.info('[auth-providers] Services registered');
}
