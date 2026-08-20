/**
 * Auth RPC Handlers
 *
 * Handles authentication-related RPC methods: auth:getHealth, auth:saveSettings,
 * auth:testConnection, auth:getAuthStatus.
 */

import { injectable, inject } from 'tsyringe';
import {
  Logger,
  RpcHandler,
  TOKENS,
  ConfigManager,
  IAuthSecretsService,
} from '@ptah-extension/vscode-core';
import type {
  SentryService,
  WebviewManager,
} from '@ptah-extension/vscode-core';
import type {
  IPlatformCommands,
  IPlatformAuthProvider,
} from '@ptah-extension/platform-core';
import {
  SdkAgentAdapter,
  SDK_TOKENS,
  getAllAnthropicProviders,
  DEFAULT_PROVIDER_ID,
  getAnthropicProvider,
  TIER_ENV_VAR_MAP,
  ClaudeCliDetector,
} from '@ptah-extension/agent-sdk';
import {
  ProviderModelsService,
  ActiveProviderResolver,
  AUTH_PROVIDERS_TOKENS,
} from '@ptah-extension/auth-providers';
import type {
  CopilotAuthService,
  CopilotDeviceLoginInfo,
  ICodexAuthService,
} from '@ptah-extension/auth-providers';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type { AuthDeviceCodePayload } from '@ptah-extension/shared';
import { asAuthCommandRunner } from './auth-command-runner';
import {
  SETTINGS_TOKENS,
  WorkspaceScopeResolver,
} from '@ptah-extension/settings-core';
import { resolveAuthProviderKey } from '@ptah-extension/platform-core';
import {
  AuthGetAuthStatusParams,
  AuthGetAuthStatusResponse,
} from '@ptah-extension/shared';
import type {
  AuthGetScopeResult,
  AuthClearWorkspaceOverrideResult,
} from '@ptah-extension/shared';
import { AuthSettingsSchema } from './auth-rpc.schema';
import type { RpcMethodName } from '@ptah-extension/shared';

/** Provider registry ids used to tag interactive-login push events. */
const COPILOT_PROVIDER_ID = 'github-copilot';
const CODEX_PROVIDER_ID = 'openai-codex';

function resolveScopeFromKey(
  effectiveKey: string,
  globalKey: string,
): { scope: 'global' | 'app' | 'workspace'; runtime?: string } {
  if (effectiveKey === globalKey) {
    return { scope: 'global' };
  }
  const appMatch = /^app\.([^.]+)\.(.*)$/.exec(effectiveKey);
  if (appMatch) {
    const runtime = appMatch[1];
    const rest = appMatch[2];
    if (rest.startsWith('workspace.')) {
      return { scope: 'workspace', runtime };
    }
    return { scope: 'app', runtime };
  }
  if (effectiveKey.startsWith('workspace.')) {
    return { scope: 'workspace' };
  }
  return { scope: 'global' };
}

/**
 * RPC handlers for authentication operations
 */
