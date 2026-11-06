import { REDACTED, redactSecrets } from './redact-secrets';

/** Base64url JSON segment, so no token-shaped literal sits in the source. */
const segment = (value: object): string =>
  Buffer.from(JSON.stringify(value)).toString('base64url');
/** A fake three-part JWT built at run time (secret scanners flag literals). */
const FAKE_JWT = [segment({ alg: 'HS256' }), segment({ sub: 'x' }), 'SENTINELsig'].join('.');

describe('redactSecrets', () => {
  it.each([
    ['an OpenAI/Anthropic key', 'call failed with sk-ant-api03-SENTINELabcdefghijklmnop', 'SENTINEL'],
    ['a GitHub token', 'push rejected: ghp_SENTINEL1234567890abcdefghij', 'SENTINEL'],
    ['a GitHub fine-grained token', 'github_pat_11SENTINEL0123456789_abcdef', 'SENTINEL'],
    ['a Slack token', 'slack said xoxb-123456789012-SENTINEL', 'SENTINEL'],
    ['an AWS access key id', 'key AKIAIOSFODNN7SENTINE was denied', 'AKIAIOSFODNN7SENTINE'],
    ['an Authorization header', 'Authorization: Bearer SENTINELtoken', 'SENTINELtoken'],
    ['a basic Authorization header', 'authorization=Basic dXNlcjpwYXNz', 'dXNlcjpwYXNz'],
    ['a bare bearer token', 'sent bearer SENTINEL.abc.def', 'SENTINEL'],
    ['an api_key query value', 'GET /v1?api_key=SENTINEL&q=1', 'SENTINEL'],
    ['a token value', 'token=SENTINEL failed', 'SENTINEL'],
    ['a JSON password', '{"password": "SENTINEL"}', 'SENTINEL'],
    ['URL credentials', 'clone https://alice:SENTINEL@example.com/repo.git', 'SENTINEL'],
    ['a URL token user', 'fetch https://SENTINEL@github.com/x', 'SENTINEL'],
    ['a long hex run', `digest ${'ab12'.repeat(10)} rejected`, 'ab12ab12'],
    ['a long base64 run', 'blob QmFzZTY0U0VOVElORUwxMjM0NTY3ODkwYWJjZGVm end', 'QmFzZTY0'],
    ['a JWT', `jwt ${FAKE_JWT}`, 'SENTINEL'],
  ])('redacts %s', (_label, input, secret) => {
    const out = redactSecrets(input);
    expect(out).not.toContain(secret);
    expect(out).toContain(REDACTED);
  });

  it.each([
    ['a JSON password with spaces', '{"password":"alpha SENTINEL beta"}'],
    ['a spaced JSON secret', '{ "client_secret" : "one two SENTINEL" }'],
    ['a single-quoted token with spaces', "token='SENTINEL and more'"],
    ['an escaped quote inside the value', '{"password":"a\\"b SENTINEL c"}'],
    ['an unterminated quoted value', 'api_key="SENTINEL never closed'],
  ])('redacts %s through the closing quote', (_label, input) => {
    const out = redactSecrets(input);
    expect(out).not.toContain('SENTINEL');
    expect(out).not.toContain('beta');
    expect(out).toContain(REDACTED);
  });

  it('keeps text after a closed quoted value', () => {
    expect(redactSecrets('{"password":"a b","user":"ann"}')).toBe(
      `{"password":"${REDACTED}","user":"ann"}`,
    );
  });

  it.each([
    ['one long word', 'a'.repeat(100_000)],
    ['a long hex run ending in a word character', `${'ab12'.repeat(25_000)}z`],
    ['a long mixed-case run', `${'Aa1'.repeat(33_334)}!`],
    ['a long URL-like run without @', `https://${'a'.repeat(100_000)}`],
    ['an unterminated quoted secret', `password="${'x '.repeat(50_000)}`],
    ['repeated key names', 'token '.repeat(17_000)],
    ['a long bearer run', `Bearer ${' '.repeat(100_000)}`],
  ])('finishes fast on ~100 KB of %s', (_label, input) => {
    const startedAt = performance.now();
    redactSecrets(input);
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });

  it('keeps ordinary failure text unchanged', () => {
    const text =
      "TypeError: Cannot read properties of undefined (reading 'x') at /src/app/main.ts:12";
    expect(redactSecrets(text)).toBe(text);
  });

  it('keeps the URL host and path when redacting credentials', () => {
    expect(redactSecrets('https://u:p@example.com/a')).toBe(
      `https://${REDACTED}@example.com/a`,
    );
  });
});
