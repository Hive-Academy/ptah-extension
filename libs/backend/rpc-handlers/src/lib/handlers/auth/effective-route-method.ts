import { z } from 'zod';
import { RpcUserError } from '@ptah-extension/vscode-core';
import type {
  ConfigManager,
  Logger,
  RpcHandler,
} from '@ptah-extension/vscode-core';
import { resolveEffectiveAuthRoute } from '@ptah-extension/auth-providers';
import type { ModelResolver } from '@ptah-extension/auth-providers';
import { resolveAuthProviderKey } from '@ptah-extension/platform-core';
import type { WorkspaceScopeResolver } from '@ptah-extension/settings-core';
import type {
  AuthGetEffectiveRouteResult,
  EffectiveRouteProvider,
} from '@ptah-extension/shared';
import type { ConnectionCheckRecorder } from '../../utils/connection-check-recorder';
import { resolveScopeFromKey } from '../setting-scope';
import { CODEX_PROVIDER_ID, COPILOT_PROVIDER_ID } from './auth-provider-ids';
import type { AuthStatusCache } from './auth-status-cache';

export interface EffectiveRouteMethodDeps {
  readonly logger: Logger;
  readonly rpcHandler: RpcHandler;
  readonly configManager: ConfigManager;
  readonly scopeResolver: WorkspaceScopeResolver;
  readonly connectionChecks: ConnectionCheckRecorder;
  readonly statusCache: AuthStatusCache;
  readonly invalidateAuthStatusCache: () => void;
  readonly modelResolver?: ModelResolver;
}

/** `auth:getEffectiveRoute`. */
export class EffectiveRouteMethod {
  constructor(private readonly deps: EffectiveRouteMethodDeps) {}

