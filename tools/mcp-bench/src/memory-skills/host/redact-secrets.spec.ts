import { redactSecrets } from './redact-secrets';

describe('redactSecrets', () => {
  it.each([
    [
      'JSON access token',
      '"access_token":"abc"',
      '"access_token":"<redacted>"',
    ],
    [
      'JSON refresh token',
      '"refresh_token": "abc"',
      '"refresh_token": "<redacted>"',
    ],
    ['JSON ID token', '"id_token":"abc"', '"id_token":"<redacted>"'],
    ['single-quoted API key', "'apiKey': 'abc'", "'apiKey': '<redacted>'"],
    ['cookie header', 'Cookie: a=b; c=d', 'Cookie: <redacted>'],
    [
      'set-cookie header',
      'Set-Cookie: sid=abc; HttpOnly',
      'Set-Cookie: <redacted>',
    ],
    ['API key header', 'x-api-key: abc', 'x-api-key: <redacted>'],
    ['space-separated API key', 'apiKey mysecret', 'apiKey <redacted>'],
    ['space-separated token', 'token abc', 'token <redacted>'],
    [
      'multi-word authorization header',
      'Authorization: Basic part1 part2',
      'Authorization: <redacted>',
    ],
    ['bearer credential', 'Bearer abc.def', 'Bearer <redacted>'],
    [
      'bare JWT',
      'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature',
      'jwt <redacted-jwt>',
    ],
  ])('%s', (_, input, expected) => {
    expect(redactSecrets(input)).toBe(expected);
  });

  it('leaves ordinary log text unchanged', () => {
    expect(redactSecrets('curator initialized in 42ms')).toBe(
      'curator initialized in 42ms',
    );
  });
});
