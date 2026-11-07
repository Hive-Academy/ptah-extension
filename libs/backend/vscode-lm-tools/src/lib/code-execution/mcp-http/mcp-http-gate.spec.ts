import {
  extractAuthToken,
  isAllowedHost,
  isJsonContentType,
  isRejectedOrigin,
  splitCredential,
} from './mcp-http-gate';

const TOKEN = 'a'.repeat(43);
const OTHER = 'b'.repeat(43);

describe('mcp http gate', () => {
  it('accepts only loopback hosts on the bound port', () => {
    expect(isAllowedHost('localhost:51820', 51820)).toBe(true);
    expect(isAllowedHost(' 127.0.0.1:51820 ', 51820)).toBe(true);
    expect(isAllowedHost('[::1]:51820', 51820)).toBe(true);
    expect(isAllowedHost('localhost:51821', 51820)).toBe(false);
    expect(isAllowedHost('evil.example:51820', 51820)).toBe(false);
    expect(isAllowedHost(undefined, 51820)).toBe(false);
    expect(isAllowedHost(['localhost:51820'], 51820)).toBe(false);
    expect(isAllowedHost('localhost:1', 0)).toBe(false);
  });

  it('rejects any present Origin and ignores a missing one', () => {
    expect(isRejectedOrigin(undefined)).toBe(false);
    expect(isRejectedOrigin('')).toBe(false);
    expect(isRejectedOrigin('   ')).toBe(false);
    expect(isRejectedOrigin('http://localhost')).toBe(true);
    expect(isRejectedOrigin('http://evil.test')).toBe(true);
    expect(isRejectedOrigin(['http://localhost'])).toBe(true);
  });

  it('accepts application/json with an optional charset', () => {
    expect(isJsonContentType('application/json')).toBe(true);
    expect(isJsonContentType('application/json; charset=utf-8')).toBe(true);
    expect(isJsonContentType('Application/JSON;charset=UTF-8')).toBe(true);
    expect(isJsonContentType('text/plain')).toBe(false);
    expect(isJsonContentType(undefined)).toBe(false);
  });

  it('strips a leading auth segment and ignores a query token', () => {
    const split = splitCredential(undefined, `/auth/${TOKEN}/session/tab-1?token=nope`);
    expect(split).toEqual({
      ok: true,
      token: TOKEN,
      identityUrl: '/session/tab-1?token=nope',
    });
  });

  it('fails when bearer and path tokens differ', () => {
    expect(splitCredential(`Bearer ${TOKEN}`, `/auth/${OTHER}/`)).toEqual({
      ok: false,
    });
  });

  it('fails a malformed Authorization instead of treating it as legacy', () => {
    expect(splitCredential('Bearer short', '/')).toEqual({ ok: false });
    expect(splitCredential('Basic abc', '/')).toEqual({ ok: false });
  });

  it('reads a single file token and ignores zero or several', () => {
    expect(extractAuthToken(`http://localhost/auth/${TOKEN}/workspace/x`)).toBe(
      TOKEN,
    );
    expect(extractAuthToken('http://localhost/workspace/x')).toBeUndefined();
    expect(
      extractAuthToken(`/auth/${TOKEN}/x /auth/${OTHER}/y`),
    ).toBeUndefined();
  });
});
