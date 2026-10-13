import {
  NON_AUTH_PROVIDER_KEY_SLOT_PREFIXES,
  PROVIDER_KEY_SECRET_PREFIX,
  isSdkAuthSecretKey,
} from './provider-key-slots';

describe('isSdkAuthSecretKey', () => {
  it.each([
    'ptah.auth.anthropicApiKey',
    'ptah.auth.provider.openrouter',
    'ptah.auth.provider.ollama-cloud',
    'ptah.auth.provider.my.custom.provider',
  ])('treats %s as an SDK auth secret', (key) => {
    expect(isSdkAuthSecretKey(key)).toBe(true);
  });

  it.each([
    // The exact key whose refresh disposed every chat session (2026-10-13).
    'ptah.auth.provider.mcp.oauth.oauth-mcp.heygen.com-mcp-hyperframes',
    'ptah.auth.provider.smithery.config.github',
    'ptah.auth.provider.ptahCli.pc-1234',
  ])('ignores the non-auth slot %s', (key) => {
    expect(isSdkAuthSecretKey(key)).toBe(false);
  });

  it('ignores keys outside the ptah.auth namespace', () => {
    expect(isSdkAuthSecretKey('ptah.llm.openai')).toBe(false);
  });

  it('ignores every declared non-auth slot family', () => {
    for (const prefix of Object.values(NON_AUTH_PROVIDER_KEY_SLOT_PREFIXES)) {
      expect(isSdkAuthSecretKey(`${PROVIDER_KEY_SECRET_PREFIX}${prefix}x`)).toBe(
        false,
      );
    }
  });
});
