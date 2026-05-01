import 'reflect-metadata';
import { createMockAuthProvider } from '../mocks/auth-provider.mock';
import { runAuthProviderContract } from './run-auth-provider-contract';

runAuthProviderContract('createMockAuthProvider', () => {
  let seededUsername: string | undefined;
  const provider = createMockAuthProvider();
  // Override after creation so the seed() hook can mutate it.
  provider.getGitHubUsername = jest.fn(
    async () => seededUsername,
  ) as typeof provider.getGitHubUsername;
  return {
    provider,
    seed({ gitHubUsername }): void {
      seededUsername = gitHubUsername;
    },
  };
});
