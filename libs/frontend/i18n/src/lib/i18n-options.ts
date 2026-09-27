import { InjectionToken } from '@angular/core';
import type { I18nScope } from './i18n-scope';

/** What an app passes to `provideI18n`. */
export interface I18nOptions {
  /** `localStorage` key holding the visitor's choice (e.g. `ptah.lang`). */
  readonly storageKey: string;
  /**
   * Scopes every view may use (for the landing app: `app`, `ui`, `core`).
   * They load before bootstrap finishes, for the active language and English.
   */
  readonly globalScopes: readonly I18nScope[];
}

/**
 * The app's `I18nOptions`. Kept apart from `provide-i18n.ts` so that
 * `I18nService` can read it without an import cycle through the provider.
 */
export const I18N_OPTIONS = new InjectionToken<I18nOptions>('I18N_OPTIONS');
