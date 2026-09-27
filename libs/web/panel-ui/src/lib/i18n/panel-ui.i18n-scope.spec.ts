import ar from './ar.json';
import en from './en.json';
import { PANEL_UI_I18N_SCOPE } from './panel-ui.i18n-scope';

/** A JSON module arrives as `{ default: {...} }`; Transloco unwraps it. */
function unwrap(loaded: unknown): unknown {
  const json = loaded as Record<string, unknown>;
  return json['default'] ?? json;
}

describe('PANEL_UI_I18N_SCOPE', () => {
  it('is the "panelUi" scope, aliased to its own name', () => {
    expect(PANEL_UI_I18N_SCOPE.scope).toBe('panelUi');
    expect(PANEL_UI_I18N_SCOPE.alias).toBe('panelUi');
  });

  it.each([
    ['en', en],
    ['ar', ar],
  ] as const)('loads its %s translation file', async (lang, expected) => {
    const loaded = await PANEL_UI_I18N_SCOPE.loader[lang]();
    expect(unwrap(loaded)).toEqual(expected);
  });
});
