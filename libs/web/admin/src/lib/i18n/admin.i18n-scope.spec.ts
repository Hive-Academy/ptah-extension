import { loadScopeTranslations } from '@ptah-extension/i18n/testing';
import { PANEL_UI_I18N_SCOPE } from '@ptah-web/panel-ui';
import ar from './ar.json';
import en from './en.json';
import { ADMIN_I18N_SCOPE, ADMIN_I18N_SCOPES } from './admin.i18n-scope';

describe('ADMIN_I18N_SCOPE', () => {
  it('is the "admin" scope, aliased to its own name', () => {
    expect(ADMIN_I18N_SCOPE.scope).toBe('admin');
    expect(ADMIN_I18N_SCOPE.alias).toBe('admin');
  });

  it('loads its en and ar translation files', async () => {
    expect(await loadScopeTranslations(ADMIN_I18N_SCOPE)).toEqual({ en, ar });
  });

  it('lists its own scope and the panel-ui scope in ADMIN_I18N_SCOPES', () => {
    expect(ADMIN_I18N_SCOPES).toEqual([ADMIN_I18N_SCOPE, PANEL_UI_I18N_SCOPE]);
  });
});
