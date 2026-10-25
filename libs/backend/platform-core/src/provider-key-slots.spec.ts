import {
  NON_AUTH_PROVIDER_KEY_SLOT_IDS,
  NON_AUTH_PROVIDER_KEY_SLOT_PREFIXES,
  PROVIDER_KEY_SECRET_PREFIX,
  authProviderIdOfSecretKey,
  isSdkAuthSecretKey,
} from './provider-key-slots';

describe('isSdkAuthSecretKey', () => {
  it.each([
    'ptah.auth.anthropicApiKey',
    'ptah.auth.provider.openrouter',
    'ptah.auth.provider.kimi-code',
    'ptah.auth.provider.z-ai',
    'ptah.auth.provider.ollama-cloud',
    'ptah.auth.provider.sakana',
    'ptah.auth.provider.opencode-zen',
    'ptah.auth.provider.my-custom-provider',
  ])('treats %s as an SDK auth secret', (key) => {
    expect(isSdkAuthSecretKey(key)).toBe(true);
  });

  it.each([
    // The exact key whose refresh disposed every chat session (2026-10-13).
    'ptah.auth.provider.mcp.oauth.oauth-mcp.heygen.com-mcp-hyperframes',
    'ptah.auth.provider.mcp.oauth.oauth-mcp.sentry.dev-mcp',
    'ptah.auth.provider.smithery.config.github',
    'ptah.auth.provider.smithery.apiKey',
    'ptah.auth.provider.ptahCli.pc-1234',
    'ptah.auth.provider.cursor',
  ])('ignores the connector slot %s', (key) => {
    expect(isSdkAuthSecretKey(key)).toBe(false);
  });

  it('ignores any future dotted connector slot without registration', () => {
    expect(
      isSdkAuthSecretKey(`${PROVIDER_KEY_SECRET_PREFIX}newconnector.token.x`),
    ).toBe(false);
  });

  it('names the provider of an auth provider-key slot only', () => {
    expect(authProviderIdOfSecretKey('ptah.auth.provider.openrouter')).toBe(
      'openrouter',
    );
    expect(authProviderIdOfSecretKey('ptah.auth.anthropicApiKey')).toBeNull();
    expect(
      authProviderIdOfSecretKey('ptah.auth.provider.mcp.oauth.heygen'),
    ).toBeNull();
    expect(authProviderIdOfSecretKey('ptah.auth.provider.cursor')).toBeNull();
    expect(authProviderIdOfSecretKey('authMethod')).toBeNull();
  });

  it('ignores keys outside the ptah.auth namespace', () => {
    expect(isSdkAuthSecretKey('ptah.webSearch.apiKey.tavily')).toBe(false);
    expect(isSdkAuthSecretKey('ptah.licenseKey')).toBe(false);
  });

  it('ignores every declared connector slot family and id', () => {
    for (const prefix of Object.values(NON_AUTH_PROVIDER_KEY_SLOT_PREFIXES)) {
      expect(
        isSdkAuthSecretKey(`${PROVIDER_KEY_SECRET_PREFIX}${prefix}x`),
      ).toBe(false);
    }
    for (const id of Object.values(NON_AUTH_PROVIDER_KEY_SLOT_IDS)) {
      expect(isSdkAuthSecretKey(`${PROVIDER_KEY_SECRET_PREFIX}${id}`)).toBe(
        false,
      );
    }
  });
});
