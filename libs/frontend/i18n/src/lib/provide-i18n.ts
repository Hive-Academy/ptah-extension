import { registerLocaleData } from '@angular/common';
import localeAr from '@angular/common/locales/ar';
import {
  inject,
  Injectable,
  isDevMode,
  makeEnvironmentProviders,
  provideAppInitializer,
  provideEnvironmentInitializer,
  type EnvironmentProviders,
  type Type,
} from '@angular/core';
import {
  provideTransloco,
  provideTranslocoFallbackStrategy,
  provideTranslocoMissingHandler,
  type Translation,
  type TranslocoFallbackStrategy,
  type TranslocoLoader,
} from '@jsverse/transloco';
import { of, type Observable } from 'rxjs';
import {
  I18N_MISSING_KEY_POLICY,
  I18nMissingHandler,
  type MissingKeyPolicy,
} from './i18n-missing.handler';
import { I18N_OPTIONS, type I18nOptions } from './i18n-options';
import { I18nService } from './i18n.service';
import {
  DEFAULT_LANG,
  SUPPORTED_LANGS,
  type SupportedLang,
} from './lang.config';

/**
 * Wires i18n into an app: Transloco, the missing-key handler, Arabic locale
 * data, and an app initializer that resolves the language and loads the
 * global scopes before the first render.
 *
 * ```ts
 * provideI18n({ storageKey: 'ptah.lang', globalScopes: [APP_I18N_SCOPE, UI_I18N_SCOPE, CORE_I18N_SCOPE] })
 * ```
 */
export function provideI18n(options: I18nOptions): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideI18nRuntime({
      options,
      initialLang: DEFAULT_LANG,
      rootLoader: EmptyRootLoader,
      missingKeys: 'report',
      prodMode: !isDevMode(),
    }),
    provideAppInitializer(() => inject(I18nService).init()),
  ]);
}

/** @internal What differs between the app runtime and the testing runtime. */
export interface I18nRuntimeSetup {
  readonly options: I18nOptions;
  /** Transloco's default language, which seeds `I18nService.lang`. */
  readonly initialLang: SupportedLang;
  readonly rootLoader: Type<TranslocoLoader>;
  readonly missingKeys: MissingKeyPolicy;
  readonly prodMode: boolean;
}

/**
 * @internal Shared by `provideI18n` and `provideI18nTesting`, so both run the
 * same Transloco configuration and provider order.
 */
export function provideI18nRuntime(
  setup: I18nRuntimeSetup,
): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: I18N_OPTIONS, useValue: setup.options },
    { provide: I18N_MISSING_KEY_POLICY, useValue: setup.missingKeys },
    ...provideTransloco({
      config: {
        availableLangs: [...SUPPORTED_LANGS],
        defaultLang: setup.initialLang,
        fallbackLang: DEFAULT_LANG,
        reRenderOnLangChange: true,
        prodMode: setup.prodMode,
        failedRetries: 1,
        missingHandler: {
          useFallbackTranslation: false,
          logMissingKey: false,
          allowEmpty: false,
        },
        scopes: { keepCasing: true },
      },
      loader: setup.rootLoader,
    }),
    // Both AFTER provideTransloco, which registers its own defaults for these
    // two tokens; the later provider wins.
    provideTranslocoMissingHandler(I18nMissingHandler),
    provideTranslocoFallbackStrategy(NoLoadFallbackStrategy),
    provideEnvironmentInitializer(() => registerLocaleData(localeAr, 'ar')),
  ]);
}

/**
 * Root translations are empty: all content lives in scopes, bundled as JSON
 * chunks, so no `HttpClient` is involved.
 */
@Injectable()
class EmptyRootLoader implements TranslocoLoader {
  getTranslation(): Observable<Translation> {
    return of({});
  }
}

/**
 * Makes a failed load fail. Transloco's default strategy would load the
 * fallback language instead and then switch the active language to it, which
 * silently desynchronises Transloco from `I18nService` and hides the failure
 * from `setLanguage`. `I18nService` owns the fallback to English itself.
 */
@Injectable()
class NoLoadFallbackStrategy implements TranslocoFallbackStrategy {
  getNextLangs(): string[] {
    return [];
  }
}
