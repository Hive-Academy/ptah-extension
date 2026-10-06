import type {
  Logger,
  RpcHandler,
  SentryService,
} from '@ptah-extension/vscode-core';
import type { SdkAgentAdapter } from '@ptah-extension/agent-sdk';
import { resolveAuthProviderKey } from '@ptah-extension/platform-core';
import type { WorkspaceScopeResolver } from '@ptah-extension/settings-core';
import type {
  AuthClearWorkspaceOverrideResult,
  AuthGetScopeResult,
} from '@ptah-extension/shared';
import { resolveScopeFromKey } from '../setting-scope';

export interface WorkspaceScopeMethodsDeps {
  readonly logger: Logger;
  readonly rpcHandler: RpcHandler;
  readonly sentryService: SentryService;
  readonly sdkAdapter: SdkAgentAdapter;
  readonly scopeResolver: WorkspaceScopeResolver;
  readonly invalidateAuthStatusCache: () => void;
}

/** `auth:getScope` and `auth:clearWorkspaceOverride`. */
export class WorkspaceScopeMethods {
  constructor(private readonly deps: WorkspaceScopeMethodsDeps) {}

  /**
   * auth:getScope - Report whether the active workspace overrides auth/provider
   * settings or inherits the global defaults.
   */
  registerGetScope(): void {
    const { logger, sentryService, scopeResolver } = this.deps;
    this.deps.rpcHandler.registerMethod<
      Record<string, never>,
      AuthGetScopeResult
    >('auth:getScope', async () => {
      try {
        const activePath = scopeResolver.getActivePath() ?? null;
        const authMethodKey = scopeResolver.effectiveKey('authMethod', true);
        const providerKey = scopeResolver.effectiveKey(
          'anthropicProviderId',
          true,
        );
        const authMethodResolved = resolveScopeFromKey(
          authMethodKey,
          'authMethod',
        );
        const providerResolved = resolveScopeFromKey(
          providerKey,
          'anthropicProviderId',
        );
        const runtime = authMethodResolved.runtime ?? providerResolved.runtime;
        return {
          authMethodScope: authMethodResolved.scope,
          providerScope: providerResolved.scope,
          activePath,
          ...(runtime !== undefined ? { runtime } : {}),
        };
      } catch (error) {
        logger.error(
          'RPC: auth:getScope failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'AuthRpcHandlers.registerGetScope' },
        );
        throw error;
      }
    });
  }

  /**
   * auth:clearWorkspaceOverride - Drop the active workspace's overrides for
   * authMethod, anthropicProviderId, and the active provider's model + effort
   * keys, reverting them to the global defaults.
   */
  registerClearWorkspaceOverride(): void {
    const { logger, sentryService, sdkAdapter, scopeResolver } = this.deps;
    this.deps.rpcHandler.registerMethod<
      Record<string, never>,
      AuthClearWorkspaceOverrideResult
    >('auth:clearWorkspaceOverride', async () => {
      try {
        const authMethod =
          scopeResolver.read<string>('authMethod', true) ?? 'apiKey';
        const providerId =
          scopeResolver.read<string>('anthropicProviderId', true) ?? '';
        const authKey = resolveAuthProviderKey(authMethod, providerId);

        await scopeResolver.clearOverride('authMethod', true);
        await scopeResolver.clearOverride('anthropicProviderId', true);
        await scopeResolver.clearOverride(
          `provider.${authKey}.selectedModel`,
          true,
        );
        await scopeResolver.clearOverride(
          `provider.${authKey}.reasoningEffort`,
          true,
        );

        await sdkAdapter.reset();
        this.deps.invalidateAuthStatusCache();

        return { success: true };
      } catch (error) {
        logger.error(
          'RPC: auth:clearWorkspaceOverride failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'AuthRpcHandlers.registerClearWorkspaceOverride' },
        );
        throw error;
      }
    });
  }
}
