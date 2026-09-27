// Language data
export {
  SUPPORTED_LANGS,
  DEFAULT_LANG,
  isSupportedLang,
  LANG_DIRECTION,
  ANGULAR_LOCALE,
  INTL_LOCALE,
  LANG_NATIVE_NAME,
} from './lib/lang.config';
export type { SupportedLang, LangDirection } from './lib/lang.config';

// Detection and persistence
export { resolveInitialLang } from './lib/resolve-initial-lang';
export type { InitialLangInput } from './lib/resolve-initial-lang';
export { LangPreferenceStore } from './lib/lang-preference.store';

// Scopes and messages
export { defineI18nScope } from './lib/i18n-scope';
export type { I18nScope, I18nScopeLoaders } from './lib/i18n-scope';
export type { I18nMessage } from './lib/i18n-message';
