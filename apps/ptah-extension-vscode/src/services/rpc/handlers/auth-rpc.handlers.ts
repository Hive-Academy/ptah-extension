/**
 * Auth RPC Handlers
 *
 * Handles authentication-related RPC methods: auth:getHealth, auth:saveSettings,
 * auth:testConnection, auth:getAuthStatus
 *
 * TASK_2025_074: Extracted from monolithic RpcMethodRegistrationService
 * TASK_2025_076: SecretStorage integration for secure credential storage
 */

import { injectable, inject } from 'tsyringe';
import { z } from 'zod';
import {
  Logger,
  RpcHandler,
  TOKENS,
  ConfigManager,
  IAuthSecretsService,
} from '@ptah-extension/vscode-core';
// eslint-disable-next-line @nx/enforce-module-boundaries
import {
  SdkAgentAdapter,
  ANTHROPIC_PROVIDERS,
  DEFAULT_PROVIDER_ID,
} from '@ptah-extension/agent-sdk';
import {
  AuthGetAuthStatusParams,
  AuthGetAuthStatusResponse,
} from '@ptah-extension/shared';

/**
 * RPC handlers for authentication operations
 */
@injectable()
export class AuthRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(TOKENS.CONFIG_MANAGER)
    private readonly configManager: ConfigManager,
    @inject(TOKENS.AUTH_SECRETS_SERVICE)
    private readonly authSecretsService: IAuthSecretsService,
    @inject('SdkAgentAdapter') private readonly sdkAdapter: SdkAgentAdapter
  ) {}

  /**
   * Register all auth RPC methods
   */
  register(): void {
    this.registerGetHealth();
    this.registerGetAuthStatus();
    this.registerSaveSettings();
    this.registerTestConnection();

    this.logger.debug('Auth RPC handlers registered', {
      methods: [
        'auth:getHealth',
        'auth:getAuthStatus',
        'auth:saveSettings',
        'auth:testConnection',
      ],
    });
  }

  /**
   * auth:getHealth - Get SDK authentication health status
   */
  private registerGetHealth(): void {
    this.rpcHandler.registerMethod<void, { success: boolean; health: unknown }>(
      'auth:getHealth',
      async () => {
        try {
          this.logger.debug('RPC: auth:getHealth called');
          const health = this.sdkAdapter.getHealth();
          return { success: true, health };
        } catch (error) {
          this.logger.error(
            'RPC: auth:getHealth failed',
            error instanceof Error ? error : new Error(String(error))
          );
          throw error;
        }
      }
    );
  }

  /**
   * auth:getAuthStatus - Get auth configuration status
   * SECURITY: Never returns actual credential values - only boolean existence flags
   */
  private registerGetAuthStatus(): void {
    this.rpcHandler.registerMethod<
      AuthGetAuthStatusParams,
      AuthGetAuthStatusResponse
    >('auth:getAuthStatus', async (_params: AuthGetAuthStatusParams) => {
      try {
        this.logger.debug('RPC: auth:getAuthStatus called');

        // Check SecretStorage for credentials
        const hasOAuthToken = await this.authSecretsService.hasCredential(
          'oauthToken'
        );
        const hasApiKey = await this.authSecretsService.hasCredential('apiKey');
        const hasOpenRouterKey = await this.authSecretsService.hasCredential(
          'openrouterKey'
        );

        // Get auth method from ConfigManager (non-sensitive)
        const authMethod = this.configManager.getWithDefault<
          'oauth' | 'apiKey' | 'openrouter' | 'auto'
        >('authMethod', 'auto');

        // TASK_2025_129 Batch 3: Get selected provider ID
        const anthropicProviderId = this.configManager.getWithDefault<string>(
          'anthropicProviderId',
          DEFAULT_PROVIDER_ID
        );

        // Map provider registry to frontend-consumable format
        const availableProviders = ANTHROPIC_PROVIDERS.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          helpUrl: p.helpUrl,
          keyPrefix: p.keyPrefix,
          keyPlaceholder: p.keyPlaceholder,
          maskedKeyDisplay: p.maskedKeyDisplay,
        }));

        this.logger.debug('RPC: auth:getAuthStatus result', {
          hasOAuthToken,
          hasApiKey,
          hasOpenRouterKey,
          authMethod,
          anthropicProviderId,
        });

        return {
          hasOAuthToken,
          hasApiKey,
          hasOpenRouterKey,
          authMethod,
          anthropicProviderId,
          availableProviders,
        };
      } catch (error) {
        this.logger.error(
          'RPC: auth:getAuthStatus failed',
          error instanceof Error ? error : new Error(String(error))
        );
        throw error;
      }
    });
  }

  /**
   * auth:saveSettings - Save authentication settings
   */
  private registerSaveSettings(): void {
    const AuthSettingsSchema = z.object({
      authMethod: z.enum(['oauth', 'apiKey', 'openrouter', 'auto']),
      claudeOAuthToken: z.string().optional(),
      anthropicApiKey: z.string().optional(),
      openrouterApiKey: z.string().optional(),
      // TASK_2025_129 Batch 3: Selected Anthropic-compatible provider
      anthropicProviderId: z.string().optional(),
    });

    this.rpcHandler.registerMethod<
      unknown,
      { success: boolean; error?: string }
    >('auth:saveSettings', async (params: unknown) => {
      try {
        // SECURITY: Sanitize params before logging (mask credentials)
        const sanitizedParams =
          typeof params === 'object' && params !== null
            ? {
                ...params,
                claudeOAuthToken:
                  'claudeOAuthToken' in params &&
                  typeof params.claudeOAuthToken === 'string' &&
                  params.claudeOAuthToken
                    ? `***${params.claudeOAuthToken.slice(-4)}`
                    : undefined,
                anthropicApiKey:
                  'anthropicApiKey' in params &&
                  typeof params.anthropicApiKey === 'string' &&
                  params.anthropicApiKey
                    ? `***${params.anthropicApiKey.slice(-4)}`
                    : undefined,
                openrouterApiKey:
                  'openrouterApiKey' in params &&
                  typeof params.openrouterApiKey === 'string' &&
                  params.openrouterApiKey
                    ? `***${params.openrouterApiKey.slice(-4)}`
                    : undefined,
              }
            : params;
        this.logger.debug('RPC: auth:saveSettings called', {
          params: sanitizedParams,
        });

        // Validate parameters with Zod
        const validated = AuthSettingsSchema.parse(params);

        // Save auth method to ConfigManager (non-sensitive)
        await this.configManager.set('authMethod', validated.authMethod);

        // Save credentials to SecretStorage (encrypted!)
        if (validated.claudeOAuthToken !== undefined) {
          if (validated.claudeOAuthToken.trim()) {
            await this.authSecretsService.setCredential(
              'oauthToken',
              validated.claudeOAuthToken
            );
          } else {
            // Empty string = clear the credential
            await this.authSecretsService.deleteCredential('oauthToken');
          }
        }

        if (validated.anthropicApiKey !== undefined) {
          if (validated.anthropicApiKey.trim()) {
            await this.authSecretsService.setCredential(
              'apiKey',
              validated.anthropicApiKey
            );
          } else {
            // Empty string = clear the credential
            await this.authSecretsService.deleteCredential('apiKey');
          }
        }

        // TASK_2025_091: OpenRouter/Provider API key handling
        if (validated.openrouterApiKey !== undefined) {
          if (validated.openrouterApiKey.trim()) {
            await this.authSecretsService.setCredential(
              'openrouterKey',
              validated.openrouterApiKey
            );
          } else {
            // Empty string = clear the credential
            await this.authSecretsService.deleteCredential('openrouterKey');
          }
        }

        // TASK_2025_129 Batch 3: Save selected Anthropic-compatible provider ID
        if (validated.anthropicProviderId !== undefined) {
          await this.configManager.set(
            'anthropicProviderId',
            validated.anthropicProviderId
          );
        }

        this.logger.info('RPC: auth:saveSettings completed successfully');
        return { success: true };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Validation failed';
        this.logger.error('RPC: auth:saveSettings failed', {
          error: errorMessage,
        });
        return {
          success: false,
          error: errorMessage,
        };
      }
    });
  }

  /**
   * auth:testConnection - Test connection after settings save
   */
  private registerTestConnection(): void {
    this.rpcHandler.registerMethod<
      void,
      { success: boolean; health: unknown; errorMessage?: string }
    >('auth:testConnection', async () => {
      try {
        this.logger.debug('RPC: auth:testConnection called');

        // Brief delay to allow ConfigManager watcher to trigger re-init
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const health = this.sdkAdapter.getHealth();

        const success = health.status === 'available';
        const result = {
          success,
          health,
          errorMessage: health.errorMessage,
        };

        this.logger.info('RPC: auth:testConnection completed', { result });
        return result;
      } catch (error) {
        this.logger.error(
          'RPC: auth:testConnection failed',
          error instanceof Error ? error : new Error(String(error))
        );
        throw error;
      }
    });
  }
}
