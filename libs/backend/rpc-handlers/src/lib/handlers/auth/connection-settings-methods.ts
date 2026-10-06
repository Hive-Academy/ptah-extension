import { RpcUserError } from '@ptah-extension/vscode-core';
import type {
  IAuthSecretsService,
  Logger,
  RpcHandler,
  SentryService,
} from '@ptah-extension/vscode-core';
import { DEFAULT_PROVIDER_ID } from '@ptah-extension/agent-sdk';
import type { SdkAgentAdapter } from '@ptah-extension/agent-sdk';
import type { ProviderModelsService } from '@ptah-extension/auth-providers';
import type { WorkspaceScopeResolver } from '@ptah-extension/settings-core';
import { ANTHROPIC_DIRECT_PROVIDER_ID } from '@ptah-extension/shared';
import type {
  AuthCheckConnectionResult,
  AuthTestConnectionResponse,
} from '@ptah-extension/shared';
import type { ConnectionCheckRecorder } from '../../utils/connection-check-recorder';
import { connectionCheckKind } from '../connection-check';
import type { ConnectionChecker } from '../connection-check';
import {
  AuthCheckConnectionSchema,
  AuthSettingsSchema,
} from '../auth-rpc.schema';
import { autoMapProviderTiers } from './provider-tier-auto-map';

export interface ConnectionSettingsMethodsDeps {
  readonly logger: Logger;
  readonly rpcHandler: RpcHandler;
  readonly sentryService: SentryService;
  readonly sdkAdapter: SdkAgentAdapter;
  readonly scopeResolver: WorkspaceScopeResolver;
  readonly authSecretsService: IAuthSecretsService;
  readonly providerModels: ProviderModelsService;
  readonly connectionChecks: ConnectionCheckRecorder;
  readonly connectionChecker: ConnectionChecker;
  readonly invalidateAuthStatusCache: () => void;
}

/** `auth:checkConnection`, `auth:saveSettings` and `auth:testConnection`. */
export class ConnectionSettingsMethods {
  constructor(private readonly deps: ConnectionSettingsMethodsDeps) {}

  /**
   * auth:checkConnection - Check one SAVED connection now and record the result
   * (status, latency, time) for `auth:getEffectiveRoute` `providers[].lastCheck`.
   * Key-carrying connections send one minimal request through the stored-key
   * probe; sign-in and CLI connections re-read their token or detection.
   * Probe failures are a `failed` record, not an RPC error.
   */
  registerCheckConnection(): void {
    this.deps.rpcHandler.registerMethod<unknown, AuthCheckConnectionResult>(
      'auth:checkConnection',
      async (raw: unknown) => {
        const parsed = AuthCheckConnectionSchema.safeParse(raw);
        if (!parsed.success) {
          // The lib's standard invalid-params text; "Unknown provider id" is
          // kept for a well-formed id that names no connection.
          throw new RpcUserError(
            'Invalid parameters for auth:checkConnection',
            'INVALID_PARAMS',
          );
        }
        const { providerId } = parsed.data;
        const kind = connectionCheckKind(providerId);
        if (kind === undefined) {
          throw new RpcUserError('Unknown provider id', 'INVALID_PARAMS');
        }
        if (kind === null) {
          throw new RpcUserError(
            'This connection cannot be checked here.',
            'INVALID_PARAMS',
          );
        }
        return this.deps.connectionChecker.check(providerId, kind);
      },
    );
  }

