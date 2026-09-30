import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  I18nService,
  type I18nMessage,
  type SupportedLang,
} from '@ptah-extension/i18n';
import {
  loadScopeTranslations,
  provideI18nTesting,
  type I18nTestingOptions,
} from '@ptah-extension/i18n/testing';
import {
  CORE_I18N_SCOPE,
  GitHubReleaseService,
  SeoService,
  type ParsedRelease,
} from '@ptah-web/core';

import appAr from '../../i18n/ar.json';
import { APP_I18N_SCOPE } from '../../i18n/app.i18n-scope';
import { DownloadPageComponent } from './download-page.component';

// The shared chrome (navigation, footer, grid) and the scroll animations are
// not under test here, and the `@ptah-web/ui` barrel pulls ESM-only packages
// (fullcalendar) that Jest cannot load. Minimal stand-ins keep the page's own
// template honest. Because the stubbed chrome renders no `ui` keys, the spec
// provides the `app` and `core` scopes only (core: the release error message).
// A manually applied decorator is compiled in JIT mode, which does not
// discover signal `input()`s, so the stubs declare their inputs in metadata.
jest.mock('@ptah-web/ui', () => {
  const { Component } = jest.requireActual('@angular/core');
  class NavigationStub {}
  Component({ selector: 'ptah-navigation', template: '' })(NavigationStub);
  class FooterStub {}
  Component({ selector: 'ptah-footer', template: '' })(FooterStub);
  class GridStub {}
  Component({
    selector: 'ptah-console-grid-background',
    template: '',
    inputs: ['glow'],
  })(GridStub);
  return {
    NavigationComponent: NavigationStub,
    FooterComponent: FooterStub,
    ConsoleGridBackgroundComponent: GridStub,
  };
});

jest.mock('@hive-academy/angular-gsap', () => {
  const { Directive } = jest.requireActual('@angular/core');
  class ViewportAnimationStub {}
  Directive({ selector: '[viewportAnimation]', inputs: ['viewportConfig'] })(
    ViewportAnimationStub,
  );
  return { ViewportAnimationDirective: ViewportAnimationStub };
});

const RELEASE: ParsedRelease = {
  version: 'v1.4.0',
  tagName: 'v1.4.0',
  name: 'Ptah v1.4.0',
  publishedAt: '2026-03-05T12:00:00Z',
  releaseUrl: 'https://github.com/Hive-Academy/ptah-extension/releases/v1.4.0',
  windows: [
    {
      label: 'Windows Installer (.exe)',
      fileName: 'ptah-setup.exe',
      downloadUrl: 'https://example.test/ptah-setup.exe',
      size: '96 MB',
    },
  ],
  macos: [],
  linux: [],
};

let translations: I18nTestingOptions['translations'];
beforeAll(async () => {
  const [app, core] = await Promise.all([
    loadScopeTranslations(APP_I18N_SCOPE),
    loadScopeTranslations(CORE_I18N_SCOPE),
  ]);
  translations = {
    en: { app: app.en, core: core.en },
    ar: { app: app.ar, core: core.ar },
  };
});

