/**
 * Electron Config Extended RPC Handlers
 *
 * Handles Electron-specific config methods that go beyond
 * what the shared ConfigRpcHandlers provides:
 * - config:model-set - Persist model selection via StorageService
 *   (The shared ConfigRpcHandlers registers config:model-get, config:autopilot-get,
 *    config:autopilot-toggle, config:models-list, config:model-switch)
 *
 * Also initializes the permission handler from saved config at startup.
 *
 * TASK_2025_203 Batch 5: Extracted from inline registrations
 */

import { injectable, inject, DependencyContainer } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type {
  Logger,
  RpcHandler,
  IAuthSecretsService,
} from '@ptah-extension/vscode-core';
import { SDK_TOKENS, DEFAULT_PROVIDER_ID } from '@ptah-extension/agent-sdk';
import type { ConfigManager } from '@ptah-extension/vscode-core';

@injectable()
export class ConfigExtendedRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    private readonly container: DependencyContainer,
  ) {}

  register(): void {
    this.registerModelSet();
    this.initializePermissionHandler();
    this.registerSetApiKey();
    this.registerGetStatus();
  }

  /**
   * Register config:model-set method.
   * The rpc-handler-setup.ts previously handled this inline. Now it's extracted
   * as a proper handler method.
   */
  private registerModelSet(): void {
    this.rpcHandler.registerMethod(
      'config:model-set',
      async (params: { model?: string; autopilot?: boolean } | undefined) => {
        if (params?.model !== undefined) {
          const storageService = this.container.resolve<{
            set<T>(key: string, value: T): Promise<void>;
          }>(TOKENS.STORAGE_SERVICE);
          await storageService.set('model.selected', params.model);
        }
        if (params?.autopilot !== undefined) {
          const storageService = this.container.resolve<{
            set<T>(key: string, value: T): Promise<void>;
          }>(TOKENS.STORAGE_SERVICE);
          await storageService.set('autopilot.enabled', params.autopilot);
        }
        return { success: true };
      },
    );
  }

  /** auth:setApiKey — store an API key for the given provider */
  private registerSetApiKey(): void {
    this.rpcHandler.registerMethod<
      { provider: string; apiKey: string },
      { success: boolean; error?: string }
    >('auth:setApiKey', async (params) => {
      try {
        const authSecrets = this.container.resolve<IAuthSecretsService>(
          TOKENS.AUTH_SECRETS_SERVICE,
        );
        if (params?.apiKey?.trim()) {
          await authSecrets.setProviderKey(params.provider, params.apiKey);
        } else {
          await authSecrets.deleteProviderKey(params.provider);
        }
        return { success: true };
      } catch (error) {
        this.logger.error('[Electron RPC] auth:setApiKey failed', {
          provider: params?.provider,
          error: error instanceof Error ? error.message : String(error),
        } as unknown as Error);
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });
  }

  /** auth:getStatus — simple auth status for the active provider */
  private registerGetStatus(): void {
    this.rpcHandler.registerMethod<
      Record<string, never>,
      { isAuthenticated: boolean; provider: string; hasApiKey: boolean }
    >('auth:getStatus', async () => {
      try {
        const authSecrets = this.container.resolve<IAuthSecretsService>(
          TOKENS.AUTH_SECRETS_SERVICE,
        );
        const configManager = this.container.resolve<ConfigManager>(
          TOKENS.CONFIG_MANAGER,
        );
        const provider = configManager.getWithDefault<string>(
          'anthropicProviderId',
          DEFAULT_PROVIDER_ID,
        );
        const hasApiKey = await authSecrets.hasProviderKey(provider);
        return { isAuthenticated: hasApiKey, provider, hasApiKey };
      } catch (error) {
        this.logger.error('[Electron RPC] auth:getStatus failed', {
          error: error instanceof Error ? error.message : String(error),
        } as unknown as Error);
        return {
          isAuthenticated: false,
          provider: DEFAULT_PROVIDER_ID,
          hasApiKey: false,
        };
      }
    });
  }

  /**
   * Initialize permission handler from saved config at startup.
   * Ensures the saved autopilot permission level is applied immediately
   * rather than waiting for the user to toggle it in the UI.
   */
  private initializePermissionHandler(): void {
    try {
      const initStorageService = this.container.resolve<{
        get<T>(key: string, defaultValue: T): T;
      }>(TOKENS.STORAGE_SERVICE);
      const savedEnabled = initStorageService.get('autopilot.enabled', false);
      const savedLevel = initStorageService.get(
        'autopilot.permissionLevel',
        'ask',
      );
      if (savedEnabled && savedLevel !== 'ask') {
        const permissionHandler = this.container.resolve<{
          setPermissionLevel(level: string): void;
        }>(SDK_TOKENS.SDK_PERMISSION_HANDLER);
        permissionHandler.setPermissionLevel(savedLevel);
        this.logger.info(
          '[Electron RPC] Initialized permission handler from saved config',
          { permissionLevel: savedLevel } as unknown as Error,
        );
      }
    } catch {
      // Permission handler may not be registered yet -- best-effort
      this.logger.debug(
        '[Electron RPC] Permission handler initialization skipped (best-effort)',
      );
    }
  }
}
