import type {
  Logger,
  RpcHandler,
  SentryService,
  WebviewManager,
} from '@ptah-extension/vscode-core';
import type { SdkAgentAdapter } from '@ptah-extension/agent-sdk';
import type {
  IKimiCodeAuthService,
  IKimiCodeLoginService,
} from '@ptah-extension/auth-providers';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type {
  AuthKimiCodeLoginCancelParams,
  AuthKimiCodeLoginCancelResponse,
  AuthKimiCodeLoginParams,
  AuthKimiCodeLoginResponse,
  AuthKimiCodeLoginStatusPayload,
  KimiCodeLoginState,
} from '@ptah-extension/shared';

/** Fixed copy for a sign-in that threw before it could report a state. */
const START_FAILED_COPY = 'Failed to start Kimi Code login.';

export interface KimiCodeLoginMethodsDeps {
  readonly logger: Logger;
  readonly rpcHandler: RpcHandler;
  readonly sentryService: SentryService;
  readonly sdkAdapter: Pick<SdkAgentAdapter, 'reset'>;
  readonly kimiCodeAuth: Pick<IKimiCodeAuthService, 'clearCache'>;
  readonly kimiCodeLogin: IKimiCodeLoginService;
  readonly invalidateAuthStatusCache: () => void;
  readonly webviewManager?: Pick<WebviewManager, 'broadcastMessage'>;
}

/**
 * The in-app Kimi Code sign-in: `auth:kimiCodeLogin` and
 * `auth:kimiCodeLoginCancel`.
 *
 * Unlike `auth:codexLogin`, the host runs `kimi login` itself on every host
 * (Electron included) through `IKimiCodeLoginService`. The RPC returns once
 * the command is launched; each phase (verification URL, success, failure,
 * cancel) is broadcast as `auth:kimiCodeLoginStatus`.
 *
 * SECURITY: the pushed state is the service's display-safe snapshot. No CLI
 * output, token or local path ever reaches a payload or a log line here.
 */
export class KimiCodeLoginMethods {
  constructor(private readonly deps: KimiCodeLoginMethodsDeps) {}

  registerKimiCodeLogin(): void {
    const { logger, sentryService, kimiCodeLogin } = this.deps;
    this.deps.rpcHandler.registerMethod<
      AuthKimiCodeLoginParams,
      AuthKimiCodeLoginResponse
    >('auth:kimiCodeLogin', async () => {
      logger.info('RPC: auth:kimiCodeLogin called');
      try {
        const state = await kimiCodeLogin.start((next) =>
          this.onStateChange(next),
        );
        return state.status === 'failed'
          ? { success: false, error: state.error, state }
          : { success: true, state };
      } catch (error) {
        logger.error(
          'RPC: auth:kimiCodeLogin failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'AuthRpcHandlers.registerKimiCodeLogin' },
        );
        return { success: false, error: START_FAILED_COPY };
      }
    });
  }

  registerKimiCodeLoginCancel(): void {
    const { logger, kimiCodeLogin } = this.deps;
    this.deps.rpcHandler.registerMethod<
      AuthKimiCodeLoginCancelParams,
      AuthKimiCodeLoginCancelResponse
    >('auth:kimiCodeLoginCancel', async () => {
      const cancelled = kimiCodeLogin.cancel();
      logger.info('RPC: auth:kimiCodeLoginCancel', { cancelled });
      return { cancelled };
    });
  }

  private onStateChange(state: KimiCodeLoginState): void {
    if (state.status === 'succeeded') {
      void this.applySignedIn();
    }
    this.broadcast(state);
  }

  /**
   * A new CLI login changes which credential serves Kimi Code: drop the
   * cached read and the status payload, and re-initialize the adapter (it may
   * have failed to configure while signed out).
   */
  private async applySignedIn(): Promise<void> {
    this.deps.kimiCodeAuth.clearCache();
    this.deps.invalidateAuthStatusCache();
    try {
      await this.deps.sdkAdapter.reset();
    } catch (error) {
      this.deps.logger.error(
        'RPC: auth:kimiCodeLogin adapter reset failed',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /** Best-effort push: a missing webview manager never fails the sign-in. */
  private broadcast(state: KimiCodeLoginState): void {
    const payload: AuthKimiCodeLoginStatusPayload = state;
    void this.deps.webviewManager
      ?.broadcastMessage(MESSAGE_TYPES.AUTH_KIMI_CODE_LOGIN_STATUS, payload)
      .catch((error: unknown) => {
        this.deps.logger.warn(
          `Failed to broadcast ${MESSAGE_TYPES.AUTH_KIMI_CODE_LOGIN_STATUS} (${
            error instanceof Error ? error.name : 'unknown'
          })`,
        );
      });
  }
}
