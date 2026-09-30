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

// Errors
export { I18nError } from './lib/i18n.error';

// Runtime
export { provideI18n } from './lib/provide-i18n';
export type { I18nOptions } from './lib/i18n-options';
export { I18nService } from './lib/i18n.service';
export { i18nScopesResolver } from './lib/i18n-scopes.resolver';
export type { I18nScopesSource } from './lib/i18n-scopes.resolver';

// Template and signal helpers (consumers never import @jsverse/transloco)
export { TranslocoPipe, translateSignal } from '@jsverse/transloco';
export { I18nDatePipe } from './lib/pipes/i18n-date.pipe';
export { I18nNumberPipe } from './lib/pipes/i18n-number.pipe';
