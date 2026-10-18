import { relativeTime } from './command-relative-time';

describe('relativeTime', () => {
  const now = 1_000_000;
  it('formats fresh, minute, hour and day ages from the supplied clock', () => {
    expect(relativeTime(now, now)).toBe('Just now');
    expect(relativeTime(now - 3 * 60_000, now)).toBe('3m ago');
    expect(relativeTime(now - 2 * 3_600_000, now)).toBe('2h ago');
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2d ago');
  });
  it('treats future skew as fresh and omits invalid timestamps', () => {
    expect(relativeTime(undefined, now)).toBeNull();
    expect(relativeTime(Number.NaN, now)).toBeNull();
    expect(relativeTime(Number.POSITIVE_INFINITY, now)).toBeNull();
    expect(relativeTime(now, Number.NaN)).toBeNull();
    expect(relativeTime(now + 5_000, now)).toBe('Just now');
    expect(relativeTime(now + 10 * 60_000, now)).toBe('Just now');
  });
});
