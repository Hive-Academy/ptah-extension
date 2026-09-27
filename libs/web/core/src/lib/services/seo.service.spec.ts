import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { I18nService, type SupportedLang } from '@ptah-extension/i18n';
import { provideI18nTesting } from '@ptah-extension/i18n/testing';
import { SeoService, type SeoConfig } from './seo.service';

/** A page scope as the caller would own it, in both languages. */
const EN = {
  page: {
    seo: {
      title: 'Ptah — Home',
      description: 'The English description.',
      ogTitle: 'Ptah — Share title',
      ogDescription: 'The English share description.',
    },
  },
};
const AR = {
  page: {
    seo: {
      title: 'Ptah — الرئيسية',
      description: 'الوصف بالعربية.',
      ogTitle: 'Ptah — عنوان المشاركة',
      ogDescription: 'وصف المشاركة بالعربية.',
    },
  },
};

const PAGE: SeoConfig = {
  titleKey: 'page.seo.title',
  descriptionKey: 'page.seo.description',
  url: 'https://ptah.live/page',
};

function setUp(lang: SupportedLang): {
  seo: SeoService;
  i18n: I18nService;
  doc: Document;
} {
  TestBed.configureTestingModule({
    providers: [provideI18nTesting({ lang, translations: { en: EN, ar: AR } })],
  });
  return {
    seo: TestBed.inject(SeoService),
    i18n: TestBed.inject(I18nService),
    doc: TestBed.inject(DOCUMENT),
  };
}

function metaContent(doc: Document, selector: string): string | null {
  return doc.head.querySelector(selector)?.getAttribute('content') ?? null;
}

function head(doc: Document) {
  return {
    title: doc.title,
    description: metaContent(doc, 'meta[name="description"]'),
    ogTitle: metaContent(doc, 'meta[property="og:title"]'),
    ogDescription: metaContent(doc, 'meta[property="og:description"]'),
    ogUrl: metaContent(doc, 'meta[property="og:url"]'),
    ogType: metaContent(doc, 'meta[property="og:type"]'),
    twitterTitle: metaContent(doc, 'meta[name="twitter:title"]'),
    twitterDescription: metaContent(doc, 'meta[name="twitter:description"]'),
    canonical: doc.head
      .querySelector('link[rel="canonical"]')
      ?.getAttribute('href'),
  };
}

describe('SeoService', () => {
  afterEach(() => {
    const doc = TestBed.inject(DOCUMENT);
    doc.head
      .querySelectorAll('meta, link[rel="canonical"], title')
      .forEach((node) => node.remove());
  });

  it('writes the title and description in Arabic and og/twitter in English, synchronously', () => {
    const { seo, doc } = setUp('ar');

    seo.setPage(PAGE);

    expect(head(doc)).toEqual({
      title: 'Ptah — الرئيسية',
      description: 'الوصف بالعربية.',
      ogTitle: 'Ptah — Home',
      ogDescription: 'The English description.',
      ogUrl: 'https://ptah.live/page',
      ogType: 'website',
      twitterTitle: 'Ptah — Home',
      twitterDescription: 'The English description.',
      canonical: 'https://ptah.live/page',
    });
  });

  it('writes og/twitter from the English og keys when the page has them', () => {
    const { seo, doc } = setUp('ar');

    seo.setPage({
      ...PAGE,
      ogTitleKey: 'page.seo.ogTitle',
      ogDescriptionKey: 'page.seo.ogDescription',
    });

    expect(head(doc)).toMatchObject({
      title: 'Ptah — الرئيسية',
      ogTitle: 'Ptah — Share title',
      ogDescription: 'The English share description.',
      twitterTitle: 'Ptah — Share title',
      twitterDescription: 'The English share description.',
    });
  });

  it('writes everything in English when English is active (the server case)', () => {
    const { seo, doc } = setUp('en');

    seo.setPage(PAGE);

    expect(head(doc)).toMatchObject({
      title: 'Ptah — Home',
      description: 'The English description.',
      ogTitle: 'Ptah — Home',
      twitterDescription: 'The English description.',
    });
  });

  it('writes og:image only when the page gives one', () => {
    const { seo, doc } = setUp('en');

    seo.setPage(PAGE);
    expect(metaContent(doc, 'meta[property="og:image"]')).toBeNull();

    seo.setPage({ ...PAGE, ogImage: 'https://ptah.live/og.png' });
    expect(metaContent(doc, 'meta[property="og:image"]')).toBe(
      'https://ptah.live/og.png',
    );
  });

  it('re-applies only the title and description after a language switch', async () => {
    const { seo, i18n, doc } = setUp('ar');
    seo.setPage({ ...PAGE, ogTitleKey: 'page.seo.ogTitle' });
    TestBed.tick();
    const before = head(doc);

    expect(await i18n.setLanguage('en')).toBe(true);
    TestBed.tick();

    expect(head(doc)).toEqual({
      ...before,
      title: 'Ptah — Home',
      description: 'The English description.',
    });

    expect(await i18n.setLanguage('ar')).toBe(true);
    TestBed.tick();

    expect(head(doc)).toEqual(before);
  });

  it('touches nothing on a language switch before any page is set', async () => {
    const { i18n, doc } = setUp('ar');
    doc.title = 'Seeded title';

    expect(await i18n.setLanguage('en')).toBe(true);
    TestBed.tick();

    expect(doc.title).toBe('Seeded title');
    expect(doc.head.querySelector('meta[name="description"]')).toBeNull();
  });

  it('reuses one canonical link across pages', () => {
    const { seo, doc } = setUp('en');

    seo.setPage(PAGE);
    seo.setPage({ ...PAGE, url: 'https://ptah.live/other' });

    const links = doc.head.querySelectorAll('link[rel="canonical"]');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('https://ptah.live/other');
  });
});
