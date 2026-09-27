import { PLATFORM_ID, signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18nService, type SupportedLang } from '@ptah-extension/i18n';
import { provideArabicFontLoader } from './arabic-font.loader';
import {
  ARABIC_FONT_HREF,
  ARABIC_FONT_LINK_ID,
} from './landing-i18n.constants';

describe('provideArabicFontLoader', () => {
  let lang: WritableSignal<SupportedLang>;

  function fontLinks(): NodeListOf<HTMLLinkElement> {
    return document.head.querySelectorAll<HTMLLinkElement>(
      `link#${ARABIC_FONT_LINK_ID}`,
    );
  }

  function setUp(platform: 'browser' | 'server', initial: SupportedLang): void {
    lang = signal(initial);
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: platform },
        { provide: I18nService, useValue: { lang: lang.asReadonly() } },
        provideArabicFontLoader(),
      ],
    });
    // Environment initializers run when the environment injector is created.
    TestBed.inject(I18nService);
    TestBed.tick();
  }

  afterEach(() => {
    fontLinks().forEach((link) => link.remove());
  });

  it('never requests the font while the language is English', () => {
    setUp('browser', 'en');

    expect(fontLinks()).toHaveLength(0);
  });

  it('appends the stylesheet link when the language becomes Arabic', () => {
    setUp('browser', 'en');

    lang.set('ar');
    TestBed.tick();

    const links = fontLinks();
    expect(links).toHaveLength(1);
    expect(links[0].rel).toBe('stylesheet');
    expect(links[0].getAttribute('href')).toBe(ARABIC_FONT_HREF);
  });

  it('appends it only once across repeated switches', () => {
    setUp('browser', 'ar');

    lang.set('en');
    TestBed.tick();
    lang.set('ar');
    TestBed.tick();

    expect(fontLinks()).toHaveLength(1);
  });

  it('keeps a link the pre-paint script already added', () => {
    const existing = document.createElement('link');
    existing.id = ARABIC_FONT_LINK_ID;
    document.head.appendChild(existing);

    setUp('browser', 'ar');

    expect(fontLinks()).toHaveLength(1);
    expect(fontLinks()[0]).toBe(existing);
  });

  it('does nothing on the server', () => {
    setUp('server', 'ar');

    expect(fontLinks()).toHaveLength(0);
  });
});
