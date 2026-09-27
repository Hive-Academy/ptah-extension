import ar from './ar.json';
import en from './en.json';
import { APP_I18N_SCOPE } from './app.i18n-scope';

/** A JSON module arrives as `{ default: {...} }`; Transloco unwraps it. */
function unwrap(loaded: unknown): unknown {
  const json = loaded as Record<string, unknown>;
  return json['default'] ?? json;
}

describe('APP_I18N_SCOPE', () => {
  it('is the "app" scope, aliased to its own name', () => {
    expect(APP_I18N_SCOPE.scope).toBe('app');
    expect(APP_I18N_SCOPE.alias).toBe('app');
  });

  it.each([
    ['en', en],
    ['ar', ar],
  ] as const)('loads its %s translation file', async (lang, expected) => {
    const loaded = await APP_I18N_SCOPE.loader[lang]();
    expect(unwrap(loaded)).toEqual(expected);
  });
});
