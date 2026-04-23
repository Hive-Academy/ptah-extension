/**
 * Mock factory for {@link SentryService} (vscode-core).
 *
 * Every method is a `jest.fn()` no-op. `isInitialized` defaults to `false`
 * so specs don't accidentally pretend Sentry is live. Override via the
 * `overrides.initialized` flag or by calling `.mockReturnValue()` directly.
 *
 * Production source: `libs/backend/vscode-core/src/services/sentry.service.ts`
 */

import type { SentryService } from '../services/sentry.service';

export interface MockSentryServiceOverrides {
  /** Initial value returned from `isInitialized()`. Defaults to false. */
  initialized?: boolean;
}

export type MockSentryService = jest.Mocked<SentryService>;

/**
 * Create a `jest.Mocked<SentryService>` whose methods are all no-op jest.fn
 * instances. `hashWorkspacePath` is preserved as a pure mock returning a
 * stable 8-char pseudo-hash so call-path assertions remain simple.
 */
export function createMockSentryService(
  overrides?: MockSentryServiceOverrides,
): MockSentryService {
  const initialized = overrides?.initialized ?? false;

  const mock = {
    initialize: jest.fn<void, [unknown]>(),
    captureException: jest.fn<void, [Error, unknown?]>(),
    captureMessage: jest.fn<void, [string, unknown?]>(),
    addBreadcrumb: jest.fn<void, [string, string, unknown?]>(),
    flush: jest.fn<Promise<void>, [number?]>(async () => undefined),
    shutdown: jest.fn<Promise<void>, [number?]>(async () => undefined),
    isInitialized: jest.fn<boolean, []>(() => initialized),
  } as unknown as MockSentryService;

  return mock;
}
