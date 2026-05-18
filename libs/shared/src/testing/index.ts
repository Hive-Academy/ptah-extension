/**
 * `@ptah-extension/shared/testing` — universal test utilities.
 *
 * Consumed by every spec in the monorepo. Kept deliberately framework-agnostic
 * (no VS Code, no Angular, no Nest) so it can load inside any Jest runner.
 */
export {
  createMockLogger,
  type LoggerLike,
  type MockLogger,
} from './mock-logger';
export {
  createFakeAsyncGenerator,
  type FakeAsyncGeneratorOptions,
} from './fake-async-generator';
export {
  createTestContainer,
  resetTestContainer,
  type TsyringeTestContainer,
} from './tsyringe-test-container';
export {
  registerMatchers,
  toBeSessionId,
  toMatchRpcSuccess,
  toMatchRpcError,
  type RpcResponseEnvelope,
} from './matchers';
export {
  makeCorrelationId,
  resetCorrelationIdCounter,
  type MakeCorrelationIdOptions,
} from './fixtures/correlation-id';
export { freezeTime, type FrozenClock } from './time/freeze-time';
export {
  expectNormalizedPath,
  toPosixPath,
} from './path/expect-normalized-path';
