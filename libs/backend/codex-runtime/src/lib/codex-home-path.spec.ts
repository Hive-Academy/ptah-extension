import { SessionRuntimeIdentitySchema } from '@ptah-extension/shared/schemas';
import {
  normalizeCodexHomeKey,
  normalizeCodexWorkspaceKey,
} from './codex-home-path';

describe('normalizeCodexHomeKey', () => {
  it.each([
    ['C:/', 'win32'],
    ['//Server/Share/', 'win32'],
    ['//Server/Share/Home/../Nested/', 'win32'],
    ['/', 'posix'],
    ['/Users/A/../B/.codex/', 'posix'],
    ['C:/Users/A/../B/.codex/', 'win32'],
  ])(
    'produces a shared runtime identity home key for %s on %s',
    (home, platform) => {
      const identity = {
        version: 1,
        runtime: 'codex-app-server',
        sessionId: '12345678-1234-4234-8234-123456789abc',
        providerId: 'codex',
        workspaceId: 'workspace',
        codex: { normalizedHome: normalizeCodexHomeKey(home, platform) },
      };
      expect(SessionRuntimeIdentitySchema.parse(identity)).toEqual(identity);
    },
  );
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

describe('normalizeCodexWorkspaceKey', () => {
  it.each([
    ['C:/Projects/A/../B///', 'win32', 'c:/projects/b'],
    ['C:\\PROJECTS\\B\\', 'win32', 'c:/projects/b'],
    ['C:/', 'win32', 'c:/'],
    ['C:\\\\', 'win32', 'c:/'],
    ['//Server/Share/Repo/', 'win32', '//server/share/repo'],
    ['\\\\Server\\Share\\', 'win32', '//server/share/'],
    ['/Projects/A/../B///', 'linux', '/Projects/B'],
    ['/Projects/B/', 'darwin', '/Projects/B'],
    ['/', 'posix', '/'],
    ['///', 'posix', '/'],
    ['/Projects/A\\B/', 'posix', '/Projects/A\\B'],
    ['/Projects/B\\', 'posix', '/Projects/B\\'],
  ])('normalizes %s on %s and is idempotent', (workspace, platform, key) => {
    expect(normalizeCodexWorkspaceKey(workspace, platform)).toBe(key);
    expect(normalizeCodexWorkspaceKey(key, platform)).toBe(key);
  });

  it.each(['win32', 'linux', 'darwin', 'posix'])(
    'rejects empty, relative and NUL-containing paths on %s',
    (platform) => {
      for (const workspace of [
        '',
        ' ',
        '.',
        'repo',
        '~/repo',
        'C:repo',
        '/a\0b',
      ]) {
        expect(() => normalizeCodexWorkspaceKey(workspace, platform)).toThrow(
          'Absolute Codex workspace required',
        );
      }
    },
  );

  it.each(['/repo', '\\repo', '//server', '///repo', '//'])(
    'rejects a drive-relative Windows root %s',
    (workspace) => {
      expect(() => normalizeCodexWorkspaceKey(workspace, 'win32')).toThrow(
        'Absolute Codex workspace required',
      );
    },
  );

  it('keeps POSIX case and literal backslashes distinct', () => {
    expect(normalizeCodexWorkspaceKey('/Projects/A\\B', 'posix')).not.toBe(
      normalizeCodexWorkspaceKey('/Projects/A/B', 'posix'),
    );
    expect(normalizeCodexWorkspaceKey('/Projects/B', 'posix')).not.toBe(
      normalizeCodexWorkspaceKey('/projects/b', 'posix'),
    );
  });
});
