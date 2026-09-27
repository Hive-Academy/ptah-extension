import { loadScopeTranslations } from '@ptah-extension/i18n/testing';
import ar from './ar.json';
import en from './en.json';
import { CORE_I18N_SCOPE } from './core.i18n-scope';

describe('CORE_I18N_SCOPE', () => {
  it('is the "core" scope, aliased to its own name', () => {
    expect(CORE_I18N_SCOPE.scope).toBe('core');
    expect(CORE_I18N_SCOPE.alias).toBe('core');
  });

  it('loads its en and ar translation files', async () => {
    expect(await loadScopeTranslations(CORE_I18N_SCOPE)).toEqual({ en, ar });
  });
});
