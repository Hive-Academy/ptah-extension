import { Component, DOCUMENT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TRANSLOCO_MISSING_HANDLER, TranslocoPipe } from '@jsverse/transloco';
import { I18nMissingHandler } from '../lib/i18n-missing.handler';
import { I18nError } from '../lib/i18n.error';
import { I18nService } from '../lib/i18n.service';
import { provideI18nTesting } from './provide-i18n-testing';

const seoEn = { title: 'Pricing', og: 'Ptah pricing' };
const seoAr = { title: 'الأسعار' };
const uiEn = { nav: { home: 'Home' } };
const uiAr = { nav: { home: 'الرئيسية' } };

@Component({
  selector: 'ptah-probe',
  imports: [TranslocoPipe],
  template: `<h1>{{ 'seo.title' | transloco }}</h1>
    <a>{{ 'ui.nav.home' | transloco }}</a>`,
})
class ProbeComponent {}

@Component({
  selector: 'ptah-typo-probe',
  imports: [TranslocoPipe],
  template: `<p>{{ 'seo.titel' | transloco }}</p>`,
})
class TypoProbeComponent {}

describe('provideI18nTesting', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    localStorage.clear();
  });

  it('renders translated text on the first detectChanges (synchronous)', () => {
    TestBed.configureTestingModule({
      providers: [
        provideI18nTesting({ translations: { en: { seo: seoEn, ui: uiEn } } }),
      ],
    });

    const fixture = TestBed.createComponent(ProbeComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toBe('PricingHome');
    expect(TestBed.inject(I18nService).lang()).toBe('en');
  });

  it('N14: in an `ar` setup the same key translates in Arabic and in English', () => {
    TestBed.configureTestingModule({
      providers: [
        provideI18nTesting({
          lang: 'ar',
          translations: { en: { seo: seoEn }, ar: { seo: seoAr } },
        }),
      ],
    });
    const i18n = TestBed.inject(I18nService);

    expect(i18n.lang()).toBe('ar');
    expect(i18n.direction()).toBe('rtl');
    expect(i18n.translate('seo.title')).toBe('الأسعار');
    expect(i18n.translate('seo.title', {}, 'en')).toBe('Pricing');
    // Missing in `ar`: the English value, as in the app.
    expect(i18n.translate('seo.og')).toBe('Ptah pricing');
    expect(warn).toHaveBeenCalledWith(
      '[i18n] missing "seo.og" in "ar"; using English.',
    );
  });

  it('seeds the language without writing storage or the document', () => {
    TestBed.configureTestingModule({
      providers: [
        provideI18nTesting({
          lang: 'ar',
          translations: { ar: { seo: seoAr } },
        }),
      ],
    });

    TestBed.inject(I18nService);

    expect(localStorage.length).toBe(0);
    expect(
      TestBed.inject(DOCUMENT).documentElement.getAttribute('dir'),
    ).toBeNull();
  });

  it('switches the rendered language with setLanguage', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideI18nTesting({
          translations: {
            en: { seo: seoEn, ui: uiEn },
            ar: { seo: seoAr, ui: uiAr },
          },
        }),
      ],
    });
    const fixture = TestBed.createComponent(ProbeComponent);
    fixture.detectChanges();

    await expect(TestBed.inject(I18nService).setLanguage('ar')).resolves.toBe(
      true,
    );
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toBe('الأسعارالرئيسية');
  });

  it('throws an I18nError for a key missing from every provided language', () => {
    TestBed.configureTestingModule({
      providers: [
        provideI18nTesting({
          lang: 'ar',
          translations: { en: { seo: seoEn } },
        }),
      ],
    });
    const i18n = TestBed.inject(I18nService);

    expect(() => i18n.translate('seo.titel')).toThrow(I18nError);

    // Expected here, so drained before teardown would report it again.
    const handler = TestBed.inject(TRANSLOCO_MISSING_HANDLER);
    expect((handler as I18nMissingHandler).takeFailure()).toBeInstanceOf(
      I18nError,
    );
  });

  it('fails a component spec that renders a mistyped key, at teardown', () => {
    TestBed.configureTestingModule({
      providers: [provideI18nTesting({ translations: { en: { seo: seoEn } } })],
    });
    const fixture = TestBed.createComponent(TypoProbeComponent);
    fixture.detectChanges();

    // What TestBed runs after every test; its error fails that test.
    expect(() => TestBed.resetTestingModule()).toThrow(
      '[i18n] Missing translation "seo.titel"',
    );
  });

  it('tears down cleanly when every key resolved', () => {
    TestBed.configureTestingModule({
      providers: [
        provideI18nTesting({ translations: { en: { seo: seoEn, ui: uiEn } } }),
      ],
    });
    TestBed.createComponent(ProbeComponent).detectChanges();

    expect(() => TestBed.resetTestingModule()).not.toThrow();
  });
});
