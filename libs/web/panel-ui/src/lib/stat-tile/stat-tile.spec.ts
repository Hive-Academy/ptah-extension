import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { I18nService } from '@ptah-extension/i18n';
import { provideI18nTesting } from '@ptah-extension/i18n/testing';

import panelUiAr from '../i18n/ar.json';
import panelUiEn from '../i18n/en.json';
import { StatTile } from './stat-tile';

describe('StatTile value formatting', () => {
  let fixture: ComponentFixture<StatTile>;

  const valueText = (): string =>
    (
      (fixture.nativeElement as HTMLElement).querySelector('.tabular-nums')
        ?.textContent ?? ''
    ).trim();

  const render = (value: string | number | null): void => {
    fixture.componentRef.setInput('value', value);
    fixture.detectChanges();
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [StatTile],
      providers: [
        provideRouter([]),
        provideI18nTesting({
          translations: {
            en: { panelUi: panelUiEn },
            ar: { panelUi: panelUiAr },
          },
        }),
      ],
    });
    fixture = TestBed.createComponent(StatTile);
  });

  afterEach(() => {
    document.documentElement.lang = 'en';
    document.documentElement.dir = 'ltr';
  });

  it('formats a number for the active language', () => {
    render(1234);
    expect(valueText()).toBe('1,234');
  });

  it('keeps Western digits in Arabic and re-formats on a switch', async () => {
    render(1234.5);
    await TestBed.inject(I18nService).setLanguage('ar');
    fixture.detectChanges();

    expect(valueText()).toBe('1,234.5');
    expect(valueText()).not.toMatch(/[٠-٩]/);
  });

  it('shows a caller-formatted string as given', () => {
    render('98.2%');
    expect(valueText()).toBe('98.2%');
  });

  it('falls back to an em dash for null and empty', () => {
    render(null);
    expect(valueText()).toBe('—');
    render('');
    expect(valueText()).toBe('—');
  });

  describe('link chevron', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('link', '/admin/users');
      fixture.componentRef.setInput('value', 3);
      fixture.detectChanges();
    });

    it('mirrors through a wrapper, never on lucide-angular itself', () => {
      // lucide-angular copies its host's static classes onto the inner <svg>,
      // so a flip on the host is applied twice and cancels.
      const icon = (fixture.nativeElement as HTMLElement).querySelector(
        'lucide-angular',
      );
      const wrapper = icon?.parentElement;

      expect(wrapper?.tagName).toBe('SPAN');
      expect(wrapper?.classList).toContain('rtl:scale-x-[-1]');
      expect(wrapper?.getAttribute('aria-hidden')).toBe('true');
      expect(icon?.classList).not.toContain('rtl:scale-x-[-1]');
      expect(icon?.querySelector('svg')?.classList).not.toContain(
        'rtl:scale-x-[-1]',
      );
    });

    it('keeps one physical hover nudge on the icon (the wrapper flips it)', () => {
      const icon = (fixture.nativeElement as HTMLElement).querySelector(
        'lucide-angular',
      );
      expect(icon?.classList).toContain('group-hover:translate-x-0.5');
      expect(icon?.classList).not.toContain('rtl:group-hover:-translate-x-0.5');
    });
  });
});
