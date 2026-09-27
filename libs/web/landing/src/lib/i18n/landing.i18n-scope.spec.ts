import ar from './ar.json';
import en from './en.json';
import { LANDING_I18N_SCOPE } from './landing.i18n-scope';

/** A JSON module arrives as `{ default: {...} }`; Transloco unwraps it. */
function unwrap(loaded: unknown): unknown {
  const json = loaded as Record<string, unknown>;
  return json['default'] ?? json;
}

describe('LANDING_I18N_SCOPE', () => {
  it('is the "landing" scope, aliased to its own name', () => {
    expect(LANDING_I18N_SCOPE.scope).toBe('landing');
    expect(LANDING_I18N_SCOPE.alias).toBe('landing');
  });

  it.each([
    ['en', en],
    ['ar', ar],
  ] as const)('loads its %s translation file', async (lang, expected) => {
    const loaded = await LANDING_I18N_SCOPE.loader[lang]();
    expect(unwrap(loaded)).toEqual(expected);
  });
});
