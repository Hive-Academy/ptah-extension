import {
  DestroyRef,
  inject,
  Injectable,
  InjectionToken,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
  type EnvironmentProviders,
} from '@angular/core';
import {
  TRANSLOCO_MISSING_HANDLER,
  TranslocoService,
  type Translation,
  type TranslocoLoader,
} from '@jsverse/transloco';
import { of, type Observable } from 'rxjs';
import { I18nMissingHandler } from '../lib/i18n-missing.handler';
import { provideI18nRuntime } from '../lib/provide-i18n';
import {
  DEFAULT_LANG,
  isSupportedLang,
  SUPPORTED_LANGS,
  type SupportedLang,
} from '../lib/lang.config';

/** Scope name to that scope's JSON, e.g. `{ pricing: pricingEn, ui: uiEn }`. */
export type ScopeTranslations = Readonly<Record<string, Translation>>;

export interface I18nTestingOptions {
  /** The language the spec starts in. Default `en`. */
  readonly lang?: SupportedLang;
  /**
   * Per language, each scope's translations, e.g.
   * `{ en: { pricing: pricingEn, ui: uiEn, core: coreEn }, ar: { pricing: pricingAr } }`.
   * Pass every language the spec renders or switches to; a key missing in the
   * active language renders its English value, as in the app.
   */
  readonly translations: Partial<Record<SupportedLang, ScopeTranslations>>;
}

/** Storage key for `setLanguage` in specs, apart from any app key. */
const TESTING_STORAGE_KEY = 'ptah.i18n.testing';

const TESTING_TRANSLATIONS = new InjectionToken<
  I18nTestingOptions['translations']
>('I18N_TESTING_TRANSLATIONS');

/**
 * The app's i18n runtime with the translations a spec hands in, available
 * synchronously: the first `detectChanges()` renders translated text.
 *
 * `I18nService` starts in `lang` without touching storage or the document.
 * A key missing from every provided language fails the spec with an
 * `I18nError`: at once when translated from TypeScript or read through
 * `translateSignal`, and at TestBed's teardown after the test when rendered
 * through the `transloco` pipe (see below).
 */
export function provideI18nTesting(
  options: I18nTestingOptions,
): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideI18nRuntime({
      options: { storageKey: TESTING_STORAGE_KEY, globalScopes: [] },
      initialLang: options.lang ?? DEFAULT_LANG,
      rootLoader: TestingRootLoader,
      missingKeys: 'throw',
      prodMode: true,
    }),
    { provide: TESTING_TRANSLATIONS, useValue: options.translations },
    // Loads every provided language up front (the loader replays
    // synchronously), so `translate(key, {}, 'en')` works while `ar` is
    // active.
    provideEnvironmentInitializer(() => {
      const transloco = inject(TranslocoService);
      for (const lang of SUPPORTED_LANGS) {
        if (options.translations[lang]) transloco.load(lang).subscribe();
      }
    }),
    // A mistyped key in a template throws inside TranslocoPipe's
    // subscription, where RxJS defers it to a timer that no spec awaits. The
    // handler keeps that failure, and TestBed's teardown after each test
    // (which rethrows errors) fails the test with it.
    provideEnvironmentInitializer(() => {
      const handler = inject(TRANSLOCO_MISSING_HANDLER);
      if (!(handler instanceof I18nMissingHandler)) return;
      inject(DestroyRef).onDestroy(() => {
        const failure = handler.takeFailure();
        if (failure) throw failure;
      });
    }),
  ]);
}

/**
 * Serves each language's map as the root translation. Scope maps sit under
 * their scope name, which yields the same `scope.key` paths as a scope load.
 */
@Injectable()
class TestingRootLoader implements TranslocoLoader {
  private readonly translations = inject(TESTING_TRANSLATIONS);

  getTranslation(lang: string): Observable<Translation> {
    return of(isSupportedLang(lang) ? { ...this.translations[lang] } : {});
  }
}