  /** Read-only route snapshot composed from the existing status sources. */
  registerGetEffectiveRoute(): void {
    const {
      logger,
      rpcHandler,
      configManager,
      scopeResolver,
      connectionChecks,
      statusCache,
    } = this.deps;
    const paramsSchema = z.object({ refresh: z.boolean().optional() }).strict();
    const statusSchema = z.object({
      copilotAuthenticated: z.boolean().optional(),
      codexAuthenticated: z.boolean().optional(),
      codexTokenStale: z.boolean().optional(),
      claudeCliInstalled: z.boolean().optional(),
    });
    const providersSchema = z.object({
      providers: z.array(
        z.object({
          name: z.string(),
          authType: z.enum(['apiKey', 'oauth', 'cli', 'none']),
          hasApiKey: z.boolean(),
          isLocal: z.boolean(),
          requiresProxy: z.boolean(),
        }),
      ),
    });
    rpcHandler.registerMethod(
      'auth:getEffectiveRoute',
      async (raw: unknown): Promise<AuthGetEffectiveRouteResult> => {
        const params = paramsSchema.safeParse(raw ?? {});
        if (!params.success)
          throw new RpcUserError(
            'Invalid effective route request',
            'INVALID_PARAMS',
          );
        try {
          if (params.data.refresh) this.deps.invalidateAuthStatusCache();
          const generation = statusCache.generation;
          const activePath = scopeResolver.getActivePath();
          // Do not normalize: an unset/invalid stored method is a resolver blocker.
          const storedAuthMethodDiagnostic =
            scopeResolver.read<string>('authMethod', true) ?? null;
          const anthropicProviderId =
            scopeResolver.read<string>('anthropicProviderId', true) ?? null;
          const defaultProvider =
            configManager.get<string>('llm.defaultProvider') ?? null;
          const storedAuthMethodScope = resolveScopeFromKey(
            scopeResolver.effectiveKey('authMethod', true),
            'authMethod',
          ).scope;
          const fromCache =
            statusCache.getFresh(statusCache.cacheKey({})) !== undefined;
          // Reuse the registered status paths, including their coalescing and probe ceilings.
          const [authResponse, providerResponse] = await Promise.all([
            rpcHandler.handleMessage({
              method: 'auth:getAuthStatus',
              params: {},
              correlationId: 'effective-route-auth',
            }),
            rpcHandler.handleMessage({
              method: 'llm:getProviderStatus',
              params: {},
              correlationId: 'effective-route-providers',
            }),
          ]);
          const auth = statusSchema.safeParse(authResponse.data);
          const catalogue = providersSchema.safeParse(providerResponse.data);
          if (
            !authResponse.success ||
            !providerResponse.success ||
            !auth.success ||
            !catalogue.success
          ) {
            throw new RpcUserError(
              'Unable to read authentication status',
              'AUTH_REQUIRED',
            );
          }
          if (
            generation !== statusCache.generation ||
            activePath !== scopeResolver.getActivePath()
          ) {
            throw new RpcUserError(
              'Authentication changed during the check; refresh the route',
              'AUTH_REQUIRED',
            );
          }
          const providers: EffectiveRouteProvider[] =
            catalogue.data.providers.map((provider) => {
              if (
                provider.name === 'claude-cli' ||
                provider.authType === 'cli'
              ) {
                return {
                  id: provider.name,
                  type: 'cli',
                  status: statusCache.claudeCliHealth
                    ? statusCache.claudeCliHealth.available
                      ? 'connected'
                      : 'missing'
                    : 'unknown',
                };
              }
              if (provider.authType === 'apiKey') {
                return {
                  id: provider.name,
                  type: 'apiKey',
                  status: provider.hasApiKey ? 'connected' : 'needs-key',
                };
              }
              if (provider.authType === 'oauth') {
                const authenticated =
                  provider.name === COPILOT_PROVIDER_ID
                    ? auth.data.copilotAuthenticated
                    : provider.name === CODEX_PROVIDER_ID
                      ? auth.data.codexAuthenticated &&
                        !auth.data.codexTokenStale
                      : undefined;
                return {
                  id: provider.name,
                  type: 'oauth',
                  status:
                    authenticated === undefined
                      ? 'unknown'
                      : authenticated
                        ? 'connected'
                        : 'unauthenticated',
                };
              }
              return {
                id: provider.name,
                type: provider.isLocal
                  ? provider.requiresProxy
                    ? 'local-proxy'
                    : 'local-native'
                  : 'unknown',
                status: 'skipped',
              };
            });
          if (!providers.some((provider) => provider.id === 'claude-cli')) {
            providers.push({
              id: 'claude-cli',
              type: 'cli',
              status: statusCache.claudeCliHealth
                ? statusCache.claudeCliHealth.available
                  ? 'connected'
                  : 'missing'
                : 'unknown',
            });
          }
          const effective = resolveEffectiveAuthRoute(
            {
              authMethod: storedAuthMethodDiagnostic,
              anthropicProviderId,
              defaultProvider,
            },
            providers,
          );
          // Read-only: the route never records a check (it probes nothing).
          const providersWithChecks = providers.map((provider) => {
            const lastCheck = connectionChecks.get(provider.id);
            return lastCheck ? { ...provider, lastCheck } : provider;
          });
          const authKey = resolveAuthProviderKey(
            storedAuthMethodDiagnostic ?? '',
            anthropicProviderId ?? '',
          );
          const selected = scopeResolver.read<unknown>(
            `provider.${authKey}.selectedModel`,
            true,
          );
          let resolvedModel: AuthGetEffectiveRouteResult['resolvedModel'] = {
            kind: 'unresolved',
          };
          if (effective.route !== 'unresolved' && this.deps.modelResolver) {
            // Use the runtime's resolver, including dated-model remapping and provider defaults.
            const model = this.deps.modelResolver.resolve(
              typeof selected === 'string' && selected ? selected : 'default',
            );
            if (model === 'opus' || model === 'sonnet' || model === 'haiku') {
              resolvedModel = { kind: 'tier', tier: model };
            } else if (model && model !== 'default') {
              resolvedModel = { kind: 'model', id: model };
            }
            // 'default' remains SDK-selected, so no concrete identity is claimed.
          }
          return {
            ...effective,
            resolvedAuthModality:
              effective.route === 'oauth-proxy'
                ? 'oauth'
                : effective.route === 'local-native' ||
                    effective.route === 'local-proxy'
                  ? 'local'
                  : effective.route === 'unresolved'
                    ? 'unknown'
                    : effective.route,
            resolvedModel,
            storedAuthMethodDiagnostic,
            storedAuthMethodScope,
            providers: providersWithChecks,
            // These status sources prove configuration/installation, not a successful inference request.
            // Never manufacture connection timestamps from credential presence or cache age.
            lastSuccessfulProbeAt: null,
            lastFailedProbeAt: null,
            probedAt: new Date().toISOString(),
            fromCache,
          };
        } catch (error: unknown) {
          if (error instanceof RpcUserError) throw error;
          logger.warn('Unable to read the effective route', {
            errorType: error instanceof Error ? error.name : 'unknown',
          });
          throw new Error('Unable to read the effective route');
        }
      },
    );
  }
}
