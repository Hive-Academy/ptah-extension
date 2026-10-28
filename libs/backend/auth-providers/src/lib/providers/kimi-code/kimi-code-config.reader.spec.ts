import {
  KIMI_CODE_CONFIG_MAX_BYTES,
  KIMI_CODE_DEFAULT_OAUTH_HOST,
  readKimiCodeOAuthConfig,
} from './kimi-code-config.reader';

describe('readKimiCodeOAuthConfig', () => {
  it('reads the oauth table, base url and oauth host', () => {
    const config = readKimiCodeOAuthConfig(
      [
        '# Kimi Code CLI config',
        'default_model = "k3"',
        '',
        '[providers."managed:kimi-code"]',
        'base_url = "https://api.kimi.ai/coding/v1" # inline comment',
        '',
        '[providers."managed:kimi-code".oauth]',
        'key = "oauth/kimi-code-env-0123456789abcdef"',
        'oauth_host = "https://auth.example.test/"',
      ].join('\n'),
    );
    expect(config).toEqual({
      oauthKey: 'oauth/kimi-code-env-0123456789abcdef',
      oauthHost: 'https://auth.example.test',
      baseUrlHost: 'api.kimi.ai',
    });
  });

  it('accepts dotted keys inside the provider table and CRLF line ends', () => {
    const config = readKimiCodeOAuthConfig(
      '[ providers . "managed:kimi-code" ]\r\noauth.key = "oauth/kimi-code"\r\n',
    );
    expect(config.oauthKey).toBe('oauth/kimi-code');
    expect(config.oauthHost).toBe(KIMI_CODE_DEFAULT_OAUTH_HOST);
  });

  it('ignores the same keys in other tables', () => {
    const config = readKimiCodeOAuthConfig(
      [
        '[providers."managed:other".oauth]',
        'key = "oauth/other"',
        '[[providers."managed:kimi-code".oauth]]',
        'key = "oauth/array-table"',
      ].join('\n'),
    );
    expect(config.oauthKey).toBeUndefined();
  });

  it('decodes escaped quotes and rejects a key that fails validation', () => {
    const config = readKimiCodeOAuthConfig(
      [
        '[providers."managed:kimi-code".oauth]',
        'key = "oauth/has\\"quote"',
      ].join('\n'),
    );
    expect(config.oauthKey).toBeUndefined();
  });

  it('reads literal strings and a comment character inside a string', () => {
    const config = readKimiCodeOAuthConfig(
      [
        "[providers.'managed:kimi-code'.oauth]",
        "key = 'oauth/kimi-code-env-1'",
        'host = "https://auth.example.test/#frag" # trailing',
      ].join('\n'),
    );
    expect(config.oauthKey).toBe('oauth/kimi-code-env-1');
    expect(config.oauthHost).toBe('https://auth.example.test');
  });

  it('rejects a non-https oauth host and keeps the default', () => {
    const config = readKimiCodeOAuthConfig(
      [
        '[providers."managed:kimi-code".oauth]',
        'oauth_host = "http://auth.example.test"',
      ].join('\n'),
    );
    expect(config.oauthHost).toBe(KIMI_CODE_DEFAULT_OAUTH_HOST);
  });

  it('ignores malformed lines and unterminated strings', () => {
    const config = readKimiCodeOAuthConfig(
      [
        '[providers."managed:kimi-code".oauth',
        'key = "oauth/kimi-code',
        '[providers."managed:kimi-code".oauth]',
        'key = "oauth/kimi-code-env-2" trailing-garbage',
      ].join('\n'),
    );
    expect(config.oauthKey).toBeUndefined();
  });

  it('returns only defaults for an oversized file', () => {
    const huge =
      '[providers."managed:kimi-code".oauth]\nkey = "oauth/kimi-code"\n' +
      '#'.repeat(KIMI_CODE_CONFIG_MAX_BYTES);
    expect(readKimiCodeOAuthConfig(huge)).toEqual({
      oauthHost: KIMI_CODE_DEFAULT_OAUTH_HOST,
    });
  });
});
