import { normalizeCodexHomeKey } from './codex-home-path';

describe('normalizeCodexHomeKey', () => {
  it.each([
    ['C:/Users/A/../B/.codex/', 'win32', 'c:\\users\\b\\.codex'],
    ['C:\\USERS\\B\\.codex\\', 'win32', 'c:\\users\\b\\.codex'],
    ['/Users/A/../B/.codex/', 'posix', '/Users/B/.codex'],
    ['/', 'posix', '/'],
    ['C:/', 'win32', 'c:\\'],
    ['//Server/Share/Home/', 'win32', '\\\\server\\share\\home'],
  ])('normalizes %s on %s', (home, platform, expected) => {
    expect(normalizeCodexHomeKey(home, platform)).toBe(expected);
    expect(normalizeCodexHomeKey(expected, platform)).toBe(expected);
  });
  it.each(['', 'relative', '~/home', 'C:relative'])(
    'rejects unresolved home %s',
    (home) => {
      expect(() => normalizeCodexHomeKey(home, 'win32')).toThrow('Absolute');
      expect(() => normalizeCodexHomeKey(home, 'posix')).toThrow('Absolute');
    },
  );
  it('preserves case on posix', () => {
    expect(normalizeCodexHomeKey('/Home', 'posix')).not.toBe(
      normalizeCodexHomeKey('/home', 'posix'),
    );
  });
});
