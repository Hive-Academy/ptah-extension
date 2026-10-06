/**
 * Auth RPC Handlers
 *
 * Handles authentication-related RPC methods: auth:getHealth, auth:saveSettings,
 * auth:testConnection, auth:getAuthStatus.
 *
 * This class is the DI-facing composition root of the `auth:*` family: it owns
 * the constructor signature, the method list and registration order, and hands
 * each group of methods to a focused collaborator under `./auth/`.
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
  ClaudeCliDetector,
} from '@ptah-extension/agent-sdk';
import type { SdkAdapterEvents } from '@ptah-extension/agent-sdk';
import {
  ProviderModelsService,
  ActiveProviderResolver,
  DraftVerificationService,
  AUTH_PROVIDERS_TOKENS,
} from '@ptah-extension/auth-providers';
import type {
  CopilotAuthService,
  ICodexAuthService,
  ModelResolver,
} from '@ptah-extension/auth-providers';
import {
  SETTINGS_TOKENS,
  WorkspaceScopeResolver,
} from '@ptah-extension/settings-core';
import type { RpcMethodName } from '@ptah-extension/shared';
import { ConnectionCheckRecorder } from '../utils/connection-check-recorder';
import { ConnectionChecker } from './connection-check';
import { ApiKeyMethods } from './auth/api-key-methods';
import { AuthStatusCache } from './auth/auth-status-cache';
import { AuthStatusMethods } from './auth/auth-status-methods';
import { AuthStatusProbes } from './auth/auth-status-probes';
import { ConnectionSettingsMethods } from './auth/connection-settings-methods';
import { DraftVerificationMethods } from './auth/draft-verification-methods';
import { EffectiveRouteMethod } from './auth/effective-route-method';
import { InteractiveLoginMethods } from './auth/interactive-login-methods';
import { WorkspaceScopeMethods } from './auth/workspace-scope-methods';

/**
 * RPC handlers for authentication operations
 */
@injectable()
export class AuthRpcHandlers {
  static readonly METHODS = [
    'auth:getHealth',
    'auth:getAuthStatus',
    'auth:getEffectiveRoute',
    'auth:checkConnection',
    'auth:getStatus',
    'auth:saveSettings',
    'auth:setApiKey',
    'auth:deleteStoredKey',
    'auth:testConnection',
    'auth:copilotLogin',
    'auth:copilotLogout',
    'auth:copilotStatus',
    'auth:codexLogin',
    'auth:getApiKeyStatus',
    'auth:getScope',
    'auth:clearWorkspaceOverride',
    'auth:verifyDraftConnection',
    'auth:cancelDraftVerification',
  ] as const satisfies readonly RpcMethodName[];

  /** Single owner of the `auth:getAuthStatus` cache, generation and Claude-CLI memo. */
  private readonly statusCache: AuthStatusCache;

  /** Runs `auth:checkConnection`; see `connection-check.ts`. */
  private readonly connectionChecker: ConnectionChecker;

