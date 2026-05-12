/**
 * `createMockHttpServerProvider` — in-memory stub for `IHttpServerProvider`.
 *
 * This stub does NOT bind a real TCP socket. It is suitable for unit tests that
 * need to verify handle shape (port, host, close idempotency) without requiring
 * network access. The port returned is `0` unless the caller specifies
 * `boundPort` in the mock state — callers that need a specific port value can
 * set `state.boundPort`.
 *
 * For handler-invocation tests, use a real `CliHttpServerProvider` or a
 * purpose-built integration harness instead.
 */

import type {
  IHttpServerProvider,
  IHttpServerHandle,
  HttpServerRequestHandler,
} from '../../interfaces/http-server-provider.interface';

export interface MockHttpServerState {
  /** Port reported by created handles. Defaults to 58080. */
  boundPort: number;
  /** List of (host, port, handler) calls recorded by listen(). */
  listenCalls: Array<{
    host: string;
    port: number;
    handler: HttpServerRequestHandler;
  }>;
  /** If set, listen() will reject with this error. */
  listenError?: Error;
}

export type MockHttpServerProvider = jest.Mocked<IHttpServerProvider> & {
  state: MockHttpServerState;
};

export function createMockHttpServerProvider(
  overrides?: Partial<MockHttpServerState>,
): MockHttpServerProvider {
  const state: MockHttpServerState = {
    boundPort: 58080,
    listenCalls: [],
    ...overrides,
  };

  const mock: MockHttpServerProvider = {
    state,
    listen: jest.fn(
      async (
        host: string,
        port: number,
        handler: HttpServerRequestHandler,
      ): Promise<IHttpServerHandle> => {
        if (state.listenError) {
          throw state.listenError;
        }
        state.listenCalls.push({ host, port, handler });
        let closed = false;
        const handle: IHttpServerHandle = {
          port: state.boundPort,
          host,
          close: jest.fn(async (): Promise<void> => {
            closed = true;
            void closed; // suppress unused-variable lint
          }),
        };
        return handle;
      },
    ),
  };

  return mock;
}
