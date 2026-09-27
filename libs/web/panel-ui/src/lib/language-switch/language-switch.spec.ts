import { ComponentFixture, TestBed } from '@angular/core/testing';
import { I18nService, type SupportedLang } from '@ptah-extension/i18n';
import {
  loadScopeTranslations,
  provideI18nTesting,
} from '@ptah-extension/i18n/testing';
import { UI_I18N_SCOPE } from '@ptah-web/ui';

import { LanguageSwitch } from './language-switch';

describe('LanguageSwitch', () => {
  let fixture: ComponentFixture<LanguageSwitch>;
  let host: HTMLElement;

  const group = (): HTMLElement => {
    const el = host.querySelector<HTMLElement>('[role="radiogroup"]');
    if (!el) throw new Error('radiogroup not rendered');
    return el;
  };

  const radio = (lang: SupportedLang): HTMLButtonElement => {
    const el = host.querySelector<HTMLButtonElement>(
      `[role="radio"][lang="${lang}"]`,
    );
    if (!el) throw new Error(`radio ${lang} not rendered`);
    return el;
  };

  /** `setLanguage` awaits its scope loads before it applies. */
  const settle = async (): Promise<void> => {
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const press = async (key: string): Promise<KeyboardEvent> => {
    const event = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
    });
    radio(TestBed.inject(I18nService).lang()).dispatchEvent(event);
    await settle();
    return event;
  };

  const setup = async (lang: SupportedLang): Promise<void> => {
    const ui = await loadScopeTranslations(UI_I18N_SCOPE);
    TestBed.configureTestingModule({
      imports: [LanguageSwitch],
      providers: [
        provideI18nTesting({
          lang,
          translations: { en: { ui: ui.en }, ar: { ui: ui.ar } },
        }),
      ],
    });
    fixture = TestBed.createComponent(LanguageSwitch);
    host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
    fixture.detectChanges();
  };

  afterEach(() => {
    host.remove();
    document.documentElement.lang = 'en';
    document.documentElement.dir = 'ltr';
  });

  describe('in English (ltr)', () => {
    beforeEach(() => setup('en'));

    it('is a radiogroup named by the translated "Language" key', () => {
      expect(group().getAttribute('aria-label')).toBe('Language');
    });

    it('checks the active language and gives only it tabIndex 0', () => {
      expect(radio('en').getAttribute('aria-checked')).toBe('true');
      expect(radio('ar').getAttribute('aria-checked')).toBe('false');
      expect(radio('en').tabIndex).toBe(0);
      expect(radio('ar').tabIndex).toBe(-1);
    });

    it('starts each accessible name with the visible code (label in name)', () => {
      for (const lang of ['en', 'ar'] as const) {
        const caption = radio(lang).textContent?.trim() ?? '';
        expect(caption).toBe(lang.toUpperCase());
        expect(radio(lang).getAttribute('aria-label')).toMatch(
          new RegExp(`^${caption} — `),
        );
      }
      expect(radio('en').getAttribute('aria-label')).toBe(
        'EN — Language: English',
      );
      expect(radio('ar').getAttribute('aria-label')).toBe(
        'AR — Language: العربية',
      );
    });

    it('gives each option its own lang and dir', () => {
      expect(radio('en').getAttribute('dir')).toBe('ltr');
      expect(radio('ar').getAttribute('dir')).toBe('rtl');
    });

    it('shows the check icon on the selected option only', () => {
      expect(radio('en').querySelector('lucide-angular')).not.toBeNull();
      expect(radio('ar').querySelector('lucide-angular')).toBeNull();
    });

    it('ArrowRight selects ar, moves tabIndex and focus with it', async () => {
      const event = await press('ArrowRight');

      expect(event.defaultPrevented).toBe(true);
      expect(TestBed.inject(I18nService).lang()).toBe('ar');
      expect(radio('ar').getAttribute('aria-checked')).toBe('true');
      expect(radio('ar').tabIndex).toBe(0);
      expect(radio('en').tabIndex).toBe(-1);
      expect(document.activeElement).toBe(radio('ar'));
    });

    it('ArrowLeft from en wraps to ar, ArrowDown is direction-independent', async () => {
      await press('ArrowLeft');
      expect(TestBed.inject(I18nService).lang()).toBe('ar');
      await press('ArrowDown');
      expect(TestBed.inject(I18nService).lang()).toBe('en');
    });

    it('ignores keys that are not arrows', async () => {
      const event = await press('a');
      expect(event.defaultPrevented).toBe(false);
      expect(TestBed.inject(I18nService).lang()).toBe('en');
    });

    describe('when the switch fails', () => {
      let unhandled: unknown[];
      const onUnhandled = (reason: unknown): void => {
        unhandled.push(reason);
      };

      beforeEach(() => {
        unhandled = [];
        process.on('unhandledRejection', onUnhandled);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
      });

      afterEach(() => {
        process.off('unhandledRejection', onUnhandled);
        jest.restoreAllMocks();
      });

      /** Lets a rejection that nobody handled reach the process listener. */
      const flushRejections = (): Promise<void> =>
        new Promise((resolve) => setTimeout(resolve, 0));

      const expectStillEnglish = (): void => {
        expect(TestBed.inject(I18nService).lang()).toBe('en');
        expect(radio('en').getAttribute('aria-checked')).toBe('true');
        expect(radio('ar').getAttribute('aria-checked')).toBe('false');
        expect(radio('en').tabIndex).toBe(0);
        expect(radio('ar').tabIndex).toBe(-1);
        expect(group().contains(document.activeElement)).toBe(true);
        expect(document.activeElement).toBe(radio('en'));
      };

      it('keeps the previous language checked and focused when setLanguage rejects', async () => {
        jest
          .spyOn(TestBed.inject(I18nService), 'setLanguage')
          .mockRejectedValue(new Error('chunk load failed'));

        await press('ArrowRight');
        await flushRejections();
        fixture.detectChanges();

        expectStillEnglish();
        expect(console.error).toHaveBeenCalledTimes(1);
        expect(unhandled).toEqual([]);
      });

      it('does the same when setLanguage resolves false (load failure)', async () => {
        jest
          .spyOn(TestBed.inject(I18nService), 'setLanguage')
          .mockResolvedValue(false);

        await press('ArrowRight');
        await flushRejections();
        fixture.detectChanges();

        expectStillEnglish();
        expect(unhandled).toEqual([]);
      });

      it('returns focus from a clicked option that did not apply', async () => {
        jest
          .spyOn(TestBed.inject(I18nService), 'setLanguage')
          .mockRejectedValue(new Error('chunk load failed'));

        radio('ar').focus();
        radio('ar').click();
        await settle();
        await flushRejections();
        fixture.detectChanges();

        expectStillEnglish();
        expect(unhandled).toEqual([]);
      });
    });

    it('selects on click and translates the group name', async () => {
      radio('ar').click();
      await settle();

      expect(TestBed.inject(I18nService).lang()).toBe('ar');
      expect(group().getAttribute('aria-label')).toBe('اللغة');
      expect(radio('ar').getAttribute('aria-label')).toBe(
        'AR — اللغة: العربية',
      );
    });
  });

  describe('in Arabic (rtl)', () => {
    beforeEach(() => setup('ar'));

    it('ArrowRight selects en (toward reading-start)', async () => {
      await press('ArrowRight');
      expect(TestBed.inject(I18nService).lang()).toBe('en');
      expect(radio('en').tabIndex).toBe(0);
      expect(document.activeElement).toBe(radio('en'));
    });

    it('ArrowLeft moves toward reading-end and wraps from ar to en', async () => {
      await press('ArrowLeft');
      expect(TestBed.inject(I18nService).lang()).toBe('en');
    });

    it('ArrowUp is direction-independent', async () => {
      await press('ArrowUp');
      expect(TestBed.inject(I18nService).lang()).toBe('en');
    });
  });
});
