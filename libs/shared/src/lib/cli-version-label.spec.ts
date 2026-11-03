import {
  VERSION_TOKEN,
  cliVersionLabel,
  isCliProcessDump,
} from './cli-version-label';

describe('cli-version-label', () => {
  it.each([
    ['codex-cli 0.155.1', 'v0.155.1'],
    ['opencode v2.0.12', 'v2.0.12'],
    ['GitHub Copilot CLI 1.0.83.', 'v1.0.83'],
    ['1.2.14', 'v1.2.14'],
    ['pi 0.9.0-beta.2 (build 7)', 'v0.9.0-beta.2'],
    ['  2024 edition  ', '2024 edition'],
    ['grok 1.0.46\nUsage: grok models\nstdout follows', 'v1.0.46'],
    ['Usage: grok models\nlisted below', ''],
    ['', ''],
  ])('cliVersionLabel(%j) is %j', (raw, label) => {
    expect(cliVersionLabel(raw)).toBe(label);
  });

  it.each([
    ['one\ntwo', true],
    ['x'.repeat(181), true],
    ['stdout follows', true],
    ['stderr: boom', true],
    ['codex-cli 0.155.1', false],
    ['', false],
  ])('isCliProcessDump(%j) is %j', (value, expected) => {
    expect(isCliProcessDump(value)).toBe(expected);
  });

  it('exposes the version token pattern', () => {
    expect(VERSION_TOKEN.exec('v2.0.12')?.[1]).toBe('2.0.12');
  });
});
