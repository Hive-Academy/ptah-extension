import * as angularCore from '@angular/core';
import { Injectable } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  TranslocoService,
  type Translation,
  type TranslocoLoader,
} from '@jsverse/transloco';
import { of, type Observable } from 'rxjs';
import { I18nError } from './i18n.error';
import type { MissingKeyPolicy } from './i18n-missing.handler';
import { provideI18nRuntime } from './provide-i18n';

jest.mock('@angular/core', () => ({
  ...jest.requireActual<typeof angularCore>('@angular/core'),
  isDevMode: jest.fn(() => true),
}));

const isDevMode = jest.mocked(angularCore.isDevMode);

const ROOT: Record<string, Translation> = {
  en: { shared: 'Shared', englishOnly: 'Only English', greet: 'Hi {{name}}' },
  ar: { shared: 'مشترك' },
};

@Injectable()
class FixedLoader implements TranslocoLoader {
  getTranslation(lang: string): Observable<Translation> {
    return of(ROOT[lang] ?? {});
  }
}

function setup(missingKeys: MissingKeyPolicy): TranslocoService {
  TestBed.configureTestingModule({
    providers: [
      provideI18nRuntime({
        options: { storageKey: 'spec.lang', globalScopes: [] },
        initialLang: 'ar',
        rootLoader: FixedLoader,
        missingKeys,
        prodMode: true,
      }),
    ],
  });
  const transloco = TestBed.inject(TranslocoService);
  transloco.load('en').subscribe();
  transloco.load('ar').subscribe();
  return transloco;
}

describe('I18nMissingHandler', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    isDevMode.mockReturnValue(true);
  });

  describe('report policy (the app)', () => {
    it('renders the English value when the active language misses a key', () => {
      const transloco = setup('report');

      expect(transloco.translate('shared')).toBe('مشترك');
      expect(transloco.translate('englishOnly')).toBe('Only English');
      expect(transloco.translate('greet', { name: 'Sam' })).toBe('Hi Sam');
    });

    it('warns in dev about the English fallback', () => {
      const transloco = setup('report');

      transloco.translate('englishOnly');

      expect(warn).toHaveBeenCalledWith(
        '[i18n] missing "englishOnly" in "ar"; using English.',
      );
    });

    it('renders "" in production for a key missing in both, never the key', () => {
      isDevMode.mockReturnValue(false);
      const transloco = setup('report');

      expect(transloco.translate('nowhere.to.be.found')).toBe('');
      expect(transloco.translate('nowhere.to.be.found', {}, 'en')).toBe('');
      expect(warn).not.toHaveBeenCalled();
    });

    it('also renders "" in dev, with a warning', () => {
      const transloco = setup('report');

      expect(transloco.translate('nowhere')).toBe('');
      expect(warn).toHaveBeenCalledWith(
        '[i18n] missing "nowhere" in "ar" and in English.',
      );
    });

    it('stays usable after a miss (the re-entrancy guard resets)', () => {
      const transloco = setup('report');

      transloco.translate('nowhere');

      expect(transloco.translate('englishOnly')).toBe('Only English');
    });
  });

  describe('throw policy (provideI18nTesting)', () => {
    it('throws an I18nError for a key missing in every language', () => {
      const transloco = setup('throw');

      expect(() => transloco.translate('typo.key')).toThrow(I18nError);
      expect(() => transloco.translate('typo.key')).toThrow(
        '[i18n] Missing translation "typo.key"',
      );
    });

    it('still falls back to English when only the active language misses', () => {
      const transloco = setup('throw');

      expect(transloco.translate('englishOnly')).toBe('Only English');
    });
  });
});
