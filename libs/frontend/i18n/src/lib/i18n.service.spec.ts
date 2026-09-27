import { DOCUMENT, Injectable, PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  TranslocoService,
  type Translation,
  type TranslocoLoader,
} from '@jsverse/transloco';
import { of, type Observable } from 'rxjs';
import { I18nError } from './i18n.error';
import { defineI18nScope, type I18nScope } from './i18n-scope';
import { I18nService } from './i18n.service';
import type { SupportedLang } from './lang.config';
import { provideI18nRuntime } from './provide-i18n';

const KEY = 'spec.lang';

@Injectable()
class EmptyLoader implements TranslocoLoader {
  getTranslation(): Observable<Translation> {
    return of({});
  }
}

/** A scope whose loads can be held open, failed or counted per language. */
function controllableScope(name: string) {
  const calls: SupportedLang[] = [];
  const gates = new Map<SupportedLang, Promise<void>>();
  /** Calls still to fail per language (Infinity: always). */
  const failures = new Map<SupportedLang, number>();
  const text: Record<SupportedLang, string> = { en: 'Hello', ar: 'مرحبا' };
  const loadFor = (lang: SupportedLang) => async () => {
    calls.push(lang);
    await gates.get(lang);
    const remaining = failures.get(lang) ?? 0;
    if (remaining > 0) {
      failures.set(lang, remaining - 1);
      throw new Error(`chunk ${name}/${lang} failed`);
    }
    return { hello: text[lang] };
  };
  const scope = defineI18nScope(name, { en: loadFor('en'), ar: loadFor('ar') });
  return {
    scope,
    calls,
    fail: (lang: SupportedLang) => failures.set(lang, Infinity),
    /** Fails the next `times` calls, then loads normally. */
    failTimes: (lang: SupportedLang, times: number) =>
      failures.set(lang, times),
    callsFor: (lang: SupportedLang) => calls.filter((c) => c === lang).length,
    hold(lang: SupportedLang): () => void {
      let release!: () => void;
      gates.set(lang, new Promise<void>((resolve) => (release = resolve)));
      return () => release();
    },
  };
}

function setup(
  globalScopes: readonly I18nScope[],
  platform: 'browser' | 'server' = 'browser',
) {
  TestBed.configureTestingModule({
    providers: [
      provideI18nRuntime({
        options: { storageKey: KEY, globalScopes },
        initialLang: 'en',
        rootLoader: EmptyLoader,
        missingKeys: 'report',
        prodMode: true,
      }),
      { provide: PLATFORM_ID, useValue: platform },
    ],
  });
  return {
    i18n: TestBed.inject(I18nService),
    transloco: TestBed.inject(TranslocoService),
    root: TestBed.inject(DOCUMENT).documentElement,
  };
}

function i18nErrors(spy: jest.SpyInstance): unknown[][] {
  return spy.mock.calls.filter(
    ([message]) => typeof message === 'string' && message.startsWith('[i18n]'),
  );
}

