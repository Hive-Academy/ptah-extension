/**
 * CodexCliAdapter.ensureTokensFresh — credential CHECK semantics.
 *
 * Kept out of `codex-cli.adapter.spec.ts` because it is the only test in this
 * adapter that needs `fs/promises` mocked, and that spec's SDK/spawn suites
 * must keep the real module.
 *
 * The rule under test (TASK_2026_342): this method and
 * `CodexAuthService.getTokenStatus` must reach the SAME verdict for the same
 * `auth.json`. It used to answer "a credential is present", so
 * `[CliDetection] codex credential refresh: fresh` and
 * `auth:getAuthStatus -> codexTokenStale: true` were logged in the same session
 * for the same file.
 */

const mockReadFile = jest.fn();
jest.mock('fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

import { CodexCliAdapter } from './codex-cli.adapter';

/** Build a syntactically real JWT whose payload carries `exp` (UNIX seconds). */
function makeJwt(expSeconds: number): string {
  const encode = (value: unknown): string =>
    Buffer.from(JSON.stringify(value), 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${encode({ alg: 'RS256' })}.${encode({ exp: expSeconds })}.sig`;
}

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

describe('CodexCliAdapter.ensureTokensFresh', () => {
  let adapter: CodexCliAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new CodexCliAdapter();
  });

  const writeAuthFile = (auth: unknown): void => {
    mockReadFile.mockResolvedValue(JSON.stringify(auth));
  };

  it('is true for a present, unexpired JWT access token', async () => {
    writeAuthFile({
      auth_mode: 'chatgpt',
      OPENAI_API_KEY: null,
      tokens: { access_token: makeJwt(nowSeconds() + 9 * 86_400) },
      // Deliberately far older than the legacy 50-minute heuristic: the JWT's
      // own exp is authoritative and this file is perfectly usable.
      last_refresh: new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString(),
    });

    await expect(adapter.ensureTokensFresh()).resolves.toBe(true);
  });

  it('is false for a present but EXPIRED JWT access token', async () => {
    writeAuthFile({
      auth_mode: 'chatgpt',
      tokens: { access_token: makeJwt(nowSeconds() - 60) },
      last_refresh: new Date().toISOString(),
    });

    await expect(adapter.ensureTokensFresh()).resolves.toBe(false);
  });

  it('is true for an API key regardless of token age', async () => {
    writeAuthFile({
      auth_mode: 'ApiKey',
      openai_api_key: 'sk-test',
      last_refresh: '1999-01-01T00:00:00.000Z',
    });

    await expect(adapter.ensureTokensFresh()).resolves.toBe(true);
  });

  it('falls back to the last_refresh age for an opaque token', async () => {
    writeAuthFile({
      tokens: { access_token: 'opaque-not-a-jwt' },
      last_refresh: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    });
    await expect(adapter.ensureTokensFresh()).resolves.toBe(true);

    writeAuthFile({
      tokens: { access_token: 'opaque-not-a-jwt' },
      last_refresh: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    await expect(adapter.ensureTokensFresh()).resolves.toBe(false);
  });

  it('is false when no credential is present at all', async () => {
    writeAuthFile({ auth_mode: 'chatgpt', tokens: {} });
    await expect(adapter.ensureTokensFresh()).resolves.toBe(false);
  });

  it('is false (never throws) when the auth file is missing or unreadable', async () => {
    mockReadFile.mockRejectedValue(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    );
    await expect(adapter.ensureTokensFresh()).resolves.toBe(false);

    mockReadFile.mockResolvedValue('{ not json');
    await expect(adapter.ensureTokensFresh()).resolves.toBe(false);
  });
});
