import { parseQuotaOwnerRef } from './quota-owner-ref.schema';

const VALID = {
  providerId: 'anthropic',
  identityKind: 'account',
  key: 'anthropic#account:0123456789abcdef',
  label: 'Claude account',
} as const;

describe('parseQuotaOwnerRef', () => {
  it.each([
    ['account', VALID],
    [
      'unknown kind with a hyphenated provider',
      {
        providerId: 'openai-codex',
        identityKind: 'unknown',
        key: 'openai-codex#unknown:fedcba9876543210',
        label: 'Codex account',
      },
    ],
    [
      'credential',
      {
        providerId: 'ollama-cloud',
        identityKind: 'credential',
        key: 'ollama-cloud#credential:00000000ffffffff',
        label: 'Ollama Cloud key',
      },
    ],
    [
      'cli-store',
      {
        providerId: 'opencode',
        identityKind: 'cli-store',
        key: 'opencode#cli-store:abcdefabcdefabcd',
        label: 'OpenCode store',
      },
    ],
  ])('accepts a canonical %s owner unchanged', (_name, value) => {
    expect(parseQuotaOwnerRef(value)).toEqual(value);
  });

  it.each<[string, unknown]>([
    ['undefined', undefined],
    ['null', null],
    ['a legacy quotaOwnerKey string', 'anthropic#account:0123456789abcdef'],
    ['a number', 42],
    ['an array', [VALID]],
    ['an unknown identityKind', { ...VALID, identityKind: 'email' }],
    ['a missing label', { ...VALID, label: undefined }],
    ['a blank label', { ...VALID, label: '   ' }],
    ['an email as label', { ...VALID, label: 'me@example.test' }],
    ['an over-long label', { ...VALID, label: 'x'.repeat(65) }],
    ['a non-string key', { ...VALID, key: 7 }],
    [
      'a key for another provider',
      { ...VALID, key: 'openai-codex#account:0123456789abcdef' },
    ],
    [
      'a key for another kind',
      { ...VALID, key: 'anthropic#credential:0123456789abcdef' },
    ],
    ['a raw-material key', { ...VALID, key: 'anthropic#account:me@x.test' }],
    [
      'an uppercase fingerprint',
      { ...VALID, key: 'anthropic#account:0123456789ABCDEF' },
    ],
    [
      'a short fingerprint',
      { ...VALID, key: 'anthropic#account:0123456789abcde' },
    ],
    [
      'an uppercase provider id',
      {
        ...VALID,
        providerId: 'Anthropic',
        key: 'Anthropic#account:0123456789abcdef',
      },
    ],
    ['an extra email field', { ...VALID, email: 'me@example.test' }],
    ['an extra token field', { ...VALID, apiKey: 'sk-secret' }],
    [
      'a stray quotaOwnerKey field',
      { ...VALID, quotaOwnerKey: 'anthropic#account:0123456789abcdef' },
    ],
  ])('drops %s to undefined without throwing', (_name, value) => {
    expect(() => parseQuotaOwnerRef(value)).not.toThrow();
    expect(parseQuotaOwnerRef(value)).toBeUndefined();
  });
});
