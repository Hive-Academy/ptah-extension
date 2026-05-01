/**
 * `@ptah-extension/vscode-core/testing` — test mocks for vscode-core DI tokens.
 *
 * Consumed by every spec that injects any `TOKENS.*` resolved out of
 * `libs/backend/vscode-core`. See implementation plan §3.3 for scope.
 */

export {
  createMockConfigManager,
  type ConfigBag,
  type MockConfigManager,
  type MockConfigManagerOverrides,
} from './config-manager.mock';

export {
  createMockAuthSecretsService,
  type MockAuthSecretsOverrides,
  type MockAuthSecretsService,
  type MockedAuthSecretsService,
} from './auth-secrets-service.mock';

export {
  createMockSentryService,
  type MockSentryService,
  type MockSentryServiceOverrides,
} from './sentry-service.mock';

export {
  createMockRpcHandler,
  type MockRpcHandler,
  type MockRpcHandlerOverrides,
} from './rpc-handler.mock';

export {
  registerVscodeCoreMocks,
  type RegisterVscodeCoreMocksOptions,
  type RegisteredVscodeCoreMocks,
} from './tokens-guard';
