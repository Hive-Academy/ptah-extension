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
  container.registerInstance(
    AUTH_PROVIDERS_TOKENS.SDK_AUTH_ENV,
    createEmptyAuthEnv(),
  );
  container.register(
    AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_MODELS,
    { useClass: ProviderModelsService },
    { lifecycle: Lifecycle.Singleton },
  );
  registerProviders(container);
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
  container.register(
    AUTH_PROVIDERS_TOKENS.SDK_MODEL_RESOLVER,
    { useClass: ModelResolver },
    { lifecycle: Lifecycle.Singleton },
  );
  container.register(
    AUTH_PROVIDERS_TOKENS.SDK_AUTH_MANAGER,
    { useClass: AuthManager },
    { lifecycle: Lifecycle.Singleton },
  );

  logger.info('[auth-providers] Services registered');
}
