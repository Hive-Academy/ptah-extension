import type {
  Logger,
  RpcHandler,
  SentryService,
} from '@ptah-extension/vscode-core';
import type { SdkAgentAdapter } from '@ptah-extension/agent-sdk';
import type {
  AuthGetAuthStatusParams,
  AuthGetAuthStatusResponse,
} from '@ptah-extension/shared';
import type { AuthStatusCache } from './auth-status-cache';

export interface AuthStatusMethodsDeps {
  readonly logger: Logger;
  readonly rpcHandler: RpcHandler;
  readonly sentryService: SentryService;
  readonly sdkAdapter: SdkAgentAdapter;
  readonly statusCache: AuthStatusCache;
}

/** `auth:getHealth` and `auth:getAuthStatus`. */
export class AuthStatusMethods {
  constructor(private readonly deps: AuthStatusMethodsDeps) {}

  /**
   * auth:getHealth - Get SDK authentication health status
   */
  registerGetHealth(): void {
    const { logger, sentryService, sdkAdapter } = this.deps;
    this.deps.rpcHandler.registerMethod<
      void,
      { success: boolean; health: unknown }
    >('auth:getHealth', async () => {
      try {
        logger.debug('RPC: auth:getHealth called');
        const health = sdkAdapter.getHealth();
        return { success: true, health };
      } catch (error) {
        logger.error(
          'RPC: auth:getHealth failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'AuthRpcHandlers.registerGetHealth' },
        );
        throw error;
      }
    });
  }

  /**
   * auth:getAuthStatus - Get auth configuration status
   * SECURITY: Never returns actual credential values - only boolean existence flags
   *
   * Served from a short TTL cache with in-flight coalescing (TASK_2026_342).
   * Measured before: 14 calls in one boot-plus-two-workspace-switches session,
   * 2.0-5.3s each, identical payload every time, up to three concurrent.
   */
  registerGetAuthStatus(): void {
    const { logger, sentryService, statusCache } = this.deps;
    this.deps.rpcHandler.registerMethod<
      AuthGetAuthStatusParams,
      AuthGetAuthStatusResponse
    >('auth:getAuthStatus', async (params: AuthGetAuthStatusParams) => {
      try {
        const safeParams: AuthGetAuthStatusParams = params ?? {};
        const key = statusCache.cacheKey(safeParams);

        const cached = statusCache.getFresh(key);
        if (cached) {
          logger.debug('RPC: auth:getAuthStatus called', {
            cacheHit: true,
          });
          return cached;
        }

        const inFlight = statusCache.getInFlight(key);
        if (inFlight) {
          logger.debug('RPC: auth:getAuthStatus called', {
            coalesced: true,
          });
          return await inFlight;
        }

        logger.debug('RPC: auth:getAuthStatus called', {
          cacheHit: false,
        });
        return await statusCache.compute(key, safeParams);
      } catch (error) {
        logger.error(
          'RPC: auth:getAuthStatus failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'AuthRpcHandlers.registerGetAuthStatus' },
        );
        throw error;
      }
    });
  }
}
