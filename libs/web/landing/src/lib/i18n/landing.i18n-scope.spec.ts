import { loadScopeTranslations } from '@ptah-extension/i18n/testing';
import ar from './ar.json';
import en from './en.json';
import { LANDING_I18N_SCOPE } from './landing.i18n-scope';

describe('LANDING_I18N_SCOPE', () => {
  it('is the "landing" scope, aliased to its own name', () => {
    expect(LANDING_I18N_SCOPE.scope).toBe('landing');
    expect(LANDING_I18N_SCOPE.alias).toBe('landing');
  });

  it('loads its en and ar translation files', async () => {
    expect(await loadScopeTranslations(LANDING_I18N_SCOPE)).toEqual({ en, ar });
  });
});
