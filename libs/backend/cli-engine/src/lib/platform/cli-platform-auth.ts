/**
 * CLI Platform Auth Provider Implementation
 *
 * Implements IPlatformAuthProvider for the CLI/TUI environment.
 *
 * `getGitHubUsername()` used to return `undefined` unconditionally, so every
 * Copilot success toast in the TUI read "Connected as GitHub user" and
 * `auth:getAuthStatus` never reported an account. VS Code gets the name from
 * `vscode.authentication.getSession().account.label`; there is no such session
 * outside the editor, so the CLI resolves it from the two sources it does
 * have:
 *
 *   1. The `user` field the official Copilot integrations write next to the
 *      token in `~/.config/github-copilot/hosts.json` (or the Copilot CLI's
 *      `apps.json`). Free, offline, no network.
 *   2. GitHub's `/user` endpoint, authenticated with that same stored OAuth
 *      token. Needed because Ptah's own device-code flow persists only
 *      `oauth_token` — a Ptah-only login has no `user` on disk.
 *
 * `auth:getAuthStatus` calls this on every status poll, so the network
 * fallback is bounded by a short timeout and the resolved login is memoized
 * per token: a different token (re-login as another account) invalidates the
 * cache, an unchanged token never hits the network twice.
 */

import type { IPlatformAuthProvider } from '@ptah-extension/rpc-handlers';
import {
  readCopilotToken,
  readCopilotUsername,
} from '@ptah-extension/auth-providers';

/** Upper bound on the GitHub `/user` lookup; status polling must stay snappy. */
const GITHUB_USER_TIMEOUT_MS = 5_000;

const GITHUB_USER_ENDPOINT = 'https://api.github.com/user';

export class CliPlatformAuth implements IPlatformAuthProvider {
  /**
   * Memoized `/user` result, keyed by the OAuth token it was resolved from.
   * `username: null` caches a negative answer so a token that cannot resolve
   * (revoked, offline, rate-limited) does not re-hit the network on every poll.
   */
  private cachedLogin: { token: string; username: string | null } | null = null;

  async getGitHubUsername(): Promise<string | undefined> {
    const fromFile = await readCopilotUsername();
    if (fromFile) {
      return fromFile;
    }

    const token = await readCopilotToken();
    if (!token) {
      return undefined;
    }

    if (this.cachedLogin?.token === token) {
      return this.cachedLogin.username ?? undefined;
    }

    const username = await this.fetchGitHubLogin(token);
    this.cachedLogin = { token, username };
    return username ?? undefined;
  }

  /**
   * Resolve the login for an OAuth token via GitHub's `/user` endpoint.
   * Returns `null` on any failure — an unavailable username must never break
   * an auth status poll, and the caller falls back to a generic label.
   */
  private async fetchGitHubLogin(token: string): Promise<string | null> {
    try {
      const response = await fetch(GITHUB_USER_ENDPOINT, {
        headers: {
          Authorization: `token ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'ptah-cli',
        },
        signal: AbortSignal.timeout(GITHUB_USER_TIMEOUT_MS),
      });

      if (!response.ok) {
        return null;
      }

      const body: unknown = await response.json();
      const login =
        typeof body === 'object' && body !== null
          ? (body as { login?: unknown }).login
          : undefined;

      return typeof login === 'string' && login.length > 0 ? login : null;
    } catch (error: unknown) {
      void error;
      return null;
    }
  }
}
