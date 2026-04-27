import { expectNormalizedPath, toPosixPath } from './expect-normalized-path';

describe('toPosixPath', () => {
  it('converts Windows backslashes to forward slashes', () => {
    expect(toPosixPath('C:\\Users\\abdal\\.ptah\\plugins\\foo.json')).toBe(
      'C:/Users/abdal/.ptah/plugins/foo.json',
    );
  });

  it('leaves POSIX paths untouched (modulo normalization)', () => {
    expect(toPosixPath('/home/user/.ptah/plugins/foo.json')).toBe(
      '/home/user/.ptah/plugins/foo.json',
    );
  });

  it('collapses redundant `..` and `.` segments', () => {
    expect(toPosixPath('a/b/../c/./d')).toBe('a/c/d');
  });
});

describe('expectNormalizedPath', () => {
  it('passes when two paths match after normalization', () => {
    expectNormalizedPath(
      'C:\\tmp\\ptah\\session.json',
      'C:/tmp/ptah/session.json',
    );
  });

  it('passes across Windows and POSIX separators', () => {
    expectNormalizedPath('a\\b\\c', 'a/b/c');
  });

  it('throws on mismatch', () => {
    expect(() => expectNormalizedPath('a/b/c', 'a/b/d')).toThrow();
  });
});