describe('I18nService', () => {
  let consoleError: jest.SpyInstance;
  let consoleWarn: jest.SpyInstance;

  beforeEach(() => {
    consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    consoleWarn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    localStorage.clear();
    document.documentElement.removeAttribute('lang');
    document.documentElement.removeAttribute('dir');
  });

  describe('init', () => {
    it('restores a stored language and loads global scopes in it and in English', async () => {
      localStorage.setItem(KEY, 'ar');
      const global = controllableScope('greeting');
      const { i18n, transloco, root } = setup([global.scope]);

      await i18n.init();

      expect(i18n.lang()).toBe('ar');
      expect(i18n.direction()).toBe('rtl');
      expect(i18n.locale()).toBe('ar');
      expect(i18n.intlLocale()).toBe('ar-u-nu-latn');
      expect(transloco.getActiveLang()).toBe('ar');
      expect(root.lang).toBe('ar');
      expect(root.dir).toBe('rtl');
      expect(global.calls.sort()).toEqual(['ar', 'en']);
      expect(i18n.translate('greeting.hello')).toBe('مرحبا');
      expect(i18n.translate('greeting.hello', {}, 'en')).toBe('Hello');
    });

    it('detects Arabic from the first browser language', async () => {
      jest
        .spyOn(window.navigator, 'languages', 'get')
        .mockReturnValue(['ar-EG']);
      const { i18n } = setup([]);

      await i18n.init();

      expect(i18n.lang()).toBe('ar');
      // Detection is not a choice: nothing is stored.
      expect(localStorage.getItem(KEY)).toBeNull();
    });

    it('ignores an invalid stored value', async () => {
      localStorage.setItem(KEY, 'xx');
      jest
        .spyOn(window.navigator, 'languages', 'get')
        .mockReturnValue(['fr-FR']);
      const { i18n, root } = setup([]);

      await i18n.init();

      expect(i18n.lang()).toBe('en');
      expect(root.dir).toBe('ltr');
    });

    it('falls back to detection when storage throws', async () => {
      jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('denied', 'SecurityError');
      });
      jest.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['ar']);
      const { i18n } = setup([]);

      await expect(i18n.init()).resolves.toBeUndefined();
      expect(i18n.lang()).toBe('ar');
    });

    it('always renders English on the server, whatever is stored', async () => {
      localStorage.setItem(KEY, 'ar');
      const global = controllableScope('greeting');
      const { i18n, root } = setup([global.scope], 'server');

      await i18n.init();

      expect(i18n.lang()).toBe('en');
      expect(root.lang).toBe('en');
      expect(global.calls).toEqual(['en']);
    });

    it('falls back to English and logs once when the language fails to load', async () => {
      localStorage.setItem(KEY, 'ar');
      const global = controllableScope('greeting');
      global.fail('ar');
      const { i18n, transloco, root } = setup([global.scope]);

      await expect(i18n.init()).resolves.toBeUndefined();

      expect(i18n.lang()).toBe('en');
      expect(transloco.getActiveLang()).toBe('en');
      expect(root.dir).toBe('ltr');
      expect(i18n.translate('greeting.hello')).toBe('Hello');
      expect(i18nErrors(consoleError)).toHaveLength(1);
    });

    it('retries English for real when it failed during the first attempt', async () => {
      localStorage.setItem(KEY, 'ar');
      const global = controllableScope('greeting');
      // Both calls of the first attempt (load + immediate retry) fail; the
      // English retry after the failed start calls the loader again.
      global.failTimes('en', 2);
      const { i18n, root } = setup([global.scope]);

      await expect(i18n.init()).resolves.toBeUndefined();

      expect(global.callsFor('en')).toBe(3);
      expect(i18n.lang()).toBe('en');
      expect(root.dir).toBe('ltr');
      expect(i18n.translate('greeting.hello')).toBe('Hello');
      expect(i18nErrors(consoleError)).toHaveLength(1);
    });

    it('never rejects, even when English fails too', async () => {
      localStorage.setItem(KEY, 'ar');
      const global = controllableScope('greeting');
      global.fail('ar');
      global.fail('en');
      const { i18n } = setup([global.scope]);

      await expect(i18n.init()).resolves.toBeUndefined();

      expect(i18n.lang()).toBe('en');
      expect(i18nErrors(consoleError)).toHaveLength(1);
      // Never the raw key.
      expect(i18n.translate('greeting.hello')).toBe('');
    });
  });

  describe('setLanguage', () => {
    it('loads every registered scope, then switches and stores the choice', async () => {
      const global = controllableScope('greeting');
      const { i18n, transloco, root } = setup([global.scope]);
      await i18n.init();

      await expect(i18n.setLanguage('ar')).resolves.toBe(true);

      expect(global.calls.sort()).toEqual(['ar', 'en']);
      expect(i18n.lang()).toBe('ar');
      expect(i18n.direction()).toBe('rtl');
      expect(transloco.getActiveLang()).toBe('ar');
      expect(root.lang).toBe('ar');
      expect(root.dir).toBe('rtl');
      expect(localStorage.getItem(KEY)).toBe('ar');
      expect(i18n.translate('greeting.hello')).toBe('مرحبا');
    });

    it('returns false and leaves the state unchanged when loading fails', async () => {
      const global = controllableScope('greeting');
      global.fail('ar');
      const { i18n, transloco, root } = setup([global.scope]);
      await i18n.init();

      await expect(i18n.setLanguage('ar')).resolves.toBe(false);

      expect(i18n.lang()).toBe('en');
      expect(transloco.getActiveLang()).toBe('en');
      expect(root.lang).toBe('en');
      expect(root.dir).toBe('ltr');
      expect(localStorage.getItem(KEY)).toBeNull();
      expect(i18nErrors(consoleError)).toHaveLength(1);
    });

    it('retries a scope that failed on an earlier switch', async () => {
      const global = controllableScope('greeting');
      const { i18n } = setup([global.scope]);
      await i18n.init();
      // The first switch fails (both the load and its immediate retry).
      global.failTimes('ar', 2);

      await expect(i18n.setLanguage('ar')).resolves.toBe(false);
      expect(i18n.lang()).toBe('en');
      expect(global.callsFor('ar')).toBe(2);

      await expect(i18n.setLanguage('ar')).resolves.toBe(true);
      expect(global.callsFor('ar')).toBe(3);
      expect(i18n.lang()).toBe('ar');
      expect(i18n.translate('greeting.hello')).toBe('مرحبا');
    });

    it('recovers within one call when only the first attempt fails', async () => {
      const global = controllableScope('greeting');
      const { i18n } = setup([global.scope]);
      await i18n.init();
      global.failTimes('ar', 1);

      await expect(i18n.setLanguage('ar')).resolves.toBe(true);
      expect(global.callsFor('ar')).toBe(2);
    });

    it('shares one loader call between concurrent loads of the same pair', async () => {
      const global = controllableScope('greeting');
      const { i18n } = setup([global.scope]);
      await i18n.init();
      const release = global.hold('ar');

      const first = i18n.setLanguage('ar');
      const second = i18n.setLanguage('ar');
      release();

      await expect(first).resolves.toBe(false);
      await expect(second).resolves.toBe(true);
      expect(global.callsFor('ar')).toBe(1);
      expect(i18n.translate('greeting.hello')).toBe('مرحبا');
    });

    it('does not reload a pair that already loaded', async () => {
      const global = controllableScope('greeting');
      const { i18n } = setup([global.scope]);
      await i18n.init();

      await i18n.setLanguage('ar');
      await i18n.setLanguage('en');
      await i18n.setLanguage('ar');

      expect(global.callsFor('ar')).toBe(1);
      expect(global.callsFor('en')).toBe(1);
    });

    it('lets the latest of two concurrent calls win', async () => {
      const global = controllableScope('greeting');
      const { i18n, transloco } = setup([global.scope]);
      await i18n.init();
      const release = global.hold('ar');

      const toArabic = i18n.setLanguage('ar');
      const toEnglish = i18n.setLanguage('en');
      await expect(toEnglish).resolves.toBe(true);
      release();

      await expect(toArabic).resolves.toBe(false);
      expect(i18n.lang()).toBe('en');
      expect(transloco.getActiveLang()).toBe('en');
      expect(localStorage.getItem(KEY)).toBe('en');
    });

    it('also loads a scope registered while the switch was loading', async () => {
      const global = controllableScope('greeting');
      const late = controllableScope('late');
      const { i18n } = setup([global.scope]);
      await i18n.init();
      const release = global.hold('ar');

      const switching = i18n.setLanguage('ar');
      const resolving = new Promise<void>((resolve) =>
        i18n.loadScopes([late.scope]).subscribe({ complete: resolve }),
      );
      await resolving;
      release();

      await expect(switching).resolves.toBe(true);
      expect(late.calls.sort()).toEqual(['ar', 'en']);
      expect(i18n.translate('late.hello')).toBe('مرحبا');
    });
  });

  describe('scope loader results', () => {
    async function load(scope: I18nScope) {
      const { i18n } = setup([scope]);
      await i18n.init();
      return i18n;
    }

    it('keeps a real top-level `default` section and its siblings', async () => {
      const result = {
        default: { label: 'Default' },
        theme: { label: 'Theme' },
      };
      const i18n = await load(
        defineI18nScope('sections', {
          en: () => Promise.resolve(result),
          ar: () => Promise.resolve(result),
        }),
      );

      expect(i18n.translate('sections.default.label')).toBe('Default');
      expect(i18n.translate('sections.theme.label')).toBe('Theme');
    });

    it('unwraps a real JSON module import', async () => {
      const i18n = await load(
        defineI18nScope('fixture', {
          en: () => import('./__fixtures__/en.json'),
          ar: () => import('./__fixtures__/ar.json'),
        }),
      );

      expect(i18n.translate('fixture.greeting.hello')).toBe('Hello');
      await i18n.setLanguage('ar');
      expect(i18n.translate('fixture.greeting.hello')).toBe('مرحبا');
    });

    it('unwraps a wrapper-shaped object { default: X, ...X }', async () => {
      const content = { greeting: { hello: 'Wrapped' }, title: 'Title' };
      const wrapper = { default: content, ...content };
      const i18n = await load(
        defineI18nScope('wrapped', {
          en: () => Promise.resolve(wrapper),
          ar: () => Promise.resolve(wrapper),
        }),
      );

      expect(i18n.translate('wrapped.greeting.hello')).toBe('Wrapped');
      expect(i18n.translate('wrapped.title')).toBe('Title');
      // Unwrapped: no `default` section was stored.
      expect(i18n.translate('wrapped.default.title')).toBe('');
    });

    it('resolves a key three levels deep', async () => {
      const i18n = await load(
        defineI18nScope('deep', {
          en: () => Promise.resolve({ a: { b: { c: 'Deep' } } }),
          ar: () => Promise.resolve({ a: { b: { c: 'عميق' } } }),
        }),
      );

      expect(i18n.translate('deep.a.b.c')).toBe('Deep');
    });
  });

  describe('loadScopes', () => {
    it('loads a scope for the active language and English, once', async () => {
      const { i18n } = setup([]);
      await i18n.init();
      await i18n.setLanguage('ar');
      const feature = controllableScope('feature');

      await new Promise<void>((resolve) =>
        i18n.loadScopes([feature.scope]).subscribe({ complete: resolve }),
      );
      await new Promise<void>((resolve) =>
        i18n.loadScopes([feature.scope]).subscribe({ complete: resolve }),
      );

      expect(feature.calls.sort()).toEqual(['ar', 'en']);
      expect(i18n.translate('feature.hello')).toBe('مرحبا');
    });

    it('rejects a second, different scope under a registered name (dev)', async () => {
      const first = controllableScope('dup');
      const second = controllableScope('dup');
      const { i18n } = setup([first.scope]);
      await i18n.init();

      const error = await new Promise<unknown>((resolve) =>
        i18n.loadScopes([second.scope]).subscribe({ error: resolve }),
      );

      expect(error).toBeInstanceOf(I18nError);
      expect((error as Error).message).toContain('"dup" is already registered');
    });
  });

  it('interpolates params in translate()', async () => {
    const scope = defineI18nScope('msg', {
      en: () => Promise.resolve({ count: '{{n}} items' }),
      ar: () => Promise.resolve({ count: '{{n}} عناصر' }),
    });
    const { i18n } = setup([scope]);
    await i18n.init();

    expect(i18n.translate('msg.count', { n: 3 })).toBe('3 items');
    expect(consoleWarn).not.toHaveBeenCalled();
  });
});
