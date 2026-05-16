/**
 * `@ptah-extension/shared/testing` — universal test utilities.
 *
 * Consumed by every spec in the monorepo. Kept deliberately framework-agnostic
 * (no VS Code, no Angular, no Nest) so it can load inside any Jest runner.
 */

// --- Loggers -----------------------------------------------------------------
export {
  createMockLogger,
  type LoggerLike,
  type MockLogger,
} from './mock-logger';

// --- Async iteration helpers -------------------------------------------------
export {
  createFakeAsyncGenerator,
  type FakeAsyncGeneratorOptions,
} from './fake-async-generator';

// --- tsyringe container ------------------------------------------------------
export {
  createTestContainer,
  resetTestContainer,
  type TsyringeTestContainer,
} from './tsyringe-test-container';

// --- Custom matchers ---------------------------------------------------------
export {
  registerMatchers,
  toBeSessionId,
  toMatchRpcSuccess,
  toMatchRpcError,
  type RpcResponseEnvelope,
} from './matchers';

// --- Deterministic fixtures --------------------------------------------------
export {
  makeCorrelationId,
  resetCorrelationIdCounter,
  type MakeCorrelationIdOptions,
} from './fixtures/correlation-id';

// --- Time / clock ------------------------------------------------------------
export { freezeTime, type FrozenClock } from './time/freeze-time';

// --- Path normalization ------------------------------------------------------
export {
  expectNormalizedPath,
  toPosixPath,
} from './path/expect-normalized-path';
