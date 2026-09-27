import { loadScopeTranslations } from '@ptah-extension/i18n/testing';
import ar from './ar.json';
import en from './en.json';
import { AUTH_I18N_SCOPE } from './auth.i18n-scope';

describe('AUTH_I18N_SCOPE', () => {
  it('is the "auth" scope, aliased to its own name', () => {
    expect(AUTH_I18N_SCOPE.scope).toBe('auth');
    expect(AUTH_I18N_SCOPE.alias).toBe('auth');
  });

  it('loads its en and ar translation files', async () => {
    expect(await loadScopeTranslations(AUTH_I18N_SCOPE)).toEqual({ en, ar });
  });
});
