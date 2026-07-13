import {
  Lifecycle,
  instanceCachingFactory,
  type DependencyContainer,
} from 'tsyringe';
import { createEmptyAuthEnv } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import { AUTH_PROVIDERS_TOKENS } from './tokens';
import { ProviderModelsService } from '../provider-models.service';
import { AuthManager } from '../auth/auth-manager';
import { ModelResolver } from '../auth/model-resolver';
import { ActiveProviderResolver } from '../auth/active-provider-resolver';
import { WorkspaceProviderProfileResolver } from '../auth/workspace-provider-profile-resolver';
import { ProviderProxyPool } from '../auth/provider-proxy-pool';
import {
  ApiKeyStrategy,
  OAuthProxyStrategy,
  LocalNativeStrategy,
  LocalProxyStrategy,
  CliStrategy,
} from '../auth/strategies';
import { registerProviders } from '../providers/register-providers';
import { OpenRouterPricingService } from '../providers/openrouter';
import { CopilotTranslationProxy } from '../providers/copilot';
import { CodexTranslationProxy } from '../providers/codex';
import { OpenRouterTranslationProxy } from '../providers/openrouter';
import { LmStudioTranslationProxy } from '../providers/local';
import { CuratorProxyManager } from '../auth/curator-proxy-manager';
import { CuratorAuthResolver } from '../auth/curator-auth-resolver';

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
    AUTH_PROVIDERS_TOKENS.SDK_ACTIVE_PROVIDER_RESOLVER,
    { useClass: ActiveProviderResolver },
    { lifecycle: Lifecycle.Singleton },
  );
  container.register(
    AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_PROXY_POOL,
    { useClass: ProviderProxyPool },
    { lifecycle: Lifecycle.Singleton },
  );
  container.register(
    AUTH_PROVIDERS_TOKENS.SDK_WORKSPACE_PROVIDER_PROFILE_RESOLVER,
    { useClass: WorkspaceProviderProfileResolver },
    { lifecycle: Lifecycle.Singleton },
  );
  container.register(
    AUTH_PROVIDERS_TOKENS.SDK_AUTH_MANAGER,
    { useClass: AuthManager },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(SDK_TOKENS.PRICING_PROVIDER, {
    useFactory: instanceCachingFactory((c) =>
      c.resolve<OpenRouterPricingService>(
        AUTH_PROVIDERS_TOKENS.SDK_OPENROUTER_PRICING,
      ),
    ),
  });

  logger.info('[auth-providers] Services registered');

  warmupPricing(container, logger);
}

export function registerCuratorAuthServices(
  container: DependencyContainer,
  logger: Logger,
): void {
  logger.info('[auth-providers] Registering curator auth services...');

  container.register(
    AUTH_PROVIDERS_TOKENS.SDK_CURATOR_COPILOT_PROXY,
    { useClass: CopilotTranslationProxy },
    { lifecycle: Lifecycle.Singleton },
  );
  container.register(
    AUTH_PROVIDERS_TOKENS.SDK_CURATOR_CODEX_PROXY,
    { useClass: CodexTranslationProxy },
    { lifecycle: Lifecycle.Singleton },
  );
  container.register(
    AUTH_PROVIDERS_TOKENS.SDK_CURATOR_OPENROUTER_PROXY,
    { useClass: OpenRouterTranslationProxy },
    { lifecycle: Lifecycle.Singleton },
  );
  container.register(
    AUTH_PROVIDERS_TOKENS.SDK_CURATOR_LM_STUDIO_PROXY,
    { useClass: LmStudioTranslationProxy },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(
    AUTH_PROVIDERS_TOKENS.SDK_CURATOR_PROXY_MANAGER,
    { useClass: CuratorProxyManager },
    { lifecycle: Lifecycle.Singleton },
  );
  container.register(
    SDK_TOKENS.SDK_CURATOR_AUTH_RESOLVER,
    { useClass: CuratorAuthResolver },
    { lifecycle: Lifecycle.Singleton },
  );

  logger.info('[auth-providers] Curator auth services registered');
}

function warmupPricing(container: DependencyContainer, logger: Logger): void {
  try {
    const pricing = container.resolve<OpenRouterPricingService>(
      AUTH_PROVIDERS_TOKENS.SDK_OPENROUTER_PRICING,
    );
    pricing.warmup();
  } catch (error: unknown) {
    logger.warn(
      `[auth-providers] OpenRouter pricing warmup skipped: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
