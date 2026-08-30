import {
  decodeJwtExpiry,
  isCodexAccessTokenStale,
  CODEX_TOKEN_MAX_AGE_MS,
  CODEX_TOKEN_EXPIRY_SKEW_MS,
} from './codex-token-freshness';

/** Build a syntactically real JWT whose payload carries `exp` (UNIX seconds). */
function makeJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown): string =>
    Buffer.from(JSON.stringify(value), 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(payload)}.sig`;
}

const NOW = Date.parse('2026-08-28T12:00:00.000Z');

describe('decodeJwtExpiry', () => {
  it('reads the exp claim from a well-formed JWT', () => {
    const exp = Math.floor(NOW / 1000) + 86_400;
    expect(decodeJwtExpiry(makeJwt({ exp, sub: 'user' }))).toBe(exp);
  });

  it('returns null (never throws) for malformed input', () => {
    const malformed = [
      '',
      'not-a-jwt',
      'only.two',
      'a.b.c.d',
      'a.!!!!.c',
      `x.${Buffer.from('not json', 'utf-8').toString('base64url')}.y`,
      makeJwt({ sub: 'no-exp-claim' }),
      makeJwt({ exp: 'soon' }),
    ];
    for (const token of malformed) {
      expect(() => decodeJwtExpiry(token)).not.toThrow();
      expect(decodeJwtExpiry(token)).toBeNull();
    }
  });

  it('rejects a non-finite exp', () => {
    // JSON has no Infinity literal, so this is the only reachable non-finite:
    // an exp that is not a number at all is already covered above.
    expect(decodeJwtExpiry(makeJwt({ exp: null }))).toBeNull();
  });
});

describe('isCodexAccessTokenStale', () => {
  it('is fresh when the JWT exp is days away, even with an ancient last_refresh', () => {
    // The measured real case: ChatGPT-subscription login, last_refresh 20h old,
    // access_token valid for another 9 days. The old 50-minute rule called this
    // stale on every single status response.
    const stale = isCodexAccessTokenStale({
      accessToken: makeJwt({ exp: Math.floor(NOW / 1000) + 9 * 86_400 }),
      lastRefresh: new Date(NOW - 20 * 60 * 60 * 1000).toISOString(),
      now: NOW,
    });
    expect(stale).toBe(false);
  });

  it('is stale when the JWT exp is in the past', () => {
    expect(
      isCodexAccessTokenStale({
        accessToken: makeJwt({ exp: Math.floor(NOW / 1000) - 60 }),
        lastRefresh: new Date(NOW - 1000).toISOString(),
        now: NOW,
      }),
    ).toBe(true);
  });

  it('is stale inside the expiry skew window', () => {
    const justInsideSkew = Math.floor(
      (NOW + CODEX_TOKEN_EXPIRY_SKEW_MS - 1000) / 1000,
    );
    expect(
      isCodexAccessTokenStale({
        accessToken: makeJwt({ exp: justInsideSkew }),
        now: NOW,
      }),
    ).toBe(true);
  });

  it('falls back to the last_refresh heuristic for an opaque token', () => {
    const opaque = 'sk-opaque-access-token';
    expect(
      isCodexAccessTokenStale({
        accessToken: opaque,
        lastRefresh: new Date(NOW - 10 * 60 * 1000).toISOString(),
        now: NOW,
      }),
    ).toBe(false);
    expect(
      isCodexAccessTokenStale({
        accessToken: opaque,
        lastRefresh: new Date(
          NOW - CODEX_TOKEN_MAX_AGE_MS - 60_000,
        ).toISOString(),
        now: NOW,
      }),
    ).toBe(true);
  });

  it('is stale for an opaque token with a missing or unparseable last_refresh', () => {
    expect(isCodexAccessTokenStale({ accessToken: 'opaque', now: NOW })).toBe(
      true,
    );
    expect(
      isCodexAccessTokenStale({
        accessToken: 'opaque',
        lastRefresh: 'yesterday-ish',
        now: NOW,
      }),
    ).toBe(true);
  });

  it('falls through to the age heuristic when no access token is supplied', () => {
    expect(
      isCodexAccessTokenStale({
        lastRefresh: new Date(NOW - 1000).toISOString(),
        now: NOW,
      }),
    ).toBe(false);
    expect(isCodexAccessTokenStale({ now: NOW })).toBe(true);
  });
});
