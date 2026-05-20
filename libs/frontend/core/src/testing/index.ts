/**
 * `@ptah-extension/core/testing` — Angular + signal-store test helpers.
 *
 * Three surfaces live here:
 *   1. `mock-rpc-service` — `jest.Mocked<ClaudeRpcService>` factory with
 *      `rpcSuccess` / `rpcError` result helpers.
 *   2. `mock-message-router` — `jest.Mocked<MessageRouterService>` factory
 *      with a `dispatch(message)` helper that simulates incoming VS Code
 *      messages without touching `window.addEventListener`.
 *   3. `signal-store-harness` — `makeSignalStoreHarness<TState>()` which
 *      builds a read-only snapshot view over any signal-based store.
 *   4. `test-bed-setup` — `configureTestBedWithMocks()` which wires the
 *      defaults above into Angular's `TestBed` at the right DI tokens.
 *
 * Excluded from the production build via `tsconfig.lib.json` so none of this
 * ships in `dist/`.
 */

export {
  createMockRpcService,
  rpcSuccess,
  rpcError,
  type MockRpcService,
} from './mock-rpc-service';

export {
  createMockMessageRouter,
  type MockMessageRouter,
  type MockMessageRouterState,
  type MockMessageRouterOverrides,
} from './mock-message-router';

export {
  makeSignalStoreHarness,
  type SignalStoreHarness,
} from './signal-store-harness';

export {
  configureTestBedWithMocks,
  type ConfigureTestBedOverrides,
  type ConfiguredTestBed,
} from './test-bed-setup';
