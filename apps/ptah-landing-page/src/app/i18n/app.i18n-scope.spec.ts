import { loadScopeTranslations } from '@ptah-extension/i18n/testing';
import ar from './ar.json';
import en from './en.json';
import { APP_I18N_SCOPE } from './app.i18n-scope';

describe('APP_I18N_SCOPE', () => {
  it('is the "app" scope, aliased to its own name', () => {
    expect(APP_I18N_SCOPE.scope).toBe('app');
    expect(APP_I18N_SCOPE.alias).toBe('app');
  });

  it('loads its en and ar translation files', async () => {
    expect(await loadScopeTranslations(APP_I18N_SCOPE)).toEqual({ en, ar });
  });
});
