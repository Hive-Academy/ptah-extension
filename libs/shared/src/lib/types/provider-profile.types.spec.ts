import {
  ProviderProfileSchema,
  type ProviderProfile,
} from './provider-profile.types';

describe('ProviderProfileSchema', () => {
  it('parses a minimal Anthropic direct profile', () => {
    const input: ProviderProfile = {
      providerId: 'anthropic',
      authEnv: { ANTHROPIC_API_KEY: 'sk-ant-test' },
      model: 'claude-sonnet-4-20250514',
    };
    expect(ProviderProfileSchema.parse(input)).toEqual(input);
  });

  it('parses a third-party profile with baseUrl + cliJsPath', () => {
    const input: ProviderProfile = {
      providerId: 'moonshot',
      authEnv: {
        ANTHROPIC_AUTH_TOKEN: 'moonshot-token',
        ANTHROPIC_BASE_URL: 'https://api.moonshot.ai/anthropic/',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'kimi-k2',
      },
      model: 'claude-sonnet-4-20250514',
      baseUrl: 'https://api.moonshot.ai/anthropic/',
      cliJsPath: '/path/to/cli.js',
      defaultMaxTokens: 128000,
    };
    expect(ProviderProfileSchema.parse(input)).toEqual(input);
  });

  it('rejects empty providerId', () => {
    expect(() =>
      ProviderProfileSchema.parse({
        providerId: '',
        authEnv: {},
        model: 'claude-sonnet-4-20250514',
      }),
    ).toThrow();
  });

  it('rejects non-positive defaultMaxTokens', () => {
    expect(() =>
      ProviderProfileSchema.parse({
        providerId: 'anthropic',
        authEnv: {},
        model: 'claude-sonnet-4-20250514',
        defaultMaxTokens: 0,
      }),
    ).toThrow();
  });
});