  /**
   * auth:saveSettings - Save authentication settings
   */
  registerSaveSettings(): void {
    const {
      logger,
      sentryService,
      sdkAdapter,
      scopeResolver,
      authSecretsService,
      providerModels,
      connectionChecks,
    } = this.deps;
    this.deps.rpcHandler.registerMethod<
      unknown,
      { success: boolean; error?: string }
    >('auth:saveSettings', async (params: unknown) => {
      try {
        const sanitizedParams =
          typeof params === 'object' && params !== null
            ? {
                ...params,
                anthropicApiKey:
                  'anthropicApiKey' in params &&
                  typeof params.anthropicApiKey === 'string' &&
                  params.anthropicApiKey
                    ? `***${params.anthropicApiKey.slice(-4)}`
                    : undefined,
                providerApiKey:
                  'providerApiKey' in params &&
                  typeof params.providerApiKey === 'string' &&
                  params.providerApiKey
                    ? `***${params.providerApiKey.slice(-4)}`
                    : undefined,
              }
            : params;
        logger.debug('RPC: auth:saveSettings called', {
          params: sanitizedParams,
        });
        const validated = AuthSettingsSchema.parse(params);
        const applyTo: 'global' | 'app' | 'workspace' =
          validated.applyTo ?? 'global';
        await scopeResolver.write(
          'authMethod',
          validated.authMethod,
          applyTo,
          true,
        );
        await scopeResolver.clearMoreSpecific('authMethod', applyTo, true);
        if (validated.anthropicApiKey !== undefined) {
          if (validated.anthropicApiKey.trim()) {
            await authSecretsService.setCredential(
              'apiKey',
              validated.anthropicApiKey,
            );
          } else {
            await authSecretsService.deleteCredential('apiKey');
          }
          connectionChecks.clear(ANTHROPIC_DIRECT_PROVIDER_ID);
        }
        if (validated.providerApiKey !== undefined) {
          const targetProviderId =
            validated.anthropicProviderId ??
            scopeResolver.read<string>('anthropicProviderId', true) ??
            DEFAULT_PROVIDER_ID;

          if (validated.providerApiKey.trim()) {
            await authSecretsService.setProviderKey(
              targetProviderId,
              validated.providerApiKey,
            );
          } else {
            await authSecretsService.deleteProviderKey(targetProviderId);
          }
          connectionChecks.clear(targetProviderId);
          providerModels.clearCache(targetProviderId);
        }
        if (validated.anthropicProviderId !== undefined) {
          await scopeResolver.write(
            'anthropicProviderId',
            validated.anthropicProviderId,
            applyTo,
            true,
          );
          await scopeResolver.clearMoreSpecific(
            'anthropicProviderId',
            applyTo,
            true,
          );
          await autoMapProviderTiers(
            providerModels,
            logger,
            validated.anthropicProviderId,
          );
        }
        logger.info('RPC: auth:saveSettings triggering adapter reset...');
        await sdkAdapter.reset();
        logger.info('RPC: auth:saveSettings adapter reset completed');

        this.deps.invalidateAuthStatusCache();
        logger.info('RPC: auth:saveSettings completed successfully');
        return { success: true };
      } catch (error) {
        logger.error(
          'RPC: auth:saveSettings failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'AuthRpcHandlers.registerSaveSettings' },
        );
        throw error;
      }
    });
  }

  /**
   * auth:testConnection - Test connection after settings save
   *
   * Uses retry-poll with exponential backoff instead of a fixed delay.
   * Delays: 200ms, 400ms, 800ms, 1600ms, 3200ms = ~6.2s total max.
   * Returns as soon as the SDK reports 'available', avoiding unnecessary waits.
   */
  registerTestConnection(): void {
    const { logger, sentryService, sdkAdapter } = this.deps;
    this.deps.rpcHandler.registerMethod<void, AuthTestConnectionResponse>(
      'auth:testConnection',
      async () => {
        try {
          logger.debug('RPC: auth:testConnection called');
          const MAX_RETRIES = 5;
          const BASE_DELAY_MS = 200;

          for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            const delay = BASE_DELAY_MS * Math.pow(2, attempt);
            await new Promise((resolve) => setTimeout(resolve, delay));

            const health = sdkAdapter.getHealth();
            if (health.status === 'available') {
              const result = {
                success: true,
                health: { ...health, errorMessage: undefined },
                errorMessage: undefined,
              };
              logger.info('RPC: auth:testConnection completed', {
                result,
                attempt: attempt + 1,
              });
              return result;
            }

            logger.debug(
              `RPC: auth:testConnection attempt ${attempt + 1}/${MAX_RETRIES}`,
              { status: health.status, delay },
            );
          }
          const finalHealth = sdkAdapter.getHealth();
          const result = {
            success: finalHealth.status === 'available',
            health: {
              ...finalHealth,
              errorMessage: finalHealth.errorMessage
                ? 'Could not test the connection.'
                : undefined,
            },
            errorMessage:
              finalHealth.status === 'available'
                ? undefined
                : finalHealth.status === 'error'
                  ? 'Could not test the connection.'
                  : 'Connection test timed out',
          };

          logger.info(
            'RPC: auth:testConnection completed (exhausted retries)',
            { result },
          );
          return result;
        } catch (error: unknown) {
          const errorType = error instanceof Error ? error.name : 'unknown';
          logger.error('RPC: auth:testConnection failed', { errorType });
          sentryService.captureException(
            new Error(`auth:testConnection failed (${errorType})`),
            { errorSource: 'AuthRpcHandlers.registerTestConnection' },
          );
          return {
            success: false,
            health: null,
            errorMessage: 'Could not test the connection.',
          };
        }
      },
    );
  }
}
