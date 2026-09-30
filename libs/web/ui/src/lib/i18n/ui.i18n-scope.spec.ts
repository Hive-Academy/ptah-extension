import { loadScopeTranslations } from '@ptah-extension/i18n/testing';
import ar from './ar.json';
import en from './en.json';
import { UI_I18N_SCOPE } from './ui.i18n-scope';

describe('UI_I18N_SCOPE', () => {
  it('is the "ui" scope, aliased to its own name', () => {
    expect(UI_I18N_SCOPE.scope).toBe('ui');
    expect(UI_I18N_SCOPE.alias).toBe('ui');
  });

  it('loads its en and ar translation files', async () => {
    expect(await loadScopeTranslations(UI_I18N_SCOPE)).toEqual({ en, ar });
  });
});
