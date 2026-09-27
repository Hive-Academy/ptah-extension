import { defineI18nScope } from '../lib/i18n-scope';
import { I18nError } from '../lib/i18n.error';
import { loadScopeTranslations } from './load-scope-translations';

describe('loadScopeTranslations', () => {
  it('returns each language of a JSON-module scope, unwrapped', async () => {
    const scope = defineI18nScope('fixture', {
      en: () => import('../lib/__fixtures__/en.json'),
      ar: () => import('../lib/__fixtures__/ar.json'),
    });

    await expect(loadScopeTranslations(scope)).resolves.toEqual({
      en: { greeting: { hello: 'Hello' } },
      ar: { greeting: { hello: 'مرحبا' } },
    });
  });

  it('unwraps a module wrapper and keeps a real top-level `default` section', async () => {
    const content = { nav: { home: 'Home' } };
    const withDefaultSection = { default: { label: 'Default' }, other: 'x' };
    const scope = defineI18nScope('fixture', {
      en: () => Promise.resolve({ default: content, ...content }),
      ar: () => Promise.resolve(withDefaultSection),
    });

    await expect(loadScopeTranslations(scope)).resolves.toEqual({
      en: content,
      ar: withDefaultSection,
    });
  });

  it('rejects when the ar loader resolves to a non-translation', async () => {
    const scope = defineI18nScope('broken', {
      en: () => Promise.resolve({}),
      ar: () => Promise.resolve(null),
    });

    await expect(loadScopeTranslations(scope)).rejects.toBeInstanceOf(
      I18nError,
    );
  });

  it('rejects when the en loader resolves to a non-translation', async () => {
    const scope = defineI18nScope('broken', {
      en: () => Promise.resolve('not a translation'),
      ar: () => Promise.resolve({}),
    });

    await expect(loadScopeTranslations(scope)).rejects.toBeInstanceOf(
      I18nError,
    );
  });

  it('rejects with the error of a loader that rejects', async () => {
    const chunkError = new Error('chunk load failed');
    const scope = defineI18nScope('broken', {
      en: () => Promise.reject(chunkError),
      ar: () => Promise.resolve({}),
    });

    await expect(loadScopeTranslations(scope)).rejects.toBe(chunkError);
  });
});
