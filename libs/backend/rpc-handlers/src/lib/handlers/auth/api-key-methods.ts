import type {
  ConfigManager,
  IAuthSecretsService,
  Logger,
  RpcHandler,
  SentryService,
} from '@ptah-extension/vscode-core';
import {
  DEFAULT_PROVIDER_ID,
  getAllAnthropicProviders,
} from '@ptah-extension/agent-sdk';
import type { ProviderModelsService } from '@ptah-extension/auth-providers';
import type {
  AuthApiKeyStatusEntry,
  AuthDeleteStoredKeyParams,
  AuthDeleteStoredKeyResult,
  AuthGetApiKeyStatusResult,
} from '@ptah-extension/shared';
import { maskKeyHint } from '../../utils/mask-key-hint';
import type { ConnectionCheckRecorder } from '../../utils/connection-check-recorder';
import { AuthDeleteStoredKeySchema } from '../auth-rpc.schema';
import { keyStoreReadFailure } from './key-store-read-failure';

export interface ApiKeyMethodsDeps {
  readonly logger: Logger;
  readonly rpcHandler: RpcHandler;
  readonly sentryService: SentryService;
  readonly configManager: ConfigManager;
  readonly authSecretsService: IAuthSecretsService;
  readonly providerModels: ProviderModelsService;
  readonly connectionChecks: ConnectionCheckRecorder;
  readonly invalidateAuthStatusCache: () => void;
}

/**
 * Stored API keys: `auth:getStatus`, `auth:setApiKey`, `auth:deleteStoredKey`
 * and `auth:getApiKeyStatus`.
 */
export class ApiKeyMethods {
  constructor(private readonly deps: ApiKeyMethodsDeps) {}

  /**
   * auth:getStatus - Compact auth status for the active Anthropic provider.
   *
   * Lifted from
   * `apps/ptah-electron/src/services/rpc/handlers/config-extended-rpc.handlers.ts`.
   * Distinct from `auth:getAuthStatus` (which returns full provider list +
   * Copilot/Codex/Claude CLI flags); this method is the lightweight check
   * the Electron renderer uses on startup.
   */
  registerGetStatus(): void {
    const { logger, sentryService, configManager, authSecretsService } =
      this.deps;
    this.deps.rpcHandler.registerMethod<
      Record<string, never>,
      { isAuthenticated: boolean; provider: string; hasApiKey: boolean }
    >('auth:getStatus', async () => {
      try {
        const provider = configManager.getWithDefault<string>(
          'anthropicProviderId',
          DEFAULT_PROVIDER_ID,
        );
        const hasApiKey = await authSecretsService.hasProviderKey(provider);
        return { isAuthenticated: hasApiKey, provider, hasApiKey };
      } catch (error) {
        logger.error(
          'RPC: auth:getStatus failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'AuthRpcHandlers.registerGetStatus' },
        );
        return {
          isAuthenticated: false,
          provider: DEFAULT_PROVIDER_ID,
          hasApiKey: false,
        };
      }
    });
  }

  /**
   * auth:setApiKey - Store or clear an API key for a provider.
   *
   * Lifted from
   * `apps/ptah-electron/src/services/rpc/handlers/config-extended-rpc.handlers.ts`
   * so all three apps (VS Code, Electron, CLI) consume it via
   * `registerAllRpcHandlers()`. Empty/whitespace `apiKey` deletes the slot
   * — mirrors how `auth:saveSettings` treats empty strings.
   */
  registerSetApiKey(): void {
    const {
      logger,
      sentryService,
      authSecretsService,
      providerModels,
      connectionChecks,
    } = this.deps;
    this.deps.rpcHandler.registerMethod<
      { provider: string; apiKey: string },
      { success: boolean; error?: string }
    >('auth:setApiKey', async (params) => {
      try {
        if (!params?.provider) {
          return {
            success: false,
            error: 'provider is required',
          };
        }
        try {
          if (params.apiKey?.trim()) {
            await authSecretsService.setProviderKey(
              params.provider,
              params.apiKey,
            );
          } else {
            await authSecretsService.deleteProviderKey(params.provider);
          }
        } finally {
          // A replaced or cleared key makes the last check stale. Cleared after
          // the write (also when it failed), so no check of the old key survives.
          connectionChecks.clear(params.provider);
        }
        providerModels.clearCache(params.provider);
        this.deps.invalidateAuthStatusCache();
        return { success: true };
      } catch (error: unknown) {
        const errorType = error instanceof Error ? error.name : 'unknown';
        logger.error('RPC: auth:setApiKey failed', { errorType });
        sentryService.captureException(
          new Error(`auth:setApiKey failed (${errorType})`),
          { errorSource: 'AuthRpcHandlers.registerSetApiKey' },
        );
        // Fixed copy: a secret-store error can echo the key it was given.
        return {
          success: false,
          error: params.apiKey?.trim()
            ? 'Could not save the API key.'
            : 'Could not delete the stored key.',
        };
      }
    });
  }

