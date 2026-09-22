import {
  Lifecycle,
  instanceCachingFactory,
  type DependencyContainer,
} from 'tsyringe';
import { createEmptyAuthEnv } from '@ptah-extension/shared';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
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
import { ProviderAuthResolver } from '../auth/provider-auth-resolver';
import { DraftVerificationService } from '../auth/draft-verification.service';
import { providerQuotaStore } from '../auth/provider-quota.store';

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
  // `registerInstance` and not `useClass`: the translation proxies reach the
  // store by import (two of the six are built per provider id at runtime, not
  // by the container), so a container-minted second instance would leave the
  // resolver reading a store nothing ever writes.
  container.registerInstance(
    AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_QUOTA_STORE,
    providerQuotaStore,
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
  container.register(
    AUTH_PROVIDERS_TOKENS.SDK_DRAFT_VERIFICATION,
    { useClass: DraftVerificationService },
    { lifecycle: Lifecycle.Singleton },
  );
  // Draft verification is required on every host, including VS Code, which
  // never registers the memory curator. Register the resolver's complete proxy
  // graph here; none of these lazy registrations starts a proxy server.
  registerCuratorAuthServices(container, logger);

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
  // Electron and CLI also call this from their curator setup. Re-registering
  // singletons would replace live resolver/proxy instances, so keep this
  // shared graph intact when the required auth phase already supplied it.
  if (
    container.isRegistered(SDK_TOKENS.SDK_PROVIDER_AUTH_RESOLVER) &&
    container.isRegistered(AUTH_PROVIDERS_TOKENS.SDK_CURATOR_PROXY_MANAGER)
  )
    return;

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

  // The final numeric constructor argument is a test-only TTL override, not
  // a DI dependency. A factory preserves its default with decorator metadata
  // enabled too (tsyringe otherwise attempts to resolve Number).
  container.register(AUTH_PROVIDERS_TOKENS.SDK_CURATOR_PROXY_MANAGER, {
    useFactory: instanceCachingFactory(
      (c) =>
        new CuratorProxyManager(
          c.resolve(TOKENS.LOGGER),
          c.resolve(AUTH_PROVIDERS_TOKENS.SDK_CURATOR_COPILOT_PROXY),
          c.resolve(AUTH_PROVIDERS_TOKENS.SDK_CURATOR_CODEX_PROXY),
          c.resolve(AUTH_PROVIDERS_TOKENS.SDK_CURATOR_OPENROUTER_PROXY),
          c.resolve(AUTH_PROVIDERS_TOKENS.SDK_CURATOR_LM_STUDIO_PROXY),
        ),
    ),
  });
  container.register(
    SDK_TOKENS.SDK_PROVIDER_AUTH_RESOLVER,
    { useClass: ProviderAuthResolver },
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
