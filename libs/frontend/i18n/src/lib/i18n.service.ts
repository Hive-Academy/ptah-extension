import { isPlatformBrowser } from '@angular/common';
import {
  computed,
  DOCUMENT,
  inject,
  Injectable,
  isDevMode,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { TranslocoService, type Translation } from '@jsverse/transloco';
import { defer, from, lastValueFrom, type Observable } from 'rxjs';
import { I18nError } from './i18n.error';
import type { I18nMessage } from './i18n-message';
import { I18N_OPTIONS } from './i18n-options';
import { scopeLoadPath, type I18nScope } from './i18n-scope';
import {
  ANGULAR_LOCALE,
  DEFAULT_LANG,
  INTL_LOCALE,
  isSupportedLang,
  LANG_DIRECTION,
  type SupportedLang,
} from './lang.config';
import { LangPreferenceStore } from './lang-preference.store';
import { resolveInitialLang } from './resolve-initial-lang';

/**
 * The active language and everything derived from it, for the app's lifetime.
 *
 * Text never renders in a language whose scopes are not loaded yet: `init()`
 * loads the global scopes before bootstrap finishes, route resolvers load
 * feature scopes through `loadScopes()` before navigation ends, and
 * `setLanguage()` loads every registered scope before it switches. Transloco
 * stores late loads without re-rendering, so these gates are what keep a
 * render complete.
 */
@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly transloco = inject(TranslocoService);
  private readonly document = inject(DOCUMENT);
  private readonly options = inject(I18N_OPTIONS);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly store = new LangPreferenceStore(
    this.options.storageKey,
    this.isBrowser,
  );

  /** Every scope registered so far, keyed by scope name. */
  private readonly registry = new Map<string, I18nScope>();

  /** `scope/lang` paths stored in Transloco. A failed path is never added. */
  private readonly loadedPaths = new Set<string>();
  /** Scope loads in progress, so concurrent callers share one loader call. */
  private readonly inFlight = new Map<string, Promise<void>>();

  /**
   * Starts as Transloco's active language: `en` in the app (its default),
   * the seeded language under `provideI18nTesting`.
   */
  private readonly current = signal<SupportedLang>(
    toSupportedLang(this.transloco.getActiveLang()),
  );

  /** Incremented by every `init`/`setLanguage`; only the latest may apply. */
  private latestRequest = 0;

  readonly lang = this.current.asReadonly();
  readonly direction = computed(() => LANG_DIRECTION[this.current()]);
  /** Angular locale id, for `formatDate` / `formatNumber`. */
  readonly locale = computed(() => ANGULAR_LOCALE[this.current()]);
  /** Locale for raw `Intl` APIs (`ar-u-nu-latn` keeps Western digits). */
  readonly intlLocale = computed(() => INTL_LOCALE[this.current()]);

  /**
   * Resolves the initial language and loads the global scopes for it and for
   * English. Never rejects: when loading fails it logs once, falls back to
   * English and lets bootstrap continue. The server always renders English.
   */
  async init(): Promise<void> {
    const request = ++this.latestRequest;
    const lang = this.detectLang();
    try {
      this.register(this.options.globalScopes);
      await this.load(withEnglish(lang), this.registeredScopes());
    } catch (error) {
      console.error(
        `[i18n] Could not load "${lang}" at startup; continuing in English.`,
        error,
      );
      if (lang !== DEFAULT_LANG) await this.retryEnglish();
      if (request === this.latestRequest) this.apply(DEFAULT_LANG);
      return;
    }
    if (request === this.latestRequest) this.apply(lang);
  }

  /**
   * Loads every registered scope in `lang`, then switches to it and stores the
   * choice. Resolves `false`, with the state unchanged, when loading fails or
   * a later call superseded this one (the latest call wins).
   */
  async setLanguage(lang: SupportedLang): Promise<boolean> {
    const request = ++this.latestRequest;
    try {
      await this.loadRegistered(lang);
    } catch (error) {
      console.error(`[i18n] Could not switch to "${lang}".`, error);
      return false;
    }
    if (request !== this.latestRequest) return false;
    this.apply(lang);
    this.store.write(lang);
    return true;
  }

  /**
   * Registers `scopes` and loads them for the active language and English.
   * Used by `i18nScopesResolver`; completes once, after everything loaded.
   */
  loadScopes(scopes: readonly I18nScope[]): Observable<void> {
    return defer(() => {
      this.register(scopes);
      return from(this.load(withEnglish(this.current()), scopes));
    });
  }

  /**
   * Instant translation for text built in TypeScript (toasts, `aria` text).
   * Only keys of loaded scopes resolve; `lang` defaults to the active one.
   */
  translate(
    key: string,
    params?: I18nMessage['params'],
    lang?: SupportedLang,
  ): string {
    return this.transloco.translate<string>(key, { ...params }, lang);
  }

  private detectLang(): SupportedLang {
    if (!this.isBrowser) return DEFAULT_LANG;
    return resolveInitialLang({
      stored: this.store.read(),
      languages: this.document.defaultView?.navigator?.languages,
    });
  }

  /**
   * A name registered twice must be the same scope. In dev a different scope
   * under a known name is a wiring mistake and throws; in production the
   * first registration is kept.
   */
  private register(scopes: readonly I18nScope[]): void {
    for (const scope of scopes) {
      const known = this.registry.get(scope.scope);
      if (known === undefined) {
        this.registry.set(scope.scope, scope);
      } else if (known.loader !== scope.loader && isDevMode()) {
        throw new I18nError(
          `[i18n] Scope "${scope.scope}" is already registered with a different loader; define each scope once and import that definition.`,
        );
      }
    }
  }

  private registeredScopes(): I18nScope[] {
    return [...this.registry.values()];
  }

  /**
   * Loads root and every registered scope in `lang`. A resolver may register
   * a scope while this waits, so it repeats until nothing new is pending; the
   * caller then applies synchronously, with no gap for another registration.
   */
  private async loadRegistered(lang: SupportedLang): Promise<void> {
    const loaded = new Set<string>();
    let pending = this.registeredScopes();
    await this.load([lang], pending);
    for (;;) {
      pending.forEach((scope) => loaded.add(scope.scope));
      pending = this.registeredScopes().filter((s) => !loaded.has(s.scope));
      if (pending.length === 0) return;
      await this.load([lang], pending);
    }
  }

  /**
   * For each language, in order: the root translation first, then the scopes.
   * The root goes through `TranslocoService.load` (its loader never fails);
   * scopes go through `loadScope`, which retries a failed path on the next
   * call instead of replaying Transloco's cached failure.
   */
  private async load(
    langs: readonly SupportedLang[],
    scopes: readonly I18nScope[],
  ): Promise<void> {
    for (const lang of langs) {
      await lastValueFrom(this.transloco.load(lang), { defaultValue: {} });
      await Promise.all(scopes.map((scope) => this.loadScope(scope, lang)));
    }
  }

  /**
   * Runs the scope's own loader (with one immediate retry, like Transloco's
   * `failedRetries: 1`) and stores the result under `scope/lang`, the same
   * call Transloco's own load makes, so keys read `scope.key`. A loaded path
   * is remembered; a failed one is not, so the next caller loads it afresh.
   */
  private loadScope(scope: I18nScope, lang: SupportedLang): Promise<void> {
    const path = scopeLoadPath(scope, lang);
    if (this.loadedPaths.has(path)) return Promise.resolve();
    const pending = this.inFlight.get(path);
    if (pending) return pending;

    const attempt = () => scope.loader[lang]().then(unwrapJsonModule);
    const load = attempt()
      .catch(() => attempt())
      .then((translation) => {
        this.transloco.setTranslation(translation, path, { emitChange: false });
        this.loadedPaths.add(path);
      })
      .finally(() => this.inFlight.delete(path));
    this.inFlight.set(path, load);
    return load;
  }

  /**
   * Second chance for English after a failed start. A real retry: failed
   * paths are not remembered, so every English loader that failed runs
   * again. (When the detected language failed first, `load` stopped before
   * English, so this may also be English's first attempt.)
   */
  private async retryEnglish(): Promise<void> {
    try {
      await this.load([DEFAULT_LANG], this.registeredScopes());
    } catch {
      // degradation-audit: reported - init() already logged the startup
      // failure; English text now falls back to '' via I18nMissingHandler.
      return;
    }
  }

  /** Switches Transloco, the signals and the document together. */
  private apply(lang: SupportedLang): void {
    this.transloco.setActiveLang(lang);
    this.current.set(lang);
    const root = this.document.documentElement;
    root.lang = lang;
    root.dir = LANG_DIRECTION[lang];
  }
}

function withEnglish(lang: SupportedLang): SupportedLang[] {
  return lang === DEFAULT_LANG ? [lang] : [lang, DEFAULT_LANG];
}

/**
 * A JSON module's `default` when `result` is a module wrapper, else `result`.
 * Library-internal (not in the barrel); `loadScopeTranslations` in the testing
 * entry reuses it so specs unwrap exactly as the runtime does.
 */
export function unwrapJsonModule(result: Translation): Translation {
  // Only a module wrapper is unwrapped. Bundlers and TypeScript repeat each
  // JSON key beside `default` (`{ default: X, ...X }`), so a wrapper is a plain
  // object `default` whose siblings are the same values. A translation with a
  // real top-level `default` section has other siblings and stays whole.
  const content: unknown = result['default'];
  if (!isPlainObject(content)) return result;
  const isWrapper = Object.keys(result).every(
    (key) => key === 'default' || result[key] === content[key],
  );
  return isWrapper ? content : result;
}

function isPlainObject(value: unknown): value is Translation {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toSupportedLang(value: string): SupportedLang {
  return isSupportedLang(value) ? value : DEFAULT_LANG;
}
