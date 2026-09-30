import { loadScopeTranslations } from '@ptah-extension/i18n/testing';
import ar from './ar.json';
import en from './en.json';
import { PANEL_UI_I18N_SCOPE } from './panel-ui.i18n-scope';

describe('PANEL_UI_I18N_SCOPE', () => {
  it('is the "panelUi" scope, aliased to its own name', () => {
    expect(PANEL_UI_I18N_SCOPE.scope).toBe('panelUi');
    expect(PANEL_UI_I18N_SCOPE.alias).toBe('panelUi');
  });

  it('loads its en and ar translation files', async () => {
    expect(await loadScopeTranslations(PANEL_UI_I18N_SCOPE)).toEqual({
      en,
      ar,
    });
  });
});
