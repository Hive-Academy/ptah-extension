import {
  ANGULAR_LOCALE,
  DEFAULT_LANG,
  INTL_LOCALE,
  LANG_DIRECTION,
  LANG_NATIVE_NAME,
  SUPPORTED_LANGS,
  isSupportedLang,
} from './lang.config';

describe('lang.config', () => {
  it('supports English and Arabic, English by default', () => {
    expect(SUPPORTED_LANGS).toEqual(['en', 'ar']);
    expect(DEFAULT_LANG).toBe('en');
  });

  it.each(['en', 'ar'])('accepts %s', (value) => {
    expect(isSupportedLang(value)).toBe(true);
  });

  it.each([['xx'], ['EN'], ['ar-EG'], [''], [null], [undefined], [1], [{}]])(
    'rejects %p',
    (value) => {
      expect(isSupportedLang(value)).toBe(false);
    },
  );

  it('maps every language to a direction and locales', () => {
    expect(LANG_DIRECTION).toEqual({ en: 'ltr', ar: 'rtl' });
    expect(ANGULAR_LOCALE).toEqual({ en: 'en-US', ar: 'ar' });
    expect(INTL_LOCALE).toEqual({ en: 'en-US', ar: 'ar-u-nu-latn' });
    expect(LANG_NATIVE_NAME).toEqual({ en: 'English', ar: 'العربية' });
  });

  it('keeps Western digits for Arabic through INTL_LOCALE', () => {
    const formatted = new Intl.NumberFormat(INTL_LOCALE.ar).format(1234.5);
    expect(formatted).not.toMatch(/[٠-٩]/);
    expect(formatted).toMatch(/1/);
  });
});
