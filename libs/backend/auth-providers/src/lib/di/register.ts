import { lstat, readdir, readFile, stat } from 'node:fs/promises';
import {
  Lifecycle,
  instanceCachingFactory,
  type DependencyContainer,
} from 'tsyringe';
import { PERSISTENCE_TOKENS } from '@ptah-extension/persistence-sqlite';
import { createEmptyAuthEnv } from '@ptah-extension/shared';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { ProviderAccountStore } from '../accounts/provider-account.store';
import { ProviderAccountService } from '../accounts/provider-account.service';
import { ProviderAccountActionsService } from '../accounts/provider-account-actions.service';
import { accountActionResult, ClaudeAccountCommand } from '../accounts/claude-account-command';
import { ClaudeRouteCertifier, type ClaudeRouteCertifierFs } from '../accounts/claude-route-certifier';
import { ClaudeLoginConsole } from '../accounts/claude-login-console';
import { ClaudeAmbientLoginStatusReader, NODE_AMBIENT_STATUS_HOST } from '../accounts/claude-ambient-login-status';
import type { ClaudeAccountSelectionReader, ProviderAccountAdmissionPort } from '@ptah-extension/auth-providers-tokens';
import { AUTH_PROVIDERS_TOKENS } from './tokens';
import { ProviderModelsService } from '../provider-models.service';
import { AuthManager } from '../auth/auth-manager';
import { ModelResolver } from '../auth/model-resolver';
import { ActiveProviderResolver } from '../auth/active-provider-resolver';
import { WorkspaceProviderProfileResolver } from '../auth/workspace-provider-profile-resolver';
import { WorkspaceLlmResolver } from '../auth/workspace-llm-resolver';
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
import { KimiCodeTranslationProxy } from '../providers/kimi-code';
import { OpenRouterTranslationProxy } from '../providers/openrouter';
import { LmStudioTranslationProxy } from '../providers/local';
import { CuratorProxyManager } from '../auth/curator-proxy-manager';
import { ProviderAuthResolver } from '../auth/provider-auth-resolver';
import { DraftVerificationService } from '../auth/draft-verification.service';
import { providerQuotaStore } from '../auth/provider-quota.store';
import { ProviderOwnerResolver } from '../quota/provider-owner.resolver';
import { PlanLimitLedgerService } from '../quota/plan-limit-ledger.service';
import { PlanCredentialSource } from '../quota/plan-credential.source';
import { PlanUsageService } from '../quota/plan-usage.service';

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
  // Provider + model snapshot for one workspace path, for every one-shot
  // workflow (harness, wizard, cron, commit message, curator).
  container.register(
    SDK_TOKENS.SDK_WORKSPACE_LLM_RESOLVER,
    { useClass: WorkspaceLlmResolver },
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
  registerPlanLimitServices(container);
  registerProviderAccountServices(container);

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

/** Read-only fs of the certifier (D14 note 1): UTF-8 reads, typed dir entries, `stat` follows links. */
const certifierFs: ClaudeRouteCertifierFs = {
  readFile: (path) => readFile(path, 'utf8'),
  lstat: (path) => lstat(path),
  readdir: (path) => readdir(path, { withFileTypes: true }),
  stat: (path) => stat(path),
};

function registerProviderAccountServices(container: DependencyContainer): void {
  container.register(ClaudeAccountCommand, {
    useFactory: instanceCachingFactory((c) => new ClaudeAccountCommand(
      c.resolve(SDK_TOKENS.SDK_CLI_DETECTOR), c.resolve(SDK_TOKENS.SDK_PROCESS_SPAWNER),
    )),
  });
  // Not decorated: the host (process env and clock) is a runtime value, not a token.
  container.register(ClaudeAmbientLoginStatusReader, {
    useFactory: instanceCachingFactory((c) => new ClaudeAmbientLoginStatusReader(
      c.resolve(ClaudeAccountCommand), NODE_AMBIENT_STATUS_HOST, c.resolve<Logger>(TOKENS.LOGGER),
    )),
  });
  // Neither class is decorated: the platform is a runtime value, not a token.
  container.register(ClaudeRouteCertifier, {
    useFactory: instanceCachingFactory((c) => new ClaudeRouteCertifier(
      c.resolve(ClaudeAccountCommand), process.platform, certifierFs,
      c.isRegistered(TOKENS.LOGGER, true) ? c.resolve<Logger>(TOKENS.LOGGER) : null,
    )),
  });
  container.register(ClaudeLoginConsole, {
    useFactory: instanceCachingFactory((c) => new ClaudeLoginConsole(
      c.resolve(SDK_TOKENS.SDK_PROCESS_SPAWNER), process.platform,
    )),
  });
  container.register(ProviderAccountStore, {
    useClass: ProviderAccountStore,
  }, { lifecycle: Lifecycle.Singleton });
  container.register(ProviderAccountService, {
    useClass: ProviderAccountService,
  }, { lifecycle: Lifecycle.Singleton });
  // Hosts without account storage refuse every admission with a typed code
  // and summary, so optional consumers construct and fail closed.
  function storagelessProviderAccountAdmission(): ProviderAccountAdmissionPort {
    const refusal = (code: 'unavailable-storage' | 'conflict') => ({
      code,
      summary: accountActionResult(code).summary,
    });
    return {
      admitClaudeRoute: async () => refusal('unavailable-storage'),
      releaseReservation: async () => refusal('conflict'),
      retainUnresolvedReservation: async () => refusal('conflict'),
    };
  }
  // Registration stays unconditional: Electron registers this module before
  // SQLITE_CONNECTION. VS Code never registers the connection at all, and the
  // service constructor requires it, so resolve the service only when the
  // connection exists. Without the connection the factories hand out the
  // fail-closed port above (and the default-route reader below) instead of
  // throwing inside the factory.
  container.register(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_ACCOUNT_ADMISSION, {
    useFactory: instanceCachingFactory<ProviderAccountAdmissionPort>((c) =>
      c.isRegistered(PERSISTENCE_TOKENS.SQLITE_CONNECTION, true)
        ? c.resolve(ProviderAccountService)
        : storagelessProviderAccountAdmission(),
    ),
  });
  // Without storage no named account can be stored, so the stored selection
  // is the default route.
  container.register(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_ACCOUNT_SELECTION_READER, {
    useFactory: instanceCachingFactory<ClaudeAccountSelectionReader>((c) =>
      c.isRegistered(PERSISTENCE_TOKENS.SQLITE_CONNECTION, true)
        ? c.resolve(ProviderAccountService)
        : { readStoredSelection: async () => ({ profileId: null }) },
    ),
  });
  container.register(ProviderAccountActionsService, {
    useClass: ProviderAccountActionsService,
  }, { lifecycle: Lifecycle.Singleton });
  container.register(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_ACCOUNT_ACTIONS, {
    useFactory: instanceCachingFactory((c) => c.resolve(ProviderAccountActionsService)),
  });
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
    AUTH_PROVIDERS_TOKENS.SDK_CURATOR_KIMI_CODE_PROXY,
    { useClass: KimiCodeTranslationProxy },
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
          c.resolve(AUTH_PROVIDERS_TOKENS.SDK_CURATOR_KIMI_CODE_PROXY),
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

/**
 * Plan-limit services (TASK_2026_596). All four resolve lazily: on every host
 * `registerSdkServices` runs AFTER this function, and it registers the
 * agent-sdk tokens they depend on (`SDK_SESSION_QUOTA_PROBE`,
 * `SDK_SESSION_PLAN_LIMIT_REGISTRY`). Nothing here resolves anything.
 */
function registerPlanLimitServices(container: DependencyContainer): void {
  container.register(
    AUTH_PROVIDERS_TOKENS.PROVIDER_OWNER_RESOLVER,
    { useClass: ProviderOwnerResolver },
    { lifecycle: Lifecycle.Singleton },
  );
  container.register(
    AUTH_PROVIDERS_TOKENS.PLAN_CREDENTIAL_SOURCE,
    { useClass: PlanCredentialSource },
    { lifecycle: Lifecycle.Singleton },
  );
  // A factory for the same reason as the curator proxy manager: the trailing
  // clock parameter is a test seam, not a DI dependency.
  container.register(AUTH_PROVIDERS_TOKENS.PLAN_LIMIT_LEDGER, {
    useFactory: instanceCachingFactory(
      (c) =>
        new PlanLimitLedgerService(
          c.resolve(TOKENS.LOGGER),
          c.resolve(PLATFORM_TOKENS.STATE_STORAGE),
          c.resolve(SDK_TOKENS.SDK_SESSION_PLAN_LIMIT_REGISTRY),
          c.resolve(AUTH_PROVIDERS_TOKENS.PROVIDER_OWNER_RESOLVER),
          c.resolve(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_QUOTA_STORE),
        ),
    ),
  });
  // A factory for the same reason: the trailing clock is a test seam.
  container.register(AUTH_PROVIDERS_TOKENS.PLAN_USAGE_SERVICE, {
    useFactory: instanceCachingFactory(
      (c) =>
        new PlanUsageService(
          c.resolve(TOKENS.LOGGER),
          c.resolve(AUTH_PROVIDERS_TOKENS.PLAN_LIMIT_LEDGER),
          c.resolve(AUTH_PROVIDERS_TOKENS.PLAN_CREDENTIAL_SOURCE),
          c.resolve(SDK_TOKENS.SDK_SESSION_QUOTA_PROBE),
          c.resolve(AUTH_PROVIDERS_TOKENS.SDK_CODEX_ACCOUNT_USAGE),
          Date.now,
          c.resolve(AUTH_PROVIDERS_TOKENS.SDK_KIMI_CODE_AUTH),
        ),
    ),
  });
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
