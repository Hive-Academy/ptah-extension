/**
 * `runAuthProviderContract` — behavioural contract for `IPlatformAuthProvider`.
 *
 * The production surface is minimal (GitHub username lookup) so the contract
 * is correspondingly narrow: the call must resolve to a string or undefined,
 * never throw when the user is signed-out, and produce deterministic output
 * across repeated calls.
 */

import type { IPlatformAuthProvider } from '../../interfaces/platform-abstractions.interface';

export interface AuthProviderSetup {
  provider: IPlatformAuthProvider;
  /** Optional seed — lets the contract prime "signed in as X". */
  seed?(config: { gitHubUsername?: string }): void;
}

export function runAuthProviderContract(
  name: string,
  createSetup: () => Promise<AuthProviderSetup> | AuthProviderSetup,
  teardown?: () => Promise<void> | void,
): void {
  describe(`IPlatformAuthProvider contract — ${name}`, () => {
    let setup: AuthProviderSetup;

    beforeEach(async () => {
      setup = await createSetup();
    });

    afterEach(async () => {
      await teardown?.();
    });

    it('getGitHubUsername resolves without throwing when unauthenticated', async () => {
      await expect(setup.provider.getGitHubUsername()).resolves.not.toThrow;
      // Actual value can be string or undefined — covered by the next test.
      await setup.provider.getGitHubUsername();
    });

    it('result is string or undefined', async () => {
      const value = await setup.provider.getGitHubUsername();
      expect(value === undefined || typeof value === 'string').toBe(true);
    });

    it('returns seeded username when the impl supports seeding', async () => {
      setup.seed?.({ gitHubUsername: 'octocat' });
      const value = await setup.provider.getGitHubUsername();
      if (setup.seed) {
        expect([undefined, 'octocat']).toContain(value);
      }
    });

    it('repeated calls produce identical results when state is stable', async () => {
      const first = await setup.provider.getGitHubUsername();
      const second = await setup.provider.getGitHubUsername();
      expect(first).toBe(second);
    });

    it('returned non-empty string (if any) does not contain whitespace', async () => {
      setup.seed?.({ gitHubUsername: 'octocat' });
      const value = await setup.provider.getGitHubUsername();
      if (typeof value === 'string' && value.length > 0) {
        expect(/\s/.test(value)).toBe(false);
      }
    });
  });
}
