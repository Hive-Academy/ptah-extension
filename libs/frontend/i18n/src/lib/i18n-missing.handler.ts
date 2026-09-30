import {
  inject,
  Injectable,
  InjectionToken,
  Injector,
  isDevMode,
} from '@angular/core';
import {
  TranslocoService,
  type Translation,
  type TranslocoMissingHandler,
  type TranslocoMissingHandlerData,
} from '@jsverse/transloco';
import { I18nError } from './i18n.error';
import { DEFAULT_LANG } from './lang.config';

/**
 * What happens to a key found in no loaded language: `report` (the app) warns
 * in dev and renders `''`; `throw` (`provideI18nTesting`) fails the spec.
 */
export type MissingKeyPolicy = 'report' | 'throw';

/** @internal Set by `provideI18n` / `provideI18nTesting`. */
export const I18N_MISSING_KEY_POLICY = new InjectionToken<MissingKeyPolicy>(
  'I18N_MISSING_KEY_POLICY',
  { providedIn: 'root', factory: () => 'report' },
);

/**
 * Replaces Transloco's `DefaultMissingHandler`, which renders the raw key.
 *
 * A key missing in the requested language renders its English value (with a
 * dev warning). A key missing in English too renders `''`, never the key; under
 * the `throw` policy it throws an `I18nError` instead, so a spec with a
 * mistyped key fails at once.
 */
@Injectable()
export class I18nMissingHandler implements TranslocoMissingHandler {
  private readonly injector = inject(Injector);
  private readonly policy = inject(I18N_MISSING_KEY_POLICY);
  /** Set while the English lookup runs, which re-enters this handler on a miss. */
  private resolvingEnglish = false;
  /** First miss under the `throw` policy not yet surfaced; see `takeFailure`. */
  private failure: I18nError | null = null;

  handle(
    key: string,
    data: TranslocoMissingHandlerData,
    params?: Translation,
  ): string {
    if (this.resolvingEnglish) return '';

    const english = this.englishValue(key, params);
    if (english !== '') {
      if (isDevMode()) {
        console.warn(
          `[i18n] missing "${key}" in "${data.activeLang}"; using English.`,
        );
      }
      return english;
    }

    if (this.policy === 'throw') {
      const error = new I18nError(
        `[i18n] Missing translation "${key}" in every loaded language (active "${data.activeLang}").`,
      );
      this.failure ??= error;
      throw error;
    }
    if (isDevMode()) {
      console.warn(
        `[i18n] missing "${key}" in "${data.activeLang}" and in English.`,
      );
    }
    return '';
  }

  /**
   * @internal Returns and clears the first `throw`-policy miss.
   * `TranslocoPipe` translates inside an RxJS subscriber, which turns the
   * throw above into an asynchronous unhandled error that no spec awaits;
   * `provideI18nTesting` rethrows this at TestBed teardown instead.
   */
  takeFailure(): I18nError | null {
    const failure = this.failure;
    this.failure = null;
    return failure;
  }

  /**
   * `TranslocoService` injects this handler, so it is resolved lazily here to
   * avoid a construction cycle.
   */
  private englishValue(key: string, params: Translation | undefined): string {
    this.resolvingEnglish = true;
    try {
      const value: unknown = this.injector
        .get(TranslocoService)
        .translate(key, params ?? {}, DEFAULT_LANG);
      return typeof value === 'string' ? value : '';
    } finally {
      this.resolvingEnglish = false;
    }
  }
}
