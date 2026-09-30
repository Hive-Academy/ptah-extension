/**
 * `@ptah-extension/i18n/testing`: spec-only providers. Never import this from
 * production code.
 */
export { provideI18nTesting } from './provide-i18n-testing';
export { loadScopeTranslations } from './load-scope-translations';
export type {
  I18nTestingOptions,
  ScopeTranslations,
} from './provide-i18n-testing';
