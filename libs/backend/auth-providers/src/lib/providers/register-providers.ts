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

import {
  DependencyContainer,
  Lifecycle,
  instanceCachingFactory,
} from 'tsyringe';
import {
  Logger,
  TOKENS,
  type IAuthSecretsService,
} from '@ptah-extension/vscode-core';
import type { OpenCodeProviderId } from '@ptah-extension/shared';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { CodexAccountUsageClient } from '@ptah-extension/codex-runtime';
import { CodexHomeAuthService } from './codex/codex-home-auth.service';
import type { ApiKeyProxyBinding } from '../auth/auth-strategy.types';
import {
  OpenCodeAuthService,
  OpenCodeTranslationProxy,
  OPENCODE_PROXY_TOKEN_PLACEHOLDER,
} from './opencode';
import { OPENROUTER_PROXY_TOKEN_PLACEHOLDER } from './openrouter';
import { SAKANA_PROXY_TOKEN_PLACEHOLDER } from './sakana';
import { AUTH_PROVIDERS_TOKENS } from '../di/tokens';
import { CopilotAuthService, CopilotTranslationProxy } from './copilot';
import {
  CodexAccountUsageService,
  CodexAuthService,
  CodexHomeResolver,
  CodexTranslationProxy,
} from './codex';
import {
  KimiCodeAuthService,
  KimiCodeCredentialStore,
  KimiCodeHomeResolver,
  KimiCodeLoginService,
  KimiCodeTranslationProxy,
} from './kimi-code';
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
  container.register(AUTH_PROVIDERS_TOKENS.SDK_CODEX_HOME_AUTH, {
    useFactory: instanceCachingFactory((c) =>
      CodexHomeAuthService.forHost(
        c.resolve(TOKENS.LOGGER),
        c.resolve(PLATFORM_TOKENS.WORKSPACE_PROVIDER),
      ),
    ),
  });
  if (
    !container.isRegistered(AUTH_PROVIDERS_TOKENS.SDK_CODEX_USAGE_CLIENT, true)
  ) {
    container.register<CodexAccountUsageClient | null>(
      AUTH_PROVIDERS_TOKENS.SDK_CODEX_USAGE_CLIENT,
      { useFactory: () => null },
    );
  }
  // A factory, not `useClass`: `CodexHomeResolver`'s constructor parameters are
  // test seams that nothing registers, so container construction only ever
  // produced the no-argument instance this factory builds explicitly.
  // `instanceCachingFactory` and not `{ lifecycle: Lifecycle.Singleton }`
  // because tsyringe rejects a lifecycle on a factory provider — the same
  // reasoning recorded in `agent-generation/src/lib/di/register.ts`.
  container.register(AUTH_PROVIDERS_TOKENS.SDK_CODEX_HOME_RESOLVER, {
    useFactory: instanceCachingFactory(() => new CodexHomeResolver()),
  });
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
    AUTH_PROVIDERS_TOKENS.SDK_CODEX_ACCOUNT_USAGE,
    { useClass: CodexAccountUsageService },
    { lifecycle: Lifecycle.Singleton },
  );

  // Factories, not `useClass`: the Kimi Code services take a deps object
  // whose clock, home and refresher are test seams (see `CodexHomeResolver`
  // above for the same reasoning). Every DI dependency is resolved here.
  container.register(AUTH_PROVIDERS_TOKENS.SDK_KIMI_CODE_AUTH, {
    useFactory: instanceCachingFactory(
      (c) =>
        new KimiCodeAuthService({
          logger: c.resolve<Logger>(TOKENS.LOGGER),
          authSecrets: c.resolve<IAuthSecretsService>(
            TOKENS.AUTH_SECRETS_SERVICE,
          ),
          events: c.resolve(SDK_TOKENS.SDK_ADAPTER_EVENTS),
        }),
    ),
  });

  container.register(
    AUTH_PROVIDERS_TOKENS.SDK_KIMI_CODE_PROXY,
    { useClass: KimiCodeTranslationProxy },
    { lifecycle: Lifecycle.Singleton },
  );

  container.register(AUTH_PROVIDERS_TOKENS.SDK_KIMI_CODE_LOGIN, {
    useFactory: instanceCachingFactory((c) => {
      const logger = c.resolve<Logger>(TOKENS.LOGGER);
      const home = new KimiCodeHomeResolver();
      return new KimiCodeLoginService({
        logger,
        spawner: c.resolve(SDK_TOKENS.SDK_PROCESS_SPAWNER),
        userInteraction: c.resolve(PLATFORM_TOKENS.USER_INTERACTION),
        kimiAuth: c.resolve(AUTH_PROVIDERS_TOKENS.SDK_KIMI_CODE_AUTH),
        store: new KimiCodeCredentialStore(home, logger),
        home,
      });
    }),
  });

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
  const subscriptions: ReadonlyArray<{
    providerId: OpenCodeProviderId;
    authToken: symbol;
    proxyToken: symbol;
  }> = [
    {
      providerId: 'opencode-zen',
      authToken: AUTH_PROVIDERS_TOKENS.SDK_OPENCODE_ZEN_AUTH,
      proxyToken: AUTH_PROVIDERS_TOKENS.SDK_OPENCODE_ZEN_PROXY,
    },
    {
      providerId: 'opencode-go',
      authToken: AUTH_PROVIDERS_TOKENS.SDK_OPENCODE_GO_AUTH,
      proxyToken: AUTH_PROVIDERS_TOKENS.SDK_OPENCODE_GO_PROXY,
    },
  ];
  for (const { providerId, authToken, proxyToken } of subscriptions) {
    container.register(authToken, {
      useFactory: instanceCachingFactory(
        (c) =>
          new OpenCodeAuthService(
            providerId,
            c.resolve<IAuthSecretsService>(TOKENS.AUTH_SECRETS_SERVICE),
          ),
      ),
    });
    container.register(proxyToken, {
      useFactory: instanceCachingFactory(
        (c) =>
          new OpenCodeTranslationProxy(
            c.resolve<Logger>(TOKENS.LOGGER),
            providerId,
            c.resolve<OpenCodeAuthService>(authToken),
          ),
      ),
    });
  }
  container.register<readonly ApiKeyProxyBinding[]>(
    AUTH_PROVIDERS_TOKENS.SDK_API_KEY_PROXY_BINDINGS,
    {
      useFactory: instanceCachingFactory<readonly ApiKeyProxyBinding[]>((c) => [
        {
          providerId: 'openrouter',
          proxy: c.resolve(AUTH_PROVIDERS_TOKENS.SDK_OPENROUTER_PROXY),
          placeholder: OPENROUTER_PROXY_TOKEN_PLACEHOLDER,
        },
        {
          providerId: 'sakana',
          proxy: c.resolve(AUTH_PROVIDERS_TOKENS.SDK_SAKANA_PROXY),
          placeholder: SAKANA_PROXY_TOKEN_PLACEHOLDER,
        },
        ...subscriptions.map(({ providerId, proxyToken }) => ({
          providerId,
          proxy: c.resolve<OpenCodeTranslationProxy>(proxyToken),
          placeholder: OPENCODE_PROXY_TOKEN_PLACEHOLDER,
        })),
      ]),
    },
  );
}
