/**
 * `createMockRpcService` — typed mock for `ClaudeRpcService`.
 *
 * Returns a `jest.Mocked<ClaudeRpcService>` whose `call()` resolves to
 * `RpcResult` instances by default. Downstream specs override individual
 * methods per test via `mockResolvedValue` / `mockImplementation`.
 *
 * The mock avoids instantiating `ClaudeRpcService` itself (which would pull in
 * Angular DI, `VSCodeService`, and `AppStateManager`). It exposes the same
 * public surface — `call`, `handleResponse`, `handleMessage`,
 * `handledMessageTypes`, and the typed RPC wrappers — so consumers can inject
 * it wherever `ClaudeRpcService` is expected.
 *
 * @see libs/frontend/core/src/lib/services/claude-rpc.service.ts
 */

import { MESSAGE_TYPES } from '@ptah-extension/shared';
import {
  ClaudeRpcService,
  RpcResult,
} from '../lib/services/claude-rpc.service';

/**
 * Default success result helper — downstream specs construct custom results
 * via `rpcSuccess` / `rpcError` or by passing their own `RpcResult` instance.
 */
export function rpcSuccess<T>(data: T): RpcResult<T> {
  return new RpcResult<T>(true, data, undefined, undefined);
}

export function rpcError<T = unknown>(
  error: string,
  errorCode?: 'LICENSE_REQUIRED' | 'PRO_TIER_REQUIRED',
): RpcResult<T> {
  return new RpcResult<T>(false, undefined, error, errorCode);
}

export type MockRpcService = jest.Mocked<ClaudeRpcService>;

/**
 * Create a fully typed `jest.Mocked<ClaudeRpcService>`.
 *
 * All methods return resolved `RpcResult` successes with empty payloads by
 * default. Consumers override per-test:
 *
 * ```ts
 * const rpc = createMockRpcService();
 * rpc.call.mockResolvedValue(rpcSuccess({ sessions: [] }));
 * ```
 */
export function createMockRpcService(
  overrides?: Partial<ClaudeRpcService>,
): MockRpcService {
  const call = jest.fn(async () =>
    rpcSuccess(undefined),
  ) as MockRpcService['call'];
  const handleResponse = jest.fn() as MockRpcService['handleResponse'];
  const handleMessage = jest.fn() as MockRpcService['handleMessage'];

  const listSessions = jest.fn(async () =>
    rpcSuccess({ sessions: [], total: 0, hasMore: false }),
  ) as MockRpcService['listSessions'];
  const loadSession = jest.fn(async () =>
    rpcError<unknown>('Not implemented in mock'),
  ) as unknown as MockRpcService['loadSession'];
  const openFile = jest.fn(async () =>
    rpcSuccess({ success: true }),
  ) as unknown as MockRpcService['openFile'];
  const deleteSession = jest.fn(async () =>
    rpcSuccess({ success: true }),
  ) as MockRpcService['deleteSession'];
  const renameSession = jest.fn(async () =>
    rpcSuccess({ success: true }),
  ) as MockRpcService['renameSession'];
  const querySubagents = jest.fn(async () =>
    rpcSuccess({ subagents: [] }),
  ) as unknown as MockRpcService['querySubagents'];

  const mock: MockRpcService = {
    call,
    handleResponse,
    handleMessage,
    handledMessageTypes: [MESSAGE_TYPES.RPC_RESPONSE],
    listSessions,
    loadSession,
    openFile,
    deleteSession,
    renameSession,
    querySubagents,
  } as unknown as MockRpcService;

  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      if (typeof value === 'function') {
        (mock as unknown as Record<string, unknown>)[key] = jest.fn(
          value as (...args: unknown[]) => unknown,
        );
      } else {
        (mock as unknown as Record<string, unknown>)[key] = value;
      }
    }
  }

  return mock;
}
