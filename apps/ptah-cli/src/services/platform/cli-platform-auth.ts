/**
 * CLI Platform Auth Provider Implementation
 *
 * Implements IPlatformAuthProvider for the CLI/TUI environment:
 * - getGitHubUsername: Returns undefined (no GitHub auth session in CLI)
 *
 * In the future, this could be extended to read from git config
 * or environment variables.
 */

import type { IPlatformAuthProvider } from '@ptah-extension/rpc-handlers';

export class CliPlatformAuth implements IPlatformAuthProvider {
  async getGitHubUsername(): Promise<string | undefined> {
    // CLI has no GitHub authentication session.
    // Could be extended to read from `git config user.name` or env vars.
    return undefined;
  }
}
