/**
 * CliPlatformAuth — GitHub username resolution (TASK_2026_172 Issue 5).
 *
 * `getGitHubUsername()` returned `undefined` unconditionally, so every Copilot
 * success path in the CLI/TUI fell back to the generic label and the toast read
 * "Connected as GitHub user" no matter who signed in. VS Code reports the real
 * account via `vscode.authentication`; the CLI has no such session, so it must
 * resolve the login from the credentials it does have.
 *
 * Contract under test:
 *   1. Prefer the `user` recorded next to the token on disk (free, offline).
 *   2. Fall back to GitHub `/user` with the stored OAuth token — required
 *      because Ptah's own device-code flow persists only `oauth_token`.
 *   3. Memoize per token so `auth:getAuthStatus` polling cannot spam the API,
 *      while a re-login as a DIFFERENT account still re-resolves.
 *   4. Never throw and never block: no token, no network, a non-2xx, or a
 *      malformed body all degrade to `undefined`.
 */

jest.mock('@ptah-extension/auth-providers', () => ({
  readCopilotToken: jest.fn(),
  readCopilotUsername: jest.fn(),
}));

import {
  readCopilotToken,
  readCopilotUsername,
} from '@ptah-extension/auth-providers';
import { CliPlatformAuth } from './cli-platform-auth';

const mockedReadToken = readCopilotToken as jest.MockedFunction<
  typeof readCopilotToken
>;
const mockedReadUsername = readCopilotUsername as jest.MockedFunction<
  typeof readCopilotUsername
>;

const originalFetch = global.fetch;
let mockFetch: jest.Mock;

/** Minimal `Response` stand-in — only `ok` and `json()` are consumed. */
function githubUserResponse(body: unknown, ok = true): unknown {
  return { ok, json: async () => body };
}

beforeEach(() => {
  mockedReadToken.mockReset();
  mockedReadUsername.mockReset();
  mockFetch = jest.fn();
  global.fetch = mockFetch as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('CliPlatformAuth.getGitHubUsername', () => {
  it('returns the username recorded in hosts.json without touching the network', async () => {
    mockedReadUsername.mockResolvedValue('octocat');

    const auth = new CliPlatformAuth();

    await expect(auth.getGitHubUsername()).resolves.toBe('octocat');
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockedReadToken).not.toHaveBeenCalled();
  });

  it('falls back to the GitHub API when the file records no user (Ptah device-code login)', async () => {
    mockedReadUsername.mockResolvedValue(null);
    mockedReadToken.mockResolvedValue('gho_token');
    mockFetch.mockResolvedValue(githubUserResponse({ login: 'hubot' }));

    const auth = new CliPlatformAuth();

    await expect(auth.getGitHubUsername()).resolves.toBe('hubot');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [
      string,
      { headers: Record<string, string>; signal?: AbortSignal },
    ];
    expect(url).toBe('https://api.github.com/user');
    // GitHub's OAuth-token scheme is `token <t>`, not `Bearer <t>`.
    expect(init.headers['Authorization']).toBe('token gho_token');
    expect(init.signal).toBeDefined();
  });

  it('returns undefined when there is no stored token at all', async () => {
    mockedReadUsername.mockResolvedValue(null);
    mockedReadToken.mockResolvedValue(null);

    const auth = new CliPlatformAuth();

    await expect(auth.getGitHubUsername()).resolves.toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('memoizes the API result per token — status polling hits the network once', async () => {
    mockedReadUsername.mockResolvedValue(null);
    mockedReadToken.mockResolvedValue('gho_token');
    mockFetch.mockResolvedValue(githubUserResponse({ login: 'hubot' }));

    const auth = new CliPlatformAuth();

    await expect(auth.getGitHubUsername()).resolves.toBe('hubot');
    await expect(auth.getGitHubUsername()).resolves.toBe('hubot');
    await expect(auth.getGitHubUsername()).resolves.toBe('hubot');

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('re-resolves when the stored token changes (re-login as another account)', async () => {
    mockedReadUsername.mockResolvedValue(null);
    mockedReadToken.mockResolvedValueOnce('gho_first');
    mockFetch.mockResolvedValueOnce(githubUserResponse({ login: 'first' }));

    const auth = new CliPlatformAuth();
    await expect(auth.getGitHubUsername()).resolves.toBe('first');

    mockedReadToken.mockResolvedValueOnce('gho_second');
    mockFetch.mockResolvedValueOnce(githubUserResponse({ login: 'second' }));
    await expect(auth.getGitHubUsername()).resolves.toBe('second');

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('caches a negative answer so a failing lookup is not retried on every poll', async () => {
    mockedReadUsername.mockResolvedValue(null);
    mockedReadToken.mockResolvedValue('gho_token');
    mockFetch.mockResolvedValue(githubUserResponse({}, false));

    const auth = new CliPlatformAuth();

    await expect(auth.getGitHubUsername()).resolves.toBeUndefined();
    await expect(auth.getGitHubUsername()).resolves.toBeUndefined();

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('degrades to undefined when the network throws — status polling must never fail', async () => {
    mockedReadUsername.mockResolvedValue(null);
    mockedReadToken.mockResolvedValue('gho_token');
    mockFetch.mockRejectedValue(new Error('ENOTFOUND api.github.com'));

    const auth = new CliPlatformAuth();

    await expect(auth.getGitHubUsername()).resolves.toBeUndefined();
  });

  it('ignores a malformed /user body', async () => {
    mockedReadUsername.mockResolvedValue(null);
    mockedReadToken.mockResolvedValue('gho_token');
    mockFetch.mockResolvedValue(githubUserResponse({ login: 42 }));

    const auth = new CliPlatformAuth();

    await expect(auth.getGitHubUsername()).resolves.toBeUndefined();
  });

  it('ignores an empty login string', async () => {
    mockedReadUsername.mockResolvedValue(null);
    mockedReadToken.mockResolvedValue('gho_token');
    mockFetch.mockResolvedValue(githubUserResponse({ login: '' }));

    const auth = new CliPlatformAuth();

    await expect(auth.getGitHubUsername()).resolves.toBeUndefined();
  });
});
