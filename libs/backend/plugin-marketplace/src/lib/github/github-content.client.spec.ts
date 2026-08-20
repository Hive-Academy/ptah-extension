import { isAllowedRedirectTarget } from './github-content.client';

/**
 * The redirect guard.
 *
 * `fetchBlob` follows redirects, a behaviour inherited from
 * `ContentDownloadService` where it is harmless because the target is a single
 * hardcoded URL we own. Here the URL is built from a user-typed `owner/repo`,
 * so an open redirect or a hijacked CDN edge could otherwise aim the request at
 * an internal host and hand whatever came back to the installer.
 */
describe('isAllowedRedirectTarget', () => {
  it.each([
    'https://raw.githubusercontent.com/dotnet/skills/HEAD/x.md',
    'https://api.github.com/repos/dotnet/skills',
    'https://github.com/dotnet/skills',
    'https://objects.githubusercontent.com/blob',
    'https://codeload.github.com/dotnet/skills/tar.gz/HEAD',
  ])('allows %s', (url) => {
    expect(isAllowedRedirectTarget(new URL(url))).toBe(true);
  });

  it.each([
    // The cases that motivate the guard.
    ['an internal host', 'https://localhost:8080/steal'],
    [
      'a link-local metadata endpoint',
      'https://169.254.169.254/latest/meta-data',
    ],
    ['an unrelated public host', 'https://evil.example.com/payload'],
    // Suffix matching would wave this through; hostname equality does not.
    ['a lookalike suffix', 'https://raw.githubusercontent.com.evil.example/x'],
    // Downgrading the transport is refused even on an allowed host.
    ['plain http on an allowed host', 'http://raw.githubusercontent.com/x'],
    ['a non-http scheme', 'file:///etc/passwd'],
  ])('refuses %s', (_label, url) => {
    expect(isAllowedRedirectTarget(new URL(url))).toBe(false);
  });
});