describe('DownloadPageComponent', () => {
  const releases = signal<ParsedRelease[]>([]);
  const loading = signal(true);
  const error = signal<I18nMessage | null>(null);
  const fetchReleases = jest.fn();

  let fixture: ComponentFixture<DownloadPageComponent>;

  const render = (lang: SupportedLang): HTMLElement => {
    TestBed.configureTestingModule({
      imports: [DownloadPageComponent],
      providers: [
        provideI18nTesting({ lang, translations }),
        {
          provide: GitHubReleaseService,
          useValue: { releases, loading, error, fetchReleases },
        },
        { provide: SeoService, useValue: { setPage: jest.fn() } },
      ],
    });
    fixture = TestBed.createComponent(DownloadPageComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  const text = (host: HTMLElement, selector: string): string =>
    host.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ??
    '';

  const expandFirstRelease = (host: HTMLElement): void => {
    host.querySelector<HTMLButtonElement>('button[aria-expanded]')?.click();
    TestBed.tick();
  };

  beforeEach(() => {
    releases.set([]);
    loading.set(true);
    error.set(null);
    fetchReleases.mockReset();
  });

  it('renders the prerendered English copy verbatim while loading', () => {
    const host = render('en');

    expect(text(host, 'h1')).toBe('Downloads');
    expect(text(host, 'h1 + p')).toBe(
      'Download the Ptah Desktop app for Windows, macOS, or Linux. Auto-updates keep you on the latest version.',
    );
    expect(text(host, '.animate-spin + p')).toBe('Loading releases...');
  });

  it('renders the core release error message and the retry label', () => {
    loading.set(false);
    error.set({ key: 'core.releases.rateLimited' });
    const host = render('en');

    expect(text(host, 'p.text-error')).toBe(
      'GitHub API rate limit reached. Please try again later.',
    );
    const retry = host.querySelector<HTMLButtonElement>('.text-error + button');
    expect(retry?.textContent?.trim()).toBe('Try Again');
    retry?.click();
    expect(fetchReleases).toHaveBeenCalledWith(3);
  });

  it('formats the release date for English exactly as before (en-US)', () => {
    loading.set(false);
    releases.set([RELEASE]);
    const host = render('en');

    expect(text(host, 'button[aria-expanded]')).toBe(
      'Version v1.4.0 Latest Mar 5, 2026',
    );
    expect(host.querySelector('.ltr-island')?.textContent?.trim()).toBe(
      'v1.4.0',
    );
  });

  it('renders Arabic copy, an Arabic date with Western digits, and keeps asset names in LTR islands', () => {
    loading.set(false);
    releases.set([RELEASE]);
    const host = render('ar');
    expandFirstRelease(host);

    const header = text(host, 'button[aria-expanded]');
    expect(header).toContain(appAr.download.release.version);
    expect(header).toContain(appAr.download.release.latest);
    expect(header).toContain('5');
    expect(header).toContain('2026');
    expect(header).not.toContain('Mar');
    expect(header).not.toMatch(/[٠-٩]/);

    expect(host.textContent).toContain(appAr.download.platforms.macosEmpty);
    expect(host.textContent).toContain(appAr.download.platforms.linuxEmpty);
    const islands = Array.from(host.querySelectorAll('.ltr-island')).map((el) =>
      el.textContent?.trim(),
    );
    expect(islands).toEqual(['v1.4.0', 'Windows Installer (.exe)', '96 MB']);
    expect(text(host, 'h3.text-lg')).toBe(appAr.download.vsCode.title);
  });

  it('mirrors the platform dividers and the CTA gradient in RTL only through rtl: variants', () => {
    loading.set(false);
    releases.set([RELEASE]);
    const host = render('en');
    expandFirstRelease(host);

    const grid = host.querySelector('.md\\:divide-x');
    expect(grid?.classList).toContain('md:rtl:divide-x-reverse');
    const cta = host.querySelector('a.btn');
    expect(cta?.classList).toContain('bg-gradient-to-r');
    expect(cta?.classList).toContain('rtl:bg-gradient-to-l');
    expect(cta?.textContent?.trim()).toBe('VS Code Marketplace');
  });
  it('re-formats the release date on a live language switch', async () => {
    loading.set(false);
    releases.set([RELEASE]);
    const host = render('en');
    expect(text(host, 'button[aria-expanded]')).toContain('Mar 5, 2026');

    try {
      await TestBed.inject(I18nService).setLanguage('ar');
      fixture.detectChanges();

      const header = text(host, 'button[aria-expanded]');
      expect(header).not.toContain('Mar');
      expect(header).toContain('2026');
      expect(header).toContain(appAr.download.release.version);
      expect(header).not.toMatch(/[\u0660-\u0669]/);
    } finally {
      document.documentElement.lang = 'en';
      document.documentElement.dir = 'ltr';
    }
  });

  it('renders a release with an unparsable publishedAt without throwing', () => {
    loading.set(false);
    releases.set([{ ...RELEASE, publishedAt: 'not-a-date' }]);

    let host!: HTMLElement;
    expect(() => {
      host = render('en');
    }).not.toThrow();
    expect(text(host, 'button[aria-expanded]')).toBe('Version v1.4.0 Latest');
    expect(fixture.componentInstance.formatDate('')).toBe('');
  });
});
