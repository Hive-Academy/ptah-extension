import {
  resolveSubagentPromptCacheTtl,
  type SubagentPromptCacheTtlResolution,
} from './subagent-prompt-cache-ttl';

type Row = [
  setting: unknown,
  envValue: string | undefined,
  canSpawnSubagents: boolean,
  expected: SubagentPromptCacheTtlResolution,
];

/** Every setting x env (unset / 5m / 1h / invalid) x canSpawn. */
const table: Row[] = [
  // setting 'auto'
  [
    'auto',
    undefined,
    true,
    { sdkValue: '1h', effective: '1h', source: 'auto' },
  ],
  [
    'auto',
    undefined,
    false,
    { sdkValue: undefined, effective: '5m', source: 'sdk-default' },
  ],
  [
    'auto',
    '5m',
    true,
    { sdkValue: '1h', effective: '5m', source: 'env', envOverride: '5m' },
  ],
  [
    'auto',
    '5m',
    false,
    { sdkValue: undefined, effective: '5m', source: 'env', envOverride: '5m' },
  ],
  [
    'auto',
    '1h',
    true,
    { sdkValue: '1h', effective: '1h', source: 'env', envOverride: '1h' },
  ],
  [
    'auto',
    '1h',
    false,
    { sdkValue: undefined, effective: '1h', source: 'env', envOverride: '1h' },
  ],
  [
    'auto',
    '2h',
    true,
    { sdkValue: '1h', effective: '1h', source: 'auto', envOverride: 'invalid' },
  ],
  [
    'auto',
    '2h',
    false,
    {
      sdkValue: undefined,
      effective: '5m',
      source: 'sdk-default',
      envOverride: 'invalid',
    },
  ],
  // setting '5m'
  [
    '5m',
    undefined,
    true,
    { sdkValue: '5m', effective: '5m', source: 'setting' },
  ],
  [
    '5m',
    undefined,
    false,
    { sdkValue: '5m', effective: '5m', source: 'setting' },
  ],
  [
    '5m',
    '5m',
    true,
    { sdkValue: '5m', effective: '5m', source: 'env', envOverride: '5m' },
  ],
  [
    '5m',
    '5m',
    false,
    { sdkValue: '5m', effective: '5m', source: 'env', envOverride: '5m' },
  ],
  [
    '5m',
    '1h',
    true,
    { sdkValue: '5m', effective: '1h', source: 'env', envOverride: '1h' },
  ],
  [
    '5m',
    '1h',
    false,
    { sdkValue: '5m', effective: '1h', source: 'env', envOverride: '1h' },
  ],
  [
    '5m',
    'bogus',
    true,
    {
      sdkValue: '5m',
      effective: '5m',
      source: 'setting',
      envOverride: 'invalid',
    },
  ],
  [
    '5m',
    'bogus',
    false,
    {
      sdkValue: '5m',
      effective: '5m',
      source: 'setting',
      envOverride: 'invalid',
    },
  ],
  // setting '1h'
  [
    '1h',
    undefined,
    true,
    { sdkValue: '1h', effective: '1h', source: 'setting' },
  ],
  [
    '1h',
    undefined,
    false,
    { sdkValue: '1h', effective: '1h', source: 'setting' },
  ],
  [
    '1h',
    '5m',
    true,
    { sdkValue: '1h', effective: '5m', source: 'env', envOverride: '5m' },
  ],
  [
    '1h',
    '5m',
    false,
    { sdkValue: '1h', effective: '5m', source: 'env', envOverride: '5m' },
  ],
  [
    '1h',
    '1h',
    true,
    { sdkValue: '1h', effective: '1h', source: 'env', envOverride: '1h' },
  ],
  [
    '1h',
    '1h',
    false,
    { sdkValue: '1h', effective: '1h', source: 'env', envOverride: '1h' },
  ],
  [
    '1h',
    '1H',
    true,
    {
      sdkValue: '1h',
      effective: '1h',
      source: 'setting',
      envOverride: 'invalid',
    },
  ],
  [
    '1h',
    '1H',
    false,
    {
      sdkValue: '1h',
      effective: '1h',
      source: 'setting',
      envOverride: 'invalid',
    },
  ],
];

describe('resolveSubagentPromptCacheTtl', () => {
  it.each(table)(
    'setting=%p env=%p canSpawn=%p',
    (setting, envValue, canSpawnSubagents, expected) => {
      expect(
        resolveSubagentPromptCacheTtl({
          setting,
          envValue,
          canSpawnSubagents,
        }),
      ).toEqual(expected);
    },
  );

  it.each([undefined, null, '', 'never', '30m', 60, true, {}])(
    'treats unknown setting %p as auto',
    (setting) => {
      for (const canSpawnSubagents of [true, false]) {
        expect(
          resolveSubagentPromptCacheTtl({
            setting,
            envValue: undefined,
            canSpawnSubagents,
          }),
        ).toEqual(
          resolveSubagentPromptCacheTtl({
            setting: 'auto',
            envValue: undefined,
            canSpawnSubagents,
          }),
        );
      }
    },
  );

  it.each(['', '   '])('treats blank env value %p as unset', (envValue) => {
    const result = resolveSubagentPromptCacheTtl({
      setting: '1h',
      envValue,
      canSpawnSubagents: true,
    });
    expect(result).toEqual({
      sdkValue: '1h',
      effective: '1h',
      source: 'setting',
    });
    expect('envOverride' in result).toBe(false);
  });
});
