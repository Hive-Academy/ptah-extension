import { loadScopeTranslations } from '@ptah-extension/i18n/testing';
import ar from './ar.json';
import en from './en.json';
import { LEGAL_I18N_SCOPE } from './legal.i18n-scope';

describe('LEGAL_I18N_SCOPE', () => {
  it('is the "legal" scope, aliased to its own name', () => {
    expect(LEGAL_I18N_SCOPE.scope).toBe('legal');
    expect(LEGAL_I18N_SCOPE.alias).toBe('legal');
  });

  it('loads its en and ar translation files', async () => {
    expect(await loadScopeTranslations(LEGAL_I18N_SCOPE)).toEqual({ en, ar });
  });
});
