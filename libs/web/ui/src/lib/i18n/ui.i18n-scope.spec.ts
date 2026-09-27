import ar from './ar.json';
import en from './en.json';
import { UI_I18N_SCOPE } from './ui.i18n-scope';

/** A JSON module arrives as `{ default: {...} }`; Transloco unwraps it. */
function unwrap(loaded: unknown): unknown {
  const json = loaded as Record<string, unknown>;
  return json['default'] ?? json;
}

describe('UI_I18N_SCOPE', () => {
  it('is the "ui" scope, aliased to its own name', () => {
    expect(UI_I18N_SCOPE.scope).toBe('ui');
    expect(UI_I18N_SCOPE.alias).toBe('ui');
  });

  it.each([
    ['en', en],
    ['ar', ar],
  ] as const)('loads its %s translation file', async (lang, expected) => {
    const loaded = await UI_I18N_SCOPE.loader[lang]();
    expect(unwrap(loaded)).toEqual(expected);
  });
});