  /**
   * auth:deleteStoredKey - Delete one stored credential without activating, re-scoping or resetting.
   */
  registerDeleteStoredKey(): void {
    const {
      logger,
      sentryService,
      authSecretsService,
      providerModels,
      connectionChecks,
    } = this.deps;
    this.deps.rpcHandler.registerMethod<
      AuthDeleteStoredKeyParams,
      AuthDeleteStoredKeyResult
    >('auth:deleteStoredKey', async (params) => {
      try {
        logger.debug('RPC: auth:deleteStoredKey called', {
          providerId: params?.providerId,
        });

        const parsed = AuthDeleteStoredKeySchema.safeParse(params);
        if (!parsed.success) {
          logger.warn('RPC: auth:deleteStoredKey rejected invalid params');
          return {
            success: false,
            error: 'Unknown provider id',
          };
        }

        const { providerId } = parsed.data;
        try {
          if (providerId === 'anthropic') {
            await authSecretsService.setCredential('apiKey', '');
          } else {
            await authSecretsService.deleteProviderKey(providerId);
          }
          // The key is gone: its last check no longer describes the connection.
          connectionChecks.clear(providerId);
        } catch {
          // The store may be half-written; forget the check either way.
          connectionChecks.clear(providerId);
          // Secret-store errors can carry credentials; discard their details (D4 / 555).
          logger.error('RPC: auth:deleteStoredKey secret deletion failed');
          return {
            success: false,
            error: 'Could not delete the stored key.',
          };
        }

        try {
          providerModels.clearCache(providerId);
          this.deps.invalidateAuthStatusCache();
        } catch {
          logger.warn('RPC: auth:deleteStoredKey cache invalidation failed');
        }

        return { success: true };
      } catch (error: unknown) {
        // A secret-store error can echo the key: log and report its type only.
        const errorType = error instanceof Error ? error.name : 'unknown';
        logger.error('RPC: auth:deleteStoredKey failed', { errorType });
        sentryService.captureException(
          new Error(`auth:deleteStoredKey failed (${errorType})`),
          { errorSource: 'AuthRpcHandlers.registerDeleteStoredKey' },
        );
        return {
          success: false,
          error: 'Could not delete the stored key.',
        };
      }
    });
  }

  /**
   * auth:getApiKeyStatus - List all providers with their key presence and the
   * masked `keyHint` of each stored key (read path only; see `maskKeyHint`).
   *
   * Shared by all three apps (VS Code, Electron, CLI) via
   * `registerAllRpcHandlers()`; each host's `IAuthSecretsService` reads its own
   * secret store. Each provider's key is read on its own: an unreadable one
   * is listed with `keyUnreadable: true` and the rest still load. Only when no
   * key can be read is it an error with fixed text, never an empty list that
   * would read as "no keys stored".
   */
  registerGetApiKeyStatus(): void {
    const { logger, sentryService, configManager, authSecretsService } =
      this.deps;
    this.deps.rpcHandler.registerMethod<
      Record<string, never>,
      AuthGetApiKeyStatusResult
    >('auth:getApiKeyStatus', async () => {
      const activeProvider = configManager.getWithDefault<string>(
        'anthropicProviderId',
        DEFAULT_PROVIDER_ID,
      );
      const all = getAllAnthropicProviders();
      // Read once per provider for presence and hint; values stay in this scope.
      const reads = await Promise.allSettled(
        all.map((p) => authSecretsService.getProviderKey(p.id)),
      );
      const failures = reads.flatMap((read, index) =>
        read.status === 'rejected'
          ? [{ providerId: all[index].id, reason: read.reason as unknown }]
          : [],
      );
      if (failures.length > 0 && failures.length === reads.length) {
        throw keyStoreReadFailure(
          logger,
          sentryService,
          'auth:getApiKeyStatus',
          failures[0].reason,
        );
      }
      if (failures.length > 0) {
        // Store errors can carry key material: provider ids and types only.
        logger.warn('RPC: auth:getApiKeyStatus could not read some keys', {
          failures: failures.map(({ providerId, reason }) => ({
            providerId,
            errorType: reason instanceof Error ? reason.name : 'unknown',
          })),
        });
      }
      const providers = all.map((p, index): AuthApiKeyStatusEntry => {
        const read = reads[index];
        const entry = {
          provider: p.id,
          displayName: p.name,
          isDefault: p.id === activeProvider,
        };
        if (read.status === 'rejected') {
          return { ...entry, hasApiKey: false, keyUnreadable: true };
        }
        const keyHint = maskKeyHint(read.value);
        return {
          ...entry,
          hasApiKey: !!read.value && read.value.length > 0,
          ...(keyHint ? { keyHint } : {}),
        };
      });
      return { providers };
    });
  }
}
