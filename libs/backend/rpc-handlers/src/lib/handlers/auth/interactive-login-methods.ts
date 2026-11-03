import type {
  Logger,
  RpcHandler,
  SentryService,
  WebviewManager,
} from '@ptah-extension/vscode-core';
import type {
  IPlatformAuthProvider,
  IPlatformCommands,
} from '@ptah-extension/platform-core';
import type { SdkAgentAdapter } from '@ptah-extension/agent-sdk';
import type {
  CopilotAuthService,
  CopilotDeviceLoginInfo,
  ICodexAuthService,
  ICodexLoginService,
  ProviderModelsService,
} from '@ptah-extension/auth-providers';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type { AuthDeviceCodePayload, AuthCodexLoginParams, AuthCodexLoginResponse, AuthCodexLoginCancelParams, AuthCodexLoginCancelResponse, CodexLoginState } from '@ptah-extension/shared';
import { asAuthCommandRunner } from '../auth-command-runner';
import { CODEX_PROVIDER_ID, COPILOT_PROVIDER_ID } from './auth-provider-ids';
import { getGitHubUsername } from './github-username';
import { autoMapProviderTiers } from './provider-tier-auto-map';

export interface InteractiveLoginMethodsDeps {
  readonly logger: Logger;
  readonly rpcHandler: RpcHandler;
  readonly sentryService: SentryService;
  readonly sdkAdapter: SdkAgentAdapter;
  readonly providerModels: ProviderModelsService;
  readonly copilotAuth: CopilotAuthService;
  readonly codexAuth: ICodexAuthService;
  readonly platformCommands: IPlatformCommands;
  readonly platformAuth: IPlatformAuthProvider;
  readonly invalidateAuthStatusCache: () => void;
  readonly webviewManager?: WebviewManager;
  readonly codexLogin?: ICodexLoginService;
}

/**
 * Sign-in flows: `auth:copilotLogin`, `auth:copilotLogout`,
 * `auth:copilotStatus` and `auth:codexLogin`.
 */
export class InteractiveLoginMethods {
  constructor(private readonly deps: InteractiveLoginMethodsDeps) {}

