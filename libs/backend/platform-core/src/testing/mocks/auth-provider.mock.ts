/**
 * `createMockAuthProvider` — `jest.Mocked<IPlatformAuthProvider>` with a
 * seedable GitHub username.
 */

import type { IPlatformAuthProvider } from '../../interfaces/platform-abstractions.interface';

export type MockAuthProvider = jest.Mocked<IPlatformAuthProvider>;

export interface MockAuthProviderOverrides extends Partial<IPlatformAuthProvider> {
  /** Value returned by `getGitHubUsername()`. Default: `undefined`. */
  gitHubUsername?: string;
}

export function createMockAuthProvider(
  overrides?: MockAuthProviderOverrides,
): MockAuthProvider {
  const mock: MockAuthProvider = {
    getGitHubUsername: jest.fn(
      async (): Promise<string | undefined> => overrides?.gitHubUsername,
    ),
  };

  if (overrides?.getGitHubUsername) {
    mock.getGitHubUsername = jest.fn(overrides.getGitHubUsername);
  }

  return mock;
}
