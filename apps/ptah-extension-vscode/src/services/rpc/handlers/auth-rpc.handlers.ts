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
import * as vscode from 'vscode';
import {
  SdkAgentAdapter,
  SDK_TOKENS,
  ANTHROPIC_PROVIDERS,
  DEFAULT_PROVIDER_ID,
  ProviderModelsService,
} from '@ptah-extension/agent-sdk';
import type { CopilotAuthService } from '@ptah-extension/agent-sdk';
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
    @inject(SDK_TOKENS.SDK_AGENT_ADAPTER)
    private readonly sdkAdapter: SdkAgentAdapter,
    @inject(SDK_TOKENS.SDK_PROVIDER_MODELS)
    private readonly providerModels: ProviderModelsService,
    @inject(SDK_TOKENS.SDK_COPILOT_AUTH)
    private readonly copilotAuth: CopilotAuthService
  ) {}

  /**
   * Register all auth RPC methods
   */
  register(): void {
    this.registerGetHealth();
    this.registerGetAuthStatus();
    this.registerSaveSettings();
    this.registerTestConnection();
    this.registerCopilotLogin();
    this.registerCopilotStatus();

    this.logger.debug('Auth RPC handlers registered', {
      methods: [
        'auth:getHealth',
        'auth:getAuthStatus',
        'auth:saveSettings',
        'auth:testConnection',
        'auth:copilotLogin',
        'auth:copilotStatus',
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
    >('auth:getAuthStatus', async (params: AuthGetAuthStatusParams) => {
      try {
        this.logger.debug('RPC: auth:getAuthStatus called');

        // Check SecretStorage for credentials
        const hasOAuthToken = await this.authSecretsService.hasCredential(
          'oauthToken'
        );
        const hasApiKey = await this.authSecretsService.hasCredential('apiKey');

        // Get auth method from ConfigManager (non-sensitive)
        // Normalize legacy/invalid values (e.g. 'vscode-lm') to 'auto'
        const rawMethod = this.configManager.get<string>('authMethod');
        const validMethods = ['oauth', 'apiKey', 'openrouter', 'auto'];
        const authMethod = (
          rawMethod && validMethods.includes(rawMethod) ? rawMethod : 'auto'
        ) as 'oauth' | 'apiKey' | 'openrouter' | 'auto';

        // TASK_2025_129 Batch 3: Get selected provider ID
        const anthropicProviderId = this.configManager.getWithDefault<string>(
          'anthropicProviderId',
          DEFAULT_PROVIDER_ID
        );

        // Per-provider key check: use provided ID (for local UI switching) or persisted config
        const checkProviderId = params.providerId || anthropicProviderId;
        const hasOpenRouterKey = await this.authSecretsService.hasProviderKey(
          checkProviderId
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
          hasDynamicModels: !!('modelsEndpoint' in p && p.modelsEndpoint),
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
      // Validated against known provider IDs from the registry
      anthropicProviderId: z
        .enum(ANTHROPIC_PROVIDERS.map((p) => p.id) as [string, ...string[]])
        .optional(),
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

        // Per-provider API key handling: store key under the selected provider's slot
        // This prevents overwriting keys when switching between providers
        if (validated.openrouterApiKey !== undefined) {
          const targetProviderId =
            validated.anthropicProviderId ??
            this.configManager.getWithDefault<string>(
              'anthropicProviderId',
              DEFAULT_PROVIDER_ID
            );

          if (validated.openrouterApiKey.trim()) {
            await this.authSecretsService.setProviderKey(
              targetProviderId,
              validated.openrouterApiKey
            );
          } else {
            // Empty string = clear the provider's key
            await this.authSecretsService.deleteProviderKey(targetProviderId);
          }

          // Invalidate model cache so next fetch uses the new key
          this.providerModels.clearCache(targetProviderId);
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
        this.logger.error(
          'RPC: auth:saveSettings failed',
          error instanceof Error ? error : new Error(String(error))
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
  private registerTestConnection(): void {
    this.rpcHandler.registerMethod<
      void,
      { success: boolean; health: unknown; errorMessage?: string }
    >('auth:testConnection', async () => {
      try {
        this.logger.debug('RPC: auth:testConnection called');

        // Retry-poll: check SDK health with exponential backoff
        const MAX_RETRIES = 5;
        const BASE_DELAY_MS = 200;

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));

          const health = this.sdkAdapter.getHealth();
          if (health.status === 'available') {
            const result = {
              success: true,
              health,
              errorMessage: undefined,
            };
            this.logger.info('RPC: auth:testConnection completed', {
              result,
              attempt: attempt + 1,
            });
            return result;
          }

          this.logger.debug(
            `RPC: auth:testConnection attempt ${attempt + 1}/${MAX_RETRIES}`,
            { status: health.status, delay }
          );
        }

        // Exhausted retries -- return last health check
        const finalHealth = this.sdkAdapter.getHealth();
        const result = {
          success: finalHealth.status === 'available',
          health: finalHealth,
          errorMessage: finalHealth.errorMessage || 'Connection test timed out',
        };

        this.logger.info(
          'RPC: auth:testConnection completed (exhausted retries)',
          { result }
        );
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

  /**
   * auth:copilotLogin - Trigger GitHub OAuth login for Copilot provider
   *
   * TASK_2025_186: Initiates the VS Code GitHub authentication flow,
   * exchanges the token for a Copilot bearer token, and returns the
   * connected username.
   */
  private registerCopilotLogin(): void {
    this.rpcHandler.registerMethod<
      Record<string, never>,
      { success: boolean; username?: string; error?: string }
    >('auth:copilotLogin', async () => {
      try {
        this.logger.debug('RPC: auth:copilotLogin called');

        const loginSuccess = await this.copilotAuth.login();

        if (!loginSuccess) {
          return {
            success: false,
            error:
              'GitHub login failed. Ensure you have an active GitHub Copilot subscription.',
          };
        }

        // Extract username from the GitHub auth session
        const username = await this.getGitHubUsername();

        this.logger.info('RPC: auth:copilotLogin succeeded', { username });
        return { success: true, username };
      } catch (error) {
        this.logger.error(
          'RPC: auth:copilotLogin failed',
          error instanceof Error ? error : new Error(String(error))
        );
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Login failed',
        };
      }
    });
  }

  /**
   * auth:copilotStatus - Check if Copilot is already authenticated
   *
   * TASK_2025_186: Returns current authentication state without
   * triggering a login flow.
   */
  private registerCopilotStatus(): void {
    this.rpcHandler.registerMethod<
      Record<string, never>,
      { authenticated: boolean; username?: string }
    >('auth:copilotStatus', async () => {
      try {
        this.logger.debug('RPC: auth:copilotStatus called');

        const authenticated = await this.copilotAuth.isAuthenticated();

        if (!authenticated) {
          return { authenticated: false };
        }

        const username = await this.getGitHubUsername();

        this.logger.debug('RPC: auth:copilotStatus result', {
          authenticated,
          username,
        });
        return { authenticated: true, username };
      } catch (error) {
        this.logger.error(
          'RPC: auth:copilotStatus failed',
          error instanceof Error ? error : new Error(String(error))
        );
        return { authenticated: false };
      }
    });
  }

  /**
   * Retrieve the GitHub username from VS Code's authentication session.
   * Returns undefined if no active session is found.
   */
  private async getGitHubUsername(): Promise<string | undefined> {
    try {
      const session = await vscode.authentication.getSession(
        'github',
        ['copilot'],
        { createIfNone: false }
      );
      return session?.account.label;
    } catch {
      // Fallback: try read:user scope
      try {
        const session = await vscode.authentication.getSession(
          'github',
          ['read:user'],
          { createIfNone: false }
        );
        return session?.account.label;
      } catch {
        return undefined;
      }
    }
  }
}
