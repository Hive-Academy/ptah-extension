import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { SupportedLang } from '@ptah-extension/i18n';
import { provideI18nTesting } from '@ptah-extension/i18n/testing';

import { FooterComponent } from './footer.component';
import uiAr from './i18n/ar.json';
import uiEn from './i18n/en.json';

describe('FooterComponent', () => {
  const render = (lang: SupportedLang): HTMLElement => {
    TestBed.configureTestingModule({
      imports: [FooterComponent],
      providers: [
        provideRouter([]),
        provideI18nTesting({
          lang,
          translations: { en: { ui: uiEn }, ar: { ui: uiAr } },
        }),
      ],
    });
    const fixture = TestBed.createComponent(FooterComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  const texts = (host: HTMLElement, selector: string): string[] =>
    Array.from(host.querySelectorAll(selector)).map(
      (el) => el.textContent?.trim() ?? '',
    );

  const attrs = (host: HTMLElement, selector: string, name: string) =>
    Array.from(host.querySelectorAll(selector)).map((el) =>
      el.getAttribute(name),
    );

  it('renders every keyed English string verbatim', () => {
    const host = render('en');

    expect(host.querySelector('img')?.getAttribute('alt')).toBe('Ptah logo');
    expect(texts(host, 'p')).toEqual([
      'Ptah is a persistent, multi-agent AI coding desktop app. Choose your model — no lock-in.',
      'Powered by Claude Agent SDK',
      '© 2026 Ptah Extension. All rights reserved.',
      'Persistent AI coding agent for developers.',
    ]);
    expect(texts(host, 'h3')).toEqual(['Product', 'Community', 'Legal']);
    expect(attrs(host, 'nav', 'aria-label')).toEqual([
      'Product links',
      'Community links',
      'Legal links',
    ]);
    expect(texts(host, 'nav a')).toEqual([
      'Download',
      'Pricing',
      'VS Code Extension',
      'CLI Docs',
      'Documentation',
      'Discord',
      'GitHub',
      'Reddit',
      'LinkedIn',
      'Privacy',
      'Terms',
      'Refund Policy',
    ]);
    // The social icon links are the footer's only labelled anchors.
    expect(attrs(host, 'a[aria-label]', 'aria-label')).toEqual([
      'Join Discord server',
      'View on GitHub',
      'Join Reddit community',
      'Follow on LinkedIn',
    ]);
  });

  it('renders Arabic from the same keys, keeping brand names in Latin script', () => {
    const host = render('ar');

    expect(host.querySelector('img')?.getAttribute('alt')).toBe('شعار Ptah');
    expect(texts(host, 'h3')).toEqual(['المنتج', 'المجتمع', 'قانوني']);
    expect(attrs(host, 'nav', 'aria-label')).toEqual([
      'روابط المنتج',
      'روابط المجتمع',
      'روابط قانوني',
    ]);
    expect(texts(host, 'nav a')).toEqual([
      'التنزيل',
      'الأسعار',
      'إضافة VS Code',
      'وثائق CLI',
      'الوثائق',
      'Discord',
      'GitHub',
      'Reddit',
      'LinkedIn',
      'الخصوصية',
      'الشروط',
      'سياسة الاسترداد',
    ]);
    expect(texts(host, 'p')).toContain(
      '© 2026 Ptah Extension. جميع الحقوق محفوظة.',
    );
    expect(attrs(host, 'a[aria-label]', 'aria-label')).toEqual([
      'انضم إلى خادم Discord',
      'عرض على GitHub',
      'انضم إلى مجتمع Reddit',
      'تابعنا على LinkedIn',
    ]);
  });
});
