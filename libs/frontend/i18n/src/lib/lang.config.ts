/**
 * Language data for every app that uses `@ptah-extension/i18n`.
 *
 * Pure data and helpers, no Angular: the pre-paint inline script, the
 * `i18n-check` tool and the runtime all agree on these values.
 */

export const SUPPORTED_LANGS = ['en', 'ar'] as const;

export type SupportedLang = (typeof SUPPORTED_LANGS)[number];

export type LangDirection = 'ltr' | 'rtl';

export const DEFAULT_LANG: SupportedLang = 'en';

export function isSupportedLang(value: unknown): value is SupportedLang {
  return (
    typeof value === 'string' &&
    (SUPPORTED_LANGS as readonly string[]).includes(value)
  );
}

export const LANG_DIRECTION: Readonly<Record<SupportedLang, LangDirection>> = {
  en: 'ltr',
  ar: 'rtl',
};

/** Locale id passed to Angular `formatDate` / `formatNumber`. */
export const ANGULAR_LOCALE: Readonly<Record<SupportedLang, string>> = {
  en: 'en-US',
  ar: 'ar',
};

/**
 * Locale passed to raw `Intl` APIs. Arabic keeps Western (Latin) digits via the
 * `nu-latn` Unicode extension, the approved numbering decision.
 */
export const INTL_LOCALE: Readonly<Record<SupportedLang, string>> = {
  en: 'en-US',
  ar: 'ar-u-nu-latn',
};

/** Each language's name written in that language, for the switcher. */
export const LANG_NATIVE_NAME: Readonly<Record<SupportedLang, string>> = {
  en: 'English',
  ar: 'العربية',
};
