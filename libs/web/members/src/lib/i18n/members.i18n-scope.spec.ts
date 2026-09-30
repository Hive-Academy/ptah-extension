import { loadScopeTranslations } from '@ptah-extension/i18n/testing';
import { PANEL_UI_I18N_SCOPE } from '@ptah-web/panel-ui';
import ar from './ar.json';
import en from './en.json';
import { MEMBERS_I18N_SCOPE, MEMBERS_I18N_SCOPES } from './members.i18n-scope';

describe('MEMBERS_I18N_SCOPE', () => {
  it('is the "members" scope, aliased to its own name', () => {
    expect(MEMBERS_I18N_SCOPE.scope).toBe('members');
    expect(MEMBERS_I18N_SCOPE.alias).toBe('members');
  });

  it('loads its en and ar translation files', async () => {
    expect(await loadScopeTranslations(MEMBERS_I18N_SCOPE)).toEqual({ en, ar });
  });

  it('lists its own scope and the panel-ui scope in MEMBERS_I18N_SCOPES', () => {
    expect(MEMBERS_I18N_SCOPES).toEqual([
      MEMBERS_I18N_SCOPE,
      PANEL_UI_I18N_SCOPE,
    ]);
  });
});
