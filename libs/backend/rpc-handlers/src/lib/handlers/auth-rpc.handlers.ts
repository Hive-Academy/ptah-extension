/**
 * Auth RPC Handlers
 *
 * Handles authentication-related RPC methods: auth:getHealth, auth:saveSettings,
 * auth:testConnection, auth:getAuthStatus
 *
 * TASK_2025_074: Extracted from monolithic RpcMethodRegistrationService
 * TASK_2025_076: SecretStorage integration for secure credential storage
 * TASK_2025_203: Moved to @ptah-extension/rpc-handlers (replaced vscode.window/auth with platform abstractions)
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
import type {
  IPlatformCommands,
  IPlatformAuthProvider,
} from '../platform-abstractions';
import {
  SdkAgentAdapter,
  SDK_TOKENS,
  ANTHROPIC_PROVIDERS,
  DEFAULT_PROVIDER_ID,
  ProviderModelsService,
  getAnthropicProvider,
  TIER_ENV_VAR_MAP,
  ClaudeCliDetector,
} from '@ptah-extension/agent-sdk';
import type {
  CopilotAuthService,
  ICodexAuthService,
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
    @inject(SDK_TOKENS.SDK_AGENT_ADAPTER)
    private readonly sdkAdapter: SdkAgentAdapter,
    @inject(SDK_TOKENS.SDK_PROVIDER_MODELS)
    private readonly providerModels: ProviderModelsService,
    @inject(SDK_TOKENS.SDK_COPILOT_AUTH)
    private readonly copilotAuth: CopilotAuthService,
    @inject(SDK_TOKENS.SDK_CODEX_AUTH)
    private readonly codexAuth: ICodexAuthService,
    @inject(TOKENS.PLATFORM_COMMANDS)
    private readonly platformCommands: IPlatformCommands,
    @inject(TOKENS.PLATFORM_AUTH_PROVIDER)
    private readonly platformAuth: IPlatformAuthProvider,
    @inject(SDK_TOKENS.SDK_CLI_DETECTOR)
    private readonly cliDetector: ClaudeCliDetector,
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
    this.registerCopilotLogout();
    this.registerCopilotStatus();
    this.registerCodexLogin();

    this.logger.debug('Auth RPC handlers registered', {
      methods: [
        'auth:getHealth',
        'auth:getAuthStatus',
        'auth:saveSettings',
        'auth:testConnection',
        'auth:copilotLogin',
        'auth:copilotLogout',
        'auth:copilotStatus',
        'auth:codexLogin',
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
            error instanceof Error ? error : new Error(String(error)),
          );
          throw error;
        }
      },
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

        // Guard against undefined params: TUI callers pass no params at all.
        const safeParams: AuthGetAuthStatusParams = params ?? {};

        // Check SecretStorage for credentials
        const hasApiKey = await this.authSecretsService.hasCredential('apiKey');

        // Get auth method from ConfigManager (non-sensitive)
        // Normalize legacy/invalid values (e.g. 'vscode-lm', 'auto') to 'apiKey'
        const rawMethod = this.configManager.get<string>('authMethod');
        const validMethods = [
          'apiKey',
          'claudeCli',
          'thirdParty',
          'openrouter',
        ];
        const authMethod = (
          rawMethod && validMethods.includes(rawMethod)
            ? rawMethod === 'openrouter'
              ? 'thirdParty'
              : rawMethod
            : 'apiKey'
        ) as 'apiKey' | 'claudeCli' | 'thirdParty';

        // TASK_2025_129 Batch 3: Get selected provider ID
        const anthropicProviderId = this.configManager.getWithDefault<string>(
          'anthropicProviderId',
          DEFAULT_PROVIDER_ID,
        );

        // Per-provider key check: use provided ID (for local UI switching) or persisted config
        const checkProviderId = safeParams.providerId || anthropicProviderId;
        const hasOpenRouterKey =
          await this.authSecretsService.hasProviderKey(checkProviderId);

        // TASK_2025_194: Check if ANY provider has a key configured.
        // This supports users who only use third-party providers (z-ai, moonshot, etc.)
        // without Claude/Anthropic auth. The per-provider check above only verifies the
        // currently selected provider, which may miss keys stored for other providers.
        let hasAnyProviderKey = hasOpenRouterKey;
        if (!hasAnyProviderKey) {
          for (const p of ANTHROPIC_PROVIDERS) {
            if (await this.authSecretsService.hasProviderKey(p.id)) {
              hasAnyProviderKey = true;
              break;
            }
          }
        }

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
          authType: 'authType' in p ? p.authType : undefined,
          isLocal: 'isLocal' in p ? p.isLocal : undefined,
          baseUrl: p.baseUrl,
        }));

        // Check Copilot auth status (TASK_2025_191)
        // Wrapped in try/catch so Copilot failures don't crash the entire auth status response
        let copilotAuthenticated = false;
        let copilotUsername: string | undefined;
        try {
          copilotAuthenticated = await this.copilotAuth.isAuthenticated();
          if (copilotAuthenticated) {
            copilotUsername = await this.getGitHubUsername();
          }
        } catch (copilotError) {
          this.logger.warn(
            'Copilot auth status check failed (non-fatal)',
            copilotError instanceof Error
              ? copilotError
              : new Error(String(copilotError)),
          );
        }

        // Check Codex auth status (TASK_2025_199)
        // Wrapped in try/catch so Codex failures don't crash the entire auth status response
        let codexAuthenticated = false;
        let codexTokenStale = false;
        try {
          const codexStatus = await this.codexAuth.getTokenStatus();
          codexAuthenticated = codexStatus.authenticated;
          codexTokenStale = codexStatus.stale;
        } catch (codexError) {
          this.logger.warn(
            'Codex auth status check failed (non-fatal)',
            codexError instanceof Error
              ? codexError
              : new Error(String(codexError)),
          );
        }

        // Check Claude CLI availability
        let claudeCliInstalled = false;
        try {
          const cliHealth = await this.cliDetector.performHealthCheck();
          claudeCliInstalled = cliHealth.available;
        } catch (cliError) {
          this.logger.warn(
            'Claude CLI detection failed (non-fatal)',
            cliError instanceof Error ? cliError : new Error(String(cliError)),
          );
        }

        this.logger.debug('RPC: auth:getAuthStatus result', {
          hasApiKey,
          hasOpenRouterKey,
          hasAnyProviderKey,
          authMethod,
          anthropicProviderId,
          copilotAuthenticated,
          codexAuthenticated,
          codexTokenStale,
          claudeCliInstalled,
        });

        return {
          hasApiKey,
          hasOpenRouterKey,
          hasAnyProviderKey,
          authMethod,
          anthropicProviderId,
          availableProviders,
          copilotAuthenticated,
          copilotUsername,
          codexAuthenticated,
          codexTokenStale,
          claudeCliInstalled,
        };
      } catch (error) {
        this.logger.error(
          'RPC: auth:getAuthStatus failed',
          error instanceof Error ? error : new Error(String(error)),
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
      authMethod: z.enum(['apiKey', 'claudeCli', 'thirdParty']),
      anthropicApiKey: z.string().optional(),
      providerApiKey: z.string().optional(),
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
        this.logger.debug('RPC: auth:saveSettings called', {
          params: sanitizedParams,
        });

        // Validate parameters with Zod
        const validated = AuthSettingsSchema.parse(params);

        // Save auth method to ConfigManager (non-sensitive)
        await this.configManager.set('authMethod', validated.authMethod);

        // Save credentials to SecretStorage (encrypted!)
        if (validated.anthropicApiKey !== undefined) {
          if (validated.anthropicApiKey.trim()) {
            await this.authSecretsService.setCredential(
              'apiKey',
              validated.anthropicApiKey,
            );
          } else {
            // Empty string = clear the credential
            await this.authSecretsService.deleteCredential('apiKey');
          }
        }

        // Per-provider API key handling: store key under the selected provider's slot
        // This prevents overwriting keys when switching between providers
        if (validated.providerApiKey !== undefined) {
          const targetProviderId =
            validated.anthropicProviderId ??
            this.configManager.getWithDefault<string>(
              'anthropicProviderId',
              DEFAULT_PROVIDER_ID,
            );

          if (validated.providerApiKey.trim()) {
            await this.authSecretsService.setProviderKey(
              targetProviderId,
              validated.providerApiKey,
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
            validated.anthropicProviderId,
          );

          // Auto-map default tier models on first provider selection
          await this.autoMapProviderTiers(validated.anthropicProviderId);
        }

        // TASK_2025_194: Explicitly await reinit so testConnection sees updated health.
        // Without this, saveSettings returns before reinit completes (fire-and-forget
        // via ConfigWatcher), causing testConnection polls to fail.
        this.logger.info('RPC: auth:saveSettings triggering adapter reset...');
        await this.sdkAdapter.reset();
        this.logger.info('RPC: auth:saveSettings adapter reset completed');

        this.logger.info('RPC: auth:saveSettings completed successfully');
        return { success: true };
      } catch (error) {
        this.logger.error(
          'RPC: auth:saveSettings failed',
          error instanceof Error ? error : new Error(String(error)),
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
            { status: health.status, delay },
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
          { result },
        );
        return result;
      } catch (error) {
        this.logger.error(
          'RPC: auth:testConnection failed',
          error instanceof Error ? error : new Error(String(error)),
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

        // Auto-map default tier models if no mappings exist yet
        await this.autoMapProviderTiers('github-copilot');

        // Clear cached models so they're re-fetched with provider-specific IDs
        await this.sdkAdapter.reset();

        this.logger.info('RPC: auth:copilotLogin succeeded', { username });
        return { success: true, username };
      } catch (error) {
        this.logger.error(
          'RPC: auth:copilotLogin failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Login failed',
        };
      }
    });
  }

  /**
   * auth:copilotLogout - Disconnect GitHub Copilot OAuth
   *
   * TASK_2025_191: Clears the in-memory Copilot auth state.
   */
  private registerCopilotLogout(): void {
    this.rpcHandler.registerMethod<Record<string, never>, { success: boolean }>(
      'auth:copilotLogout',
      async () => {
        try {
          this.logger.debug('RPC: auth:copilotLogout called');
          this.copilotAuth.logout();
          this.logger.info('RPC: auth:copilotLogout succeeded');
          return { success: true };
        } catch (error) {
          this.logger.error(
            'RPC: auth:copilotLogout failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          return { success: false };
        }
      },
    );
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
          error instanceof Error ? error : new Error(String(error)),
        );
        return { authenticated: false };
      }
    });
  }

  /**
   * auth:codexLogin - Open a terminal for the user to run `codex login`
   *
   * TASK_2025_199: Codex authentication is managed externally via the CLI.
   * This handler opens a VS Code terminal with `codex login` pre-typed,
   * making it one-click from the auth settings UI.
   */
  private registerCodexLogin(): void {
    this.rpcHandler.registerMethod<void, { success: boolean }>(
      'auth:codexLogin',
      async () => {
        this.logger.info('RPC: auth:codexLogin - opening terminal');
        this.platformCommands.openTerminal(
          'Codex Login',
          'codex login --device-auth',
        );
        return { success: true };
      },
    );
  }

  /**
   * Auto-map a provider's default tier models on first selection or login.
   * Only sets tiers that haven't been explicitly configured by the user.
   *
   * Reads `defaultTiers` from the provider registry entry. Providers without
   * defaultTiers (e.g., OpenRouter, local providers) are silently skipped.
   */
  private async autoMapProviderTiers(providerId: string): Promise<void> {
    const provider = getAnthropicProvider(providerId);
    if (!provider?.defaultTiers) return;

    try {
      const currentTiers = this.providerModels.getModelTiers(providerId);
      const { defaultTiers } = provider;

      const tierNames = Object.keys(TIER_ENV_VAR_MAP) as Array<
        keyof typeof TIER_ENV_VAR_MAP
      >;
      const promises: Promise<void>[] = [];
      for (const tier of tierNames) {
        if (!currentTiers[tier] && defaultTiers[tier]) {
          promises.push(
            this.providerModels.setModelTier(
              providerId,
              tier,
              defaultTiers[tier],
            ),
          );
        }
      }

      if (promises.length > 0) {
        await Promise.all(promises);
        this.logger.info(`Auto-mapped ${provider.name} default tier models`, {
          mapped: promises.length,
        });
      }
    } catch (error) {
      this.logger.warn(
        `Failed to auto-map ${provider?.name ?? providerId} tier models (non-fatal)`,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * Retrieve the GitHub username from the platform auth provider.
   * Returns undefined if no active session is found.
   * TASK_2025_203: Delegates to IPlatformAuthProvider instead of vscode.authentication
   */
  private async getGitHubUsername(): Promise<string | undefined> {
    return this.platformAuth.getGitHubUsername();
  }
}