@injectable()
export class AuthRpcHandlers {
  static readonly METHODS = [
    'auth:getHealth',
    'auth:getAuthStatus',
    'auth:getStatus',
    'auth:saveSettings',
    'auth:setApiKey',
    'auth:testConnection',
    'auth:copilotLogin',
    'auth:copilotLogout',
    'auth:copilotStatus',
    'auth:codexLogin',
    'auth:getApiKeyStatus',
    'auth:getScope',
    'auth:clearWorkspaceOverride',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(TOKENS.CONFIG_MANAGER)
    private readonly configManager: ConfigManager,
    @inject(TOKENS.AUTH_SECRETS_SERVICE)
    private readonly authSecretsService: IAuthSecretsService,
    @inject(SDK_TOKENS.SDK_AGENT_ADAPTER)
    private readonly sdkAdapter: SdkAgentAdapter,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_MODELS)
    private readonly providerModels: ProviderModelsService,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_ACTIVE_PROVIDER_RESOLVER)
    private readonly activeProviderResolver: ActiveProviderResolver,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_COPILOT_AUTH)
    private readonly copilotAuth: CopilotAuthService,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_CODEX_AUTH)
    private readonly codexAuth: ICodexAuthService,
    @inject(TOKENS.PLATFORM_COMMANDS)
    private readonly platformCommands: IPlatformCommands,
    @inject(TOKENS.PLATFORM_AUTH_PROVIDER)
    private readonly platformAuth: IPlatformAuthProvider,
    @inject(SDK_TOKENS.SDK_CLI_DETECTOR)
    private readonly cliDetector: ClaudeCliDetector,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
    @inject(SETTINGS_TOKENS.WORKSPACE_SCOPE_RESOLVER)
    private readonly scopeResolver: WorkspaceScopeResolver,
    /**
     * Optional: absent in unit harnesses and in any host that has not wired a
     * webview manager. Used only to broadcast interactive-login progress
     * (`auth:deviceCode`, `auth:loginOutput`) — never load-bearing for the RPC
     * result itself.
     */
    @inject(TOKENS.WEBVIEW_MANAGER, { isOptional: true })
    private readonly webviewManager?: WebviewManager,
  ) {}

  /**
   * Register all auth RPC methods
   */
  register(): void {
    this.registerGetHealth();
    this.registerGetAuthStatus();
    this.registerGetStatus();
    this.registerSaveSettings();
    this.registerSetApiKey();
    this.registerTestConnection();
    this.registerCopilotLogin();
    this.registerCopilotLogout();
    this.registerCopilotStatus();
    this.registerCodexLogin();
    this.registerGetApiKeyStatus();
    this.registerGetScope();
    this.registerClearWorkspaceOverride();

    this.logger.debug('Auth RPC handlers registered', {
      methods: [
        'auth:getHealth',
        'auth:getAuthStatus',
        'auth:getStatus',
        'auth:saveSettings',
        'auth:setApiKey',
        'auth:testConnection',
        'auth:copilotLogin',
        'auth:copilotLogout',
        'auth:copilotStatus',
        'auth:codexLogin',
        'auth:getApiKeyStatus',
        'auth:getScope',
        'auth:clearWorkspaceOverride',
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
          this.sentryService.captureException(
            error instanceof Error ? error : new Error(String(error)),
            { errorSource: 'AuthRpcHandlers.registerGetHealth' },
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
        const safeParams: AuthGetAuthStatusParams = params ?? {};
        const hasApiKey = await this.authSecretsService.hasCredential('apiKey');
        const active = this.activeProviderResolver.resolveActiveAuth();
        const authMethod = active.authMethod;
        const anthropicProviderId = active.providerId;
        const checkProviderId = safeParams.providerId || anthropicProviderId;
        const hasOpenRouterKey =
          await this.authSecretsService.hasProviderKey(checkProviderId);
        let hasAnyProviderKey = hasOpenRouterKey;
        // Merged list — built-ins plus user-defined entries. A custom provider
        // holding the only configured key must still flip this flag.
        const allProviders = getAllAnthropicProviders();
        if (!hasAnyProviderKey) {
          for (const p of allProviders) {
            if (await this.authSecretsService.hasProviderKey(p.id)) {
              hasAnyProviderKey = true;
              break;
            }
          }
        }
        // The read model behind BOTH the webview tile grid and the TUI tile
        // list. Sourcing it from the static array is what made user-defined
        // entries invisible everywhere at once.
        const availableProviders = allProviders.map((p) => ({
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
          supportsOptionalApiKey:
            'supportsOptionalApiKey' in p
              ? p.supportsOptionalApiKey
              : undefined,
          // Ambient-credential providers (claude-cli). Without this the tile
          // is indistinguishable from a local server in this payload, which is
          // how the TUI came to render it with a fabricated localhost endpoint.
          nativeAuth: 'nativeAuth' in p ? p.nativeAuth : undefined,
        }));
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
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'AuthRpcHandlers.registerGetAuthStatus' },
        );
        throw error;
      }
    });
  }

  /**
   * auth:saveSettings - Save authentication settings
   */
  private registerSaveSettings(): void {
    this.rpcHandler.registerMethod<
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
        this.logger.debug('RPC: auth:saveSettings called', {
          params: sanitizedParams,
        });
        const validated = AuthSettingsSchema.parse(params);
        const applyTo: 'global' | 'app' | 'workspace' =
          validated.applyTo ?? 'global';
        await this.scopeResolver.write(
          'authMethod',
          validated.authMethod,
          applyTo,
          true,
        );
        await this.scopeResolver.clearMoreSpecific('authMethod', applyTo, true);
        if (validated.anthropicApiKey !== undefined) {
          if (validated.anthropicApiKey.trim()) {
            await this.authSecretsService.setCredential(
              'apiKey',
              validated.anthropicApiKey,
            );
          } else {
            await this.authSecretsService.deleteCredential('apiKey');
          }
        }
        if (validated.providerApiKey !== undefined) {
          const targetProviderId =
            validated.anthropicProviderId ??
            this.scopeResolver.read<string>('anthropicProviderId', true) ??
            DEFAULT_PROVIDER_ID;

          if (validated.providerApiKey.trim()) {
            await this.authSecretsService.setProviderKey(
              targetProviderId,
              validated.providerApiKey,
            );
          } else {
            await this.authSecretsService.deleteProviderKey(targetProviderId);
          }
          this.providerModels.clearCache(targetProviderId);
        }
        if (validated.anthropicProviderId !== undefined) {
          await this.scopeResolver.write(
            'anthropicProviderId',
            validated.anthropicProviderId,
            applyTo,
            true,
          );
          await this.scopeResolver.clearMoreSpecific(
            'anthropicProviderId',
            applyTo,
            true,
          );
          await this.autoMapProviderTiers(validated.anthropicProviderId);
        }
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
        this.sentryService.captureException(
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
  private registerTestConnection(): void {
    this.rpcHandler.registerMethod<
      void,
      { success: boolean; health: unknown; errorMessage?: string }
    >('auth:testConnection', async () => {
      try {
        this.logger.debug('RPC: auth:testConnection called');
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
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'AuthRpcHandlers.registerTestConnection' },
        );
        throw error;
      }
    });
  }

  /**
   * auth:copilotLogin - Trigger GitHub OAuth login for Copilot provider.
   *
   * Initiates the VS Code GitHub authentication flow,
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

        // The device-code flow blocks inside `login()` for up to five minutes.
        // Broadcasting the code the moment it exists is the only way a surface
        // without a message dialog (the TUI) can show the user what to do —
        // `showInformationMessage` still fires for VS Code / Electron.
        const loginSuccess = await this.copilotAuth.login({
          onDeviceCode: (info) => this.broadcastDeviceCode(info),
        });

        if (!loginSuccess) {
          return {
            success: false,
            error:
              'GitHub login failed. Ensure you have an active GitHub Copilot subscription.',
          };
        }
        const username = await this.getGitHubUsername();
        await this.autoMapProviderTiers('github-copilot');
        await this.sdkAdapter.reset();

        this.logger.info('RPC: auth:copilotLogin succeeded', { username });
        return { success: true, username };
      } catch (error) {
        this.logger.error(
          'RPC: auth:copilotLogin failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'AuthRpcHandlers.registerCopilotLogin' },
        );
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Login failed',
        };
      }
    });
  }

  /**
   * auth:copilotLogout - Disconnect GitHub Copilot in Ptah.
   *
   * Clears the in-memory Copilot auth state AND persists a Ptah-side logout
   * tombstone so the next `configure()` does not silently re-authenticate from
   * the shared `~/.config/github-copilot/hosts.json`. That file is left alone
   * on purpose — it belongs to the user's editor Copilot integrations too.
   */
  private registerCopilotLogout(): void {
    this.rpcHandler.registerMethod<Record<string, never>, { success: boolean }>(
      'auth:copilotLogout',
      async () => {
        try {
          this.logger.debug('RPC: auth:copilotLogout called');
          // MUST be awaited: logout() persists a logout tombstone to the
          // settings store (TASK_2026_172 Issue 2). Fire-and-forget would
          // report success before the write landed and could lose it entirely
          // if the host exited right after.
          await this.copilotAuth.logout();
          this.logger.info('RPC: auth:copilotLogout succeeded');
          return { success: true };
        } catch (error) {
          this.logger.error(
            'RPC: auth:copilotLogout failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          this.sentryService.captureException(
            error instanceof Error ? error : new Error(String(error)),
            { errorSource: 'AuthRpcHandlers.registerCopilotLogout' },
          );
          return { success: false };
        }
      },
    );
  }

  /**
   * auth:copilotStatus - Check if Copilot is already authenticated
   *
   * Returns current authentication state without
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
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'AuthRpcHandlers.registerCopilotStatus' },
        );
        return { authenticated: false };
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
  private registerSetApiKey(): void {
    this.rpcHandler.registerMethod<
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
        if (params.apiKey?.trim()) {
          await this.authSecretsService.setProviderKey(
            params.provider,
            params.apiKey,
          );
        } else {
          await this.authSecretsService.deleteProviderKey(params.provider);
        }
        this.providerModels.clearCache(params.provider);
        return { success: true };
      } catch (error) {
        this.logger.error(
          'RPC: auth:setApiKey failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'AuthRpcHandlers.registerSetApiKey' },
        );
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });
  }

  /**
   * auth:getStatus - Compact auth status for the active Anthropic provider.
   *
   * Lifted from
   * `apps/ptah-electron/src/services/rpc/handlers/config-extended-rpc.handlers.ts`.
   * Distinct from `auth:getAuthStatus` (which returns full provider list +
   * Copilot/Codex/Claude CLI flags); this method is the lightweight check
   * the Electron renderer uses on startup.
   */
  private registerGetStatus(): void {
    this.rpcHandler.registerMethod<
      Record<string, never>,
      { isAuthenticated: boolean; provider: string; hasApiKey: boolean }
    >('auth:getStatus', async () => {
      try {
        const provider = this.configManager.getWithDefault<string>(
          'anthropicProviderId',
          DEFAULT_PROVIDER_ID,
        );
        const hasApiKey =
          await this.authSecretsService.hasProviderKey(provider);
        return { isAuthenticated: hasApiKey, provider, hasApiKey };
      } catch (error) {
        this.logger.error(
          'RPC: auth:getStatus failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        this.sentryService.captureException(
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
   * auth:getApiKeyStatus - List all providers with their key presence
   *
   * Lifted from
   * `apps/ptah-electron/src/services/rpc/handlers/config-extended-rpc.handlers.ts`
   * so all three apps (VS Code, Electron, CLI) consume it via
   * `registerAllRpcHandlers()`. Body is a verbatim port; the only mechanical
   * change is `container.resolve<...>(...)` → `this.<field>` (constructor-injected).
   */
  private registerGetApiKeyStatus(): void {
    this.rpcHandler.registerMethod<
      Record<string, never>,
      {
        providers: Array<{
          provider: string;
          displayName: string;
          hasApiKey: boolean;
          isDefault: boolean;
        }>;
      }
    >('auth:getApiKeyStatus', async () => {
      try {
        const activeProvider = this.configManager.getWithDefault<string>(
          'anthropicProviderId',
          DEFAULT_PROVIDER_ID,
        );
        const providers = await Promise.all(
          getAllAnthropicProviders().map(async (p) => ({
            provider: p.id,
            displayName: p.name,
            hasApiKey: await this.authSecretsService.hasProviderKey(p.id),
            isDefault: p.id === activeProvider,
          })),
        );
        return { providers };
      } catch (error) {
        this.logger.error(
          'RPC: auth:getApiKeyStatus failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'AuthRpcHandlers.registerGetApiKeyStatus' },
        );
        return { providers: [] };
      }
    });
  }

  /**
   * auth:codexLogin - Start the external `codex login --device-auth` flow.
   *
   * Two paths, selected by platform capability (see `auth-command-runner.ts`):
   *
   * 1. The platform can run the command itself (`IAuthCommandRunner`, i.e. the
   *    CLI/TUI runtime). The command is spawned, its output is streamed to the
   *    UI as `auth:loginOutput` / `auth:deviceCode` push events, and `success`
   *    reflects the real exit code.
   * 2. The platform has a terminal (VS Code). Unchanged historical behaviour:
   *    hand the command to `openTerminal` and report success — the user drives
   *    it from there and the outcome is not observable here.
   */
  private registerCodexLogin(): void {
    this.rpcHandler.registerMethod<void, { success: boolean; error?: string }>(
      'auth:codexLogin',
      async () => {
        const command = 'codex login --device-auth';
        const runner = asAuthCommandRunner(this.platformCommands);

        if (!runner) {
          this.logger.info('RPC: auth:codexLogin - opening terminal');
          this.platformCommands.openTerminal('Codex Login', command);
          return { success: true };
        }

        this.logger.info('RPC: auth:codexLogin - running command in-process');
        try {
          const result = await runner.runAuthCommand({
            provider: CODEX_PROVIDER_ID,
            name: 'Codex Login',
            command,
          });
          if (!result.success) {
            this.logger.warn(
              `RPC: auth:codexLogin failed (exit ${String(result.exitCode)})`,
            );
            return {
              success: false,
              error: result.error ?? 'codex login did not complete.',
            };
          }
          this.codexAuth.clearCache();
          await this.sdkAdapter.reset();
          return { success: true };
        } catch (error) {
          this.logger.error(
            'RPC: auth:codexLogin failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          this.sentryService.captureException(
            error instanceof Error ? error : new Error(String(error)),
            { errorSource: 'AuthRpcHandlers.registerCodexLogin' },
          );
          return { success: false, error: 'Failed to start Codex login.' };
        }
      },
    );
  }

  /**
   * Broadcast a provider device code to every attached surface. Best-effort:
   * a missing webview manager or a rejected send must never fail the login.
   */
  private broadcastDeviceCode(info: CopilotDeviceLoginInfo): void {
    const payload: AuthDeviceCodePayload = {
      provider: COPILOT_PROVIDER_ID,
      userCode: info.userCode,
      verificationUri: info.verificationUri,
      expiresInSeconds: info.expiresIn,
    };
    void this.webviewManager
      ?.broadcastMessage(MESSAGE_TYPES.AUTH_DEVICE_CODE, payload)
      .catch((error: unknown) => {
        this.logger.warn(
          `Failed to broadcast ${MESSAGE_TYPES.AUTH_DEVICE_CODE}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
  }

  /**
   * auth:getScope - Report whether the active workspace overrides auth/provider
   * settings or inherits the global defaults.
   */
  private registerGetScope(): void {
    this.rpcHandler.registerMethod<Record<string, never>, AuthGetScopeResult>(
      'auth:getScope',
      async () => {
        try {
          const activePath = this.scopeResolver.getActivePath() ?? null;
          const authMethodKey = this.scopeResolver.effectiveKey(
            'authMethod',
            true,
          );
          const providerKey = this.scopeResolver.effectiveKey(
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
          const runtime =
            authMethodResolved.runtime ?? providerResolved.runtime;
          return {
            authMethodScope: authMethodResolved.scope,
            providerScope: providerResolved.scope,
            activePath,
            ...(runtime !== undefined ? { runtime } : {}),
          };
        } catch (error) {
          this.logger.error(
            'RPC: auth:getScope failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          this.sentryService.captureException(
            error instanceof Error ? error : new Error(String(error)),
            { errorSource: 'AuthRpcHandlers.registerGetScope' },
          );
          throw error;
        }
      },
    );
  }

  /**
   * auth:clearWorkspaceOverride - Drop the active workspace's overrides for
   * authMethod, anthropicProviderId, and the active provider's model + effort
   * keys, reverting them to the global defaults.
   */
  private registerClearWorkspaceOverride(): void {
    this.rpcHandler.registerMethod<
      Record<string, never>,
      AuthClearWorkspaceOverrideResult
    >('auth:clearWorkspaceOverride', async () => {
      try {
        const authMethod =
          this.scopeResolver.read<string>('authMethod', true) ?? 'apiKey';
        const providerId =
          this.scopeResolver.read<string>('anthropicProviderId', true) ?? '';
        const authKey = resolveAuthProviderKey(authMethod, providerId);

        await this.scopeResolver.clearOverride('authMethod', true);
        await this.scopeResolver.clearOverride('anthropicProviderId', true);
        await this.scopeResolver.clearOverride(
          `provider.${authKey}.selectedModel`,
          true,
        );
        await this.scopeResolver.clearOverride(
          `provider.${authKey}.reasoningEffort`,
          true,
        );

        await this.sdkAdapter.reset();

        return { success: true };
      } catch (error) {
        this.logger.error(
          'RPC: auth:clearWorkspaceOverride failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'AuthRpcHandlers.registerClearWorkspaceOverride' },
        );
        throw error;
      }
    });
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
      const currentTiers = this.providerModels.getModelTiers(
        providerId,
        'mainAgent',
      );
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
              'mainAgent',
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
   * Delegates to IPlatformAuthProvider instead of vscode.authentication.
   */
  private async getGitHubUsername(): Promise<string | undefined> {
    return this.platformAuth.getGitHubUsername();
  }
}
