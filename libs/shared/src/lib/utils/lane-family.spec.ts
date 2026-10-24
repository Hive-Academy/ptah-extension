import type { CliDetectionResult } from '../types/agent-process.types';
import { SUBAGENT_FAMILY, laneFamilyOf } from './lane-family';

type Row = [
  label: string,
  input: Parameters<typeof laneFamilyOf>[0],
  expected: string,
];

/** Every cli x provider / ptahCliId presence x blank-value combination. */
const table: Row[] = [
  ['a system cli is its own family', { cli: 'codex' }, 'codex'],
  ['every other system cli likewise', { cli: 'grok' }, 'grok'],
  [
    'a ptah-cli agent groups under its provider',
    { cli: 'ptah-cli', ptahCliId: 'pc-1', providerId: 'kimi-code' },
    'kimi-code',
  ],
  [
    'a ptah-cli agent without a provider falls back to the registry id',
    { cli: 'ptah-cli', ptahCliId: 'pc-1', providerId: null },
    'ptah-cli:pc-1',
  ],
  [
    'a ptah-cli agent with neither key falls back to the cli name',
    { cli: 'ptah-cli', ptahCliId: undefined, providerId: undefined },
    'ptah-cli',
  ],
  [
    'a blank provider id counts as unset',
    { cli: 'ptah-cli', ptahCliId: 'pc-2', providerId: '' },
    'ptah-cli:pc-2',
  ],
  [
    'a blank ptahCliId counts as unset too',
    { cli: 'ptah-cli', ptahCliId: '', providerId: '' },
    'ptah-cli',
  ],
];

describe('laneFamilyOf', () => {
  it.each(table)('%s', (_label, input, expected) => {
    expect(laneFamilyOf(input)).toBe(expected);
  });

  it('accepts a CliDetectionResult row as the input (SC-5)', () => {
    const detection: CliDetectionResult = {
      cli: 'codex',
      installed: true,
      messagingMode: 'none',
    };
    expect(laneFamilyOf(detection)).toBe('codex');
  });

  it('groups a ptah-cli detection row under its provider', () => {
    const detection: CliDetectionResult = {
      cli: 'ptah-cli',
      installed: true,
      messagingMode: 'none',
      ptahCliId: 'pc-3',
      providerId: 'z-ai',
    };
    expect(laneFamilyOf(detection)).toBe('z-ai');
  });

  it('pins SUBAGENT_FAMILY', () => {
    expect(SUBAGENT_FAMILY).toBe('claude');
  });
});