  /**
   * auth:copilotLogin - Trigger GitHub OAuth login for Copilot provider.
   *
   * Initiates the VS Code GitHub authentication flow,
   * exchanges the token for a Copilot bearer token, and returns the
   * connected username.
   */
  registerCopilotLogin(): void {
    const { logger, sentryService, sdkAdapter, copilotAuth } = this.deps;
    this.deps.rpcHandler.registerMethod<
      Record<string, never>,
      { success: boolean; username?: string; error?: string }
    >('auth:copilotLogin', async () => {
      try {
        logger.debug('RPC: auth:copilotLogin called');

        // The device-code flow blocks inside `login()` for up to five minutes.
        // Broadcasting the code the moment it exists is the only way a surface
        // without a message dialog (the TUI) can show the user what to do —
        // `showInformationMessage` still fires for VS Code / Electron.
        const loginSuccess = await copilotAuth.login({
          onDeviceCode: (info) => this.broadcastDeviceCode(info),
        });

        if (!loginSuccess) {
          return {
            success: false,
            error:
              'GitHub login failed. Ensure you have an active GitHub Copilot subscription.',
          };
        }
        const username = await getGitHubUsername(this.deps.platformAuth);
        await autoMapProviderTiers(
          this.deps.providerModels,
          logger,
          'github-copilot',
        );
        await sdkAdapter.reset();
        this.deps.invalidateAuthStatusCache();

        logger.info('RPC: auth:copilotLogin succeeded', { username });
        return { success: true, username };
      } catch (error) {
        logger.error(
          'RPC: auth:copilotLogin failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'AuthRpcHandlers.registerCopilotLogin' },
        );
        // Fixed copy: a thrown error's text can carry tokens or local paths.
        // The known user-actionable outcomes (device code expired, access
        // denied) resolve `false` above and never reach this catch.
        return {
          success: false,
          error: 'GitHub sign-in failed. Try again.',
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
  registerCopilotLogout(): void {
    const { logger, sentryService, copilotAuth } = this.deps;
    this.deps.rpcHandler.registerMethod<
      Record<string, never>,
      { success: boolean }
    >('auth:copilotLogout', async () => {
      try {
        logger.debug('RPC: auth:copilotLogout called');
        // MUST be awaited: logout() persists a logout tombstone to the
        // settings store (TASK_2026_172 Issue 2). Fire-and-forget would
        // report success before the write landed and could lose it entirely
        // if the host exited right after.
        await copilotAuth.logout();
        this.deps.invalidateAuthStatusCache();
        logger.info('RPC: auth:copilotLogout succeeded');
        return { success: true };
      } catch (error) {
        logger.error(
          'RPC: auth:copilotLogout failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'AuthRpcHandlers.registerCopilotLogout' },
        );
        return { success: false };
      }
    });
  }

  /**
   * auth:copilotStatus - Check if Copilot is already authenticated
   *
   * Returns current authentication state without
   * triggering a login flow.
   */
  registerCopilotStatus(): void {
    const { logger, sentryService, copilotAuth } = this.deps;
    this.deps.rpcHandler.registerMethod<
      Record<string, never>,
      { authenticated: boolean; username?: string }
    >('auth:copilotStatus', async () => {
      try {
        logger.debug('RPC: auth:copilotStatus called');

        const authenticated = await copilotAuth.isAuthenticated();

        if (!authenticated) {
          return { authenticated: false };
        }

        const username = await getGitHubUsername(this.deps.platformAuth);

        logger.debug('RPC: auth:copilotStatus result', {
          authenticated,
          username,
        });
        return { authenticated: true, username };
      } catch (error) {
        logger.error(
          'RPC: auth:copilotStatus failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'AuthRpcHandlers.registerCopilotStatus' },
        );
        return { authenticated: false };
      }
    });
  }

  /**
   * auth:codexLogin - Start an in-app login where available, or use the CLI runner.
   *
   * The runner branch remains the existing CLI/TUI behaviour.
   */
  registerCodexLogin(): void {
    const { logger, sentryService, sdkAdapter, codexAuth, platformCommands } =
      this.deps;
    this.deps.rpcHandler.registerMethod<AuthCodexLoginParams, AuthCodexLoginResponse>('auth:codexLogin', async (raw: unknown) => {
      if (this.deps.codexLogin) {
        const params = raw !== null && typeof raw === 'object' && !Array.isArray(raw)
          ? raw as Record<string, unknown> : {};
        try {
          const state = await this.deps.codexLogin.start({
            mode: params['mode'] === 'device' ? 'device' : 'browser',
            restart: params['restart'] === true,
          }, (next) => this.onCodexStateChange(next));
          if (state.status === 'failed') return { success: false, error: this.codexErrorCopy(state), state };
          if (state.status === 'cancelled') return { success: false, state };
          return { success: true, state };
        } catch (error) {
          logger.error('RPC: auth:codexLogin failed', error instanceof Error ? new Error(error.name) : new Error('unknown'));
          sentryService.captureException(error instanceof Error ? error : new Error(String(error)),
            { errorSource: 'AuthRpcHandlers.registerCodexLogin' });
          return { success: false, error: 'Failed to start Codex login.' };
        }
      }
      const command = 'codex login --device-auth';
      const runner = asAuthCommandRunner(platformCommands);

      if (!runner) {
        return { success: false, error: 'Codex sign-in cannot run here. Run codex login in a terminal, then check again.' };
      }

      logger.info('RPC: auth:codexLogin - running command in-process');
      try {
        const result = await runner.runAuthCommand({
          provider: CODEX_PROVIDER_ID,
          name: 'Codex Login',
          command,
        });
        if (!result.success) {
          logger.warn(
            `RPC: auth:codexLogin failed (exit ${String(result.exitCode)})`,
          );
          return {
            success: false,
            error: result.error ?? 'codex login did not complete.',
          };
        }
        codexAuth.clearCache();
        await sdkAdapter.reset();
        this.deps.invalidateAuthStatusCache();
        return { success: true };
      } catch (error) {
        logger.error(
          'RPC: auth:codexLogin failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'AuthRpcHandlers.registerCodexLogin' },
        );
        return { success: false, error: 'Failed to start Codex login.' };
      }
    });
  }

  registerCodexLoginCancel(): void {
    this.deps.rpcHandler.registerMethod<AuthCodexLoginCancelParams, AuthCodexLoginCancelResponse>(
      'auth:codexLoginCancel', async () => ({ cancelled: this.deps.codexLogin?.cancel() ?? false }),
    );
  }

  private onCodexStateChange(state: CodexLoginState): void {
    if (state.status === 'succeeded') {
      try {
        this.deps.codexAuth.clearCache();
        void this.deps.sdkAdapter.reset().catch(() => {
          this.deps.logger.error('RPC: auth:codexLogin adapter reset failed');
        });
        this.deps.invalidateAuthStatusCache();
      } catch {
        this.deps.logger.error('RPC: auth:codexLogin cache refresh failed');
      }
    }
    void this.deps.webviewManager?.broadcastMessage(MESSAGE_TYPES.AUTH_CODEX_LOGIN_STATUS, state)
      .catch(() => this.deps.logger.warn('RPC: auth:codexLogin status broadcast failed'));
  }

  private codexErrorCopy(state: CodexLoginState): string {
    switch (state.errorCode) {
      case 'unavailable': return 'The Codex CLI is unavailable. Try again.';
      case 'spawn-failed': return 'Codex sign-in could not be started. Try again.';
      case 'exited': return 'Codex sign-in did not complete. Try again.';
      case 'timeout': return 'Codex sign-in timed out. Try again.';
      case 'no-credentials': return 'Codex sign-in finished, but no login was found. Try again.';
      default: return 'Failed to start Codex login.';
    }
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
    void this.deps.webviewManager
      ?.broadcastMessage(MESSAGE_TYPES.AUTH_DEVICE_CODE, payload)
      .catch((error: unknown) => {
        this.deps.logger.warn(
          `Failed to broadcast ${MESSAGE_TYPES.AUTH_DEVICE_CODE}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
  }
}
