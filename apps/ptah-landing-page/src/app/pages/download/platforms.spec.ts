import { PLATFORM_ORDER, detectDesktopOs, formatReleaseDate } from './platforms';

describe('detectDesktopOs', () => {
  it.each([
    ['Windows Chrome', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130', platform: 'Win32' }, 'windows'],
    ['macOS Safari', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Safari/605', platform: 'MacIntel' }, 'macos'],
    ['Linux Firefox', { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/131', platform: 'Linux x86_64' }, 'linux'],
    ['Client hints', { userAgent: 'Mozilla/5.0', userAgentData: { platform: 'macOS', mobile: false } }, 'macos'],
    ['iPhone', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148', platform: 'iPhone' }, null],
    ['Android', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile', platform: 'Linux armv8l' }, null],
    ['Mobile client hint', { userAgent: 'Mozilla/5.0', userAgentData: { platform: 'Windows', mobile: true } }, null],
    ['Unknown', { userAgent: 'curl/8.0' }, null],
  ] as const)('%s', (_label, nav, expected) => {
    expect(detectDesktopOs(nav)).toBe(expected);
  });

  it('does not read Darwin as Windows', () => {
    expect(detectDesktopOs({ userAgent: 'CFNetwork Darwin/23.0.0' })).toBeNull();
  });
});

describe('platform metadata', () => {
  it('lists the platform links as Windows, macOS, Linux', () => {
    expect(PLATFORM_ORDER.map((p) => p.name)).toEqual(['Windows', 'macOS', 'Linux']);
  });

  it('formats release dates as the release list always has', () => {
    expect(formatReleaseDate('2026-10-01T12:00:00Z')).toBe('Oct 1, 2026');
  });
});
