/** @jest-environment jsdom */
import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { GitHubReleaseService, ParsedRelease, SeoService } from '@ptah-web/core';
import { DownloadPageComponent } from './download-page.component';

const latestReleaseUrl = 'https://github.com/Hive-Academy/PtahCode/releases/latest';

function renderDownloadPage(options: {
  loading: boolean;
  error?: string;
  releases?: ParsedRelease[];
}): ComponentFixture<DownloadPageComponent> {
  TestBed.configureTestingModule({
    imports: [DownloadPageComponent],
    providers: [
      provideRouter([]),
      { provide: PLATFORM_ID, useValue: 'server' },
      {
        provide: GitHubReleaseService,
        useValue: {
          releases: signal(options.releases ?? []),
          loading: signal(options.loading),
          error: signal(options.error ?? null),
          fetchReleases: jest.fn(),
        },
      },
      { provide: SeoService, useValue: { setPage: jest.fn() } },
    ],
  });
  const fixture = TestBed.createComponent(DownloadPageComponent);
  fixture.detectChanges();
  return fixture;
}

function platformLinks(root: HTMLElement): HTMLAnchorElement[] {
  return Array.from(root.querySelectorAll<HTMLAnchorElement>('[aria-label="Download platforms"] a'));
}

describe('DownloadPageComponent release fallback', () => {
  afterEach(() => TestBed.resetTestingModule());

  it.each([
    { loading: true, label: 'initial server render' },
    { loading: false, error: 'GitHub API rate limit reached.', label: 'API error' },
    { loading: false, label: 'empty API response' },
  ])('keeps a platform destination in the $label', ({ loading, error }) => {
    const root = renderDownloadPage({ loading, error }).nativeElement as HTMLElement;
    const links = platformLinks(root);

    expect(links.map((link) => link.textContent?.trim())).toEqual([
      'Download for Windows',
      'Download for macOS',
      'Download for Linux',
    ]);
    expect(links.map((link) => link.href)).toEqual(Array(3).fill(latestReleaseUrl));
    expect(links.every((link) => link.getAttribute('rel') === 'noopener noreferrer')).toBe(true);
    if (!loading && !error) {
      expect(root.textContent).toContain('No release details are available right now');
    }
  });

  it('keeps direct asset links when the API returns a release', () => {
    const release: ParsedRelease = {
      version: '1.0.0',
      tagName: 'electron-v1.0.0',
      name: 'PtahCode 1.0.0',
      publishedAt: '2026-10-01T00:00:00Z',
      releaseUrl: latestReleaseUrl,
      windows: [{
        label: 'Windows Installer (.exe)',
        fileName: 'PtahCode.exe',
        downloadUrl: 'https://github.com/Hive-Academy/PtahCode/releases/download/electron-v1.0.0/PtahCode.exe',
        size: '100 MB',
      }],
      macos: [],
      linux: [],
    };
    const fixture = renderDownloadPage({ loading: false, releases: [release] });
    const root = fixture.nativeElement as HTMLElement;
    const versionButton = Array.from(root.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('1.0.0'),
    );
    versionButton?.click();
    fixture.detectChanges();
    const asset = root.querySelector<HTMLAnchorElement>('a[href$="PtahCode.exe"]');

    expect(platformLinks(root)).toHaveLength(3);
    expect(asset?.href).toBe(release.windows[0].downloadUrl);
  });
});
