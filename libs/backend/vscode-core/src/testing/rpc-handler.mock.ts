/**
 * Mock factory for {@link RpcHandler} (vscode-core).
 *
 * `registerMethod` records handlers in a Map so specs can drive `handleMessage`
 * end-to-end without standing up the real license middleware. All error
 * plumbing (license gating, Sentry reporting) is bypassed — tests that need
 * those paths should use the real `RpcHandler` with a mock `LicenseService`.
 *
 * Production source: `libs/backend/vscode-core/src/messaging/rpc-handler.ts`
 */

import type { RpcHandler } from '../messaging/rpc-handler';
import type {
  RpcMessage,
  RpcResponse,
  RpcMethodHandler,
  BaseRpcMethodHandler,
} from '../messaging/rpc-types';

export interface MockRpcHandlerOverrides {
  /** Preregistered method handlers keyed by method name. */
  handlers?: Record<string, BaseRpcMethodHandler>;
}

export interface MockRpcHandler extends jest.Mocked<
  Pick<
    RpcHandler,
    | 'registerMethod'
    | 'handleMessage'
    | 'unregisterMethod'
    | 'getRegisteredMethods'
  >
> {
  /** Read-only view of currently registered methods. */
  __handlers(): ReadonlyMap<string, BaseRpcMethodHandler>;
  __reset(): void;
}

/**
 * Create a `jest.Mocked<RpcHandler>` that truly records registrations and
 * routes messages through them — useful for integration-ish specs where
 * downstream code exercises register-then-call flows.
 */
export function createMockRpcHandler(
  overrides?: MockRpcHandlerOverrides,
): MockRpcHandler {
  const handlers = new Map<string, BaseRpcMethodHandler>(
    Object.entries(overrides?.handlers ?? {}),
  );

  const mock = {
    registerMethod: jest.fn(
      <TParams = unknown, TResult = unknown>(
        name: string,
        handler: RpcMethodHandler<TParams, TResult>,
      ): void => {
        handlers.set(name, handler as BaseRpcMethodHandler);
      },
    ),
    handleMessage: jest.fn(
      async (message: RpcMessage): Promise<RpcResponse> => {
        const { method, params, correlationId } = message;
        const handler = handlers.get(method);
        if (!handler) {
          return {
            success: false,
            error: `Method not found: ${method}`,
            correlationId,
          };
        }
        try {
          const data = await handler(params);
          return { success: true, data, correlationId };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            correlationId,
          };
        }
      },
    ),
    unregisterMethod: jest.fn((name: string): void => {
      handlers.delete(name);
    }),
    getRegisteredMethods: jest.fn((): string[] => Array.from(handlers.keys())),

    __handlers: () => handlers as ReadonlyMap<string, BaseRpcMethodHandler>,
    __reset: () => {
      handlers.clear();
    },
  } as unknown as MockRpcHandler;

  return mock;
}
