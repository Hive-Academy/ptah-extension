import { lastPathSegment } from './path-display.utils';

describe('lastPathSegment', () => {
  it('returns the folder name from a Windows path', () => {
    expect(lastPathSegment('D:\\projects\\alpha')).toBe('alpha');
  });

  it('returns the folder name from a POSIX path', () => {
    expect(lastPathSegment('/home/user/alpha')).toBe('alpha');
  });

  it('handles the separator the OTHER host wrote', () => {
    // The paths this formats are written by whichever host captured them, so a
    // POSIX root can reach a Windows renderer and the reverse. Neither
    // separator is "the" separator here.
    expect(lastPathSegment('/home/user/alpha')).toBe('alpha');
    expect(lastPathSegment('D:\\projects\\alpha')).toBe('alpha');
  });

  it('ignores a trailing separator instead of falling back to the whole path', () => {
    // THE reason this exists rather than `.split(sep).pop() || path`: that form
    // returns `''` here, and the `|| path` guard then renders the entire path
    // in a slot sized for a folder name.
    expect(lastPathSegment('D:\\projects\\alpha\\')).toBe('alpha');
    expect(lastPathSegment('/home/user/alpha/')).toBe('alpha');
  });

  it('returns the input unchanged when it holds no segment', () => {
    // A caller rendering a name has to render something.
    expect(lastPathSegment('')).toBe('');
    expect(lastPathSegment('/')).toBe('/');
    expect(lastPathSegment('\\')).toBe('\\');
  });

  it('returns a bare name unchanged', () => {
    expect(lastPathSegment('alpha')).toBe('alpha');
  });
});
