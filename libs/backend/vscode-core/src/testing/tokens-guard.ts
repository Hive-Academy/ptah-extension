/**
 * tokens-guard — single-call DI registration of every vscode-core mock.
 *
 * Specs consuming vscode-core DI tokens can call `registerVscodeCoreMocks(container)`
 * to stand up the full mock surface (logger, config manager, auth secrets, sentry,
 * rpc handler) at their real `Symbol.for(...)` tokens via tsyringe's
 * `container.register(TOKEN, { useValue: mock })`.
 *
 * This guards against token drift: mocks are always registered at the exact
 * symbols production consumers inject from, so a stray `Symbol.for(...)` typo
 * surfaces as a DI failure at test time rather than a stale mock.
 *
 * Pattern reference: TOKENS consumers at
 * `libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.ts:51-56`.
 */

import type { DependencyContainer } from 'tsyringe';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import { TOKENS } from '../di/tokens';
import {
  createMockConfigManager,
  type MockConfigManager,
  type MockConfigManagerOverrides,
} from './config-manager.mock';
import {
  createMockAuthSecretsService,
  type MockAuthSecretsOverrides,
  type MockAuthSecretsService,
} from './auth-secrets-service.mock';
import {
  createMockSentryService,
  type MockSentryService,
  type MockSentryServiceOverrides,
} from './sentry-service.mock';
import {
  createMockRpcHandler,
  type MockRpcHandler,
  type MockRpcHandlerOverrides,
} from './rpc-handler.mock';

export interface RegisterVscodeCoreMocksOptions {
  logger?: MockLogger;
  configManager?: MockConfigManager;
  configManagerOverrides?: MockConfigManagerOverrides;
  authSecrets?: MockAuthSecretsService;
  authSecretsOverrides?: MockAuthSecretsOverrides;
  sentry?: MockSentryService;
  sentryOverrides?: MockSentryServiceOverrides;
  rpcHandler?: MockRpcHandler;
  rpcHandlerOverrides?: MockRpcHandlerOverrides;
}

/**
 * Everything registered by `registerVscodeCoreMocks`, returned so individual
 * specs can retain direct jest.fn handles without re-resolving from the
 * container.
 */
export interface RegisteredVscodeCoreMocks {
  logger: MockLogger;
  configManager: MockConfigManager;
  authSecrets: MockAuthSecretsService;
  sentry: MockSentryService;
  rpcHandler: MockRpcHandler;
}

/**
 * Register every vscode-core mock against the real DI tokens on the supplied
 * `DependencyContainer`. Returns the concrete mock instances so specs can
 * assert on them without calling `container.resolve(...)` again.
 *
 * @example
 * ```ts
 * import 'reflect-metadata';
 * import { container } from 'tsyringe';
 * import { registerVscodeCoreMocks } from '@ptah-extension/vscode-core/testing';
 *
 * beforeEach(() => {
 *   container.clearInstances();
 *   const mocks = registerVscodeCoreMocks(container);
 *   mocks.configManager.__seed({ 'ptah.apiKey': 'sk-test' });
 * });
 * ```
 */
export function registerVscodeCoreMocks(
  target: DependencyContainer,
  options: RegisterVscodeCoreMocksOptions = {},
): RegisteredVscodeCoreMocks {
  const logger = options.logger ?? createMockLogger();
  const configManager =
    options.configManager ??
    createMockConfigManager(options.configManagerOverrides);
  const authSecrets =
    options.authSecrets ??
    createMockAuthSecretsService(options.authSecretsOverrides);
  const sentry =
    options.sentry ?? createMockSentryService(options.sentryOverrides);
  const rpcHandler =
    options.rpcHandler ?? createMockRpcHandler(options.rpcHandlerOverrides);

  target.register(TOKENS.LOGGER, { useValue: logger });
  target.register(TOKENS.CONFIG_MANAGER, { useValue: configManager });
  target.register(TOKENS.AUTH_SECRETS_SERVICE, { useValue: authSecrets });
  target.register(TOKENS.SENTRY_SERVICE, { useValue: sentry });
  target.register(TOKENS.RPC_HANDLER, { useValue: rpcHandler });

  return { logger, configManager, authSecrets, sentry, rpcHandler };
}