  private readonly statusMethods: AuthStatusMethods;
  private readonly effectiveRouteMethod: EffectiveRouteMethod;
  private readonly connectionSettingsMethods: ConnectionSettingsMethods;
  private readonly apiKeyMethods: ApiKeyMethods;
  private readonly interactiveLoginMethods: InteractiveLoginMethods;
  private readonly workspaceScopeMethods: WorkspaceScopeMethods;
  private readonly draftVerificationMethods: DraftVerificationMethods;

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
    @inject(AUTH_PROVIDERS_TOKENS.SDK_DRAFT_VERIFICATION)
    private readonly draftVerification: DraftVerificationService,
    /** Last explicit check per connection (registered in `registerSharedRpcHandlers`). */
    @inject(ConnectionCheckRecorder)
    private readonly connectionChecks: ConnectionCheckRecorder,
    /**
     * Optional: absent in unit harnesses and in any host that has not wired a
     * webview manager. Used only to broadcast interactive-login progress
     * (`auth:deviceCode`, `auth:loginOutput`) — never load-bearing for the RPC
     * result itself.
     */
    @inject(TOKENS.WEBVIEW_MANAGER, { isOptional: true })
    private readonly webviewManager?: WebviewManager,
    /**
     * Optional: absent in unit harnesses. Used only to learn that
     * `~/.codex/auth.json` changed under us (an external `codex login`) so the
     * status cache can be dropped immediately instead of waiting out its TTL.
     */
    @inject(SDK_TOKENS.SDK_ADAPTER_EVENTS, { isOptional: true })
    private readonly adapterEvents?: SdkAdapterEvents,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_MODEL_RESOLVER, { isOptional: true })
    private readonly modelResolver?: ModelResolver,
  ) {
    this.connectionChecker = new ConnectionChecker({
      recorder: connectionChecks,
      draftVerification,
      copilotAuth,
      codexAuth,
      cliDetector,
      readProviderKey: (id) => authSecretsService.getProviderKey(id),
      logger,
    });

    // Every mutating method goes through the public entry point, so the
    // invalidation stays observable on this instance.
    const invalidateAuthStatusCache = (): void =>
      this.invalidateAuthStatusCache();

    this.statusCache = new AuthStatusCache({
      logger,
      scopeResolver,
      activeProviderResolver,
      cliDetector,
      probes: new AuthStatusProbes({
        logger,
        sentryService,
        authSecretsService,
        copilotAuth,
        codexAuth,
        platformAuth,
      }),
    });
    this.statusMethods = new AuthStatusMethods({
      logger,
      rpcHandler,
      sentryService,
      sdkAdapter,
      statusCache: this.statusCache,
    });
    this.effectiveRouteMethod = new EffectiveRouteMethod({
      logger,
      rpcHandler,
      configManager,
      scopeResolver,
      connectionChecks,
      statusCache: this.statusCache,
      invalidateAuthStatusCache,
      modelResolver,
    });
    this.connectionSettingsMethods = new ConnectionSettingsMethods({
      logger,
      rpcHandler,
      sentryService,
      sdkAdapter,
      scopeResolver,
      authSecretsService,
      providerModels,
      connectionChecks,
      connectionChecker: this.connectionChecker,
      invalidateAuthStatusCache,
    });
    this.apiKeyMethods = new ApiKeyMethods({
      logger,
      rpcHandler,
      sentryService,
      configManager,
      authSecretsService,
      providerModels,
      connectionChecks,
      invalidateAuthStatusCache,
    });
    this.interactiveLoginMethods = new InteractiveLoginMethods({
      logger,
      rpcHandler,
      sentryService,
      sdkAdapter,
      providerModels,
      copilotAuth,
      codexAuth,
      platformCommands,
      platformAuth,
      invalidateAuthStatusCache,
      webviewManager,
    });
    this.workspaceScopeMethods = new WorkspaceScopeMethods({
      logger,
      rpcHandler,
      sentryService,
      sdkAdapter,
      scopeResolver,
      invalidateAuthStatusCache,
    });
    this.draftVerificationMethods = new DraftVerificationMethods({
      logger,
      rpcHandler,
      sentryService,
      draftVerification,
    });
  }

  /**
   * Register all auth RPC methods
   */
  register(): void {
    this.statusMethods.registerGetHealth();
    this.statusMethods.registerGetAuthStatus();
    this.effectiveRouteMethod.registerGetEffectiveRoute();
    this.connectionSettingsMethods.registerCheckConnection();
    this.apiKeyMethods.registerGetStatus();
    this.connectionSettingsMethods.registerSaveSettings();
    this.apiKeyMethods.registerSetApiKey();
    this.apiKeyMethods.registerDeleteStoredKey();
    this.connectionSettingsMethods.registerTestConnection();
    this.interactiveLoginMethods.registerCopilotLogin();
    this.interactiveLoginMethods.registerCopilotLogout();
    this.interactiveLoginMethods.registerCopilotStatus();
    this.interactiveLoginMethods.registerCodexLogin();
    this.apiKeyMethods.registerGetApiKeyStatus();
    this.workspaceScopeMethods.registerGetScope();
    this.workspaceScopeMethods.registerClearWorkspaceOverride();
    this.draftVerificationMethods.registerVerifyDraftConnection();
    this.draftVerificationMethods.registerCancelDraftVerification();

    // An external `codex login` changes the answer without going through any
    // method here, so the TTL is the only thing that would eventually notice.
    this.adapterEvents?.onAuthFileChanged(() =>
      this.invalidateAuthStatusCache(),
    );

    this.logger.debug('Auth RPC handlers registered', {
      methods: [
        'auth:getHealth',
        'auth:getAuthStatus',
        'auth:checkConnection',
        'auth:getStatus',
        'auth:saveSettings',
        'auth:setApiKey',
        'auth:deleteStoredKey',
        'auth:testConnection',
        'auth:copilotLogin',
        'auth:copilotLogout',
        'auth:copilotStatus',
        'auth:codexLogin',
        'auth:getApiKeyStatus',
        'auth:getScope',
        'auth:clearWorkspaceOverride',
        'auth:verifyDraftConnection',
        'auth:cancelDraftVerification',
      ],
    });
  }

  /**
   * Drop every cached auth answer. MUST be called by any method that mutates
   * auth state — otherwise the UI keeps reading the pre-change payload for up
   * to the status TTL after a login, logout or key write.
   *
   * See `AuthStatusCache.invalidate` for why this also bumps the generation.
   */
  invalidateAuthStatusCache(): void {
    this.statusCache.invalidate();
  }
}
