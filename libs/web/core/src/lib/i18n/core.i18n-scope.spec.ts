import ar from './ar.json';
import en from './en.json';
import { CORE_I18N_SCOPE } from './core.i18n-scope';

/** A JSON module arrives as `{ default: {...} }`; Transloco unwraps it. */
function unwrap(loaded: unknown): unknown {
  const json = loaded as Record<string, unknown>;
  return json['default'] ?? json;
}

describe('CORE_I18N_SCOPE', () => {
  it('is the "core" scope, aliased to its own name', () => {
    expect(CORE_I18N_SCOPE.scope).toBe('core');
    expect(CORE_I18N_SCOPE.alias).toBe('core');
  });

  it.each([
    ['en', en],
    ['ar', ar],
  ] as const)('loads its %s translation file', async (lang, expected) => {
    const loaded = await CORE_I18N_SCOPE.loader[lang]();
    expect(unwrap(loaded)).toEqual(expected);
  });
});
