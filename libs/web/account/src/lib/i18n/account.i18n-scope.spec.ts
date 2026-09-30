import { loadScopeTranslations } from '@ptah-extension/i18n/testing';
import ar from './ar.json';
import en from './en.json';
import { ACCOUNT_I18N_SCOPE } from './account.i18n-scope';

describe('ACCOUNT_I18N_SCOPE', () => {
  it('is the "account" scope, aliased to its own name', () => {
    expect(ACCOUNT_I18N_SCOPE.scope).toBe('account');
    expect(ACCOUNT_I18N_SCOPE.alias).toBe('account');
  });

  it('loads its en and ar translation files', async () => {
    expect(await loadScopeTranslations(ACCOUNT_I18N_SCOPE)).toEqual({ en, ar });
  });
});
