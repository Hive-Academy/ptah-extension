/**
 * Minimal logger surface used by the Ptah codebase.
 *
 * A production `Logger` class lives at
 * `libs/backend/vscode-core/src/logging/logger.ts`, but the `@ptah-extension/shared`
 * library is the zero-dependency foundation layer and cannot import it (that would
 * create a cycle). The only stable contract every consumer relies on is the
 * `{ debug, info, warn, error }` method surface, so we define a minimal testing
 * interface here and produce a `jest.Mocked<...>` matching it.
 *
 * Evidence: consumers inline this exact shape — see
 * `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.spec.ts:12-20`.
 */

export interface LoggerLike {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export type MockLogger = jest.Mocked<LoggerLike>;

/**
 * Create a `jest.Mocked<LoggerLike>` suitable for injecting into any service
 * that takes a Logger dependency. All four methods are fresh `jest.fn()`s so
 * individual tests can assert on call counts and arguments without collision.
 */
export function createMockLogger(): MockLogger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}
