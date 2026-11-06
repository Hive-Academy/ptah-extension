/** @jest-environment jsdom */
import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { GitHubReleaseService, ParsedRelease, SeoService } from '@ptah-web/core';
import { DownloadPageComponent } from './download-page.component';

const latestReleaseUrl = 'https://github.com/Hive-Academy/PtahCode/releases/latest';

function makeRelease(overrides: Partial<ParsedRelease> = {}): ParsedRelease {
  return {
    version: '1.0.0',
    tagName: 'electron-v1.0.0',
    name: 'PtahCode 1.0.0',
    publishedAt: '2026-10-01T12:00:00Z',
    releaseUrl: 'https://github.com/Hive-Academy/PtahCode/releases/tag/electron-v1.0.0',
    windows: [{
      label: 'Windows Installer (.exe)',
      fileName: 'PtahCode.exe',
      downloadUrl: 'https://github.com/Hive-Academy/PtahCode/releases/download/electron-v1.0.0/PtahCode.exe',
      size: '100 MB',
    }],
    macos: [],
    linux: [],
    ...overrides,
  };
}

function renderDownloadPage(options: {
  loading: boolean;
  error?: string;
  releases?: ParsedRelease[];
}): { fixture: ComponentFixture<DownloadPageComponent>; service: { fetchReleases: jest.Mock }; seo: { setPage: jest.Mock } } {
  const service = {
    releases: signal(options.releases ?? []),
    loading: signal(options.loading),
    error: signal(options.error ?? null),
    fetchReleases: jest.fn(),
  };
  const seo = { setPage: jest.fn() };
  TestBed.configureTestingModule({
    imports: [DownloadPageComponent],
    providers: [
      provideRouter([]),
      { provide: PLATFORM_ID, useValue: 'server' },
      { provide: GitHubReleaseService, useValue: service },
      { provide: SeoService, useValue: seo },
    ],
  });
  const fixture = TestBed.createComponent(DownloadPageComponent);
  fixture.detectChanges();
  return { fixture, service, seo };
}

function platformLinks(root: HTMLElement): HTMLAnchorElement[] {
  return Array.from(root.querySelectorAll<HTMLAnchorElement>('[aria-label="Download platforms"] a'));
}

function expandRelease(fixture: ComponentFixture<DownloadPageComponent>, version: string): void {
  const root = fixture.nativeElement as HTMLElement;
  const button = Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.includes(version));
  button?.click();
  fixture.detectChanges();
}

describe('DownloadPageComponent release fallback', () => {
  afterEach(() => TestBed.resetTestingModule());

  it.each([
    { loading: true, label: 'initial server render' },
    { loading: false, error: 'GitHub API rate limit reached.', label: 'API error' },
    { loading: false, label: 'empty API response' },
  ])('keeps a platform destination in the $label', ({ loading, error }) => {
    const root = renderDownloadPage({ loading, error }).fixture.nativeElement as HTMLElement;
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
    const release = makeRelease();
    const { fixture } = renderDownloadPage({ loading: false, releases: [release] });
    const root = fixture.nativeElement as HTMLElement;
    expandRelease(fixture, '1.0.0');
    const asset = root.querySelector<HTMLAnchorElement>('a[href$="PtahCode.exe"]');

    expect(platformLinks(root)).toHaveLength(3);
    expect(asset?.href).toBe(release.windows[0].downloadUrl);
  });
});

describe('DownloadPageComponent hero and release details', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('sets the page SEO and fetches three releases after render', async () => {
    const { fixture, seo, service } = renderDownloadPage({ loading: true });
    await fixture.whenStable();

    expect(seo.setPage).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Download PtahCode — AI Coding Agent for Windows, macOS & Linux',
      url: 'https://ptah.live/download',
    }));
    expect(service.fetchReleases).toHaveBeenCalledWith(3);
  });

  it('renders two sections: the stage with the platform downloads, then the releases', () => {
    const root = renderDownloadPage({ loading: true }).fixture.nativeElement as HTMLElement;
    const sections = Array.from(root.querySelectorAll('main > * > section'));
    const stage = root.querySelector('section[aria-labelledby="download-title"]');

    expect(sections.map((section) => section.getAttribute('aria-labelledby'))).toEqual(['download-title', 'releases-title']);
    expect(root.querySelector('h1')?.textContent?.trim()).toBe('Download PtahCode');
    expect(stage?.querySelector('[aria-label="Download platforms"]')).not.toBeNull();
    expect(stage?.querySelector('ptah-lightfall')).not.toBeNull();
    expect(stage?.querySelector('img[src$="command-center.jpg"]')).toBeNull();
    expect(stage?.querySelector('a[href="#releases"]')).not.toBeNull();
    expect(root.querySelector('#releases')?.textContent).toContain('Choose your installer on the latest GitHub release page.');
  });

  it('shows the latest version in the hero once releases load', () => {
    const root = renderDownloadPage({ loading: false, releases: [makeRelease()] }).fixture.nativeElement as HTMLElement;

    expect(root.querySelector('.dl-meta')?.textContent).toContain('Latest 1.0.0');
  });

  it('offers the Microsoft Store when a release has no Windows asset', () => {
    const { fixture } = renderDownloadPage({ loading: false, releases: [makeRelease({ windows: [] })] });
    expandRelease(fixture, '1.0.0');
    const root = fixture.nativeElement as HTMLElement;
    const store = root.querySelector<HTMLAnchorElement>('[data-testid="microsoft-store-link"]');

    expect(store?.href).toBe('https://apps.microsoft.com/detail/9N80K3HFX0JT');
    expect(root.textContent).toContain('No macOS builds');
    expect(root.textContent).toContain('No Linux builds');
  });

  it('links the expanded release to its notes and collapses on a second click', () => {
    const release = makeRelease();
    const { fixture } = renderDownloadPage({ loading: false, releases: [release] });
    const root = fixture.nativeElement as HTMLElement;
    expandRelease(fixture, '1.0.0');

    const notes = Array.from(root.querySelectorAll<HTMLAnchorElement>('a')).find((a) => a.textContent?.includes('View release notes'));
    expect(notes?.href).toBe(release.releaseUrl);
    expect(root.querySelector('.rl-toggle')?.getAttribute('aria-expanded')).toBe('true');

    expandRelease(fixture, '1.0.0');
    expect(root.querySelector('.rl-toggle')?.getAttribute('aria-expanded')).toBe('false');
  });

  it('retries the fetch from the error state', () => {
    const { fixture, service } = renderDownloadPage({ loading: false, error: 'GitHub API rate limit reached.' });
    const root = fixture.nativeElement as HTMLElement;
    service.fetchReleases.mockClear();
    Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.includes('Try Again'))?.click();

    expect(root.textContent).toContain('GitHub API rate limit reached.');
    expect(service.fetchReleases).toHaveBeenCalledWith(3);
  });
});
