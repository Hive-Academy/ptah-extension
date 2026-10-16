import {
  ENDPOINT_BASE_URL_MAX_LENGTH,
  EndpointBaseUrlSchema,
  isLoopbackBase,
  keyTransportAllowed,
  originOf,
  parseEndpointBaseUrl,
  systemOneUrl,
  type EndpointBaseUrlError,
} from './decision-endpoint.url';

const LONG_HOST_URL = (length: number): string => {
  const prefix = 'https://example.com/';
  return prefix + 'a'.repeat(length - prefix.length);
};

describe('parseEndpointBaseUrl', () => {
  it.each<[string, string]>([
    ['https://api.typesafe.ai', 'https://api.typesafe.ai'],
    ['https://api.typesafe.ai/', 'https://api.typesafe.ai'],
    ['  https://ollama.com///  ', 'https://ollama.com'],
    ['http://127.0.0.1:11434', 'http://127.0.0.1:11434'],
    ['http://localhost:11434/', 'http://localhost:11434'],
    ['http://[::1]:11434', 'http://[::1]:11434'],
    ['http://192.168.1.20:11434', 'http://192.168.1.20:11434'],
    ['https://host.example/gw', 'https://host.example/gw'],
    ['https://host.example/gw/v2/', 'https://host.example/gw/v2'],
    ['HTTPS://Host.Example:443/gw', 'https://host.example/gw'],
    ['http://host.example:80', 'http://host.example'],
    ['https://host.example/path@segment', 'https://host.example/path@segment'],
  ])('accepts %j as %j', (raw, expected) => {
    expect(parseEndpointBaseUrl(raw)).toEqual({ ok: true, baseUrl: expected });
  });

  it.each<[string, EndpointBaseUrlError]>([
    ['', 'empty'],
    ['   ', 'empty'],
    ['ollama.com', 'not-http'],
    ['localhost:11434', 'not-http'],
    ['//host.example', 'not-http'],
    ['ftp://host.example', 'not-http'],
    ['file:///etc/passwd', 'not-http'],
    ['javascript:alert(1)', 'not-http'],
    ['https:host.example', 'not-http'],
    ['https:\\\\host.example', 'not-http'],
    ['https://', 'malformed'],
    ['https:///host.example', 'malformed'],
    ['https://host .example', 'malformed'],
    ['https://user@host.example', 'has-credentials'],
    ['https://user:secret@host.example', 'has-credentials'],
    ['https://:@host.example', 'has-credentials'],
    ['https://:secret@host.example/gw', 'has-credentials'],
    ['https://host.example?key=secret', 'has-query'],
    ['https://host.example/gw?', 'has-query'],
    ['https://host.example/#frag', 'has-fragment'],
    ['https://host.example#', 'has-fragment'],
  ])('refuses %j with %s', (raw, error) => {
    expect(parseEndpointBaseUrl(raw)).toEqual({ ok: false, error });
  });

  it(`accepts ${ENDPOINT_BASE_URL_MAX_LENGTH} characters and refuses one more`, () => {
    const atLimit = LONG_HOST_URL(ENDPOINT_BASE_URL_MAX_LENGTH);
    expect(parseEndpointBaseUrl(atLimit)).toEqual({
      ok: true,
      baseUrl: atLimit,
    });
    expect(
      parseEndpointBaseUrl(LONG_HOST_URL(ENDPOINT_BASE_URL_MAX_LENGTH + 1)),
    ).toEqual({ ok: false, error: 'too-long' });
  });
});

describe('EndpointBaseUrlSchema', () => {
  it('outputs the normalised base', () => {
    expect(EndpointBaseUrlSchema.parse(' https://Host.Example/gw/ ')).toBe(
      'https://host.example/gw',
    );
  });

  it('refuses with a fixed message that never repeats the input', () => {
    const sentinel = 'sentinel-secret-7f3a';
    const result = EndpointBaseUrlSchema.safeParse(
      `https://user:${sentinel}@host.example`,
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toHaveLength(1);
    expect(result.error.issues[0]?.message).toBe(
      'base URL must not contain a user name or password',
    );
    expect(JSON.stringify(result.error.issues)).not.toContain(sentinel);
  });

  it('refuses a non-string', () => {
    expect(EndpointBaseUrlSchema.safeParse(42).success).toBe(false);
  });
});

describe('isLoopbackBase', () => {
  it.each<[string, boolean]>([
    ['http://127.0.0.1:11434', true],
    ['http://localhost:11434', true],
    ['https://localhost', true],
    ['http://[::1]:11434', true],
    ['http://LOCALHOST:11434', true],
    ['http://127.0.0.2:11434', false],
    ['http://localhost.example.com', false],
    ['http://192.168.1.20:11434', false],
    ['https://ollama.com', false],
    ['not a url', false],
  ])('%j -> %s', (url, expected) => {
    expect(isLoopbackBase(url)).toBe(expected);
  });
});

describe('keyTransportAllowed (D4)', () => {
  it.each<[string, boolean]>([
    ['https://ollama.com', true],
    ['https://host.example/gw', true],
    ['http://127.0.0.1:11434', true],
    ['http://localhost:11434', true],
    ['http://[::1]:11434', true],
    ['http://192.168.1.20:11434', false],
    ['http://ollama.com', false],
    ['http://localhost.example.com', false],
    ['ftp://host.example', false],
    ['', false],
    ['not a url', false],
  ])('%j -> %s', (url, expected) => {
    expect(keyTransportAllowed(url)).toBe(expected);
  });
});

describe('systemOneUrl (DC11)', () => {
  it.each<[string, string, string]>([
    ['https://ollama.com', '/v1/systemone', 'https://ollama.com/v1/systemone'],
    ['https://ollama.com/', '/v1/systemone', 'https://ollama.com/v1/systemone'],
    [
      'https://host.example/gw',
      '/v1/systemone',
      'https://host.example/gw/v1/systemone',
    ],
    [
      'https://host.example/gw//',
      '/v1/systemone',
      'https://host.example/gw/v1/systemone',
    ],
    [
      'http://127.0.0.1:11434',
      'api/version',
      'http://127.0.0.1:11434/api/version',
    ],
  ])('%j + %j -> %j', (base, path, expected) => {
    expect(systemOneUrl(base, path)).toBe(expected);
  });

  it('matches new URL(path, base) for a base without a path', () => {
    const base = 'http://127.0.0.1:11434';
    expect(systemOneUrl(base, '/v1/systemone')).toBe(
      new URL('/v1/systemone', base).toString(),
    );
  });
});

describe('originOf', () => {
  it.each<[string, string | null]>([
    ['https://host.example/gw/v1', 'https://host.example'],
    ['https://HOST.example:443/', 'https://host.example'],
    ['https://host.example:8443/gw', 'https://host.example:8443'],
    ['http://127.0.0.1:11434', 'http://127.0.0.1:11434'],
    ['http://[::1]:11434/x', 'http://[::1]:11434'],
    ['not a url', null],
    ['', null],
    ['file:///etc/passwd', null],
  ])('%j -> %j', (url, expected) => {
    expect(originOf(url)).toBe(expected);
  });
});
