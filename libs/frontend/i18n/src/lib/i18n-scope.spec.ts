import * as angularCore from '@angular/core';
import {
  defineI18nScope,
  scopeInlineLoader,
  scopeLoadPath,
} from './i18n-scope';

jest.mock('@angular/core', () => ({
  ...jest.requireActual<typeof angularCore>('@angular/core'),
  isDevMode: jest.fn(() => true),
}));

const isDevMode = jest.mocked(angularCore.isDevMode);

describe('defineI18nScope', () => {
  afterEach(() => isDevMode.mockReturnValue(true));

  it('builds a provider scope whose alias equals its name', () => {
    const scope = defineI18nScope('panelUi', {
      en: () => Promise.resolve({ a: 'A' }),
      ar: () => Promise.resolve({ a: 'أ' }),
    });

    expect(scope.scope).toBe('panelUi');
    expect(scope.alias).toBe('panelUi');
    expect(Object.keys(scope.loader).sort()).toEqual(['ar', 'en']);
    expect(Object.isFrozen(scope)).toBe(true);
    expect(Object.isFrozen(scope.loader)).toBe(true);
  });

  it('loads a JSON module through a dynamic import', async () => {
    const scope = defineI18nScope('fixture', {
      en: () => import('./__fixtures__/en.json'),
      ar: () => import('./__fixtures__/ar.json'),
    });

    const en = await scope.loader['en']();
    const ar = await scope.loader['ar']();

    // Transloco unwraps `default` itself; the loader hands the module through.
    const unwrap = (res: Record<string, unknown>) => res['default'] ?? res;
    expect(unwrap(en)).toEqual({ greeting: { hello: 'Hello' } });
    expect(unwrap(ar)).toEqual({ greeting: { hello: 'مرحبا' } });
  });

  it.each([[null], ['text'], [42], [['array']], [undefined]])(
    'rejects a loader that resolves to %p',
    async (value) => {
      const scope = defineI18nScope('broken', {
        en: () => Promise.resolve(value),
        ar: () => Promise.resolve({}),
      });
      await expect(scope.loader['en']()).rejects.toThrow(
        '[i18n] Loader for "broken/en"',
      );
    },
  );

  it('propagates a loader rejection as a load failure', async () => {
    const scope = defineI18nScope('failing', {
      en: () => Promise.reject(new Error('chunk failed')),
      ar: () => Promise.resolve({}),
    });
    await expect(scope.loader['en']()).rejects.toThrow('chunk failed');
  });

  it.each(['Pricing', 'panel-ui', 'panel_ui', 'ui2', 'a.b', 'a/b', ''])(
    'throws in dev mode for the malformed name %p',
    (name) => {
      expect(() =>
        defineI18nScope(name, {
          en: () => Promise.resolve({}),
          ar: () => Promise.resolve({}),
        }),
      ).toThrow(`[i18n] Invalid scope name "${name}"`);
    },
  );

  it('does not validate the name in production mode', () => {
    isDevMode.mockReturnValue(false);
    expect(
      defineI18nScope('panel-ui', {
        en: () => Promise.resolve({}),
        ar: () => Promise.resolve({}),
      }).scope,
    ).toBe('panel-ui');
  });
});

describe('scope load paths', () => {
  const scope = defineI18nScope('pricing', {
    en: () => Promise.resolve({ title: 'Pricing' }),
    ar: () => Promise.resolve({ title: 'الأسعار' }),
  });

  it('builds the Transloco `scope/lang` path', () => {
    expect(scopeLoadPath(scope, 'en')).toBe('pricing/en');
    expect(scopeLoadPath(scope, 'ar')).toBe('pricing/ar');
  });

  it('re-keys the loaders by load path, reusing the same functions', () => {
    const inlineLoader = scopeInlineLoader(scope);
    expect(Object.keys(inlineLoader).sort()).toEqual([
      'pricing/ar',
      'pricing/en',
    ]);
    expect(inlineLoader['pricing/en']).toBe(scope.loader['en']);
    expect(inlineLoader['pricing/ar']).toBe(scope.loader['ar']);
  });
});
