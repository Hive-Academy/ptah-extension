import { ProviderProfileSchema } from './provider-profile.schemas';
import type { ProviderProfile } from './provider-profile.types';

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
      providerId: 'kimi-code',
      authEnv: {
        ANTHROPIC_API_KEY: 'kimi-code-key',
        ANTHROPIC_BASE_URL: 'https://api.kimi.ai/coding/',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'k3',
      },
      model: 'claude-sonnet-4-20250514',
      baseUrl: 'https://api.kimi.ai/coding/',
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
